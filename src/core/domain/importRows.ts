/**
 * Reading whole rows of an uploaded file.
 *
 * One rule governs everything here: a row that cannot be read fails BY ITSELF.
 * It does not abort the file and it does not disappear — it comes back with its
 * own number, its own cells, and a reason the owner can act on. A bank
 * statement's footer line must not cost them the other 299 rows.
 *
 * Separate from the cell layer because the two are separate jobs. `importParse`
 * reads ONE cell and knows nothing of the file around it; this module knows
 * about headers, mappings and row numbers, and asks the cell layer for every
 * value it needs. The dependency points one way only, which is why the seam is
 * here: catalog rows land in this file next, and the money and date rules
 * underneath must not move when they do.
 */
import { columnsFor, type CatalogKind, type ColumnDef } from "./importColumns";
import {
  inferDecimalStyle, parseDateCell, parseDirectionWord, parseMoneyCell,
  type DateOrder, type DecimalStyle, type Direction, type ParsedMoney,
} from "./importParse";

/**
 * When the money arrived, relative to when the sale or cost happened.
 *
 * Blank means the ordinary case — paid the day it happened — and says so as
 * "follows" rather than by copying the date, so a later screen can still tell
 * the two apart. "unpaid" is money still owed, which is a different figure on
 * every screen that shows what is owed.
 */
export type PaidOn = { mode: "follows" } | { mode: "unpaid" } | { mode: "on"; iso: string };

export interface ParsedTxnRow {
  rowNumber: number;              // 1-based data row, matching the file
  orderId: string | null;
  occurredOn: string;             // ISO
  paidOn: PaidOn;
  description: string;
  amountCents: number;            // ALWAYS positive; direction carries the sign
  direction: Direction;
  itemName: string | null;
  qty: string;
  categoryName: string | null;
  channelName: string | null;
  personName: string | null;
  taxCollectedCents: number;
  shippingChargedCents: number;
  discountCents: number;
  reference: string | null;
  notes: string | null;
}

/** A row handed back unread: its place in the file, what it said, and why. */
export interface FailedRow { rowNumber: number; cells: string[]; reason: string }

/**
 * The row parameter defaults to a transaction row, so every existing use site
 * reads unchanged, while catalog parsing can say `RowOutcome<Record<string,
 * string>>` rather than declare a second failure shape beside `FailedRow`.
 */
export type RowOutcome<T = ParsedTxnRow> = { ok: true; row: T } | { ok: false; failure: FailedRow };

export interface TxnParseOptions { dateOrder: DateOrder }

/**
 * The mapped fields whose cells hold money, read off the one column table
 * rather than listed a second time here.
 *
 * A money column that missed this list would also miss the per-column decimal
 * inference below and be read cell by cell — the exact drift `importColumns`
 * exists to prevent.
 */
const MONEY_FIELDS: readonly string[] = columnsFor("transactions")
  .filter((column) => column.kind === "money")
  .map((column) => column.field);

/**
 * A quantity: digits, with an optional sign and an optional decimal part.
 *
 * Deliberately narrow. Anything else — "two", "1,000", "N/A" — is handed back
 * with the value quoted rather than coerced, because a quantity silently read
 * as 1 multiplies straight into somebody's revenue.
 */
const QUANTITY = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/;

/**
 * The same number, written the way the rest of the stack writes it.
 *
 * `QUANTITY` above accepts a leading `+` and a bare leading `.`, because a
 * spreadsheet exports both and they are perfectly ordinary ways to write two and
 * a half. `ledger.ts`'s `parseQty` accepts neither, and `isSellableQty`
 * (`csvImportRead.ts`) mirrors the ledger exactly so the check screen and the
 * write agree — so a cell reading ".5" was refused with "Quantity \".5\" has to
 * be more than zero", which sent an owner hunting for a zero that was not there
 * about half a unit that was perfectly sellable.
 *
 * Two readers of "is this a quantity" disagreed, and the disagreement surfaced
 * as a false sentence. Normalising here makes them agree, and makes that
 * sentence true of everything that can still reach it: strip the `+` and put the
 * `0` back, and what is left over is zero and the negatives — exactly what the
 * sentence says. The refusal was not reworded because it no longer needs to be.
 *
 * This is NOT the coercion the comment above refuses. "two", "1,000" and "N/A"
 * are still quoted back untouched — reading "1,000" would mean guessing whether
 * that comma is a thousands separator or a decimal point, and guessing wrong
 * multiplies straight into somebody's revenue. `+2` and `.5` need no guess:
 * there is exactly one number each can mean, and the sign of a negative is
 * preserved so it still fails.
 */
function normalizeQty(cell: string): string {
  const unsigned = cell.startsWith("+") ? cell.slice(1) : cell;
  const sign = unsigned.startsWith("-") ? "-" : "";
  const digits = sign === "" ? unsigned : unsigned.slice(1);
  return digits.startsWith(".") ? `${sign}0${digits}` : unsigned;
}

/** The mapped cells of ONE row, read by field name rather than by position. */
interface RowCells {
  /** Trimmed. Unmapped, or missing from a short row, reads as "". */
  text(field: string): string;
  /** Parsed with that COLUMN's decimal style. Unmapped reads as zero. */
  money(field: string): ParsedMoney;
}

/**
 * "Paid on" says one of three things and nothing else: blank means paid when it
 * happened, the word "unpaid" means it is still owed, and a date means that
 * day. Anything else is refused rather than guessed at — owed money and settled
 * money are different figures on every screen that shows either.
 */
function readPaidOn(cell: string, order: DateOrder): { ok: true; value: PaidOn } | { ok: false; reason: string } {
  if (!cell) return { ok: true, value: { mode: "follows" } };
  if (cell.toLowerCase() === "unpaid") return { ok: true, value: { mode: "unpaid" } };
  const parsed = parseDateCell(cell, order);
  // Named, because "Date isn't readable" on its own would send the owner to the
  // Date column to fix a cell that is perfectly fine.
  if (!parsed.ok) return { ok: false, reason: `Paid on: ${parsed.reason}` };
  return { ok: true, value: { mode: "on", iso: parsed.iso } };
}

/**
 * Which way the money went, and how much of it.
 *
 * The order is fixed: an explicit Money in / Money out pair, then a Type
 * column, then the sign of a signed Amount. The amount comes back POSITIVE
 * whichever branch answers, because the direction carries the sign from here
 * on — a bank writing "-45.00" in a column already headed "Money out" means
 * forty-five out, and reading that sign would file a cost as income.
 */
function resolveDirection(
  read: RowCells,
): { ok: true; cents: number; direction: Direction } | { ok: false; reason: string } {
  const moneyIn = read.money("moneyIn");
  if (!moneyIn.ok) return { ok: false, reason: moneyIn.reason };
  const moneyOut = read.money("moneyOut");
  if (!moneyOut.ok) return { ok: false, reason: moneyOut.reason };

  // Netting the two, or preferring one of them, would book a number nobody
  // wrote. The file has to answer this one.
  if (moneyIn.cents !== 0 && moneyOut.cents !== 0) {
    return { ok: false, reason: "This row has money in both the in and out columns" };
  }
  if (moneyIn.cents !== 0) return { ok: true, cents: Math.abs(moneyIn.cents), direction: "in" };
  if (moneyOut.cents !== 0) return { ok: true, cents: Math.abs(moneyOut.cents), direction: "out" };

  const amount = read.money("amount");
  if (!amount.ok) return { ok: false, reason: amount.reason };
  // A balance brought forward, a subtotal, a spacer: a real line in the file
  // and never a money event.
  if (amount.cents === 0) return { ok: false, reason: "This row has no amount" };
  // A Type column is the file SAYING which way this went, so it beats the sign,
  // which in a one-column export is often just how that bank prints things.
  const word = parseDirectionWord(read.text("type"));
  return {
    ok: true,
    cents: Math.abs(amount.cents),
    direction: word ?? (amount.cents < 0 ? "out" : "in"),
  };
}

/** One row, resolved in the order the design fixes: date, money, label, rest. */
function readTransactionRow(
  read: RowCells,
  order: DateOrder,
): { ok: true; row: Omit<ParsedTxnRow, "rowNumber"> } | { ok: false; reason: string } {
  const occurred = parseDateCell(read.text("date"), order);
  if (!occurred.ok) return { ok: false, reason: occurred.reason };

  const money = resolveDirection(read);
  if (!money.ok) return { ok: false, reason: money.reason };

  const description = read.text("description");
  const itemName = read.text("item");
  // Every ledger line carries a label or a catalogue link. A row with neither
  // would land as an unnamed amount nobody could identify a month later.
  if (!description && !itemName) {
    return { ok: false, reason: "This row needs a description or an item" };
  }

  const raw = read.text("qty");
  // Quoted back exactly as the file had it: the owner reads this beside their
  // own spreadsheet, so the refusal has to name the cell they can see.
  if (raw && !QUANTITY.test(raw)) return { ok: false, reason: `Quantity isn't a number: "${raw}"` };
  const qty = normalizeQty(raw);

  const paidOn = readPaidOn(read.text("paidOn"), order);
  if (!paidOn.ok) return { ok: false, reason: paidOn.reason };

  // Left exactly as written, signs included: these are the owner's own figures
  // and an abs() here would hide a cell that says something odd.
  const tax = read.money("taxCollected");
  if (!tax.ok) return { ok: false, reason: tax.reason };
  const shipping = read.money("shippingCharged");
  if (!shipping.ok) return { ok: false, reason: shipping.reason };
  const discount = read.money("discount");
  if (!discount.ok) return { ok: false, reason: discount.reason };

  return {
    ok: true,
    row: {
      orderId: read.text("orderId") || null,
      occurredOn: occurred.iso,
      paidOn: paidOn.value,
      description,
      amountCents: money.cents,
      direction: money.direction,
      itemName: itemName || null,
      qty: qty || "1",
      categoryName: read.text("category") || null,
      channelName: read.text("channel") || null,
      personName: read.text("person") || null,
      taxCollectedCents: tax.cents,
      shippingChargedCents: shipping.cents,
      discountCents: discount.cents,
      reference: read.text("reference") || null,
      notes: read.text("notes") || null,
    },
  };
}

/**
 * Which column of the file each field reads, and the one sentence to say about
 * a mapping that names a column the file does not have.
 *
 * Shared by both parsers below, because "the mapping points at a column that
 * isn't here" is a fact about the FILE and must read the same whichever kind is
 * being imported. Two copies of it would drift the moment one was corrected.
 */
function indexColumns(
  table: { headers: string[]; rows: string[][] },
  mapping: Record<string, string>,
): { columnIndex: Map<string, number>; missingReason: string | null } {
  const columnIndex = new Map<string, number>();
  const missing: string[] = [];
  for (const [field, header] of Object.entries(mapping)) {
    // A dropdown left on "not mapped" sends an empty header rather than
    // dropping the key. That is no column at all, not a column named "".
    if (!header.trim()) continue;
    const index = table.headers.indexOf(header);
    if (index === -1) missing.push(header);
    else columnIndex.set(field, index);
  }
  // Worked out once, then said on every row: this is one fact about the
  // mapping, not a fact about any row. Every missing column is named, not just
  // the first, so one correction fixes the file rather than uncovering the next.
  const missingReason = missing.length === 0
    ? null
    : missing.map((header) => `Column "${header}" isn't in this file`).join("; ");
  return { columnIndex, missingReason };
}

export function parseTransactionRows(
  table: { headers: string[]; rows: string[][] },
  mapping: Record<string, string>,   // field -> header name
  options: TxnParseOptions,
): RowOutcome[] {
  const { columnIndex, missingReason } = indexColumns(table, mapping);

  // A short row — an export made ragged by a trailing comma — reads as blank
  // here rather than as undefined.
  const cellAt = (cells: string[], field: string): string => {
    const index = columnIndex.get(field);
    return index === undefined ? "" : (cells[index] ?? "").trim();
  };

  // The decimal style of each money COLUMN, decided from all of its cells at
  // once. Per cell, the same column reads two ways — see inferDecimalStyle.
  const styleOf = new Map<string, DecimalStyle>();
  for (const field of MONEY_FIELDS) {
    if (!columnIndex.has(field)) continue;
    styleOf.set(field, inferDecimalStyle(table.rows.map((cells) => cellAt(cells, field))));
  }

  const outcomes: RowOutcome[] = [];
  for (let index = 0; index < table.rows.length; index += 1) {
    const cells = table.rows[index];
    // The number the owner sees in their spreadsheet: counted before anything
    // is dropped, so "row 147" still means row 147 after the blanks go.
    const rowNumber = index + 1;

    // Every export ends with a blank line. A blank line is not a problem to
    // report — it is nothing at all.
    if (cells.every((cell) => cell.trim() === "")) continue;

    // The cells are copied, not referenced: this row is handed back to the
    // owner as a download, and it must still say what the file said.
    const fail = (reason: string) => outcomes.push({ ok: false, failure: { rowNumber, cells: cells.slice(), reason } });

    if (missingReason !== null) { fail(missingReason); continue; }

    const read: RowCells = {
      text: (field) => cellAt(cells, field),
      money: (field) => parseMoneyCell(cellAt(cells, field), styleOf.get(field) ?? "dot"),
    };
    const result = readTransactionRow(read, options.dateOrder);
    if (!result.ok) { fail(result.reason); continue; }
    outcomes.push({ ok: true, row: { rowNumber, ...result.row } });
  }
  return outcomes;
}

// ---------------------------------------------------------------------------
// The three kinds that describe the business rather than move its money
// ---------------------------------------------------------------------------

/**
 * One row of a catalog or people file, read but not yet resolved against
 * anything this business already has.
 *
 * Three fields rather than one bag of strings, because the three answer
 * different questions and collapsing them loses one of the answers:
 *
 *   - `values` carries the words — text, enums (already checked and folded to
 *     the spelling we store), and the raw cell of a list column.
 *   - `moneyCents` carries money as INTEGERS in minor units, never as a string
 *     to be re-parsed later. A field is ABSENT when its cell was blank, because
 *     a blank price is not a price of zero — one means "the owner said nothing"
 *     and the other means "this is free".
 *   - `blanks` names the fields whose cell was empty. An enum's blank takes its
 *     column's documented `example`, so `values` alone cannot tell an owner who
 *     wrote "fixed" apart from one who wrote nothing at all; a writer with a
 *     better default of its own (`createExpenseItem` derives cost nature from
 *     the purpose) reads this to know it may use it.
 */
export interface ParsedCatalogRow {
  /** 1-based data row, matching the file — as `ParsedTxnRow` carries it. */
  rowNumber: number;
  values: Record<string, string>;
  moneyCents: Record<string, number>;
  blanks: ReadonlySet<string>;
}

/**
 * An enum cell read the way an owner writes it: any capitals, and a space or a
 * hyphen where we store an underscore. "One Time" and "one-time" are both
 * `one_time`.
 *
 * The value set is closed and every member is checked against it, so being
 * forgiving here cannot admit anything we would not have taken anyway.
 */
function foldEnum(raw: string): string {
  return raw.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

/**
 * One catalog cell, by its column's kind.
 *
 * A blank enum takes THAT COLUMN'S `example`, and not `values[0]`. The two
 * differ and the difference matters: `expense_items.type` lists "marketing"
 * first while its example is "operational", and filing every unlabelled cost as
 * ad spend would distort the one number owners look at most. `example` is the
 * default the column tables document, which is why `ColumnDef` has no separate
 * `default` field to disagree with it.
 */
function readCatalogCell(
  column: ColumnDef,
  cell: string,
  style: DecimalStyle,
): { ok: true; value?: string; cents?: number } | { ok: false; reason: string } {
  if (cell === "") {
    if (column.required) return { ok: false, reason: `This row has no ${column.label.toLowerCase()}` };
    if (column.kind === "enum") return { ok: true, value: column.example };
    // Money left blank stays absent, so a writer can tell it from a zero.
    return { ok: true, value: column.kind === "money" ? undefined : "" };
  }

  if (column.kind === "money") {
    const parsed = parseMoneyCell(cell, style);
    // Named, so "Amount isn't a number" does not send the owner hunting for a
    // column called Amount that this file does not have.
    if (!parsed.ok) return { ok: false, reason: `${column.label}: ${parsed.reason}` };
    return { ok: true, cents: parsed.cents };
  }

  if (column.kind === "enum") {
    const folded = foldEnum(cell);
    const values = column.values ?? [];
    if (!values.includes(folded)) {
      return {
        ok: false,
        reason: `${column.label} "${cell}" isn't one we know — use one of: ${values.join(", ")}`,
      };
    }
    return { ok: true, value: folded };
  }

  // Text, and the comma-separated list of a "Sold on" column, which stays whole
  // here: splitting it is the caller's job, since only the caller knows what the
  // pieces have to be resolved against.
  //
  // No catalog kind declares a `date` or `decimal` column today, and both would
  // land here UNREAD as plain text. A branch for them belongs above the moment
  // one is added — a date passed through as text is exactly the silent guess
  // this module exists to refuse.
  return { ok: true, value: cell };
}

/**
 * Every row of a catalog or people file, each standing or failing by itself.
 *
 * The same contract `parseTransactionRows` keeps: a row that cannot be read
 * comes back with its number, its cells and a reason, and the other rows are
 * unaffected. Nothing here knows what a revenue item IS — it reads the columns
 * `importColumns` declares for the kind and hands them over.
 */
export function parseCatalogRows(
  table: { headers: string[]; rows: string[][] },
  mapping: Record<string, string>,   // field -> header name
  kind: CatalogKind,
): RowOutcome<ParsedCatalogRow>[] {
  const columns = columnsFor(kind);
  const { columnIndex, missingReason } = indexColumns(table, mapping);

  const cellAt = (cells: string[], field: string): string => {
    const index = columnIndex.get(field);
    return index === undefined ? "" : (cells[index] ?? "").trim();
  };

  // Per COLUMN, as the transaction parser does it: the same cell reads two ways
  // depending on what the rest of its column looks like.
  const styleOf = new Map<string, DecimalStyle>();
  for (const column of columns) {
    if (column.kind !== "money" || !columnIndex.has(column.field)) continue;
    styleOf.set(column.field, inferDecimalStyle(table.rows.map((cells) => cellAt(cells, column.field))));
  }

  const outcomes: RowOutcome<ParsedCatalogRow>[] = [];
  for (let index = 0; index < table.rows.length; index += 1) {
    const cells = table.rows[index];
    const rowNumber = index + 1;
    // Every export ends with a blank line. A blank line is not a problem to
    // report — it is nothing at all.
    if (cells.every((cell) => cell.trim() === "")) continue;

    if (missingReason !== null) {
      outcomes.push({ ok: false, failure: { rowNumber, cells: cells.slice(), reason: missingReason } });
      continue;
    }

    const values: Record<string, string> = {};
    const moneyCents: Record<string, number> = {};
    const blanks = new Set<string>();
    let reason: string | null = null;
    for (const column of columns) {
      const cell = cellAt(cells, column.field);
      if (cell === "") blanks.add(column.field);
      const read = readCatalogCell(column, cell, styleOf.get(column.field) ?? "dot");
      if (!read.ok) { reason = read.reason; break; }
      if (read.value !== undefined) values[column.field] = read.value;
      if (read.cents !== undefined) moneyCents[column.field] = read.cents;
    }
    if (reason !== null) {
      outcomes.push({ ok: false, failure: { rowNumber, cells: cells.slice(), reason } });
      continue;
    }
    outcomes.push({ ok: true, row: { rowNumber, values, moneyCents, blanks } });
  }
  return outcomes;
}
