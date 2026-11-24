/**
 * Server code used only by `/api/imports`. Shared code stays in
 * `src/lib/api/functions`. Server-only: nothing in components, views or the
 * client helpers may import this file.
 */
import { and, asc, eq, gte, inArray, lte, ne, sql, desc } from "drizzle-orm";
import { IMPORT_MAPPING_UNUSABLE, type ImportMappingShape, type ImportPreviewShape, type ImportBatchShape, type ImportFailedRowShape } from "@workspace/api-contract";
import { categoriesTable, db, expenseItemsTable, peopleTable, revenueItemsTable, sourcesTable, transactionLinesTable, transactionsTable, importBatchesTable, type CostNature, type ExpenseBehavior, type ExpenseItemPurpose, type PersonKind, type PricingModel, type RevenueItemType, recurringSchedulesTable, subscriptionsTable } from "@workspace/db";
import { addCents, cellsOf, columnsFor, ignoredHeadersFor, isMapped, mappingProblem, mulCentsQty, normalizeDescription, type CatalogKind, type Direction, type ImportKind, type OrderGroup, type OrderLine, type ParsedCatalogRow, calendarDayIn, duplicateKey, zonedDayEnd, zonedDayStart, groupTransactionRows, guessMapping, inferDateOrder, isPayoutLike, looksLikeCsvFilename, parseCatalogRows, parseCsvTable, parseTransactionRows, willGroup, CSV_TOO_BIG_MESSAGE, MAX_CSV_BYTES, NOT_A_CSV_MESSAGE, NO_CHANNEL_REASON, TRANSACTION_TOTAL_FIELDS, type DateOrder, type TotalsMode } from "@workspace/domain";
import { logger } from "@/lib/api/functions/lib/logger";
import { uid } from "@/lib/api/functions/lib/uid";
import { sanitizeFilename } from "@/lib/api/functions/services/attachments";
import { listSources, revenueItemHasVariants, createExpenseItem, createRevenueItem, createSource, findOrCreateCategory, setDirectCost, setRevenueItemSourceLinks, updateExpenseItem, updateRevenueItem } from "@/lib/api/functions/services/catalog";
import { ServiceError, invalid, unavailable, notFound } from "@/lib/api/functions/services/errors";
import { createTransaction, type CreateTransactionLineInput, voidTransaction } from "@/lib/api/functions/services/ledger";
import { findOrCreatePerson } from "@/lib/api/functions/services/person";

// ── csvImportRead ────────────────────────────────────────────────

/**
 * What an uploaded file SAYS, before anyone asks the database anything.
 *
 * Which columns a mapping claims and which it ignored, whether that mapping can
 * read the file at all, the cells behind a row number, the label a blank
 * description falls back to, and the figure the ledger will write for a set of
 * lines. Every function here takes parsed input and returns a value.
 *
 * IT ASKS NOTHING. There is no `db` import in this file and there must not be
 * one: the moment a rule here needs a lookup it belongs on the other side of
 * this seam, in `csvImport.ts` with the orchestration. That is the whole point
 * of the split — `csvImport.ts` holds the order the plan is built in and the
 * two questions it puts to the database, and everything it can decide from the
 * file alone lives here, provable without a Postgres.
 *
 * `csvImportResolve.ts` is the other half of the same story: it owns the two
 * questions ("is this word one of your channels / items?", "do you already have
 * this row?"). Read the three together and the shape is — this file reads, that
 * file looks up, `csvImport.ts` decides.
 */

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

/**
 * A line of the plan: the file's line, plus what its names already mean in this
 * business.
 *
 * The resolution lives in `buildPlan` rather than in commit so the two can never
 * differ. A preview that resolves an item the commit then refuses is the one
 * thing that screen must never do. The fields start null here, where the line is
 * built from the file, and `resolveGroups` fills them.
 */
export interface PlanLine extends OrderLine {
  revenueItemId: string | null;
  expenseItemId: string | null;
  categoryId: string | null;
}

export type PlanGroupBody = Omit<OrderGroup, "lines"> & { lines: PlanLine[] };

/**
 * The three kinds that describe the business rather than move its money.
 *
 * The domain's own type, re-exported rather than redeclared: `parseCatalogRows`
 * takes it, and two definitions of one list are how a fifth kind gets added to
 * only one of them.
 */
export type { CatalogKind };

/**
 * One row of a catalog or people file, as the plan carries it.
 *
 * The counterpart of `PlanGroup` for the kinds that create a record rather than
 * a money event. It carries no date, no direction and no lines, because a
 * revenue item and a customer have none — see `importReadRow` in the contract,
 * whose four nullable fields exist for exactly this.
 */
export interface PlanRecord {
  /**
   * Stable across a re-parse of the same file with the same mapping, so commit
   * can honour `includeKeys`. The same scheme the transaction groups use, with
   * the order-id half always empty: a catalog row has no order.
   */
  key: string;
  rowNumbers: number[];
  /** The name the owner reads to recognise the row. */
  description: string;
  /** The second identifying column: an item's category, a person's email. */
  detail: string | null;
  /** The item's price or typical amount when the file gave one. People have none. */
  amountCents: number | null;
  /** The row as the file had it, so a failure at write time is still downloadable. */
  cells: string[];
  /** Null on a ready row. On a skipped one, why, in plain English. */
  skipReason: string | null;
  /** What the file said, checked but not yet resolved against this business. */
  row: ParsedCatalogRow;
  /**
   * The channels a "Sold on" column names, with the id where this business
   * already has one. Null means commit will create it. Empty for the kinds that
   * have no such column — a channel belongs to a listing, never to a person.
   */
  channels: Array<{ name: string; sourceId: string | null }>;
}

// ---------------------------------------------------------------------------
// The mapping
// ---------------------------------------------------------------------------

/**
 * Re-exported, not defined here: `isMapped` moved into `@workspace/domain`
 * beside the column table it questions, because the matching screen asks the
 * same thing of the same mapping. The server's own callers keep importing it
 * from this module, which is the seam they already read.
 */
export { isMapped };

/**
 * Headers no field claimed, recomputed against the mapping actually in force.
 *
 * Re-exported, not defined here, for the reason `isMapped` above is: it moved
 * into `@workspace/domain` when the matching screen needed to name the same
 * unused columns this response does, and one function naming them is the only
 * way the two lists cannot drift.
 */
export { ignoredHeadersFor };

/**
 * Is this mapping capable of reading the file at all? Refuse if not.
 *
 * The QUESTION is `mappingProblem` in `@workspace/domain`; this is the half that
 * turns its answer into a 400. They are split because the matching screen states
 * the same problem, in the same words, above the dropdowns that fix it — so the
 * owner reads one sentence rather than two that nearly agree.
 *
 * The refusal carries `IMPORT_MAPPING_UNUSABLE` rather than the general-purpose
 * `invalid`. Same 400 either way (`statusFor` in `contractError.ts` answers 400
 * to everything but `not_found` and `unavailable`) — the code exists so the
 * upload screen can tell THIS refusal, the only one a dropdown can fix, from
 * every other reason a file gets turned away. See the constant in the contract.
 */
export function assertMappingIsUsable(kind: ImportKind, mapping: ImportMappingShape): void {
  const problem = mappingProblem(kind, mapping);
  if (problem !== null) throw new ServiceError(IMPORT_MAPPING_UNUSABLE, problem);
}

/**
 * Every cell of a mapped column. Re-exported, not defined here, for the reason
 * `isMapped` and `ignoredHeadersFor` above are: the matching screen reads one
 * date cell out of the same column this does, to quote back at the owner.
 */
export { cellsOf };

/**
 * Is the column a field was mapped to actually IN this file?
 *
 * `assertMappingIsUsable` asks whether a field is MAPPED. It cannot ask whether
 * the header that mapping names exists, and a mapping saved against last month's
 * export names columns this month's file may not have. `cellsOf` reads such a
 * column as no cells at all — so any rule that reads "no cells" as "nothing
 * contradicted me" would state a certainty about a column nobody ever read.
 */
export function headerIsPresent(table: { headers: string[] }, header: string | undefined): boolean {
  return header !== undefined && table.headers.includes(header);
}

/** The row as the file had it, by the 1-based number the owner sees. */
export function cellsAtRow(table: { headers: string[]; rows: string[][] }, rowNumber: number): string[] {
  return (table.rows[rowNumber - 1] ?? []).slice();
}

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

/**
 * A blank label filled in from the item name, on the group AND on every line.
 *
 * `parseTransactionRows` accepts a description OR an item, so an Item-only
 * export gives every row `description: ""` — legitimately. Left alone that empty
 * string reaches both the group's description and every line's label, and an
 * unmatched item then produces an unlinked line with no label, which
 * `createTransaction` refuses outright ("Unlinked lines need a label"). So an
 * ordinary Item-only export would fail every row.
 *
 * `trim() ||` rather than `??`, matching `loadExistingKeys` on the other side of
 * the duplicate check character for character: a whitespace-only label falls
 * through to the item name on both sides, or the two stop agreeing about the
 * same sale.
 */
export function backfillLabels(group: OrderGroup): PlanGroupBody {
  const lines = group.lines.map((line) => ({
    ...line,
    label: line.label.trim() || (line.itemName ?? ""),
    revenueItemId: null,
    expenseItemId: null,
    categoryId: null,
  }));
  return {
    ...group,
    description: group.description.trim() || (lines[0]?.label ?? ""),
    lines,
  };
}

// ---------------------------------------------------------------------------
// What the ledger will actually write
// ---------------------------------------------------------------------------

/**
 * A quantity the ledger will actually take — `ledger.ts`'s own `parseQty` rule,
 * mirrored here on purpose so the check screen and the write agree.
 *
 * `importRows` deliberately accepts a signed quantity, quoting whatever the cell
 * said rather than coercing it. That is right for reading a file and wrong for
 * promising an outcome: "0" and "-1" both parse, and both throw at commit.
 */
export function isSellableQty(qty: string): boolean {
  return /^\d+(\.\d+)?$/.test(qty) && Number(qty) > 0;
}

/**
 * Σ(quantity × unit price), which is what `createTransaction` writes.
 *
 * NOT Σ of the Amount cells. `OrderLine.amountCents` is the cell as written and
 * `qty` is a separate decimal string; the ledger multiplies them. A Shopify
 * order of 20.00 × 2 plus 10.00 × 1 adds to 3000 as cells and lands as 5000, and
 * the check screen is the one place the owner confirms a figure before it
 * becomes money.
 *
 * Through the domain's own `mulCentsQty` — quantity is a decimal string and the
 * multiplication must not go through a float.
 */
export function totalOf(lines: readonly OrderLine[]): number {
  let total = 0;
  for (const line of lines) total = addCents(total, mulCentsQty(line.amountCents, line.qty));
  return total;
}

/**
 * The direction the ledger will store: "in" if anything on the order earns, else
 * "out" — `createTransaction`'s own rule, not the first row's direction.
 *
 * It matters for the duplicate check, which compares against
 * `transactions.direction` on the other side.
 */
export function headerDirectionOf(lines: readonly OrderLine[]): Direction {
  return lines.some((line) => line.direction === "in") ? "in" : "out";
}

// ---------------------------------------------------------------------------
// What a catalog row says
// ---------------------------------------------------------------------------

/** The money column each kind shows on the check screen. People have none. */
const CATALOG_AMOUNT_FIELD: Record<CatalogKind, string | null> = {
  revenue_items: "price",
  expense_items: "defaultAmount",
  people: null,
};

/** The second identifying column, so two rows sharing a name can be told apart. */
const CATALOG_DETAIL_FIELD: Record<CatalogKind, string> = {
  revenue_items: "category",
  expense_items: "category",
  people: "email",
};

/**
 * The three things the check screen shows about a catalog row.
 *
 * A person with no name is displayed by their email, because that is the name
 * `findOrCreatePerson` will store for them (`displayName: name || email`). The
 * screen has to show what the write will actually record.
 */
export function catalogDisplay(
  kind: CatalogKind,
  row: ParsedCatalogRow,
): { description: string; detail: string | null; amountCents: number | null } {
  const name = row.values.name ?? "";
  const detailField = CATALOG_DETAIL_FIELD[kind];
  const amountField = CATALOG_AMOUNT_FIELD[kind];
  return {
    description: kind === "people" ? name || (row.values.email ?? "") : name,
    detail: (row.values[detailField] ?? "") || null,
    amountCents: amountField === null ? null : row.moneyCents[amountField] ?? null,
  };
}

/**
 * What the WRITE would refuse about this row, said on the check screen instead.
 *
 * Every rule here mirrors one the service it lands through already enforces, in
 * that service's own words where it has any. A row shown as ready that the
 * create then throws out is the one thing this screen must never do — the same
 * bargain the transactions path strikes with quantities and negative header
 * money.
 */
export function catalogRowProblem(kind: CatalogKind, row: ParsedCatalogRow): string | null {
  if (kind === "people") {
    // `findOrCreatePerson`'s own sentence, verbatim: one rule, one explanation,
    // whichever screen the owner reached it from.
    const name = (row.values.name ?? "").trim();
    const email = (row.values.email ?? "").trim();
    if (!name && !email) return "A person needs a name or an email";
    return null;
  }

  // A price or a cost the create will refuse, refused here — the same rule
  // `negativeHeaderMoney` applies to a transaction's tax, shipping and discount,
  // and for the same reason. `createRevenueItem`, `addCostComponent` and
  // `createExpenseItem` each demand non-negative cents, in a vocabulary the UI
  // is never allowed to speak ("value_cents must be non-negative integer
  // cents"). Worse on a revenue row: the item is created BEFORE its direct cost
  // is written, so a negative cost would leave the item behind and still report
  // the row as failed.
  const negative = columnsFor(kind).find(
    (column) => column.kind === "money" && (row.moneyCents[column.field] ?? 0) < 0,
  );
  if (negative !== undefined) return `${negative.label} can't be a negative amount`;

  if (kind === "revenue_items") {
    // `createRevenueItem` allows a null price exactly when the price varies per
    // engagement, and requires one otherwise.
    const variable = row.values.pricingModel === "variable";
    const priced = row.moneyCents.price !== undefined;
    if (!variable && !priced) return "This row has no price";
    if (variable && priced) return "A price that varies can't also be a fixed amount — leave Price blank";
  }
  return null;
}

/**
 * The channels a "Sold on" cell names.
 *
 * Comma-separated, as the column's own hint tells the owner to write it. Blanks
 * are dropped rather than becoming a channel with no name, and a repeat within
 * one cell is asked for once — `setRevenueItemSourceLinks` takes a set.
 *
 * "Blank" is judged by `normalizeDescription` and NOT by `trim`, because that
 * fold is what every channel lookup on both sides of this feature compares by.
 * A cell holding `-`, `—` or `.` survives a trim and then folds to nothing when
 * matched, so trimming alone let a name with no letters in it through: the row
 * previewed ready, and commit created the item, wrote its cost, and only then
 * refused the row for a channel that never had a name — leaving the item behind
 * with no batch to undo it by. One fold, asked the same way in both places, and
 * a "Sold on" of `-` means what the owner meant by it: no channels.
 */
export function channelNamesOf(row: ParsedCatalogRow): string[] {
  const cell = row.values.soldOn ?? "";
  const names: string[] = [];
  for (const part of cell.split(",")) {
    const name = part.trim();
    if (normalizeDescription(name) !== "" && !names.includes(name)) names.push(name);
  }
  return names;
}

// ── csvImportResolve ─────────────────────────────────────────────

/**
 * What the names in someone's file already mean in their business.
 *
 * The check screen has two questions for the database and nothing else to ask:
 * "is this word one of your channels / items / categories?" and "do you already
 * have this row?". This module answers both and stops there.
 *
 * IT READS. It writes nothing — no insert, no update, no `createTransaction`.
 * Everything an import lands goes through the same domain services the Add
 * buttons use (CLAUDE.md), and a lookup module that could also write would be
 * the first crack in that.
 *
 * Two rules shape the rest:
 *
 *   - Every query names the business. A lookup that forgot would hand one
 *     customer another customer's books, and it would do it silently, on the
 *     screen where the owner is being asked to trust what they are shown.
 *   - The duplicate fingerprint is built in memory, compared, and thrown away.
 *     It is NEVER written to a column. `DECISIONS.md` (2026-08-03) recorded
 *     what storing a content hash does: correct a typo and the row stops
 *     matching its own past self, so the fix lands beside the row it was meant
 *     to replace and the day counts twice.
 */

// ---------------------------------------------------------------------------
// Names to ids
// ---------------------------------------------------------------------------

export interface BusinessIndex {
  sourcesByName: Map<string, string>; // normalized name -> id
  revenueItemsByName: Map<string, string>;
  expenseItemsByName: Map<string, string>;
  categoriesByName: Map<string, string>;
}

/**
 * Every map is keyed with `normalizeDescription` — the domain's own fold, the
 * one the duplicate check uses.
 *
 * That is not tidiness. If this module lowercased a name and the duplicate
 * check folded punctuation, "Facebook Ads" and "facebook  ads" would resolve to
 * the same item in one place and to different rows in the other, and the two
 * halves of one screen would disagree about the same file. One normalizer, or
 * the agreement is accidental.
 *
 * First entry wins, and rows are ordered so "first" means something: names are
 * unique per business, but the fold can still collide — "Café" and "Cafe" are
 * one key. Ordering by name then id makes the winner the same on every run
 * rather than whatever the database happened to return.
 *
 * A name that folds to nothing (punctuation only, or a wholly non-Latin name)
 * is left out. An empty key would match every unnamed cell in the file.
 *
 * Categories tagged `time` are left out too, and that one is not a preference.
 * They are the internal buckets that absorb labour — Admin, Sales & pitching —
 * seeded into EVERY business at creation (`seedInternalTimeCategories`), and
 * the rest of the codebase refuses to let money near them: `findOrCreateCategory`
 * THROWS when a money label resolves to one, `createCategory` repeats the guard,
 * and `listCategories(businessId, "expense")` keeps them out of the picker.
 * Without this predicate, a Category column reading "Admin" — an ordinary word
 * on any expense sheet — would file that expense under a bucket no money report
 * looks in, and the owner could not fix it afterwards because the picker will
 * not show them the bucket it landed in. So the import matches names against
 * exactly the tags the money pickers offer.
 */
export async function loadBusinessIndex(businessId: string): Promise<BusinessIndex> {
  const [sources, revenueItems, expenseItems, categories] = await Promise.all([
    db
      .select({ id: sourcesTable.id, name: sourcesTable.name })
      .from(sourcesTable)
      .where(eq(sourcesTable.businessId, businessId))
      .orderBy(asc(sourcesTable.name), asc(sourcesTable.id)),
    db
      .select({ id: revenueItemsTable.id, name: revenueItemsTable.name })
      .from(revenueItemsTable)
      .where(eq(revenueItemsTable.businessId, businessId))
      .orderBy(asc(revenueItemsTable.name), asc(revenueItemsTable.id)),
    db
      .select({ id: expenseItemsTable.id, name: expenseItemsTable.name })
      .from(expenseItemsTable)
      .where(eq(expenseItemsTable.businessId, businessId))
      .orderBy(asc(expenseItemsTable.name), asc(expenseItemsTable.id)),
    db
      .select({ id: categoriesTable.id, name: categoriesTable.name })
      .from(categoriesTable)
      .where(
        and(
          eq(categoriesTable.businessId, businessId),
          // Internal time buckets are not money categories. See the note above
          // the function.
          ne(categoriesTable.appliesTo, "time"),
        ),
      )
      .orderBy(asc(categoriesTable.name), asc(categoriesTable.id)),
  ]);

  return {
    sourcesByName: indexByName(sources),
    revenueItemsByName: indexByName(revenueItems),
    expenseItemsByName: indexByName(expenseItems),
    categoriesByName: indexByName(categories),
  };
}

function indexByName(rows: Array<{ id: string; name: string }>): Map<string, string> {
  const byName = new Map<string, string>();
  for (const row of rows) {
    const key = normalizeDescription(row.name);
    if (key === "") continue;
    if (!byName.has(key)) byName.set(key, row.id);
  }
  return byName;
}

/**
 * The people this business already has, keyed EXACTLY as `findOrCreatePerson`
 * matches them.
 *
 * Not `normalizeDescription`, which every other index here uses, and the
 * difference is deliberate: `findOrCreatePerson` compares `lower(email)` and
 * then `lower(display_name)`, so an index folded any other way would answer a
 * question that function never asks — and the count on the screen would stop
 * describing what the write did.
 *
 * Its own function rather than a fifth map on `BusinessIndex`, because only a
 * people import needs it and a transactions import must not pay for a query it
 * will never read.
 */
export interface PeopleIndex {
  byEmail: Map<string, string>;
  byName: Map<string, string>;
}

export async function loadPeopleIndex(businessId: string): Promise<PeopleIndex> {
  const rows = await db
    .select({ id: peopleTable.id, displayName: peopleTable.displayName, email: peopleTable.email })
    .from(peopleTable)
    .where(eq(peopleTable.businessId, businessId))
    .orderBy(asc(peopleTable.displayName), asc(peopleTable.id));

  const byEmail = new Map<string, string>();
  const byName = new Map<string, string>();
  for (const row of rows) {
    const email = row.email?.trim().toLowerCase();
    if (email && !byEmail.has(email)) byEmail.set(email, row.id);
    const name = row.displayName.trim().toLowerCase();
    if (name !== "" && !byName.has(name)) byName.set(name, row.id);
  }
  return { byEmail, byName };
}

/**
 * The person this row would resolve to, or null when it would create one.
 *
 * Email first, then name — `findOrCreatePerson`'s order, not a rewrite of it. A
 * row whose email is new but whose name matches an existing person resolves to
 * that person there, and must resolve to them here too, or the check screen
 * promises a new contact the write will not make.
 */
export function existingPersonId(index: PeopleIndex, name: string, email: string): string | null {
  const wantedEmail = email.trim().toLowerCase();
  if (wantedEmail !== "") {
    const found = index.byEmail.get(wantedEmail);
    if (found !== undefined) return found;
  }
  const wantedName = name.trim().toLowerCase();
  if (wantedName !== "") {
    const found = index.byName.get(wantedName);
    if (found !== undefined) return found;
  }
  return null;
}

/** Remember a person this import just created, so a name repeated later in the file is not created twice. */
export function rememberPerson(index: PeopleIndex, id: string, name: string, email: string): void {
  const key = email.trim().toLowerCase();
  if (key !== "" && !index.byEmail.has(key)) index.byEmail.set(key, id);
  const nameKey = name.trim().toLowerCase();
  if (nameKey !== "" && !index.byName.has(nameKey)) index.byName.set(nameKey, id);
}

// ---------------------------------------------------------------------------
// Rows the owner already has
// ---------------------------------------------------------------------------

/**
 * Existing duplicateKeys for non-void transactions on this source, for the date
 * span given.
 *
 * Void rows are left out on purpose. A void is the owner saying "this never
 * happened"; flagging a file row against one would tell them they already have
 * something they explicitly removed, and then unticking it would leave the day
 * genuinely empty.
 *
 * The span is the FILE'S OWN min and max date, passed in by the caller. A
 * five-year ledger must not be read to check one month, and the bound costs
 * nothing in accuracy: the key carries the date, so a row outside the file's
 * span could never have matched anyway.
 *
 * `fromIso` and `toIso` must each be a `YYYY-MM-DD` day. Anything else returns
 * an EMPTY SET rather than a 500 — but an empty set means "nothing was
 * compared", not "no duplicates exist", so the caller must not read it as a
 * clean bill. The only legitimate way to get here without a span is a file in
 * which no row parsed, and such a file has no rows to flag in the first place.
 * If a file HAS rows, it has a min and a max: pass those.
 *
 * ── What stands in for "the description" ────────────────────────────────────
 *
 * A transaction header has no description column — the words live on its lines
 * — so a transaction contributes one key per distinct line description, each
 * paired with the whole transaction's amount.
 *
 * A line's own label is only half of that description. `transaction_lines.label`
 * is NULLABLE, and its check constraint demands a label only from a line that
 * links no catalog item, so an ordinary sale of "Blue Mug" typed into the app
 * stores NO label: `QuickAdd` hides the label box once an item is picked, and
 * `createTransaction` writes `label?.trim() || null`. That sale's description is
 * not missing — it lives in `revenue_items.name`.
 *
 * Reading the label alone, that sale keys with an empty description, while the
 * SAME sale coming back from an Item-only export keys as "blue mug" (Task 11
 * fills a blank label in from the item name). The two sides describe one sale
 * two ways, so re-importing that export doubles it with nothing on screen to say
 * so — the same failure as dropping the empty key below, arriving from the other
 * direction.
 *
 * So the description is `label ?? the linked item's name`: the line's own words
 * when a human wrote any, the catalog name otherwise. The label wins when a line
 * has both, because a label on an item-linked line was typed on purpose. Task 11
 * folds the incoming side the same way round, and both sides trim first, so a
 * whitespace-only label falls through to the item name on either side.
 *
 * Two details of that lookup, each deliberate:
 *
 *   - The BARE `revenue_items.name`, not `read.ts`'s "Parent / Variant" path.
 *     The path is for display; the bare name is what a file's Item column is
 *     matched against (`loadBusinessIndex`), so it is the name the two sides can
 *     agree on.
 *   - Archived items are NOT filtered out. `createTransaction` accepts an
 *     archived item and the cost snapshot still resolves from it, so the money is
 *     right and only the label is arguably stale — and a name an owner used
 *     before is still the name they meant.
 *
 * For the case this flag exists for, that is exactly one key: a bank statement
 * row has no order id, so it becomes its own one-line transaction (see
 * `groupTransactionRows`). Multi-line transactions only ever come from a file
 * WITH an order id, and those are caught by `external_ref` and the unique index
 * before this flag is consulted at all.
 *
 * Keying on every label rather than "the first" is deliberate: `uid()` is
 * random and every line of one insert shares a `created_at`, so the database
 * cannot say which line came first, and a fingerprint must not depend on row
 * order.
 *
 * ── A label that folds to nothing still makes a key ─────────────────────────
 *
 * `normalizeDescription` reduces anything with no a-z or 0-9 in it to the empty
 * string: a blank cell, a placeholder like "-" or "###", and a description
 * written wholly in a non-Latin script. That empty description is emitted as a
 * key like any other, and the reason is worth stating in full, because the
 * cheaper-looking option is the dangerous one.
 *
 * The domain has already weighed this (`importMatch.ts`): all such rows share
 * one fingerprint, so two of them on the same day, in the same direction, for
 * the same cents look like repeats of each other even when they say different
 * things. That false flag is accepted deliberately — the flag only unticks a
 * row and says why, so it costs the owner one click to tick back.
 *
 * Skipping the empty label instead would reverse that trade on this side only,
 * and the cost is not symmetrical. A transaction whose every label folds to
 * empty would contribute NO key at all, so it could never be matched: import a
 * bank statement whose description column is written in Urdu, import it again,
 * and every row previews as ready while the ledger silently doubles. A bank
 * statement carries no order id, so `external_ref` cannot catch it either.
 * This app's default currency is PKR in five schema tables — that is an
 * ordinary file here, not an exotic one.
 *
 * A false flag is one row unticked; a missed flag is a duplicated year.
 *
 * A transaction that also has described lines therefore owns the empty key in
 * addition to its own, which is the same "one key per distinct label" rule
 * applied without an exception carved out of it.
 *
 * Resolving the item name above does NOT make this dead code, and it must not be
 * narrowed on the belief that it has. Two ordinary rows still key empty from this
 * side: a line whose label is a placeholder or non-Latin ("—", Urdu) folds to
 * empty whether or not it links an item, and a REFUND line links no item at all
 * while copying its original's label (`refunds.ts` takes `original.label ?? null`,
 * and the line-label check accepts a null label on a line with a
 * `refunded_line_id`) — so refunding a label-less catalog sale writes a line with
 * neither a label nor a name. And the incoming side keys empty regardless of what
 * this side produces.
 */
export async function loadExistingKeys(
  businessId: string,
  sourceId: string,
  fromIso: string,
  toIso: string,
  timeZone?: string,
): Promise<Set<string>> {
  // Both ends must be real ISO days before anything reaches the database.
  // `dayStart("")` builds an Invalid Date, and Drizzle's timestamp serializer
  // then throws a RangeError from inside a preview request — a 500 with nothing
  // in it the owner or a developer can act on.
  const from = dayStart(fromIso, timeZone);
  const to = dayEnd(toIso, timeZone);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return new Set();

  const rows = await db
    .select({
      transactionId: transactionsTable.id,
      occurredAt: transactionsTable.occurredAt,
      direction: transactionsTable.direction,
      label: transactionLinesTable.label,
      revenueItemName: revenueItemsTable.name,
      expenseItemName: expenseItemsTable.name,
      unitPriceCents: transactionLinesTable.unitPriceCents,
      qty: transactionLinesTable.qty,
    })
    .from(transactionsTable)
    .innerJoin(transactionLinesTable, eq(transactionLinesTable.transactionId, transactionsTable.id))
    // The catalog name behind a label-less line. Two joins rather than one
    // because a line links a revenue item OR an expense item, never both
    // (`transaction_lines_one_item_check`), and never anything else.
    //
    // NEITHER JOIN CAN MULTIPLY A LINE'S ROW, which would silently restate the
    // amount below: each is a nullable FK matched against a `text("id")
    // .primaryKey()`, so it finds at most one row — nothing, when the FK is
    // null or the item was somehow deleted, and LEFT keeps the line either way.
    // The count of rows out is therefore exactly the count of matching lines,
    // as it was before these joins existed.
    //
    // The business is named on both, so no query in this module reaches a table
    // it has not scoped. It changes no legitimate result: `createTransaction`
    // resolves items with the same predicate and throws `notFound` otherwise, so
    // a linked item always shares its transaction's business.
    .leftJoin(
      revenueItemsTable,
      and(
        eq(revenueItemsTable.id, transactionLinesTable.revenueItemId),
        eq(revenueItemsTable.businessId, businessId),
      ),
    )
    .leftJoin(
      expenseItemsTable,
      and(
        eq(expenseItemsTable.id, transactionLinesTable.expenseItemId),
        eq(expenseItemsTable.businessId, businessId),
      ),
    )
    .where(
      and(
        eq(transactionsTable.businessId, businessId),
        eq(transactionsTable.sourceId, sourceId),
        ne(transactionsTable.status, "void"),
        gte(transactionsTable.occurredAt, from),
        lte(transactionsTable.occurredAt, to),
      ),
    );

  // Fold the lines back into their transactions before any key is built: the
  // amount in a fingerprint is the whole transaction's, so nothing can be
  // written until every line of it has been seen.
  interface Header {
    occurredOn: string;
    direction: "in" | "out";
    amountCents: number;
    labels: Set<string>;
  }
  const headers = new Map<string, Header>();

  for (const row of rows) {
    let header = headers.get(row.transactionId);
    if (header === undefined) {
      header = {
        occurredOn: isoDay(row.occurredAt, timeZone),
        direction: row.direction === "out" ? "out" : "in",
        amountCents: 0,
        labels: new Set<string>(),
      };
      headers.set(row.transactionId, header);
    }
    // Quantity times unit price, exactly as `createTransaction` writes it and
    // as the check screen totals the file (Task 11). Quantity is a decimal
    // string, so the multiplication goes through the domain's decimal math —
    // no float ever touches a money value. Tax collected, shipping and the
    // order discount stay out of it on both sides.
    header.amountCents = addCents(header.amountCents, mulCentsQty(row.unitPriceCents, row.qty));
    // What this line SAYS: the words a human typed, or failing that the name of
    // the item it links. A catalog line carries no label at all, and its name is
    // how the file describes the same sale. Written as `trim() ||` rather than
    // `??` because that is Task 11's fold verbatim on the incoming side; for a
    // row `createTransaction` wrote the two are identical, since it already
    // stores a blank label as null.
    const itemName = row.revenueItemName ?? row.expenseItemName;
    // A description that folds to nothing is KEPT, as the empty description. See
    // the note above the function: dropping it is how a whole file stops being
    // checkable.
    header.labels.add(normalizeDescription(row.label?.trim() || itemName || ""));
  }

  const keys = new Set<string>();
  for (const header of headers.values()) {
    for (const label of header.labels) {
      keys.add(
        duplicateKey({
          occurredOn: header.occurredOn,
          // The file's amounts are always positive with the direction carrying
          // the sign (`importRows`), and the design contract says "the same
          // absolute amount". A correction stored as a negative would otherwise
          // never match the row it corrects.
          amountCents: Math.abs(header.amountCents),
          direction: header.direction,
          description: label,
        }),
      );
    }
  }
  return keys;
}

/** How many order ids one query may ask about. */
const REF_CHUNK = 1000;

/**
 * Order ids already used on this source — the hard-dedupe check.
 *
 * Void rows COUNT here, unlike the soft flag above, and the difference is the
 * database's rather than a judgement: `transactions_source_external_ref_uq` is
 * on `(source_id, external_ref)` with no status in it, so a voided order still
 * owns its id. Leaving void rows out would let the preview promise a row that
 * the insert then refuses.
 */
export async function loadExistingExternalRefs(
  businessId: string,
  sourceId: string,
  refs: string[],
): Promise<Set<string>> {
  // Asked once per id, however many rows of the file carried it, and blanks
  // dropped — an unfilled Order ID column is no id at all.
  const wanted = [...new Set(refs.map((ref) => ref.trim()).filter((ref) => ref !== ""))];
  const found = new Set<string>();

  // Chunked, because a 5,000-row file would otherwise build one query with
  // 5,000 bound parameters in it.
  for (let start = 0; start < wanted.length; start += REF_CHUNK) {
    const chunk = wanted.slice(start, start + REF_CHUNK);
    const rows = await db
      .select({ externalRef: transactionsTable.externalRef })
      .from(transactionsTable)
      .where(
        and(
          eq(transactionsTable.businessId, businessId),
          eq(transactionsTable.sourceId, sourceId),
          inArray(transactionsTable.externalRef, chunk),
        ),
      );
    for (const row of rows) if (row.externalRef !== null) found.add(row.externalRef);
  }
  return found;
}

/**
 * Has this business recorded any money coming in, anywhere?
 *
 * The payout flag needs it: a line reading "STRIPE PAYOUT" is only a
 * double-count if there are sales for it to be a payout OF. A business with no
 * recorded income yet is importing its first file, and setting its money aside
 * would leave it with nothing.
 *
 * Void rows are not excluded, and that is the safe direction: this gates
 * NOTICING a row, never writing one. Answering "yes" too readily sets a row
 * aside with the reason on screen for the owner to tick back; answering "no"
 * too readily lets money already recorded as sales be counted a second time.
 */
export async function businessHasSales(businessId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: transactionsTable.id })
    .from(transactionsTable)
    .where(and(eq(transactionsTable.businessId, businessId), eq(transactionsTable.direction, "in")))
    .limit(1);
  return row !== undefined;
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

/**
 * The day a transaction happened on, read the way the importer writes it.
 *
 * `commitImport` stores `occurredAt` at the first instant of the file's day IN
 * THE OWNER'S ZONE, so that zone is what turns it back into the same day
 * string. Reading it in UTC — which is what this did — is off by a day for
 * anywhere east of Greenwich: a row written for the 20th in Asia/Karachi is
 * 2026-09-19T19:00Z, and UTC calls that the 19th. The fingerprint would then
 * never match the file it came from, and a second upload of the same statement
 * would report no duplicates at all.
 *
 * Undated zones fall back to UTC inside `calendarDayIn`, which is what every
 * row did before this argument existed.
 */
function isoDay(occurredAt: Date, timeZone: string | undefined): string {
  return calendarDayIn(occurredAt, timeZone);
}

/** The first instant of a calendar day, in the owner's zone. */
function dayStart(iso: string, timeZone: string | undefined): Date {
  return zonedDayStart(iso, timeZone);
}

/**
 * The last instant of a calendar day in the owner's zone — so a row entered by
 * hand at some time of day is still inside the file's span. Exactly one day,
 * which is what `isoDay` reads back, so the bound can never cut off a row whose
 * key would have fallen inside the file's dates.
 */
function dayEnd(iso: string, timeZone: string | undefined): Date {
  return zonedDayEnd(iso, timeZone);
}

// ── csvImport ────────────────────────────────────────────────────

/**
 * Reading an uploaded file into a plan.
 *
 * Nothing here writes anything. The plan is a description of what an upload
 * WOULD do, and `csvImportCommit.ts` is the half that does it — it calls
 * `buildPlan` below and lands the result through the ledger. The arrow runs one
 * way: this file knows nothing about that one.
 *
 * Preview and commit both go through `buildPlan`, which is what makes the figure
 * on the check screen and the figure in the ledger the same figure rather than
 * two that agree today.
 *
 * This file is the ORCHESTRATION: the order the plan is built in, and the two
 * questions it puts to the database. What a file can be read to say without
 * asking anything lives in `csvImportRead.ts`; what the names in it already mean
 * here lives in `csvImportResolve.ts`.
 */
// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

export interface ImportInput {
  kind: ImportKind;
  filename: string;
  csv: string;
  /** field -> the header in THEIR file. Absent = guess it. */
  mapping?: ImportMappingShape;
  dateOrder?: DateOrder;
  totalsAre?: TotalsMode;
  /** The one channel, when the file has no Channel column. */
  sourceId?: string;
  /**
   * The reader's IANA time zone, sent by the browser.
   *
   * A date in a file is a calendar day, and it has to become an instant. Doing
   * that in UTC put the row on a different day from the one the owner wrote —
   * before "today" began west of Greenwich, and on the PREVIOUS day east of it.
   * Absent falls back to UTC, which is what every row did before.
   *
   * Both halves of the importer need it, and for the same reason: commit uses
   * it to WRITE the instant, and the duplicate check uses it to read an existing
   * instant back into the day it was meant to be.
   */
  timeZone?: string;
}

export interface PlanGroup {
  /**
   * Stable across a re-parse of the same file with the same mapping, which is
   * what lets commit honour `includeKeys`. Never persisted.
   */
  key: string;
  group: PlanGroupBody;
  /**
   * Σ(quantity × unit price) across the lines — the figure the ledger will
   * write, not the sum of the Amount cells as they were typed. Tax collected,
   * shipping and the discount ride the header on their own fields and are not
   * in it.
   */
  amountCents: number;
  /**
   * Derived the way `createTransaction` derives a header's direction ("in" if
   * any line earns), not simply copied from the first row. The stored row is
   * what the duplicate check on the other side reads, so anything else would
   * fingerprint a transaction that never existed.
   *
   * THIS is the direction to show and to fingerprint. `group.direction` is the
   * first row's, and is only the fallback `createTransaction` applies to a
   * label-only line that names no direction of its own — on a mixed order the
   * two differ.
   */
  direction: Direction;
  /**
   * The channel this group will land on, when we can already name it.
   *
   * Null means one thing only: the file names a channel this business does not
   * have, and commit will create it. It never means "no channel" — a group with
   * none at all is in `failed` and never reached this list, because it is
   * exactly the group the duplicate checks cannot look at.
   */
  sourceId: string | null;
  /**
   * The group's first row exactly as the file had it.
   *
   * Carried so a group that fails at WRITE time can hand back the same
   * downloadable row a group that failed at READ time does — `importFailedRow`
   * has `cells` because the "Download these" button rebuilds a CSV from them,
   * and a write failure the owner cannot download is a row they cannot fix.
   * Only `buildPlan` can read them: it holds the parsed table, and commit does
   * not.
   */
  cells: string[];
  /** Null on a ready group. On a skipped one, why, in plain English. */
  skipReason: string | null;
}

export interface PlanFailure {
  rowNumbers: number[];
  cells: string[];
  reason: string;
}

/** Everything a plan says about the FILE, whatever the file is a list of. */
interface PlanShared {
  /** Run through `sanitizeFilename`: it is displayed back to the owner. */
  filename: string;
  headers: string[];
  mapping: ImportMappingShape;
  ignoredHeaders: string[];
  dateOrder: DateOrder;
  dateOrderCertain: boolean;
  totalsAre: TotalsMode;
  grouped: boolean;
  unit: "rows" | "orders";
  needsTotalsAnswer: boolean;
  /** Rows in the file, before grouping. */
  sourceRowCount: number;
  failed: PlanFailure[];
}

/**
 * A plan carries GROUPS or it carries RECORDS, and which one is decided by the
 * kind rather than by a nullable field on both.
 *
 * A union and not one interface with two optional lists, because the two halves
 * of this feature ask different questions of a plan and the type is what stops
 * either asking the wrong one. Only a transactions plan has a channel, a date or
 * a direction to reason about; a list of customers has none of the three, and a
 * shape that let `groups` be read on a people plan is exactly how the channel
 * rule would find its way back onto a file that has no channels.
 */
export interface TransactionPlan extends PlanShared {
  kind: "transactions";
  /** Ready and skipped together, in file order. A skip is `skipReason`. */
  groups: PlanGroup[];
}

export interface CatalogPlan extends PlanShared {
  kind: CatalogKind;
  /** Ready and skipped together, in file order. A skip is `skipReason`. */
  records: PlanRecord[];
}

export type ImportPlan = TransactionPlan | CatalogPlan;

/**
 * How much CSV text we will read, in BYTES — `Buffer.byteLength(csv, "utf8")`,
 * which is the unit everything downstream of here already counts in.
 *
 * ── Why the cap exists at all ──
 *
 * `vercel.json` rewrites ALL of `/api/(.*)` to a single serverless function, and
 * the platform refuses a serverless request body over **4.5 MB** before a line
 * of this code runs. A file between our cap and theirs gets a bare platform
 * 413 — no sentence, nothing the owner can act on. So ours has to fire first.
 *
 * ── Why BYTES, which this did not used to count ──
 *
 * It counted CHARACTERS (`String.length`, UTF-16 code units), and that is a
 * different unit from the one the platform counts: the same sentence is one byte
 * per character in English and three in Japanese, Hindi or Urdu. A cap in
 * characters therefore has to be sized for its worst case — so every Latin file
 * paid for a multiplier it never used, and the number had to fall to 1 MB.
 * Counting bytes deletes the multiplier outright, because the thing measured
 * becomes the thing the platform counts.
 *
 * What is left is JSON escaping, and it is small. The CSV rides inside a JSON
 * string, where only `"` and the CR/LF between rows grow — not every character,
 * and not non-Latin text at all, which `JSON.stringify` passes through as its
 * own UTF-8 bytes. Measured on a 60-column marketplace export with every field
 * quoted, the heaviest shape a real export takes: **12–15%**, not the doubling
 * this comment used to claim.
 *
 * ── Why three megabytes ──
 *
 * Measured, not estimated — a file of exactly that shape built to sit on this
 * cap to the byte, then `JSON.stringify`d into the real `commitImport` body,
 * mapping and filename and 5,000 ticked-back-in keys and all:
 *
 *     Latin     3,826 rows, 822 bytes a row    3.55 MB on the wire
 *     Japanese  3,074 rows, 1,023 bytes a row  3.47 MB on the wire
 *
 * Both clear the platform's 4.5 MB by about three quarters of a megabyte, taking
 * 4.5 MB at its stricter reading of 4,500,000 bytes. And both sit under the 4 MB
 * body parser with ~0.45 MB to spare, which is what lets a file just OVER this
 * cap still be READ and answered with the sentence below instead of a bare 413.
 * The two numbers are not independent: the parser is this one plus its headroom,
 * which is why this is exported.
 *
 * ── What it costs an ordinary import ──
 *
 * Three megabytes across the 5,000 rows `MAX_ROWS` allows is 629 bytes a row, so
 * the row cap is what an ordinary export meets first and this stays the backstop
 * against enormous cells. Only a very wide file meets this one first — the
 * 60-column export above runs out of bytes at 3,826 rows rather than 5,000. That
 * is not a number we chose: all 5,000 rows of that file is 3.92 MB of CSV and
 * 4.61 MB on the wire, which the platform refuses whatever we set here. Getting
 * past it needs a different upload path, not a bigger number in this line.
 *
 * ── Why the number itself is not in this file ──
 *
 * It moved to `@workspace/domain`'s `importLimits.ts` so the UPLOAD SCREEN can
 * read it. The browser cannot import an Express service, so a screen that wants
 * to refuse a 40 MB file before spending a minute sending it could otherwise
 * only copy the digits — and a cap in two places that cannot check each other is
 * how this went wrong twice. Re-exported here because `routes/imports.ts`
 * derives the body parser's limit from it, and because this is still the file
 * that ENFORCES it.
 */
export { MAX_CSV_BYTES };
/** Data rows we will read. Beyond this, splitting the file is the honest advice. */
const MAX_ROWS = 5_000;
/**
 * How many entries of each list the response carries. DISPLAY ONLY — the counts
 * beside them stay exact, and commit re-reads the file rather than these rows.
 *
 * Exported because the commit response caps its `failures` list the same way,
 * and two lists cut to two different lengths would be two answers to one
 * question: "how much of this will the screen actually show?"
 */
export const DISPLAY_CAP = 200;

/**
 * The one sentence for a group with no channel to land on.
 *
 * Written down once and exported because commit refuses exactly this case with
 * exactly this wording. Two copies of a sentence agree by luck; one copy read
 * from both sides agrees by construction — and a screen that says "ready" about
 * a row the commit will throw out is the one thing this feature must never do.
 *
 * The sentence itself moved to `@workspace/domain` when a THIRD reader appeared:
 * the matching screen reads it off the preview's failures to decide whether to
 * offer the channel picker, and a browser cannot import an Express service. It
 * is re-exported here because this is still the file that MARKS a group with it,
 * and because `csvImportCommit.ts` and the integration tests reach for it here.
 */
export { NO_CHANNEL_REASON };

/**
 * The one sentence for an order this business already has.
 *
 * Exported for the same reason `NO_CHANNEL_REASON` is. Commit meets this fact a
 * SECOND time — at `unique(source_id, external_ref)`, for a row the owner was
 * shown, ticked back in, and the database then refused — and the explanation
 * they get at that point has to be the explanation they were given before they
 * ticked it. One copy read from both sides, rather than two sentences agreeing
 * by luck.
 */
export const ALREADY_IMPORTED_REASON = "This order is already imported";

/**
 * The header money field behind each of the domain's three total columns.
 *
 * A `Record` over the union rather than an array, so a fourth entry added to
 * `TRANSACTION_TOTAL_FIELDS` cannot compile until it is answered for here.
 */
const HEADER_MONEY: Record<(typeof TRANSACTION_TOTAL_FIELDS)[number], (group: PlanGroupBody) => number> = {
  taxCollected: (group) => group.taxCollectedCents,
  shippingCharged: (group) => group.shippingChargedCents,
  discount: (group) => group.discountCents,
};

/** The name the owner picked each column by, so a refusal names their column. */
const COLUMN_LABELS = new Map(columnsFor("transactions").map((column) => [column.field, column.label]));

/**
 * The first of tax, shipping or discount that arrived negative — by its column
 * label — or null when all three are fine.
 *
 * The row layer passes these three through SIGNED on purpose ("an abs() here
 * would hide a cell that says something odd", `importRows.ts`), while
 * `assertCentsField` in the ledger refuses a negative outright. Something has to
 * reconcile the two, and there are only three ways to:
 *
 *   - let it through — the check screen shows a ready row and the write then
 *     answers `tax_collected_cents must be non-negative integer cents`, which is
 *     both the promise this feature exists to keep and a sentence in the
 *     vocabulary the UI is never allowed to speak;
 *   - `Math.abs` it — silently restates the owner's own figure, and these are
 *     not cosmetic fields: shipping charged is ADDED to gross revenue
 *     (`profit.ts`) and the order discount comes off net revenue, so a flipped
 *     sign moves the ladder by twice the cell;
 *   - refuse it HERE, in the function commit re-runs, which is what this does.
 *
 * `amountCents` is the field that legitimately arrives signed and is made
 * positive, because the direction carries its sign from that point on. Nothing
 * carries the sign of these three, so there is nothing to move it into.
 */
function negativeHeaderMoney(group: PlanGroupBody): string | null {
  for (const field of TRANSACTION_TOTAL_FIELDS) {
    if (HEADER_MONEY[field](group) < 0) return COLUMN_LABELS.get(field) ?? field;
  }
  return null;
}

// ---------------------------------------------------------------------------
// The plan
// ---------------------------------------------------------------------------

/**
 * What this upload will do, decided once and read by both preview and commit.
 *
 * Exported for `commitImport` and for the tests that check the preview promises
 * exactly what the commit performs. It is not an HTTP surface of its own.
 *
 * The three signatures say the same thing the union does, one rung earlier: a
 * caller that names the kind gets the plan that kind produces, so reaching for
 * `groups` on a people import is a compile error rather than a runtime absence.
 * A caller holding a `kind` it does not know gets the union and must ask.
 */
export async function buildPlan(
  businessId: string,
  input: ImportInput & { kind: "transactions" },
): Promise<TransactionPlan>;
export async function buildPlan(
  businessId: string,
  input: ImportInput & { kind: CatalogKind },
): Promise<CatalogPlan>;
export async function buildPlan(businessId: string, input: ImportInput): Promise<ImportPlan>;
export async function buildPlan(businessId: string, input: ImportInput): Promise<ImportPlan> {
  // ── The caps and the filename, HERE and not in the route ─────────────────
  //
  // Commit calls this too, so a limit enforced at the edge would be a limit the
  // second half of the feature does not have. The size test comes before the
  // parse for the obvious reason: the cap exists so a huge file is never read.
  // `Buffer.byteLength`, not `.length`: a Japanese or Urdu file is three bytes
  // to the character, so the two disagree by up to 3× on exactly the files this
  // cap is closest to refusing.
  if (Buffer.byteLength(input.csv, "utf8") > MAX_CSV_BYTES) {
    // The sentence is BUILT from the constant, next to it, so a cap and a
    // message that disagree cannot happen — and the upload screen quotes the
    // same string rather than writing its own.
    throw invalid(CSV_TOO_BIG_MESSAGE);
  }

  const table = parseCsvTable(input.csv);
  if (table.headers.length === 0) throw invalid("That file has no rows");
  if (table.rows.length > MAX_ROWS) {
    throw invalid(
      `That file has ${table.rows.length.toLocaleString("en-US")} rows. Imports are capped at 5,000 — try splitting it by month.`,
    );
  }

  // The extension is tested on what the owner actually named the file;
  // `sanitizeFilename` then shapes the string we store and display back, since
  // a filename is untrusted input. Testing the sanitized name instead would
  // refuse a legitimate 200-character name, which that function truncates.
  //
  // Shared with the upload screen, which refuses the same names before spending
  // a minute uploading them — one rule and one sentence, not two that agree
  // today.
  const named = input.filename.trim();
  if (!looksLikeCsvFilename(named)) throw invalid(NOT_A_CSV_MESSAGE);
  const filename = sanitizeFilename(named);

  // ── The mapping, checked before a single row is read ─────────────────────
  const mapping = input.mapping ?? guessMapping(table.headers, input.kind).mapping;
  const ignoredHeaders = ignoredHeadersFor(table.headers, mapping);
  assertMappingIsUsable(input.kind, mapping);

  // ── How this file writes its dates ───────────────────────────────────────
  const inferred = inferDateOrder(cellsOf(table, mapping.date));
  // What the FILE settles, always — never "the owner answered". A day over 12
  // makes the column certain; an answer only makes it chosen. The screen needs
  // to know which of the two it is looking at.
  //
  // And never a certainty about a column that is not there. A mapped header this
  // file does not have reads as NO cells, and `inferDateOrder([])` calls its
  // default certain because nothing contradicted it. Every row of such a file
  // fails anyway, so this is cosmetic today — but the matching step reads this
  // flag to decide whether to ask the owner which way the dates run, and it must
  // not be told the file settled something the file never showed us.
  const dateOrderCertain = headerIsPresent(table, mapping.date) && inferred.certain;
  /*
   * A SETTLED COLUMN OUTRANKS THE ANSWER IN THE REQUEST.
   *
   * This used to be `input.dateOrder ?? inferred.order`, which took the caller's
   * answer whatever the file said — and the matching screen could not protect
   * against it, because the only thing that knows whether a freshly pointed-at
   * column settles the question is this function, after the request has gone.
   *
   * The sequence that misread a year: the owner answers the date question on an
   * ambiguous column, then re-points Date at a column whose own dates settle it
   * day-first. The request still carries "month-first" — the screen had no way
   * to know it was about to stop mattering — the old answer won, every date in
   * the file was read the wrong way round, and the response came back
   * `dateOrderCertain: true`, which is what makes the screen take the [Change]
   * control AWAY. A whole year misfiled with the escape hatch removed.
   *
   * Certain means a cell in that column is a day over 12, so the other reading
   * makes that cell an impossible date. An answer disagreeing with it cannot be
   * right, it can only fail rows — so ignoring it costs nothing and is the only
   * reading that keeps `dateOrder` and `dateOrderCertain` telling one story:
   * certain, and this is the file's; uncertain, and this is what you told us.
   *
   * Commit runs this same function, so the ledger lands on the reading the
   * screen showed.
   */
  const dateOrder = dateOrderCertain ? inferred.order : (input.dateOrder ?? inferred.order);

  // ── The channel the request named ────────────────────────────────────────
  //
  // Trimmed ONCE, here, and everything downstream reads this rather than the
  // raw request field: a padded id would otherwise be checked with `.trim()`
  // and then handed to the ledger with its spaces still on.
  //
  // Checked for EVERY kind, although only transactions land money on it: commit
  // stores it on the batch row, whose `source_id` is a foreign key, so a made-up
  // id on a people import would come back as a database error rather than as the
  // sentence written for exactly this.
  const fixedSourceId = input.sourceId?.trim() || null;
  if (fixedSourceId !== null) await assertChannelIsOurs(businessId, fixedSourceId);

  // Everything above is a fact about the FILE and is asked of all four kinds.
  // Everything below divides: a transactions file becomes orders that land in
  // the ledger, and the other three become records that describe the business.
  const shared = {
    filename,
    headers: table.headers,
    mapping,
    ignoredHeaders,
    dateOrder,
    dateOrderCertain,
    sourceRowCount: table.rows.length,
  };

  if (input.kind !== "transactions") {
    return catalogPlan(businessId, input.kind, table, mapping, shared);
  }

  // ── Rows, then orders ────────────────────────────────────────────────────
  const outcomes = parseTransactionRows(table, mapping, { dateOrder });
  const parsed = outcomes.flatMap((outcome) => (outcome.ok ? [outcome.row] : []));
  const failed: PlanFailure[] = outcomes.flatMap((outcome) =>
    outcome.ok ? [] : [{ rowNumbers: [outcome.failure.rowNumber], cells: outcome.failure.cells, reason: outcome.failure.reason }],
  );

  const totalsAre = input.totalsAre ?? "whole_order";
  const bodies: PlanGroupBody[] = [];
  for (const outcome of groupTransactionRows(parsed, { totalsAre })) {
    if (outcome.ok) {
      const body = backfillLabels(outcome.group);
      const unsellable = body.lines.find((line) => !isSellableQty(line.qty));
      if (unsellable !== undefined) {
        // The row layer accepts a signed quantity ("0", "-1" on a returned line
        // item) and `createTransaction` refuses one, so without this a zero-
        // quantity export would preview as ready and fail at commit. It would
        // also put a NEGATIVE amount on the screen, which the contract says this
        // field never carries. Fail the whole order: the ledger writes a
        // transaction or none of it.
        failed.push({
          rowNumbers: body.rowNumbers,
          cells: cellsAtRow(table, body.rowNumbers[0]),
          reason: `Quantity "${unsellable.qty}" has to be more than zero`,
        });
        continue;
      }
      // The same rule from the other direction: a header money field the ledger
      // will refuse fails on the screen that promised it, in the owner's words.
      const negative = negativeHeaderMoney(body);
      if (negative !== null) {
        failed.push({
          rowNumbers: body.rowNumbers,
          cells: cellsAtRow(table, body.rowNumbers[0]),
          reason: `${negative} can't be a negative amount`,
        });
        continue;
      }
      bodies.push(body);
      continue;
    }
    // A group failure names every row it covers but carries none of their
    // cells, and the "Download these" button rebuilds a CSV from cells. Re-read
    // the first of them, so the owner gets the order back rather than a blank
    // line; `rowNumbers` still names the rest.
    failed.push({
      rowNumbers: outcome.rowNumbers,
      cells: cellsAtRow(table, outcome.rowNumbers[0]),
      reason: outcome.reason,
    });
  }

  // ── What the names in the file already mean here ─────────────────────────
  const index = await loadBusinessIndex(businessId);
  const resolved = await resolveGroups(table, bodies, index, fixedSourceId);
  const groups = resolved.groups;

  // A group with nowhere to land fails HERE, in the function commit re-runs, so
  // the two cannot disagree about it. Two reasons, and either alone would be
  // enough. Commit refuses this group, so a preview calling it ready would
  // promise what the write then refuses. And it is the one group BOTH duplicate
  // checks below sit out — they are keyed per channel — so calling it ready
  // would present a row nothing was compared against as a verified one, and
  // re-uploading the file would double the books with nothing on screen to say
  // so.
  for (const body of resolved.withoutChannel) {
    failed.push({
      rowNumbers: body.rowNumbers,
      cells: cellsAtRow(table, body.rowNumbers[0]),
      reason: NO_CHANNEL_REASON,
    });
  }

  const grouped = willGroup(parsed);
  // The owner's zone reaches the duplicate scan because commit writes each row
  // at the first instant of its day IN THAT ZONE. Reading those instants back in
  // any other zone lands on a different day, and the fingerprint carries the
  // day — so a second upload of the same file would find nothing to warn about.
  await applySkips(businessId, groups, index, input.timeZone);

  return {
    ...shared,
    kind: "transactions",
    totalsAre,
    grouped,
    unit: grouped ? "orders" : "rows",
    // Only worth asking of a file that groups at all: on one row per sale the
    // figure is that sale's either way.
    needsTotalsAnswer: grouped && TRANSACTION_TOTAL_FIELDS.some((field) => isMapped(mapping, field)),
    groups,
    failed,
  };
}

// ---------------------------------------------------------------------------
// The three kinds that create records rather than money
// ---------------------------------------------------------------------------

/**
 * What a catalog or people file will do, decided once and read by both halves.
 *
 * THE CHANNEL RULE IS NOT HERE, and its absence is the point. `channelFor` and
 * `NO_CHANNEL_REASON` belong to the transactions branch above and are unreachable
 * from this one: a revenue item is sold on channels (its "Sold on" list, resolved
 * below into links, never into a place for money to land) and a person has none
 * at all. Until this function existed, the only thing keeping a customer list
 * away from that rule was `buildPlan` refusing every non-transactions kind
 * outright; the separation now lives in the type — a `CatalogPlan` has no
 * `groups` for the rule to be applied to.
 *
 * Nothing here groups. One row is one record, so `grouped` is always false, the
 * unit is always "rows", and there is no whole-order-or-per-item question to ask.
 */
async function catalogPlan(
  businessId: string,
  kind: CatalogKind,
  table: { headers: string[]; rows: string[][] },
  mapping: ImportMappingShape,
  shared: Omit<PlanShared, "totalsAre" | "grouped" | "unit" | "needsTotalsAnswer" | "failed">,
): Promise<CatalogPlan> {
  const outcomes = parseCatalogRows(table, mapping, kind);

  // One question of the database for the names in the file, and it is the only
  // one this branch asks. People are matched the way `findOrCreatePerson`
  // matches them; items and channels through the shared name index.
  const index = kind === "people" ? null : await loadBusinessIndex(businessId);
  const people = kind === "people" ? await loadPeopleIndex(businessId) : null;

  // What earlier rows of THIS file have already claimed. A template listing one
  // item twice would otherwise create it and then fail the second row at the
  // write, and the owner would read a red row where the honest answer is "you
  // said that twice".
  const seen: SeenSoFar = { names: new Set<string>(), people: { byEmail: new Map(), byName: new Map() } };

  // Failures collected in ONE pass with the records, so `plan.failed` comes back
  // in the owner's own row order: they read it against the spreadsheet open
  // beside them, and the display cap then keeps the FIRST 200 bad rows rather
  // than 200 of whichever kind of failure happened to be collected first.
  const failed: PlanFailure[] = [];
  const records: PlanRecord[] = [];
  for (const outcome of outcomes) {
    if (!outcome.ok) {
      failed.push({
        rowNumbers: [outcome.failure.rowNumber],
        cells: outcome.failure.cells,
        reason: outcome.failure.reason,
      });
      continue;
    }
    const row = outcome.row;
    const cells = cellsAtRow(table, row.rowNumber);

    // What the write would refuse, refused here instead, in the same words.
    const problem = catalogRowProblem(kind, row);
    if (problem !== null) {
      failed.push({ rowNumbers: [row.rowNumber], cells, reason: problem });
      continue;
    }

    const display = catalogDisplay(kind, row);
    records.push({
      key: `:${row.rowNumber}`,
      rowNumbers: [row.rowNumber],
      description: display.description,
      detail: display.detail,
      amountCents: display.amountCents,
      cells,
      skipReason: skipReasonFor(kind, row, index, people, seen),
      row,
      // Resolved HERE and not at the write, so the screen and the write can
      // never name different channels — the same rule the transaction lines
      // follow. A null id means this business has no such channel and commit
      // will create it as a manual one.
      channels:
        kind === "revenue_items"
          ? channelNamesOf(row).map((name) => ({
              name,
              sourceId: index?.sourcesByName.get(normalizeDescription(name)) ?? null,
            }))
          : [],
    });
  }

  return {
    ...shared,
    kind,
    // No file of this kind groups, and none carries an order total, so the
    // toggle those two feed has nothing to decide. "whole_order" is the
    // contract's own default and means nothing here either way.
    totalsAre: "whole_order",
    grouped: false,
    unit: "rows",
    needsTotalsAnswer: false,
    records,
    failed,
  };
}

/**
 * What earlier rows of the file being read have already claimed.
 *
 * A people row is matched on email-then-name rather than on one composite key,
 * because that is how `findOrCreatePerson` matches: "Acme Ltd" with an email on
 * row 1 and "Acme Ltd" with none on row 2 are ONE contact to the write, and a
 * composite key would have called them two — the preview would promise a second
 * contact that the commit would then report as skipped.
 */
interface SeenSoFar {
  names: Set<string>;
  people: PeopleIndex;
}

/** A stand-in id for a row of the file, which has none of its own until it is written. */
const NOT_YET_WRITTEN = "pending";

/**
 * The one this business already has, set aside with the reason on screen.
 *
 * Never a decision: a skipped row is unticked with its explanation, and the
 * owner ticks it back if they meant it. Items are matched on
 * `normalizeDescription`, the fold every other name lookup in this feature uses;
 * people on the email-then-name pair `findOrCreatePerson` matches on.
 *
 * The business is asked before the file, so a row that is both already known and
 * repeated reads as already known — the more useful of the two sentences.
 */
function skipReasonFor(
  kind: CatalogKind,
  row: ParsedCatalogRow,
  index: BusinessIndex | null,
  people: PeopleIndex | null,
  seen: SeenSoFar,
): string | null {
  const name = (row.values.name ?? "").trim();
  const email = (row.values.email ?? "").trim();

  if (kind === "people") {
    const already = people !== null && existingPersonId(people, name, email) !== null;
    const repeated = existingPersonId(seen.people, name, email) !== null;
    rememberPerson(seen.people, NOT_YET_WRITTEN, name, email);
    if (already) return `You already have ${name || email} in your contacts`;
    if (repeated) return `This file lists ${name || email} more than once`;
    return null;
  }

  const key = normalizeDescription(name);
  // A name that folds to nothing cannot be looked up, so it cannot be claimed
  // to have been checked — it is created, and the database's own unique index
  // is what refuses a genuine repeat.
  if (key === "") return null;
  const byName = kind === "revenue_items" ? index?.revenueItemsByName : index?.expenseItemsByName;
  const already = byName?.has(key) ?? false;
  const repeated = seen.names.has(key);
  seen.names.add(key);
  // The noun the CREATE uses, not one noun for both kinds. `createRevenueItem`
  // refuses with "an item called"; `createExpenseItem` refuses with "an expense
  // called" (`catalog.ts`). Said as "item" here, an owner who ticked an
  // already-have expense back in read "item" on the check screen and "expense"
  // on the receipt about the one row — two sentences for one rule, which is the
  // thing `catalogRowProblem` says in words it will not do.
  //
  // Reworded here rather than in `createExpenseItem`: that sentence is also what
  // the Add-an-expense dialog shows, and it is right there. The import is what
  // was speaking out of turn.
  const noun = kind === "expense_items" ? "an expense" : "an item";
  if (already) return `You already have ${noun} called "${name}"`;
  if (repeated) return `This file already lists ${noun} called "${name}"`;
  return null;
}

// ---------------------------------------------------------------------------
// Preview
// ---------------------------------------------------------------------------

export async function previewImport(businessId: string, input: ImportInput): Promise<ImportPreviewShape> {
  const plan = await buildPlan(businessId, input);
  // One list of rows, however the plan reached them, then split. The two kinds
  // of entry differ in what they carry, not in how the screen reads them.
  const rows: ImportPreviewShape["ready"] =
    plan.kind === "transactions" ? plan.groups.map(toReadRow) : plan.records.map(toRecordRow);
  const ready = rows.filter((entry) => entry.skipReason === null);
  const skipped = rows.filter((entry) => entry.skipReason !== null);

  // Every field written out. Response validation only runs outside production,
  // so a field left to the schema is a field the customer's browser never gets.
  return {
    kind: plan.kind,
    grouped: plan.grouped,
    unit: plan.unit,
    sourceRowCount: plan.sourceRowCount,
    mapping: plan.mapping,
    ignoredHeaders: plan.ignoredHeaders,
    headers: plan.headers,
    dateOrder: plan.dateOrder,
    dateOrderCertain: plan.dateOrderCertain,
    needsTotalsAnswer: plan.needsTotalsAnswer,
    // Exact, however long the lists below were cut.
    counts: { ready: ready.length, skipped: skipped.length, failed: plan.failed.length },
    /*
     * Counted off `plan.failed`, which is the WHOLE list — not off the cut one
     * below, and that is the entire reason this field exists.
     *
     * The no-channel failures are appended last (`buildPlan`, after the row and
     * group failures), so `slice(0, DISPLAY_CAP)` takes them off first. A file
     * with 200 earlier failures therefore arrives at the screen with every trace
     * of its channel problem gone, while `counts.failed` stays exact — and the
     * matching screen, which reads this to decide whether to make the owner pick
     * a channel, would have been reasoning from a sample it had no way of
     * knowing was biased.
     */
    noChannelFailures: plan.failed.filter((failure) => failure.reason === NO_CHANNEL_REASON).length,
    ready: ready.slice(0, DISPLAY_CAP),
    skipped: skipped.slice(0, DISPLAY_CAP),
    failed: plan.failed.slice(0, DISPLAY_CAP).map((failure) => ({
      rowNumbers: failure.rowNumbers,
      cells: failure.cells,
      reason: failure.reason,
    })),
  };
}

function toReadRow(entry: PlanGroup): ImportPreviewShape["ready"][number] {
  return {
    key: entry.key,
    rowNumbers: entry.group.rowNumbers,
    occurredOn: entry.group.occurredOn,
    description: entry.group.description,
    // A transaction's own description already identifies it; `detail` is for the
    // kinds where two records share a name.
    detail: null,
    amountCents: entry.amountCents,
    direction: entry.direction,
    lineCount: entry.group.lines.length,
    skipReason: entry.skipReason,
  };
}

/**
 * A catalog or people row shaped for the check screen.
 *
 * Four fields are null and each one says "this kind has no such thing", never
 * "we could not read it". An item's price is a fact about the business, not a
 * money event: giving it a date, a direction and a line count would put a
 * green-in / red-out marker beside a list of customers, and colour means money.
 *
 * Field by field, like every other response in this feature. Response validation
 * and zod's key-stripping are both gated on `NODE_ENV !== "production"`, so a
 * field left to the schema is present in every test and missing on a customer's
 * screen.
 */
function toRecordRow(entry: PlanRecord): ImportPreviewShape["ready"][number] {
  return {
    key: entry.key,
    rowNumbers: entry.rowNumbers,
    occurredOn: null,
    description: entry.description,
    detail: entry.detail,
    amountCents: entry.amountCents,
    direction: null,
    lineCount: null,
    skipReason: entry.skipReason,
  };
}

// ---------------------------------------------------------------------------
// Items and categories
// ---------------------------------------------------------------------------

/**
 * The channel the REQUEST named, confirmed to be one of this business's.
 *
 * Without this the id was simply trusted if it was not blank, and the first
 * thing to notice was `createTransaction`, which throws `"Source not found"` —
 * a sentence in the vocabulary this UI is never allowed to speak. It says
 * "Channel"; there is no such word as "Source" on any screen the owner sees.
 *
 * It also failed at the wrong moment. A padded id, or one belonging to a
 * business the owner has since left, previewed as ready — every row green,
 * every figure checked — and only came apart when the money was already being
 * written. Ready has to mean the write will accept it.
 *
 * `listSources` and not `loadBusinessIndex`: the index is keyed by
 * `normalizeDescription`, which drops a channel whose name folds to nothing —
 * a name written wholly in a non-Latin script. Checking against the index would
 * refuse a perfectly real channel because of how its name is spelled.
 *
 * Exactly as permissive as the write, deliberately: `createTransaction` matches
 * a source on business and id and looks at no status, so an ARCHIVED channel is
 * one it accepts. Refusing one here would put the preview back to promising
 * something different from what the ledger does, in the other direction.
 *
 * There is no cross-tenant hole being closed here — the query is scoped to the
 * business either way, so a foreign id was already unusable. This is about the
 * words the owner reads and about hearing it on the check screen.
 */
async function assertChannelIsOurs(businessId: string, sourceId: string): Promise<void> {
  const sources = await listSources(businessId);
  if (!sources.some((source) => source.id === sourceId)) {
    throw invalid("We can't find that channel — pick one from your list and try again");
  }
}

/**
 * Where a group's money will land, answered ONCE for both halves of the feature.
 *
 * Three answers, not two, and the difference between the last two is the whole
 * reason this is a function:
 *
 * - **a channel we can name** — the request named one, or the file's Channel
 *   column names one this business already has. The duplicate checks run
 *   against it, which is the normal path.
 * - **a channel we do not have yet** — the Channel column names one, and commit
 *   creates it. A channel created this second holds no rows to duplicate, so
 *   there is nothing for the checks to find and sitting them out costs nothing.
 * - **none at all** — no `sourceId` on the request and no Channel column in the
 *   file. Commit refuses this group, so the preview refuses it too.
 *
 * A name is blank if it is blank TO THE LOOKUP — `normalizeDescription`, the
 * same fold the index below is keyed on, not `trim()`. That fold keeps only
 * a-z and 0-9, so a channel named in a non-Latin script reduces to "", and
 * `indexByName` drops every source whose name does the same. Such a name can
 * therefore never be found, however many times the file is uploaded: it would
 * preview as ready with neither duplicate check run against a channel that
 * already holds money, and commit would mint a fresh channel every time. A name
 * we cannot look up is a name we cannot claim to have checked, so the row fails
 * and the owner picks the channel from the picker instead.
 *
 * A blank `fixedSourceId` is no channel either. The contract has it optional
 * (`sourceId: z.string().optional()`), which admits "", and an empty id matches
 * no source — so both inputs are tested the same way rather than one trusting
 * its caller.
 */
function channelFor(
  index: BusinessIndex,
  fixedSourceId: string | null,
  channelName: string | null,
): { sourceId: string | null; hasChannel: boolean } {
  if (fixedSourceId !== null && fixedSourceId.trim() !== "") return { sourceId: fixedSourceId, hasChannel: true };
  if (channelName === null || normalizeDescription(channelName) === "") return { sourceId: null, hasChannel: false };
  return {
    sourceId: index.sourcesByName.get(normalizeDescription(channelName)) ?? null,
    hasChannel: true,
  };
}

/**
 * Every group with its names resolved, its total computed and its key built —
 * split from the ones that have no channel to land on at all.
 *
 * A variant PARENT is deliberately treated as unmatched. `loadBusinessIndex`
 * indexes every revenue item including non-leaf parents, but `createTransaction`
 * refuses a sale against one ("has variants — record the sale against one of its
 * variants"), so resolving it here would have the preview promise a row the
 * commit then refuses. Falling back to a label-only line is already the
 * documented behaviour for an item we cannot resolve.
 *
 * Reached only on the transactions path — `buildPlan` refuses every other kind
 * above. A catalog file has no channel and this rule must never touch one.
 */
async function resolveGroups(
  table: { headers: string[]; rows: string[][] },
  bodies: PlanGroupBody[],
  index: BusinessIndex,
  fixedSourceId: string | null,
): Promise<{ groups: PlanGroup[]; withoutChannel: PlanGroupBody[] }> {
  const nameOf = (name: string | null): string | null =>
    name === null ? null : normalizeDescription(name);

  // Asked once per distinct matched item rather than once per line, and in
  // parallel: a 5,000-row export names a handful of products over and over.
  const candidates = new Set<string>();
  for (const body of bodies) {
    for (const line of body.lines) {
      if (line.direction !== "in") continue;
      const key = nameOf(line.itemName);
      const id = key === null ? undefined : index.revenueItemsByName.get(key);
      if (id !== undefined) candidates.add(id);
    }
  }
  const parents = new Set<string>();
  await Promise.all(
    [...candidates].map(async (id) => {
      if (await revenueItemHasVariants(id)) parents.add(id);
    }),
  );

  const groups: PlanGroup[] = [];
  const withoutChannel: PlanGroupBody[] = [];
  for (const body of bodies) {
    const lines: PlanLine[] = body.lines.map((line) => {
      const itemKey = nameOf(line.itemName);
      const categoryKey = nameOf(line.categoryName);
      const revenueItemId =
        line.direction === "in" && itemKey !== null ? index.revenueItemsByName.get(itemKey) ?? null : null;
      return {
        ...line,
        revenueItemId: revenueItemId !== null && parents.has(revenueItemId) ? null : revenueItemId,
        expenseItemId:
          line.direction === "out" && itemKey !== null ? index.expenseItemsByName.get(itemKey) ?? null : null,
        categoryId: categoryKey === null ? null : index.categoriesByName.get(categoryKey) ?? null,
      };
    });

    const group: PlanGroupBody = { ...body, lines };
    const channel = channelFor(index, fixedSourceId, group.channelName);
    if (!channel.hasChannel) {
      withoutChannel.push(group);
      continue;
    }
    groups.push({
      key: `${group.orderId ?? ""}:${group.rowNumbers.join(",")}`,
      group,
      amountCents: totalOf(lines),
      direction: headerDirectionOf(lines),
      sourceId: channel.sourceId,
      cells: cellsAtRow(table, group.rowNumbers[0]),
      skipReason: null,
    });
  }
  return { groups, withoutChannel };
}

// ---------------------------------------------------------------------------
// Rows the owner should not import again
// ---------------------------------------------------------------------------

/**
 * Sets aside the groups this business already has, or that are not income at
 * all. First match wins, so a row carries ONE reason.
 *
 * Nothing here decides anything: a skipped group is unticked on screen with its
 * reason, and the owner ticks it back if they meant it.
 */
async function applySkips(
  businessId: string,
  groups: PlanGroup[],
  index: BusinessIndex,
  timeZone?: string,
): Promise<void> {
  if (groups.length === 0) return;

  // The file's own span. A five-year ledger must not be read to check one
  // month, and the key carries the date, so a row outside the span could never
  // have matched anyway.
  const days = groups.map((entry) => entry.group.occurredOn).sort();
  const fromIso = days[0];
  const toIso = days[days.length - 1];

  // Dedupe is per channel, so the lookups are too. Usually one source; a file
  // with a Channel column can name a few.
  //
  // Every group here HAS a channel — `buildPlan` failed the ones that do not, so
  // no row can reach `ready` without having been compared to something. A null
  // `sourceId` therefore means only that commit will create the channel this
  // group names: brand new, holding nothing to duplicate, so the two checks
  // below have nothing to find and skipping them costs the owner nothing.
  const sourceIds = [...new Set(groups.flatMap((entry) => (entry.sourceId === null ? [] : [entry.sourceId])))];
  const keysBySource = new Map<string, Set<string>>();
  const refsBySource = new Map<string, Set<string>>();
  await Promise.all(
    sourceIds.map(async (sourceId) => {
      const refs = groups.flatMap((entry) =>
        entry.sourceId === sourceId && entry.group.orderId !== null ? [entry.group.orderId] : [],
      );
      const [keys, found] = await Promise.all([
        loadExistingKeys(businessId, sourceId, fromIso, toIso, timeZone),
        loadExistingExternalRefs(businessId, sourceId, refs),
      ]);
      keysBySource.set(sourceId, keys);
      refsBySource.set(sourceId, found);
    }),
  );

  /**
   * The channels this business has actually connected, as WORDS.
   *
   * `isPayoutLike` compares whole folded words, so a source stored as
   * "Daraz.pk" folds to the two-word phrase "daraz pk" and would never match a
   * statement line reading "PAYOUT FROM DARAZ". Tokens under three characters
   * are dropped: a one-letter entry matches any standalone letter.
   */
  const processorNames = [
    ...new Set(
      [...index.sourcesByName.keys()].flatMap((name) => name.split(" ")).filter((word) => word.length >= 3),
    ),
  ];

  // Asked once, and only if a row looks like a payout at all: a business with no
  // recorded income yet is importing its first file, and setting its money aside
  // would leave it with nothing.
  let salesChecked = false;
  let hasSales = false;
  const businessHasAnySales = async (): Promise<boolean> => {
    if (!salesChecked) {
      hasSales = await businessHasSales(businessId);
      salesChecked = true;
    }
    return hasSales;
  };

  for (const entry of groups) {
    const orderId = entry.group.orderId;
    if (orderId !== null && entry.sourceId !== null && refsBySource.get(entry.sourceId)?.has(orderId)) {
      entry.skipReason = ALREADY_IMPORTED_REASON;
      continue;
    }

    // Built from the SAME figure the preview shows — Σ(quantity × unit price) —
    // because the other side is built from what the ledger actually stored. Sum
    // the cells instead and the two never match on a multi-quantity row: no
    // error, nothing on screen, and the owner re-imports and doubles their books.
    //
    // A description that folds to nothing is a legitimate key and is NOT skipped
    // here. Both sides emit it on purpose (`importMatch.ts`): an Urdu statement
    // or a "-" placeholder shares one fingerprint, and a false flag costs one
    // untick where a missed flag costs a duplicated year.
    const key = duplicateKey({
      occurredOn: entry.group.occurredOn,
      // The file's amounts are always positive with the direction carrying the
      // sign, and the other side takes the absolute value too.
      amountCents: Math.abs(entry.amountCents),
      direction: entry.direction,
      description: entry.group.description,
    });
    if (entry.sourceId !== null && keysBySource.get(entry.sourceId)?.has(key)) {
      entry.skipReason = "You already have a row like this on this day";
      continue;
    }

    // The direction guard is not optional. `isPayoutLike` is a string predicate
    // and direction-blind by design: "AMAZON PAYMENTS UK LTD" on a money-OUT row
    // returns true, and that row is an ordinary cost.
    if (
      entry.direction === "in" &&
      isPayoutLike(entry.group.description, processorNames) &&
      (await businessHasAnySales())
    ) {
      entry.skipReason = "This looks like a payout — money you have already recorded as sales";
    }
  }
}

// ── csvImportCommit ──────────────────────────────────────────────

/**
 * Turning a plan into ledger rows.
 *
 * The half of importing that WRITES. `csvImport.ts` reads a file into a plan and
 * this writes that plan, and the arrow between them runs one way only: this file
 * imports `buildPlan` and the plan's shapes, and nothing there imports anything
 * here.
 *
 * Commit re-reads the FILE rather than trusting rows posted back from the
 * browser. Numbers on a screen can be edited; money must not depend on that.
 *
 * No money row is written by SQL here. Every one of them lands through the same
 * services the Add buttons call, which is what makes an imported figure behave
 * identically to a typed one — cost snapshots freeze, effective-dated components
 * resolve, and the profit ladder is computed in the one module that is allowed
 * to compute it. The only statements this file issues itself are the batch row,
 * the stamp that ties each new transaction back to it, and the advisory lock
 * that keeps two uploads for one business from running at the same moment. None
 * of the three is money.
 */
export interface CommitInput extends ImportInput {
  /**
   * Keys from the preview's `skipped` list the owner ticked back in. A key is
   * stable across a re-parse of the same file with the same mapping, which is
   * the whole reason commit can honour this while still reading the file.
   */
  includeKeys?: string[];
  /**
   * Who ran this import, stamped on the batch as `created_by`.
   *
   * The undo path has always carried this (`undoImportBatch`'s third argument),
   * so a business with two people could say who REVERSED an import and not who
   * made it — the half of the pair anyone would ask about first. Optional
   * because the column is, and because a service must not be unusable from a
   * future caller that has no user (a scheduled import has none).
   *
   * Internal: `created_by` is an auth user id and never leaves the server. The batch
   * view the browser gets does not carry it, and the response schema would
   * strip it if it did.
   */
  userId?: string;
}

export interface CommitResult {
  batch: ImportBatchShape;
  counts: { created: number; skipped: number; failed: number };
  /**
   * WHY each row failed. Cut to `DISPLAY_CAP`; `counts.failed` stays exact.
   *
   * `[]` when nothing failed — never absent. The type makes that a compile
   * error rather than a habit, which matters because nothing at runtime would
   * catch it: response validation and zod's key-stripping are both gated on
   * `NODE_ENV !== "production"`, so an omitted field is quietly supplied by the
   * schema in every test and simply missing on a customer's screen.
   */
  failures: ImportFailedRowShape[];
}

/**
 * The names one commit has already resolved, so a 300-row statement naming one
 * channel and one category does not create three hundred of either.
 *
 * Each map is keyed with the SAME fold the lookup it feeds uses — the domain's
 * `normalizeDescription` for channels, which is what `channelFor` and
 * `loadBusinessIndex` agree on, and `lower(trim())` for people and categories,
 * which is what `findOrCreatePerson` and `findOrCreateCategory` match on. A
 * cache keyed differently from the query behind it is a cache that answers a
 * question nobody asked.
 */
interface CommitCaches {
  sources: Map<string, string>;
  people: Map<string, string>;
  categories: Map<string, string>;
}

/**
 * Write everything the plan says to write.
 *
 * The file is READ AGAIN here — `buildPlan`, the identical call the check screen
 * made — and no row posted back from the browser is trusted for anything except
 * `includeKeys`, which is a list of decisions rather than a list of figures.
 * That is what makes the number on the screen and the number in the ledger the
 * same number: they are the same computation, not two that agree today.
 *
 * One upload at a time per business. The lock below is what makes the reading
 * and the writing one indivisible decision rather than two moments with a gap
 * between them.
 */
export async function commitImport(businessId: string, input: CommitInput): Promise<CommitResult> {
  try {
    return await withImportLock(businessId, () => writePlan(businessId, input));
  } catch (error) {
    // ONE place where "the database had no connection for us" becomes a
    // sentence, rather than one per statement that could raise it. Every part
    // of a commit needs a pooled connection — taking the lock, reading the
    // plan, each write, the stamp at the end — so a translation attached to any
    // single one of them would leave the others answering in `pg`'s own words.
    //
    // `await` above rather than a bare `return`, on purpose: without it the
    // promise is handed back before it settles and this catch never runs.
    if (isDatabaseUnavailable(error)) throw unavailable(DATABASE_BUSY_MESSAGE);
    throw error;
  }
}

/**
 * What the owner is told when the import stopped because the database was busy.
 *
 * Three jobs in one sentence, and it needs all three. It must NOT sound like
 * their file is wrong, because it is not. It must say that trying again is the
 * right move, because it is — unlike every other refusal this feature hands
 * back, which asks them to go and edit something instead. And it must send them
 * to look at what landed, because a commit can stop at any point: before a
 * single row (the lock, or reading the file) or part-way through writing them.
 * An owner who retries without checking is how one month lands in the books
 * twice.
 *
 * ONE sentence for both of those moments, worded so it is true at either. "See
 * what landed" costs a glance when the answer is "nothing" and prevents a
 * double import when it is not; a message promising that nothing was written
 * would be a lie half the time, and the expensive half.
 *
 * No backend vocabulary: no pool, no connection, no timeout. "Too busy" is the
 * true fact at the altitude the owner cares about.
 */
const DATABASE_BUSY_MESSAGE =
  "We were too busy to finish this import. Nothing in your file was wrong — " +
  "check your import history to see what landed, then try again.";

/**
 * The database not being there — busy, waking, or gone.
 *
 * ── Why these are matched on a MESSAGE, which is normally a bad idea ──
 *
 * Because `pg` gives us nothing else for them. All three are constructed as a
 * plain `new Error(...)` — no `code`, no `name` beyond "Error", no own
 * properties at all. Verified against the installed pg 8.20.0 / pg-pool 3.13.0
 * by provoking each one and printing it, not by reading the docs:
 *
 *     constructor : Error
 *     code        : undefined
 *     ownKeys     : []
 *
 * So the message is the only discriminator that exists. Three different moments,
 * all reaching the same loop, none of them the owner's file being wrong:
 *
 *   · the pool is full and the wait ran out (`pg-pool/index.js:224`) — the
 *     saturation case `connectionTimeoutMillis` was added for;
 *   · a NEW connection could not finish being established in time
 *     (`pg-pool/index.js:276`) — a cold Neon instance waking up, which
 *     `DEPLOY.md`'s free tier does after an idle spell;
 *   · the connection went away underneath us (`pg/lib/client.js:180`) — the
 *     socket ended with work in flight, which is the same Neon instance going
 *     back to sleep, or a network that dropped.
 *
 * EVERY ONE of these is pinned by a test that provokes it from the real library
 * rather than hand-building the error — see "every shape of `the database is not
 * there` is pinned to what `pg` actually throws" in
 * `csvImport.integration.test.ts`. That matters more than it looks: a matcher
 * that silently stops matching leaves the bug in place while looking fixed, and
 * a string nothing exercises is a string a reword can break in silence. The two
 * unpinned ones were exactly that until this round.
 *
 * ── And the shapes that are NOT strings ──
 *
 * A database that cannot be reached at all fails one rung lower, in the socket,
 * and those errors are structured: Node gives them a `syscall` and a string
 * `code` (`ECONNREFUSED` from a refused port, `ENOTFOUND` from a name that does
 * not resolve, `ECONNRESET` from a connection cut mid-handshake). Matching the
 * SHAPE rather than a list of code names is what stops this being "the codes
 * someone remembered" — every libuv failure carries it, including ones not
 * thought of here.
 *
 * It cannot swallow a row failure, and that is checked rather than assumed: a
 * real `DatabaseError` from `pg` has no `syscall` property at all, and its `code`
 * is a five-character SQLSTATE (`23505`, `55P03`). Printed from the real
 * database, and asserted in the same test.
 *
 * `isDatabaseUnavailable` is exported ONLY so that test can pin it against the
 * real library. Nothing else calls it from outside this module.
 */
const DATABASE_GONE_MESSAGES: readonly string[] = [
  "timeout exceeded when trying to connect",
  "Connection terminated due to connection timeout",
  "Connection terminated unexpectedly",
];

/** A socket that never got anywhere: Node's system-error shape, not Postgres's. */
function isSocketFailure(error: Error): boolean {
  const system = error as Error & { code?: unknown; syscall?: unknown };
  return typeof system.syscall === "string" && typeof system.code === "string";
}

export function isDatabaseUnavailable(error: unknown): boolean {
  // The chain is walked, not just the error itself, because a wrapper may carry
  // the real one as `cause` — the same pair `isDuplicateExternalRef` checks.
  // Bounded, since a `cause` chain can in principle be cyclic.
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current instanceof Error; depth += 1) {
    if (DATABASE_GONE_MESSAGES.includes(current.message)) return true;
    if (isSocketFailure(current)) return true;
    current = current.cause;
  }
  return false;
}

// ---------------------------------------------------------------------------
// One import at a time, per business
// ---------------------------------------------------------------------------

/**
 * The key this lock is taken on: a fixed word for "a CSV import", and the
 * business.
 *
 * `pg_advisory_xact_lock(classid, objid)` takes two 32-bit numbers and treats
 * two locks as one lock only when BOTH halves match, so the first half is a
 * namespace. Spelling it as `hashtext` of a readable phrase rather than a magic
 * number means the next feature that wants a lock picks its own phrase and
 * cannot collide with this one by accident.
 *
 * `hashtext` can in principle map two different businesses onto one number, and
 * the consequence of that is worth stating because it is not a bug: their two
 * imports would take turns instead of running side by side. Slower, never
 * wrong. A collision cannot cause a lock to be MISSED, which is the only
 * direction that would matter.
 */
const IMPORT_LOCK_NAMESPACE = "profit-loop:csv-import";

/**
 * How long the second of two overlapping commits waits before it gives up.
 *
 * There has to be a limit, and the reason is the connection pool rather than
 * patience. A waiting commit is holding a pooled connection while it waits;
 * `lib/db` builds its pool on `pg`'s default of ten. With no limit, ten
 * double-clicks on one business would hold all ten connections waiting, and the
 * one that actually owns the lock could never get the second connection it
 * needs to do its work — a hang that never resolves. With a limit they give
 * their connections back and the holder finishes.
 *
 * Thirty seconds is far longer than any import a human double-clicks on, and
 * short enough that an owner who genuinely uploaded a second file during a long
 * one is told to wait rather than left staring at a spinner.
 */
const IMPORT_LOCK_WAIT = "30s";

/**
 * Postgres' "I stopped waiting for a lock" — `lock_timeout` fired.
 *
 * Checked from source rather than assumed: `lock_timeout` is documented for
 * tables and rows, and an advisory lock is neither, so whether it applies here
 * was verified against a real Postgres before this code relied on it. It does,
 * and this is the SQLSTATE it raises.
 */
const LOCK_TIMEOUT_SQLSTATE = "55P03";

/**
 * Run `write` with this business's import lock held.
 *
 * ── The gap this closes ──
 *
 * The duplicate check READS (inside `buildPlan`) and the loop WRITES, and
 * nothing used to hold the door between those two moments. For a file carrying
 * order ids, `unique(source_id, external_ref)` catches a second writer at the
 * database. A bank statement has no order id column, so it had no backstop at
 * all: two overlapping commits of one file both conclude "not a duplicate" and
 * both land, and the owner's month is in their books twice with nothing on any
 * screen to say so. Uploading the same file twice in a row was already safe.
 * This is the case where the two OVERLAP — a double-click, a retried request, a
 * second tab.
 *
 * ── Why an outer transaction is the right home for it, and not atomicity ──
 *
 * A transaction-scoped lock needs a transaction to be scoped to, and
 * `createTransaction` opens its own — the same fact that makes the batch stamp
 * non-atomic (the note further down). It does not stop the lock, because A LOCK
 * IS NOT ATOMICITY. This transaction exists to be somewhere for the lock to
 * live and for nothing else: it reads nothing and writes nothing, and every
 * statement `write` issues runs on OTHER pooled connections and commits on its
 * own. Rolling this transaction back would undo precisely nothing, and that is
 * the design rather than an oversight — do not be tempted to move work into it
 * on the belief that the wrap made the import atomic. It did not.
 *
 * ── Releasing ──
 *
 * There is no release to forget. A transaction-scoped advisory lock is dropped
 * at COMMIT, at ROLLBACK, and if the connection dies, so a thrown error lets go
 * of it on the way past. The session-scoped `pg_advisory_lock` would have
 * needed a `finally`, and a missed one is worse than it sounds against a POOL:
 * the lock outlives the request on a connection that goes back to be handed to
 * somebody else, and every later import of that business waits forever on a
 * lock no request holds.
 *
 * ── Deadlock ──
 *
 * It cannot deadlock against the writes it guards. `createTransaction` never
 * asks for this lock — only `commitImport` does, exactly once, before anything
 * else — so there is no second lock to form a cycle with, and Postgres' own
 * lock manager has nothing to detect.
 *
 * The failure mode that IS real is connections rather than locks. An import in
 * flight holds two: this one, and whichever one the statement of the moment is
 * running on. The wait above bounds the case that would actually happen — many
 * clicks on ONE business — because those pile up behind one lock and give their
 * connections back when they give up. It does not bound the other one: ten
 * DIFFERENT businesses starting an import in the same instant all take their
 * locks immediately, hold ten connections between them, and leave none to work
 * on. That is a pool-size question (`lib/db` takes `pg`'s default of ten) and
 * not something this function can answer, so it is written down here rather
 * than left for someone to discover.
 *
 * ── What it does not cover ──
 *
 * Only `commitImport`, and only against another `commitImport`. A row typed
 * into the Add dialog, a recurring post or a connector sync can still land in
 * the middle of an import, and none of them takes this lock, so the duplicate
 * check can still miss a row that appeared a moment after it looked. Serialising
 * imports against imports is the race this file can answer for.
 *
 * `previewImport` takes no lock either, and does not need one: it writes
 * nothing. A preview that raced a commit can show a row as ready that the
 * commit then sets aside — which is the right way round, because commit reads
 * the file again rather than trusting what the screen decided.
 *
 * The lock is held in the DATABASE, so it holds across two API processes as
 * readily as across two requests in one. That much is not limited to a single
 * server.
 */
async function withImportLock<T>(businessId: string, write: () => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    // `SET LOCAL`, so it dies with this transaction and the connection goes
    // back to the pool exactly as it came out. SET takes no parameters, so the
    // value is spliced in — it is this module's own constant and never anything
    // a caller sent.
    await tx.execute(sql.raw(`SET LOCAL lock_timeout = '${IMPORT_LOCK_WAIT}'`));
    try {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${IMPORT_LOCK_NAMESPACE}), hashtext(${businessId}))`,
      );
    } catch (error) {
      // Translated at the statement that can actually raise it, rather than
      // around the whole import: a 55P03 from somewhere else is a different
      // fact and must not borrow this sentence.
      if (isLockTimeout(error)) {
        throw invalid("Another import is still running — give it a moment and try again");
      }
      throw error;
    }
    return write();
  });
}

function isLockTimeout(error: unknown): boolean {
  const pg = error as { code?: string; cause?: { code?: string } };
  return (pg?.code ?? pg?.cause?.code) === LOCK_TIMEOUT_SQLSTATE;
}

/** The body of a commit, with the lock above already held. */
async function writePlan(businessId: string, input: CommitInput): Promise<CommitResult> {
  const plan = await buildPlan(businessId, input);

  // A ticked-back-in entry is one the owner was told about and chose anyway.
  // Everything else the plan set aside stays set aside.
  //
  // Two lists rather than one of a union type, because the write is genuinely
  // two different jobs: a transactions plan carries orders that land in the
  // ledger, a catalog plan carries records that describe the business. Exactly
  // one of them is ever non-empty, and which one is decided by `plan.kind`.
  const forced = new Set(input.includeKeys ?? []);
  const wanted = (entry: { key: string; skipReason: string | null }): boolean =>
    entry.skipReason === null || forced.has(entry.key);
  const catalogKind: CatalogKind | null = plan.kind === "transactions" ? null : plan.kind;
  const readyGroups: PlanGroup[] = plan.kind === "transactions" ? plan.groups.filter(wanted) : [];
  const readyRecords: PlanRecord[] = plan.kind === "transactions" ? [] : plan.records.filter(wanted);
  const entryCount = plan.kind === "transactions" ? plan.groups.length : plan.records.length;
  let skipped = entryCount - readyGroups.length - readyRecords.length;
  // The rows the file itself could not answer for, each with the sentence the
  // check screen showed. Groups the WRITE refuses are appended as they happen,
  // so one list carries both heights of failure and the owner reads a reason
  // for each — including for a group that never appeared on the check screen at
  // all, because it only became a failure at the moment money was written.
  //
  // Field by field, not spread: `plan.failed` is this module's own `PlanFailure`
  // and this list goes to the browser, so the two are copied across explicitly
  // rather than trusted to stay the same shape.
  const failures: ImportFailedRowShape[] = plan.failed.map((failure) => ({
    rowNumbers: failure.rowNumbers,
    cells: failure.cells,
    reason: failure.reason,
  }));

  // The batch row FIRST, so every transaction written below has an id to carry.
  const [batch] = await db
    .insert(importBatchesTable)
    .values({
      id: uid("imp"),
      businessId,
      kind: plan.kind,
      filename: plan.filename,
      // The channel the REQUEST named, and null when the file chose per row —
      // a file with a Channel column can name several, and there is no honest
      // single answer for it. Blank is no channel, matching `channelFor`, and
      // an empty string here would break the foreign key besides.
      sourceId: input.sourceId?.trim() || null,
      status: "applied",
      sourceRowCount: plan.sourceRowCount,
      // How the file was read, which is the only record of it that survives.
      mappingJson: { mapping: plan.mapping, dateOrder: plan.dateOrder, totalsAre: plan.totalsAre },
      // Who ran it, the counterpart of the `undone_by` the undo has always set.
      // Null rather than "" when no caller supplied one, so "nobody recorded"
      // stays distinguishable from a user whose id is blank.
      createdBy: input.userId?.trim() || null,
    })
    .returning();

  const caches: CommitCaches = { sources: new Map(), people: new Map(), categories: new Map() };
  const createdIds: string[] = [];

  /**
   * One entry the write refused, counted with its reason so the loop carries on.
   *
   * One order the ledger refused must not cost the owner the other 299.
   * `createTransaction` is atomic per call, so a refused order left nothing
   * half-written behind it. The cells come off the plan because commit does not
   * hold the parsed table, and without them the "Download these" button would
   * hand back a blank line for exactly the rows the owner needs to fix.
   *
   * Logged as well as counted, because the two audiences want different things.
   * The owner gets a sentence about their row; an operator gets the error
   * itself, and needs it: a bug in the write reaches the screen as a handful of
   * mysteriously failed rows and would otherwise leave nothing server-side to
   * diagnose it from. Row numbers so the line points at the owner's spreadsheet,
   * and the batch so it points at which upload — a row number alone names a row
   * in every file ever uploaded.
   */
  const refuse = (rowNumbers: number[], cells: string[], error: unknown): void => {
    logger.error({ err: error, rowNumbers, importBatchId: batch.id }, "csv import: row failed to import");
    failures.push({ rowNumbers, cells, reason: reasonFor(error) });
  };

  /**
   * The pool failure that stopped the run, if one did.
   *
   * ── Why this is not just another `refuse` ──
   *
   * `refuse` says a sentence about the owner's ROW. A pool that has no
   * connection to give says nothing about their row — the row never reached the
   * database to be judged. Left in the catch below, the two are
   * indistinguishable, and the result is the worst kind of wrong answer: under
   * exactly the saturation `connectionTimeoutMillis` exists to bound, every
   * remaining row is stamped "We could not import this row", the batch is
   * recorded `applied`, and the accusation against a perfectly good file is
   * written into an import history the owner reads again later.
   *
   * It is also not a rethrow from inside the loop, and that part matters. The
   * rows written before this point are REAL, COMMITTED money — `createTransaction`
   * commits each one on its own connection (see the note below this loop) — so
   * throwing straight out of here would abandon them with `import_batch_id:
   * null`: money in the books that "undo this import" cannot see, and the owner
   * has no way to tell what landed before retrying. So the loop stops, the stamp
   * below still runs, and the sentence is raised after it. They get an import
   * history entry naming exactly what landed, and then the error.
   */
  let abortedBy: unknown = null;

  for (const entry of readyGroups) {
    try {
      createdIds.push(await writeGroup(businessId, entry, caches, input.timeZone));
    } catch (error) {
      if (isDatabaseUnavailable(error)) {
        abortedBy = error;
        break;
      }
      refuse(entry.group.rowNumbers, entry.cells, error);
    }
  }

  if (catalogKind !== null && abortedBy === null) {
    // The people this business already has, asked once. A row that resolves to
    // one of them creates nothing, and counting it as created would make the
    // number on screen larger than the number of new contacts — the one thing
    // this count has to be.
    const people = catalogKind === "people" ? await loadPeopleIndex(businessId) : null;
    for (const entry of readyRecords) {
      try {
        const id = await writeRecord(businessId, catalogKind, entry, caches, people);
        if (id === null) skipped += 1;
        else createdIds.push(id);
      } catch (error) {
        if (isDatabaseUnavailable(error)) {
          abortedBy = error;
          break;
        }
        refuse(entry.rowNumbers, entry.cells, error);
      }
    }
  }
  const failed = failures.length;

  // ── The stamp and the counts, in ONE transaction; the writes above, not ──
  //
  // Checked rather than assumed, because the brief asked for all three in one
  // transaction: `createTransaction` CANNOT join a caller's. It takes
  // `(businessId, input)` and opens `db.transaction` on the module-level handle
  // itself (`ledger.ts`), with no parameter to pass an outer `tx` through.
  //
  // So each transaction in the loop above has ALREADY COMMITTED, on its own
  // connection, by the time the next one starts. Wrapping the loop in
  // `db.transaction` would not make it atomic; it would only look as though it
  // had. Rolling that outer transaction back would undo nothing, because there
  // is nothing in it to undo — the money is committed elsewhere. Atomicity here
  // is unattainable, not merely risky. (This is exactly why the import lock at
  // the top of the file is safe in an outer transaction of its own: a lock does
  // not need the writes to be inside it, it only needs to be held while they
  // happen.) Giving `createTransaction` that parameter means putting an
  // import-shaped seam in the one function every screen writes money through,
  // which is the fork this architecture forbids.
  //
  // So the risk is recorded, not carried as a guess. If the process dies between
  // the loop and this statement, what is left behind is: transactions that are
  // correct money, complete and readable on every screen, carrying
  // `import_batch_id: null`; and a batch row claiming zero of everything. The
  // money is right and the audit trail is not — "undo this import" would find
  // nothing to undo, and the owner would delete those rows by hand. One
  // interrupted upload is the blast radius.
  //
  // These two statements ARE atomic with each other, which is the part that can
  // be: the stamp and the counts that describe it can never disagree.
  const [updated] = await db.transaction(async (tx) => {
    // ONE update, on the one table this kind of import writes. The rows above
    // are already indistinguishable from typed ones, and this stamp is the only
    // thing that says which upload made them, which is what "undo this import"
    // reads. Bounded by MAX_ROWS, so the id list can never be longer than 5,000.
    //
    // Written out per kind rather than through a table picked at runtime,
    // because a stamp aimed at the wrong table would silently mark nothing and
    // leave an import with no way to undo it. A `switch` on the plan's own kind
    // cannot compile with a fifth kind unanswered.
    if (createdIds.length > 0) {
      switch (plan.kind) {
        case "transactions":
          await tx
            .update(transactionsTable)
            .set({ importBatchId: batch.id })
            .where(and(eq(transactionsTable.businessId, businessId), inArray(transactionsTable.id, createdIds)));
          break;
        case "revenue_items":
          await tx
            .update(revenueItemsTable)
            .set({ importBatchId: batch.id })
            .where(and(eq(revenueItemsTable.businessId, businessId), inArray(revenueItemsTable.id, createdIds)));
          break;
        case "expense_items":
          await tx
            .update(expenseItemsTable)
            .set({ importBatchId: batch.id })
            .where(and(eq(expenseItemsTable.businessId, businessId), inArray(expenseItemsTable.id, createdIds)));
          break;
        case "people":
          await tx
            .update(peopleTable)
            .set({ importBatchId: batch.id })
            .where(and(eq(peopleTable.businessId, businessId), inArray(peopleTable.id, createdIds)));
          break;
      }
    }
    return tx
      .update(importBatchesTable)
      .set({ createdCount: createdIds.length, skippedCount: skipped, failedCount: failed })
      .where(and(eq(importBatchesTable.businessId, businessId), eq(importBatchesTable.id, batch.id)))
      .returning();
  });

  // The stamp is done, so whatever landed is now undoable and visible in the
  // history — which is the whole reason the loop broke instead of throwing. NOW
  // the owner is told, in a sentence that does not blame their file.
  //
  // Logged as well, and with the count, because an operator reading this line
  // wants the one thing the owner's sentence deliberately leaves out: how far it
  // got before the pool ran dry.
  if (abortedBy !== null) {
    logger.error(
      { err: abortedBy, importBatchId: batch.id, created: createdIds.length },
      "csv import: stopped part-way, no database connection available",
    );
    throw unavailable(DATABASE_BUSY_MESSAGE);
  }

  return {
    batch: batchView(updated),
    counts: { created: createdIds.length, skipped, failed },
    // In the owner's own row order, because they read this list against the
    // spreadsheet open beside them — and the two heights of failure are
    // collected at different moments, so unsorted they interleave as 2, 1, 3.
    // Sorted BEFORE the cut, so a long file shows the first 200 failing rows
    // rather than 200 of whichever kind happened to be collected first.
    //
    // Cut for display only. `counts.failed` above is the true number, so a file
    // with 500 bad rows says 500 and shows 200 — the same bargain the preview's
    // three lists strike.
    failures: failures
      .sort((a, b) => (a.rowNumbers[0] ?? 0) - (b.rowNumbers[0] ?? 0))
      .slice(0, DISPLAY_CAP),
  };
}

/**
 * What to tell the owner about a group the write refused.
 *
 * This sentence goes on a screen a non-technical owner reads, so it is chosen,
 * not forwarded blindly. Three heights:
 *
 * - **A `ServiceError`** carries the message the service itself wrote for a
 *   caller, and it is the SAME message the Add dialog shows when it is refused
 *   for the same reason ("Unlinked lines need a label"). Passing it through is
 *   what stops one rule having two explanations depending on which screen the
 *   owner reached it from.
 * - **A duplicate order** is Postgres, not English. `unique(source_id,
 *   external_ref)` refuses the row the owner explicitly ticked back in, and
 *   `duplicate key value violates unique constraint …` is precisely the
 *   vocabulary the UI is never allowed to speak. It gets the sentence the check
 *   screen already used for this fact. The constraint is named, not merely the
 *   code, because a 23505 raised while creating a channel or a person is a
 *   different fact and must not borrow this one's wording.
 * - **Anything else** is a bug, and gets a sentence that says the row did not
 *   land without pretending to explain why. A stack message forwarded here
 *   would read as an accusation against the owner's file.
 *
 * One thing never arrives here, and deliberately: a pool with no connection to
 * give. `isDatabaseUnavailable` catches that a rung up and stops the whole
 * import, because "We could not import this row" about a row the database never
 * looked at is precisely the accusation the last bullet exists to avoid — and it
 * would be made about every remaining row, at the one moment it is least true.
 */
function reasonFor(error: unknown): string {
  if (error instanceof ServiceError) return error.message;
  if (isDuplicateExternalRef(error)) return ALREADY_IMPORTED_REASON;
  return "We could not import this row";
}

/**
 * The `unique(source_id, external_ref)` index refusing a re-import.
 *
 * Drizzle may hand the driver's error back wrapped, so the cause is checked as
 * well as the error itself — the same pair `integrations/shopify.ts` tests.
 */
function isDuplicateExternalRef(error: unknown): boolean {
  const pg = error as { code?: string; constraint?: string; cause?: { code?: string; constraint?: string } };
  const code = pg?.code ?? pg?.cause?.code;
  const constraint = pg?.constraint ?? pg?.cause?.constraint;
  return code === "23505" && constraint === EXTERNAL_REF_INDEX;
}

/** The index name as `lib/db/src/schema/transactions.ts` declares it. */
const EXTERNAL_REF_INDEX = "transactions_source_external_ref_uq";

/**
 * One group, written through the same door the Add button uses.
 *
 * Returns the new transaction's id. Throws for anything the ledger refuses, and
 * the caller counts that as one failed group.
 */
async function writeGroup(
  businessId: string,
  entry: PlanGroup,
  caches: CommitCaches,
  timeZone: string | undefined,
): Promise<string> {
  const body = entry.group;
  /*
   * The first instant of the file's day IN THE OWNER'S ZONE.
   *
   * This was UTC midnight, and UTC is nobody's calendar. Every window in the
   * app is built from the reader's local day (`lib/period.ts`), so west of
   * Greenwich a row imported today sat hours before "today" started: the
   * receipt said rows landed and the ledger, dashboard and P&L all read empty
   * until the period was widened. East of Greenwich the same instant reads as
   * the day BEFORE, which can drop a row into a month already reported on.
   *
   * `csvImportResolve` reads it back with `calendarDayIn` and the same zone, so
   * the duplicate fingerprint still lands on the day the file wrote.
   */
  const occurredAt = zonedDayStart(body.occurredOn, timeZone);

  const sourceId = entry.sourceId ?? (await channelIdFor(businessId, body.channelName, caches));
  const personId = await personIdFor(businessId, body.personName, occurredAt, caches);

  // Annotated, not inferred: an untyped `[]` here is an evolving `any[]`, which
  // `createTransaction` would accept whole — so a mistyped field name on a line
  // would compile and land as a missing value rather than a build error.
  //
  // Built in order, awaiting each line, and it must stay that way. The category
  // cache below is what stops two lines naming one new category from creating
  // two of it, and a `Promise.all` over these would start both lookups before
  // either had answered.
  const lines: CreateTransactionLineInput[] = [];
  for (const line of body.lines) {
    lines.push({
      direction: line.direction,
      // Resolved in `buildPlan`, not here, so the screen and the write can never
      // name different items. A variant parent resolved to null there because
      // `createTransaction` refuses a sale against one.
      revenueItemId: line.direction === "in" ? line.revenueItemId : null,
      expenseItemId: line.direction === "out" ? line.expenseItemId : null,
      label: line.label,
      categoryId: await categoryIdFor(businessId, line, caches),
      qty: line.qty,
      // THE ROW'S AMOUNT IS THE PRICE OF ONE, because that is what every
      // export's "Lineitem price" column means, and `createTransaction`
      // multiplies it by the quantity. Reading it as a line total would divide
      // every multi-unit line by its quantity — two at 20.00 would land as two
      // at 10.00, and the ledger's 5000 would become the cell sum of 3000, which
      // is precisely the figure the check screen refuses to show.
      unitPriceCents: line.amountCents,
    });
  }

  const { transaction } = await createTransaction(businessId, {
    // The header direction the plan derived and the preview displayed — "in" if
    // anything on the order earns — not the first row's.
    direction: entry.direction,
    occurredAt,
    // Blank means paid on the day, which `createTransaction` spells `undefined`.
    // "unpaid" is money still owed, and is a different figure on every screen
    // that shows what is owed, so it must not collapse into the same value.
    paidAt:
      body.paidOn.mode === "unpaid"
        ? null
        : body.paidOn.mode === "on"
          ? zonedDayStart(body.paidOn.iso, timeZone)
          : undefined,
    sourceId,
    personId,
    origin: "import",
    // Null when the file had no id column. With one, `unique(source_id,
    // external_ref)` makes a re-run of the same export a no-op at the database
    // level, on top of the preview having already unticked it.
    externalRef: body.orderId,
    referenceNumber: body.reference,
    // Tax collected is never revenue — a header field, excluded from every
    // revenue and profit number, and never folded into a line.
    taxCollectedCents: body.taxCollectedCents,
    shippingChargedCents: body.shippingChargedCents,
    orderDiscountCents: body.discountCents,
    notes: body.notes,
    lines,
  });
  return transaction.id;
}

/**
 * The channel a row lands on when the plan could not already name one.
 *
 * TWO callers now, and they keep the same invariant by different means. On the
 * transactions path `buildPlan` fails every group with NO channel at all before
 * it reaches `plan.groups`. On the revenue-items path `channelNamesOf` drops any
 * "Sold on" part that folds to nothing, so `entry.channels` holds only names
 * this function can resolve. Either way a null `sourceId` here means exactly one
 * thing: the file names a channel this business does not have, and this creates
 * it.
 *
 * The refusal below is not a branch either caller can reach; it is the one guard
 * on an invariant kept two files away, and it says the sentence the preview said
 * rather than a second one that could drift. It earned its keep once already:
 * before `channelNamesOf` used the same fold this line does, a "Sold on" of `-`
 * arrived here AFTER the item and its cost had been written, so the owner was
 * told a catalogue row had no channel while a half-made item stayed behind,
 * unstamped and invisible to undo.
 */
async function channelIdFor(businessId: string, channelName: string | null, caches: CommitCaches): Promise<string> {
  if (channelName === null || normalizeDescription(channelName) === "") throw invalid(NO_CHANNEL_REASON);
  const key = normalizeDescription(channelName);
  const known = caches.sources.get(key);
  if (known !== undefined) return known;
  // "manual" is the kind for a channel nobody connected: the file named it, and
  // nothing syncs it. The owner can change it afterwards on the Channels screen.
  const created = await createSource(businessId, { name: channelName.trim(), kind: "manual" });
  caches.sources.set(key, created.id);
  return created.id;
}

/** The person a Person column names, resolved the way the Add screen resolves one. */
async function personIdFor(
  businessId: string,
  personName: string | null,
  occurredAt: Date,
  caches: CommitCaches,
): Promise<string | null> {
  if (personName === null || personName.trim() === "") return null;
  const key = personName.trim().toLowerCase();
  const known = caches.people.get(key);
  if (known !== undefined) return known;
  // The date matters: `firstTransactionAt` is the cohort anchor, and a person
  // born from an imported sale should be dated by that sale, not by the upload.
  const person = await findOrCreatePerson(businessId, { name: personName.trim(), firstTransactionAt: occurredAt });
  caches.people.set(key, person.id);
  return person.id;
}

/**
 * A line's category: the one the plan already matched, or a new one.
 *
 * A category is a user-defined label and free-typing one is how the Add screens
 * already work, so an import creates the ones the file names. It goes through
 * `findOrCreateCategory` and not an insert, which is what makes an internal time
 * bucket refuse the money rather than quietly absorb it — that refusal fails the
 * one order and is counted, exactly like anything else the write refuses.
 */
async function categoryIdFor(businessId: string, line: PlanLine, caches: CommitCaches): Promise<string | null> {
  if (line.categoryId !== null) return line.categoryId;
  // Tagged by which way the money went, as the Add-item routes tag theirs.
  return categoryByName(businessId, line.categoryName, line.direction === "in" ? "revenue" : "expense", caches);
}

/** A category by name, created if this business has none, and asked for once per name. */
async function categoryByName(
  businessId: string,
  name: string | null | undefined,
  appliesTo: "revenue" | "expense",
  caches: CommitCaches,
): Promise<string | null> {
  if (name === null || name === undefined || name.trim() === "") return null;
  const key = `${appliesTo}:${name.trim().toLowerCase()}`;
  const known = caches.categories.get(key);
  if (known !== undefined) return known;
  const id = await findOrCreateCategory(businessId, name, appliesTo);
  if (id !== null) caches.categories.set(key, id);
  return id;
}

// ---------------------------------------------------------------------------
// The three kinds that create records rather than money
// ---------------------------------------------------------------------------

/**
 * One catalog or people row, written through the same door the Add dialog uses.
 *
 * Returns the new row's id, or NULL when the row created nothing — a person
 * this business already had. Null is not a failure: it is the honest answer for
 * a row the owner ticked back in that turned out to be someone they already
 * know, and the caller counts it as skipped so the number on screen stays "how
 * many new records did this make".
 *
 * `findOrCreateExpenseItem` is deliberately not used for the expense kind. It
 * adopts a row that already carries the name and overwrites its fields, so an
 * import would report a create that never happened and quietly restate an item
 * the owner had already set up. `createExpenseItem` refuses instead, and the
 * refusal is the sentence the Add dialog gives for the same mistake.
 *
 * A revenue row takes THREE calls — the item, its direct cost, its channel
 * links — and they are not one transaction, for the same reason the loop above
 * is not: each service opens its own. So a failure in the second or third
 * leaves the item behind, unstamped, with the row reported as failed. Every
 * refusal those two can raise is caught on the check screen instead
 * (`catalogRowProblem`), which leaves only a database fault, and the honest
 * account of that is written here rather than guessed at.
 */
async function writeRecord(
  businessId: string,
  kind: CatalogKind,
  entry: PlanRecord,
  caches: CommitCaches,
  people: PeopleIndex | null,
): Promise<string | null> {
  const values = entry.row.values;
  const money = entry.row.moneyCents;

  if (kind === "people") {
    const name = (values.name ?? "").trim();
    const email = (values.email ?? "").trim();
    // Asked the way `findOrCreatePerson` asks it — email, then name — so the
    // count and the write cannot disagree about who was new.
    if (people !== null && existingPersonId(people, name, email) !== null) return null;
    const person = await findOrCreatePerson(businessId, {
      name,
      email: email || null,
      kind: values.kind as PersonKind,
    });
    // No `firstTransactionAt`: nobody here was born from a sale, and the cohort
    // anchor must not be the day their name was uploaded.
    if (people !== null) rememberPerson(people, person.id, name, email);
    return person.id;
  }

  if (kind === "revenue_items") {
    // Resolved BEFORE the wrapper, so the only call inside it is the create.
    // `categoryByName` can refuse too, and a refusal from it is not "you already
    // have this one" — it must stay a failure with its reason printed.
    const categoryId = await categoryByName(businessId, values.category, "revenue", caches);
    const item = await createOrAlreadyHad(entry, () =>
      createRevenueItem(businessId, {
        name: values.name,
        type: values.type as RevenueItemType,
        pricingModel: values.pricingModel as PricingModel,
        // Absent means the file left the cell blank, which `buildPlan` has already
        // refused unless the price varies. Never zero: free and unpriced are two
        // different claims about an item.
        unitPriceCents: money.price ?? null,
        categoryId,
        unitLabel: values.unitLabel || undefined,
        notes: values.notes || null,
      }),
    );
    // Nothing was created, so nothing downstream of it runs: no cost component
    // against an item we did not make, no channel links onto the owner's
    // existing item. An already-have row leaves the catalogue exactly as it was.
    if (item === null) return null;
    // A direct cost is a COST COMPONENT, effective-dated, never a column on the
    // item — so every unit sold from here on freezes the cost that was open when
    // its line was written, and editing the cost later never restates old profit.
    if (money.directCost !== undefined) await setDirectCost(businessId, item.id, money.directCost);
    if (entry.channels.length > 0) {
      const links: Array<{ sourceId: string }> = [];
      for (const channel of entry.channels) {
        // Resolved in the plan where this business already has the channel;
        // otherwise created here, as a manual one, exactly as a Channel column
        // on a transactions file is.
        links.push({ sourceId: channel.sourceId ?? (await channelIdFor(businessId, channel.name, caches)) });
      }
      await setRevenueItemSourceLinks(businessId, item.id, links);
    }
    return item.id;
  }

  // Resolved before the wrapper, for the reason given on the revenue branch.
  const categoryId = await categoryByName(businessId, values.category, "expense", caches);
  const item = await createOrAlreadyHad(entry, () =>
    createExpenseItem(businessId, {
      name: values.name,
      type: values.type as ExpenseItemPurpose,
      // A blank cell is the owner saying nothing, and `createExpenseItem` has a
      // better answer for that than any column default: it derives the nature from
      // the purpose, so payroll lands fixed and cogs lands variable. The column's
      // own example would have filed every one of them as fixed, and cost nature
      // is what break-even reads.
      costNature: entry.row.blanks.has("costNature") ? undefined : (values.costNature as CostNature),
      behavior: values.behavior as ExpenseBehavior,
      defaultAmountCents: money.defaultAmount ?? null,
      unitLabel: values.unitLabel || null,
      categoryId,
      // Resolved by `createExpenseItem` through `findOrCreatePerson`, the same
      // path the Add dialog's Supplier box takes.
      vendorName: values.vendorName || null,
      notes: values.notes || null,
    }),
  );
  return item?.id ?? null;
}

/**
 * "Already have this one" is a SKIP, on all three kinds.
 *
 * The people branch above answers this by asking before it writes, and returns
 * `null` — nothing created, counted as skipped. The two item kinds cannot ask
 * the same way: their creates are the authority on a name clash (`catalog.ts`
 * turns the unique index, and the expense pre-check, into a sentence), so the
 * answer arrives as a throw. Left to escape, the loop called `refuse()` and the
 * receipt said "1 couldn't be read" about a row that was read perfectly and
 * merely already existed — accurate reason beside it, wrong word on the tile,
 * and a `failedCount` stored on the batch that Settings still repeats days
 * later. This makes the count true rather than making the word vaguer.
 *
 * ── Narrow on purpose ──
 *
 * Only for a row the check screen ALREADY NAMED as a duplicate and the owner
 * ticked back in: `skipReason` is non-null exactly then, for both of the
 * sentences `skipReasonFor` writes ("you already have this" and "this file
 * lists it twice" — the second clashes with the copy the first occurrence just
 * created, so it is the same event). A row that reached here looking ready and
 * then would not create is a genuine surprise, and stays a failure with its
 * reason printed.
 *
 * Asked of the CODE, not of the sentence: `invalid` is the caller-mistake code,
 * so `unavailable` (a pool that could not serve us) and every non-`ServiceError`
 * fault are rethrown and still reach `isDatabaseUnavailable` and `refuse` at the
 * call site untouched. Matching on the message text would have broken silently
 * the first time anyone reworded it — which Finding 5 was about to do.
 */
async function createOrAlreadyHad<T>(
  entry: PlanRecord,
  create: () => Promise<T>,
): Promise<T | null> {
  try {
    return await create();
  } catch (error) {
    if (entry.skipReason !== null && error instanceof ServiceError && error.code === "invalid") {
      return null;
    }
    throw error;
  }
}

/**
 * A batch row shaped for the browser, field by field.
 *
 * Never the raw row. Response validation and zod's unknown-key stripping are
 * both gated on `NODE_ENV !== "production"`, so returning the row itself would
 * ship `business_id`, `mapping_json`, `created_by` and `undone_by` to every
 * customer while every test went on passing.
 *
 * Exported for Task 14's history and undo, so the two describe one batch the
 * same way.
 */
export function batchView(row: typeof importBatchesTable.$inferSelect): ImportBatchShape {
  return {
    id: row.id,
    // `kind` and `status` are plain text columns with no database enum behind
    // them. Every row this module writes carries a checked value into them.
    kind: row.kind as ImportKind,
    filename: row.filename,
    sourceId: row.sourceId ?? null,
    status: row.status as ImportBatchShape["status"],
    sourceRowCount: row.sourceRowCount,
    createdCount: row.createdCount,
    skippedCount: row.skippedCount,
    failedCount: row.failedCount,
    createdAt: row.createdAt.toISOString(),
    undoneAt: row.undoneAt?.toISOString() ?? null,
  };
}

// ── csvImportBatches ─────────────────────────────────────────────

/**
 * The list of past imports, and undoing one.
 *
 * This is what the batch stamp every other file writes was FOR. `csvImport.ts`
 * reads a file into a plan, `csvImportCommit.ts` writes that plan and stamps
 * each new row with the batch id, and this file is the only one that goes
 * backwards.
 *
 * ── Undo voids; it never deletes ────────────────────────────────────────────
 *
 * Money rows are never hard-deleted (CLAUDE.md: append-only ledger). Undoing a
 * transaction import calls `voidTransaction` — the same status change the Void
 * button calls — so every row stays in the database, greyed on the screen, out
 * of every total, and still readable as history. There is no `db.delete` in
 * this file and there must never be one: an undo that deleted would break the
 * audit trail the whole product rests on.
 *
 * Catalogue rows are different. An item or a contact is a description of the
 * business rather than a money event, so undo ARCHIVES those — and only the
 * ones nothing has used yet. An item that money already moved through, or that
 * something is still set up to post against, is kept and NAMED, because
 * "Removing 38 of 40. Two are already in use." is the truth, and both
 * alternatives are worse: silently skipping them leaves the owner counting, and
 * cascading through the sale would move money that really happened. What counts
 * as "in use" is spelled out at `revenueItemsInUse` below, and the rule matters
 * more than the list.
 *
 * ── Why there is no outer `db.transaction` ─────────────────────────────────
 *
 * Checked rather than assumed. `voidTransaction` (ledger.ts) takes
 * `(businessId, transactionId)` and opens `db.transaction` on the module-level
 * handle itself — exactly the shape `createTransaction` has, and for exactly
 * the reason recorded in `csvImportCommit.ts`: there is no parameter to pass an
 * outer `tx` through. `updateRevenueItem` and `updateExpenseItem` (catalog.ts)
 * issue their `db.update` on that same module-level handle. So every write
 * below has ALREADY COMMITTED, on its own pooled connection, before the next
 * one starts. Wrapping this function in `db.transaction` would not make it
 * atomic; it would only look as though it had, and rolling it back would undo
 * precisely nothing. The guarantee is unattainable here, not merely skipped, so
 * it is written down instead of faked.
 *
 * What that leaves is bounded and recoverable: if the process dies mid-undo,
 * some rows are void or archived and the batch still reads "applied", so the
 * owner presses Undo again and it finishes. Both halves are idempotent —
 * `voidTransaction` returns early on a row already void, and archiving an
 * archived row sets it to the value it already has — which is also why two
 * simultaneous undos of one batch cannot damage anything between them.
 */
/**
 * What an undo did, in the owner's terms.
 *
 * `kept` and `keptNames` always travel, `[]` when nothing was kept — never
 * absent. Response validation and zod's unknown-key stripping are BOTH gated on
 * `NODE_ENV !== "production"`, so a field the service leaves out is quietly
 * supplied by the schema in every test and simply missing on a customer's
 * screen. The type makes that a compile error instead.
 */
export interface UndoResult {
  batch: ImportBatchShape;
  /** Voided (transactions) or archived (catalogue) by this undo. */
  removed: number;
  /** Left alone because something already uses them. */
  kept: number;
  /** The names of those, so the screen can say which rather than only how many. */
  keptNames: string[];
}

/**
 * Every import this business has run, newest first.
 *
 * Undone imports stay in the list — an undo is a thing that happened, and the
 * history is the record of what was done to the books.
 */
export async function listImportBatches(businessId: string): Promise<ImportBatchShape[]> {
  const rows = await db
    .select()
    .from(importBatchesTable)
    .where(eq(importBatchesTable.businessId, businessId))
    // `created_at` decides the order. The id is a tiebreak and nothing more:
    // `uid()` is random, so it sorts to no meaning — but two batches CAN share a
    // timestamp, and without a second key Postgres is free to return them in a
    // different order each time, which is a list that reshuffles under the
    // owner between one screen and the next.
    .orderBy(desc(importBatchesTable.createdAt), desc(importBatchesTable.id));
  // `batchView`, not the row: the raw row carries `business_id`, `mapping_json`,
  // `created_by` and `undone_by`, and in production nothing would strip them.
  return rows.map(batchView);
}

/**
 * Undo one import.
 *
 * Scoped to the business at the first query, so a batch belonging to somebody
 * else is simply not found — there is no second check to forget further down.
 */
export async function undoImportBatch(
  businessId: string,
  batchId: string,
  userId: string,
): Promise<UndoResult> {
  const [batch] = await db
    .select()
    .from(importBatchesTable)
    .where(and(eq(importBatchesTable.businessId, businessId), eq(importBatchesTable.id, batchId)));
  if (!batch) throw notFound("Import");
  if (batch.status === "undone") throw invalid("That import has already been undone.");

  const kind = batch.kind as ImportKind;
  let outcome: Omit<UndoResult, "batch">;
  // Written out per kind rather than through a table picked at runtime, for the
  // same reason the stamp in `csvImportCommit.ts` is: an undo aimed at the wrong
  // table would silently reverse nothing and report that it had. A fifth kind
  // cannot compile with this switch unanswered.
  switch (kind) {
    case "transactions":
      outcome = await voidImportedTransactions(businessId, batchId);
      break;
    case "revenue_items":
      outcome = await archiveImportedRevenueItems(businessId, batchId);
      break;
    case "expense_items":
      outcome = await archiveImportedExpenseItems(businessId, batchId);
      break;
    case "people":
      outcome = await archiveImportedPeople(businessId, batchId);
      break;
    default: {
      const unreachable: never = kind;
      throw invalid(`Cannot undo an import of kind "${String(unreachable)}"`);
    }
  }

  const [updated] = await db
    .update(importBatchesTable)
    .set({ status: "undone", undoneAt: new Date(), undoneBy: userId })
    .where(and(eq(importBatchesTable.businessId, businessId), eq(importBatchesTable.id, batchId)))
    .returning();

  return { batch: batchView(updated), ...outcome };
}

// ---------------------------------------------------------------------------
// Three things an import creates that the batch stamp never touched
// ---------------------------------------------------------------------------

/**
 * ALL THREE ARE LEFT IN PLACE, DELIBERATELY. This is a decision, not an
 * oversight — do not read the omission as a bug.
 *
 * An expense item's `Supplier` column resolves through `findOrCreatePerson`
 * INSIDE `createExpenseItem`; a revenue item's `Sold on` column can mint a
 * channel through `createSource`; and either kind's `Category` cell can mint a
 * category through `findOrCreateCategory` (`csvImportCommit.ts`). None of the
 * three carries an `import_batch_id`, so undo cannot see them even in
 * principle.
 *
 * Why leaving them is right rather than merely easy:
 *
 * - None of them holds money. A contact, a channel and a label are things the
 *   business now knows; no total anywhere moves because one of them exists.
 * - All three FIND before they create. The row an import "made" may be one the
 *   owner had already, matched by name — removing it on undo would delete
 *   something the import never created.
 * - A channel is worse still: `revenue_item_sources` links other items to it,
 *   and transactions land on it. Reversing it is a cascade through live rows to
 *   undo a cheap, harmless one.
 *
 * The cost is one tidy-up: an owner who undoes an import may be left with a
 * supplier, a channel or a category they did not otherwise want, and removes it
 * by hand. That is the smaller of the two mistakes available here.
 *
 * This list is exhaustive as written — if a later import kind mints a fourth
 * unstamped row, it belongs here, because a comment that enumerates is read as
 * a promise that the enumeration is complete.
 */

// ---------------------------------------------------------------------------
// Transactions — voided, never deleted
// ---------------------------------------------------------------------------

async function voidImportedTransactions(
  businessId: string,
  batchId: string,
): Promise<Omit<UndoResult, "batch">> {
  const rows = await db
    .select()
    .from(transactionsTable)
    .where(
      and(
        eq(transactionsTable.businessId, businessId),
        eq(transactionsTable.importBatchId, batchId),
        // Already void — by a half-finished undo, or by the owner's own Void
        // button. Either way THIS undo did not void it, so counting it as
        // removed would be a claim about work that never happened.
        ne(transactionsTable.status, "void"),
      ),
    )
    // So `keptNames` reads in the owner's own order — oldest money first — and
    // reads the same way twice.
    .orderBy(transactionsTable.occurredAt, transactionsTable.id);

  let removed = 0;
  const keptNames: string[] = [];
  for (const row of rows) {
    try {
      await voidTransaction(businessId, row.id);
      removed += 1;
    } catch (error) {
      // `voidTransaction` refuses a sale that carries a live refund or
      // chargeback: that adjustment is its own money event and the owner must
      // deal with it deliberately. Undo must not fall over on it and leave the
      // import half-reversed — so the sale is KEPT and NAMED, the same answer
      // the catalogue half gives for a row that is already in use.
      //
      // Only a caller-mistake error is treated this way. A dropped connection
      // is not "in use" and must not be reported as though the owner had a
      // choice about it.
      if (!(error instanceof ServiceError) || error.code !== "invalid") throw error;
      keptNames.push(await transactionLabel(row));
    }
  }
  return { removed, kept: keptNames.length, keptNames };
}

/**
 * The line an owner would recognise this transaction by.
 *
 * A transaction header carries no description — the words are on its lines
 * (`transaction_lines.label`, which is where an import's `Details` column
 * lands). Ordered by id so a multi-line order names itself the same way twice.
 */
async function transactionLabel(row: typeof transactionsTable.$inferSelect): Promise<string> {
  const [line] = await db
    .select({ label: transactionLinesTable.label })
    .from(transactionLinesTable)
    .where(eq(transactionLinesTable.transactionId, row.id))
    .orderBy(transactionLinesTable.id)
    .limit(1);
  // The date is the last resort, not the first: it is the only thing every
  // transaction is guaranteed to have.
  return line?.label?.trim() || row.referenceNumber?.trim() || row.occurredAt.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Catalogue — archived, and only what nothing has used
// ---------------------------------------------------------------------------

/**
 * Split what the import created into "kept, because something uses it" and
 * "safe to put away", preserving the file's own order for the names.
 */
function partition<T extends { id: string; name: string }>(created: T[], usedIds: Set<string>) {
  const keep = created.filter((row) => usedIds.has(row.id));
  const archive = created.filter((row) => !usedIds.has(row.id));
  return { keep, archive };
}

/**
 * What counts as "something already uses this".
 *
 * The question is NOT "is this row mentioned anywhere". It is: would putting it
 * away hide a row that money still moves against? Three things answer yes, and
 * two of them answer it on a timer, without ever looking at the item:
 *
 * - A **recurring schedule**. `runDueSchedules` (recurring.ts) selects on the
 *   SCHEDULE's own status, and `createTransaction` (ledger.ts) resolves the item
 *   by business and id with no status predicate — checked, not assumed. So
 *   archiving the item does not stop the posting: the schedule goes on booking
 *   money every period against a row the owner can no longer find in any
 *   picker. That is exactly the failure `updateRevenueItem`'s own comment calls
 *   the worse bug — a hidden product that goes on selling — and undo must not be
 *   the thing that causes it.
 * - A **subscription**, which is that same engine with a lifecycle on top. Its
 *   own `revenue_item_id` is read, rather than inferred from the schedule it
 *   points at, because a plan change repoints the subscription at a NEW schedule
 *   row (`subscription.ts`, `editThisAndFuture`). The two are related facts, not
 *   one fact, so reading only the schedule would miss a live subscription whose
 *   original schedule has been superseded.
 * - A **transaction line**, which is money that already moved. Any line counts,
 *   including one on a voided transaction: the owner did sell it, and the void
 *   is a separate fact.
 *
 * `budgets` deliberately does not count, and the reason is the rule rather than
 * the table: a budget line naming an archived item is a display concern, not
 * money that keeps moving. Nothing posts because a budget exists. That is the
 * line to judge any future table against — something that POSTS belongs on this
 * side of it, something that merely REFERS belongs on the other.
 *
 * Status is not filtered on, for either the schedule or the subscription. A
 * paused schedule is one click from active, so its status is a setting and not
 * a promise. The direction of the error decides it: keeping an item the owner
 * wanted gone costs them one click, while archiving one that still posts hides
 * live money behind a row they cannot see.
 */
async function revenueItemsInUse(businessId: string, ids: string[]): Promise<Set<string>> {
  // No `business_id` on `transaction_lines` to filter by. `ids` come from the
  // caller's business-scoped select on the catalogue table, which is what closes
  // this one — the only available shape, and it is closed.
  const onMoney = await db
    .selectDistinct({ id: transactionLinesTable.revenueItemId })
    .from(transactionLinesTable)
    .where(inArray(transactionLinesTable.revenueItemId, ids));
  const onSchedules = await db
    .selectDistinct({ id: recurringSchedulesTable.revenueItemId })
    .from(recurringSchedulesTable)
    .where(
      and(
        eq(recurringSchedulesTable.businessId, businessId),
        inArray(recurringSchedulesTable.revenueItemId, ids),
      ),
    );
  const onSubscriptions = await db
    .selectDistinct({ id: subscriptionsTable.revenueItemId })
    .from(subscriptionsTable)
    .where(
      and(eq(subscriptionsTable.businessId, businessId), inArray(subscriptionsTable.revenueItemId, ids)),
    );
  return new Set(
    [...onMoney, ...onSchedules, ...onSubscriptions]
      .map((r) => r.id)
      .filter((id): id is string => id !== null),
  );
}

/** The same rule for the money-out half. See `revenueItemsInUse` for why. */
async function expenseItemsInUse(businessId: string, ids: string[]): Promise<Set<string>> {
  const onMoney = await db
    .selectDistinct({ id: transactionLinesTable.expenseItemId })
    .from(transactionLinesTable)
    .where(inArray(transactionLinesTable.expenseItemId, ids));
  const onSchedules = await db
    .selectDistinct({ id: recurringSchedulesTable.expenseItemId })
    .from(recurringSchedulesTable)
    .where(
      and(
        eq(recurringSchedulesTable.businessId, businessId),
        inArray(recurringSchedulesTable.expenseItemId, ids),
      ),
    );
  // `subscriptions` has no expense column — it is a revenue lifecycle only
  // (`schema/subscriptions.ts`) — so there is nothing to union in here. The
  // asymmetry is the schema's, not an omission.
  return new Set([...onMoney, ...onSchedules].map((r) => r.id).filter((id): id is string => id !== null));
}

async function archiveImportedRevenueItems(
  businessId: string,
  batchId: string,
): Promise<Omit<UndoResult, "batch">> {
  const created = await db
    .select({ id: revenueItemsTable.id, name: revenueItemsTable.name })
    .from(revenueItemsTable)
    .where(
      and(
        eq(revenueItemsTable.businessId, businessId),
        eq(revenueItemsTable.importBatchId, batchId),
        // Already archived, by a half-finished undo or by the owner. This undo
        // did not put it away, so it is neither removed nor kept-because-used.
        ne(revenueItemsTable.status, "archived"),
      ),
    )
    // Same tiebreak as everywhere else in this file: two rows of one import can
    // share a `created_at`, and `keptNames` that reshuffles between two calls
    // reads as a different answer to the same question.
    .orderBy(revenueItemsTable.createdAt, revenueItemsTable.id);
  if (created.length === 0) return { removed: 0, kept: 0, keptNames: [] };

  // Only the item's own references are checked, not its variants'. An import
  // creates root items and never variants, so a variant under an imported item
  // exists only if the owner added it afterwards — and `updateRevenueItem`
  // deliberately archives variants with their parent, because a hidden product
  // that goes on selling is the worse bug. Nothing is lost either way:
  // archiving is a visibility flag, no money moves, and it is one click back.
  const usedIds = await revenueItemsInUse(businessId, created.map((row) => row.id));

  const { keep, archive } = partition(created, usedIds);
  for (const item of archive) {
    // The existing update path, not a bespoke one: it carries the variant rule.
    await updateRevenueItem(businessId, item.id, { status: "archived" });
  }
  return { removed: archive.length, kept: keep.length, keptNames: keep.map((i) => i.name) };
}

async function archiveImportedExpenseItems(
  businessId: string,
  batchId: string,
): Promise<Omit<UndoResult, "batch">> {
  const created = await db
    .select({ id: expenseItemsTable.id, name: expenseItemsTable.name })
    .from(expenseItemsTable)
    .where(
      and(
        eq(expenseItemsTable.businessId, businessId),
        eq(expenseItemsTable.importBatchId, batchId),
        ne(expenseItemsTable.status, "archived"),
      ),
    )
    .orderBy(expenseItemsTable.createdAt, expenseItemsTable.id);
  if (created.length === 0) return { removed: 0, kept: 0, keptNames: [] };

  const usedIds = await expenseItemsInUse(businessId, created.map((row) => row.id));

  const { keep, archive } = partition(created, usedIds);
  for (const item of archive) {
    await updateExpenseItem(businessId, item.id, { status: "archived" });
  }
  return { removed: archive.length, kept: keep.length, keptNames: keep.map((i) => i.name) };
}

async function archiveImportedPeople(
  businessId: string,
  batchId: string,
): Promise<Omit<UndoResult, "batch">> {
  const created = await db
    .select({ id: peopleTable.id, name: peopleTable.displayName })
    .from(peopleTable)
    .where(
      and(
        eq(peopleTable.businessId, businessId),
        eq(peopleTable.importBatchId, batchId),
        ne(peopleTable.status, "archived"),
      ),
    )
    .orderBy(peopleTable.createdAt, peopleTable.id);
  if (created.length === 0) return { removed: 0, kept: 0, keptNames: [] };

  const ids = created.map((row) => row.id);
  // The same rule the items use — would archiving this hide a row that money
  // still moves against? — and for a contact it lands differently, which is why
  // recurring schedules and subscriptions are checked for an item above and NOT
  // for a person here.
  //
  // A schedule pointing at an archived ITEM keeps posting against a product the
  // owner cannot see or manage: the money is booked to a row that has vanished
  // from every picker. A schedule pointing at an archived PERSON keeps posting
  // too, but the money still lands correctly, on the item it always did, with
  // the same contact attached; what is lost is a name in a picker, and
  // un-archiving is one click. One hides live money, the other hides a label.
  //
  // So the two ways a contact gets used in the window between importing it and
  // undoing that import are checked — money booked to them, and an expense item
  // naming them as its supplier — and `projects`, `recurring_schedules`,
  // `subscriptions` and the three `clientProfitability` tables are not. Each of
  // those needs deliberate setup naming that contact, which is not something
  // that happens between an upload and its undo.
  const onMoney = await db
    .selectDistinct({ id: transactionsTable.personId })
    .from(transactionsTable)
    .where(and(eq(transactionsTable.businessId, businessId), inArray(transactionsTable.personId, ids)));
  const asSupplier = await db
    .selectDistinct({ id: expenseItemsTable.vendorPersonId })
    .from(expenseItemsTable)
    .where(and(eq(expenseItemsTable.businessId, businessId), inArray(expenseItemsTable.vendorPersonId, ids)));
  const usedIds = new Set(
    [...onMoney, ...asSupplier].map((r) => r.id).filter((id): id is string => id !== null),
  );

  const { keep, archive } = partition(created, usedIds);
  if (archive.length > 0) {
    // People have no `updatePerson` service — `routes/people.ts` writes the
    // status column directly, and so does this. A contact is not a money row.
    await db
      .update(peopleTable)
      .set({ status: "archived", updatedAt: new Date() })
      .where(and(eq(peopleTable.businessId, businessId), inArray(peopleTable.id, archive.map((p) => p.id))));
  }
  return { removed: archive.length, kept: keep.length, keptNames: keep.map((p) => p.name) };
}

// ── mappers ───────────────────────────────────────────────────────

// A NOTE ON THE BODY LIMIT. The CSV rides INSIDE the JSON body and
// `csvImport.ts` caps a file at 3 MB, so these endpoints accept
// `IMPORTS_BODY_LIMIT` where every other endpoint gets 100 kB. Each handler
// below passes it as `bodyLimit`. `imports.integration.test.ts` sends one body
// too big for the default to an imports route and to a settings route, and
// fails unless the first is read and the second refused.

/**
 * ── Why the cap plus a megabyte ──
 *
 * Both numbers count the same unit now — bytes — so this one can be DERIVED from
 * the file cap instead of being a second literal that has to be remembered when
 * the first one moves. Same shape as the attachment upload's
 * `ATTACHMENT_MAX_BYTES + 1024 * 1024`, one screen over in `transactions.ts`.
 *
 * The megabyte is headroom for what rides beside the file: the CSV sits inside a
 * JSON string, so its `"` and its CR/LF are escaped, and the mapping, filename
 * and up to 5,000 ticked-back-in keys travel in the same body. Measured on a
 * 60-column export with every field quoted — the heaviest real shape — a file at
 * the cap arrives here at 3.55 MB, spending just over half the megabyte and
 * leaving 0.45 MB unused. A Japanese file of the same shape is lighter, not
 * heavier: 3.47 MB.
 *
 * That headroom is the point: a file just OVER the cap is still READ, so the
 * owner gets `csvImport.ts`'s own sentence about 3 MB rather than a bare 413
 * from the parser, which carries no words at all. It reaches about 13% past the
 * cap in that same worst shape and further in an ordinary one — not forever, and
 * worth knowing rather than assuming. `imports.integration.test.ts`'s "a file
 * just over the cap is answered in words" pins both ends of that: a byte over
 * the cap gets the sentence, and something far past this line gets the 413.
 *
 * And 4 MB stays under the 4.5 MB that Vercel refuses a serverless request body
 * at, so this is a limit
 * that can actually be reached rather than one the platform pre-empts.
 */
export const IMPORTS_BODY_LIMIT = MAX_CSV_BYTES + 1024 * 1024;
