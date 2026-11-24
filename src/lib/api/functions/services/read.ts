/**
 * The read model: resolves the append-only ledger + catalog into the display
 * shapes the contract promises. ALL money here is server-computed integer cents
 * via lib/domain — the UI never computes money (CLAUDE.md). Filtering,
 * pagination, rollups, item stats, and the P&L ladder all live here so every
 * screen reads one consistent source.
 */
import {
  categoriesTable,
  costComponentsTable,
  db,
  expenseItemsTable,
  peopleTable,
  projectsTable,
  revenueItemSourcesTable,
  revenueItemsTable,
  sourcesTable,
  transactionLinesTable,
  transactionsTable,
  type Category,
  type ExpenseItem,
  type RevenueItem,
  type Source,
  type Transaction,
  type TransactionLine,
} from "@workspace/db";
import {
  allocateProportionally,
  computeBreakEven,
  computeProfitLadder,
  Decimal,
  reclaimableTaxOf,
  isIdentityRate,
  paymentStateOf,
  toBaseCents,
  type AccountingBasis,
  contributionProfitForLine,
  detectUnitMismatch,
  expenseLineSpends,
  grossLineRevenue,
  revenueLineGross,
  lineCostTotal,
  lineSubtotal,
  netLineRevenue,
  entryAmountCents,
  orderDiscountShares,
  revenueForTargetProfit,
  UNCLASSIFIED_NATURE,
  type CostSnapshot,
  type ProfitLine,
  type ProfitTransaction,
} from "@workspace/domain";
import { and, eq, gte, inArray, isNotNull, isNull, lte } from "drizzle-orm";
import { DIRECT_COST_COMPONENT_NAME } from "./catalog";
import { resolveTransactionLines, type CreateTransactionInput } from "./ledger";
import { cachedRead } from "../lib/requestCache";
import { bucketBoundaries, bucketLabel, chooseBucket, nextBucketStart } from "./buckets";

export const COUNTED_STATUSES = new Set(["completed", "refunded", "partially_refunded", "disputed"]);

export interface PeriodRange {
  start?: Date;
  end?: Date;
}

// ---------------------------------------------------------------------------
// Name maps — every id the ledger stores resolved to a human label once.
// ---------------------------------------------------------------------------

export interface NameMaps {
  sources: Map<string, Source>;
  categories: Map<string, Category>;
  revenueItems: Map<string, RevenueItem>;
  expenseItems: Map<string, ExpenseItem>;
  people: Map<string, string>;
  projects: Map<string, string>;
}

export async function loadNameMaps(businessId: string, _userId: string): Promise<NameMaps> {
  // Six definition-table reads that several reports each want. Deduplicated
  // per request for the same reason the ledger loads are: the names of things
  // cannot change midway through answering one question. Read-only downstream —
  // nothing writes to these maps.
  return cachedRead(`nameMaps:${businessId}`, async () => {
    const [sources, categories, revenueItems, expenseItems, people, projects] = await Promise.all([
      db.select().from(sourcesTable).where(eq(sourcesTable.businessId, businessId)),
      db.select().from(categoriesTable).where(eq(categoriesTable.businessId, businessId)),
      db.select().from(revenueItemsTable).where(eq(revenueItemsTable.businessId, businessId)),
      db.select().from(expenseItemsTable).where(eq(expenseItemsTable.businessId, businessId)),
      db.select().from(peopleTable).where(eq(peopleTable.businessId, businessId)),
      // EVERY project, finished ones included. This map names costs that were
      // already booked, and a site that has been handed over keeps its name on
      // them for ever. `listTimeTargets` (services/timesheet.ts) filters to live
      // projects for the opposite reason — it fills a PICKER, and offering a
      // finished site as somewhere to book new hours would be wrong.
      db.select().from(projectsTable).where(eq(projectsTable.businessId, businessId)),
    ]);
    return {
      sources: new Map(sources.map((s) => [s.id, s])),
      categories: new Map(categories.map((c) => [c.id, c])),
      revenueItems: new Map(revenueItems.map((i) => [i.id, i])),
      expenseItems: new Map(expenseItems.map((i) => [i.id, i])),
      people: new Map(people.map((p) => [p.id, p.displayName])),
      projects: new Map(projects.map((p) => [p.id, p.name])),
    };
  });
}

// ---------------------------------------------------------------------------
// Line + transaction shaping
// ---------------------------------------------------------------------------

function snapshotOf(line: TransactionLine): CostSnapshot | null {
  return (line.costSnapshot as CostSnapshot | null) ?? null;
}

/**
 * "Acme", "Ceramic mug", "Studio overheads" — who a cost was booked against.
 *
 * Resolved on read rather than frozen on the line, unlike the unit label and
 * the cost snapshot. Those are frozen because renaming an item must not restate
 * history; a target is a POINTER to a thing that still exists, so a client who
 * changes their trading name should read as their new name everywhere at once.
 *
 * "(no longer listed)" rather than blank when the pointer dangles: a cost that
 * silently belonged to nobody is how this whole area was broken before.
 *
 * There are FOUR target types (`splitTargetType`, lib/api-contract/src/shared.ts)
 * and every one of them needs a branch here. `project` arrived with Stage 2 and
 * this function was not told, so it fell to the category lookup, missed, and
 * reported every job cost in a construction business as belonging to a site that
 * no longer existed — the exact failure the paragraph above says it exists to
 * prevent. `internal` genuinely IS a category, which is why it keeps the
 * fallback rather than getting a branch of its own.
 */
function targetLabelOf(line: TransactionLine, maps: NameMaps): string | null {
  if (!line.targetType || !line.targetId) return null;
  const found =
    line.targetType === "client"
      ? maps.people.get(line.targetId)
      : line.targetType === "revenue_item"
        ? maps.revenueItems.get(line.targetId)?.name
        : line.targetType === "project"
          ? maps.projects.get(line.targetId)
          : maps.categories.get(line.targetId)?.name;
  return found ?? "(no longer listed)";
}

export function profitLine(line: TransactionLine): ProfitLine {
  return {
    direction: line.direction as "in" | "out",
    qty: line.qty,
    unitPriceCents: line.unitPriceCents,
    lineDiscountCents: line.lineDiscountCents,
    costSnapshot: snapshotOf(line),
    refundedLineId: line.refundedLineId,
    // Without this the ladder cannot see a capitalised line, and would charge
    // the whole purchase to its own month AND every slice on top of it.
    spreadMonths: line.spreadMonths,
    isAdvance: line.isAdvance,
  };
}

/**
 * "Shirt / Black / Medium" — what was actually sold, not just the leaf.
 *
 * A variant's own name is rarely enough on a ledger row. "Medium" says nothing
 * about which product, and an owner selling two things that both come in Medium
 * cannot tell those rows apart at all. The path is built from the parent chain,
 * so an item with no variants reads exactly as it always did.
 */
function revenueItemPath(itemId: string, maps: NameMaps): string | null {
  const parts: string[] = [];
  let current = maps.revenueItems.get(itemId);
  // Bounded rather than `while`: a broken parent chain must not hang a request.
  for (let hops = 0; current && hops < 10; hops += 1) {
    parts.unshift(current.name);
    current = current.parentId ? maps.revenueItems.get(current.parentId) : undefined;
  }
  return parts.length > 0 ? parts.join(" / ") : null;
}

function lineItemName(line: TransactionLine, maps: NameMaps): string | null {
  if (line.revenueItemId) return revenueItemPath(line.revenueItemId, maps);
  if (line.expenseItemId) return maps.expenseItems.get(line.expenseItemId)?.name ?? null;
  return null;
}

/**
 * What category a line belongs to.
 *
 * The line's own category when it has one — a one-off entry can be filed
 * directly — and otherwise the category of the catalogue item it names. Entry
 * forms do not ask for a category when an item is picked, because the item
 * already knows, so ANY reader that groups by category has to walk this
 * fallback. Reading `line.categoryId` alone finds almost nothing.
 */
export function lineCategoryId(line: TransactionLine, maps: NameMaps): string | null {
  if (line.categoryId) return line.categoryId;
  if (line.revenueItemId) return maps.revenueItems.get(line.revenueItemId)?.categoryId ?? null;
  if (line.expenseItemId) return maps.expenseItems.get(line.expenseItemId)?.categoryId ?? null;
  return null;
}

export function transactionSummary(
  header: Transaction,
  lines: TransactionLine[],
  maps: NameMaps,
  refundedCents: number,
  originalLineNames: Map<string, string>,
) {
  const pLines = lines.map(profitLine);
  const isAdjustment = header.adjustmentType !== null;

  let amountCents = 0;
  let netRevenueCents: number | null = null;
  let contributionProfitCents: number | null = null;

  if (isAdjustment) {
    const refundLines = lines.filter((l) => l.refundedLineId);
    const feeLines = lines.filter((l) => !l.refundedLineId);
    const refundAmount = refundLines.reduce((sum, l) => sum + grossLineRevenue(profitLine(l)), 0);
    const feeAmount = feeLines.reduce((sum, l) => sum + grossLineRevenue(profitLine(l)), 0);
    const recovered = refundLines.reduce((sum, l) => sum + lineCostTotal(profitLine(l)), 0);
    amountCents = refundAmount + feeAmount;
    contributionProfitCents = -refundAmount + recovered - feeAmount;
  } else if (header.direction === "in") {
    // A sale, possibly mixed: revenue lines make revenue; expense lines are
    // direct "cost of that job" (contribution level). Classify per line so the
    // order discount rides only the revenue side and expenses never count as
    // revenue.
    const revLines = pLines.filter((l) => (l.direction ?? "in") === "in");
    const expLines = pLines.filter((l) => (l.direction ?? "in") === "out");
    const shares = orderDiscountShares(header.orderDiscountCents, revLines);
    const net = revLines.reduce((sum, l, i) => sum + netLineRevenue(l, shares[i]), 0);
    const revCost = revLines.reduce((sum, l) => sum + lineCostTotal(l), 0);
    const jobCost = expLines.reduce((sum, l) => sum + lineSubtotal(l), 0);
    netRevenueCents = net;
    amountCents = net + header.shippingChargedCents;
    contributionProfitCents = net + header.shippingChargedCents - revCost - jobCost;
  } else {
    amountCents = pLines.reduce((sum, l) => sum + lineSubtotal(l), 0) - header.orderDiscountCents;
  }

  // Display name.
  let displayName: string;
  if (isAdjustment) {
    const refLine = lines.find((l) => l.refundedLineId);
    const orig = refLine?.refundedLineId ? originalLineNames.get(refLine.refundedLineId) : undefined;
    const verb = header.adjustmentType === "chargeback" ? "Chargeback" : "Refund";
    displayName = orig ? `${verb} · ${orig}` : verb;
  } else {
    const first = lines[0];
    const firstName = first ? lineItemName(first, maps) ?? first.label ?? "Item" : "Item";
    displayName = lines.length > 1 ? `${firstName} +${lines.length - 1}` : firstName;
  }

  return {
    id: header.id,
    direction: header.direction as "in" | "out",
    occurredAt: header.occurredAt.toISOString(),
    status: header.status as
      | "pending"
      | "completed"
      | "refunded"
      | "partially_refunded"
      | "void"
      | "disputed",
    origin: header.origin as "manual" | "integration" | "recurring_engine" | "import",
    adjustmentType: (header.adjustmentType as "refund" | "chargeback" | "correction" | null) ?? null,
    parentTransactionId: header.parentTransactionId ?? null,
    sourceId: header.sourceId,
    sourceName: maps.sources.get(header.sourceId)?.name ?? "Manual",
    personId: header.personId ?? null,
    personName: header.personId ? maps.people.get(header.personId) ?? null : null,
    currency: header.currency,
    fxRateToBase: header.fxRateToBase,
    entered:
      header.enteredCurrency && header.enteredFxRate && header.enteredAmountCents !== null
        ? { currency: header.enteredCurrency, fxRate: header.enteredFxRate, amountCents: header.enteredAmountCents }
        : null,
    /** Null = not paid yet. The two dates differ whenever a bill is settled later. */
    paidAt: header.paidAt ? header.paidAt.toISOString() : null,
    /** Null = no date was agreed, which never makes a row late. */
    dueDate: header.dueDate ?? null,
    paymentState: paymentStateOf({
      occurredAt: header.occurredAt,
      paidAt: header.paidAt,
      status: header.status as "completed",
    }),
    orderDiscountCents: header.orderDiscountCents,
    shippingChargedCents: header.shippingChargedCents,
    taxCollectedCents: header.taxCollectedCents,
    taxPaidCents: header.taxPaidCents,
    taxReclaimable: header.taxReclaimable,
    discountCode: header.discountCode ?? null,
    externalRef: header.externalRef ?? null,
    referenceNumber: header.referenceNumber ?? null,
    notes: header.notes ?? null,
    displayName,
    amountCents,
    netRevenueCents,
    contributionProfitCents,
    refundedCents,
    lines: lines.map((line) => ({
      id: line.id,
      direction: line.direction as "in" | "out",
      revenueItemId: line.revenueItemId ?? null,
      expenseItemId: line.expenseItemId ?? null,
      itemName: lineItemName(line, maps),
      label: line.label ?? null,
      categoryId: lineCategoryId(line, maps),
      categoryName: (() => {
        const cid = lineCategoryId(line, maps);
        return cid ? maps.categories.get(cid)?.name ?? null : null;
      })(),
      qty: line.qty,
      unitLabel: line.unitLabel ?? null,
      unitPriceCents: line.unitPriceCents,
      lineDiscountCents: line.lineDiscountCents,
      costSnapshot: snapshotOf(line),
      refundedLineId: line.refundedLineId ?? null,
      restocked: line.restocked ?? null,
      feesRecovered: line.feesRecovered ?? null,
      spreadMonths: line.spreadMonths ?? null,
      isAdvance: line.isAdvance,
      wastedQty: line.wastedQty ?? null,
      // All FOUR of `splitTargetType`. This cast listed three and dropped
      // `project`, the same omission `targetLabelOf` made — a type that quietly
      // disagrees with the contract it feeds is how the next reader repeats it.
      targetType: (line.targetType as "client" | "revenue_item" | "internal" | "project" | null) ?? null,
      targetId: line.targetId ?? null,
      targetLabel: targetLabelOf(line, maps),
    })),
    createdAt: header.createdAt.toISOString(),
    updatedAt: header.updatedAt.toISOString(),
  };
}

export type TransactionSummary = ReturnType<typeof transactionSummary>;

// ---------------------------------------------------------------------------
// Bulk line loading + refund attribution
// ---------------------------------------------------------------------------

async function loadLinesFor(headerIds: string[]): Promise<Map<string, TransactionLine[]>> {
  const byTxn = new Map<string, TransactionLine[]>();
  if (headerIds.length === 0) return byTxn;
  const lines = await db
    .select()
    .from(transactionLinesTable)
    .where(inArray(transactionLinesTable.transactionId, headerIds));
  for (const line of lines) {
    const list = byTxn.get(line.transactionId) ?? [];
    list.push(line);
    byTxn.set(line.transactionId, list);
  }
  return byTxn;
}

/** For every parent id, how much has been refunded against it (non-void children). */
async function loadRefundedTotals(businessId: string, parentIds: string[]): Promise<Map<string, number>> {
  const totals = new Map<string, number>();
  if (parentIds.length === 0) return totals;
  const children = await db
    .select()
    .from(transactionsTable)
    .where(and(eq(transactionsTable.businessId, businessId), inArray(transactionsTable.parentTransactionId, parentIds)));
  const live = children.filter((c) => c.status !== "void");
  const childLines = await loadLinesFor(live.map((c) => c.id));
  for (const child of live) {
    if (!child.parentTransactionId) continue;
    const amount = (childLines.get(child.id) ?? [])
      .filter((l) => l.refundedLineId)
      .reduce((sum, l) => sum + grossLineRevenue(profitLine(l)), 0);
    totals.set(child.parentTransactionId, (totals.get(child.parentTransactionId) ?? 0) + amount);
  }
  return totals;
}

/** lineId → original line's display name, so refund rows can name what they reverse. */
async function loadOriginalLineNames(businessId: string, maps: NameMaps): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  const rows = await db
    .select({ id: transactionLinesTable.id, revenueItemId: transactionLinesTable.revenueItemId, expenseItemId: transactionLinesTable.expenseItemId, label: transactionLinesTable.label })
    .from(transactionLinesTable)
    .innerJoin(transactionsTable, eq(transactionLinesTable.transactionId, transactionsTable.id))
    .where(eq(transactionsTable.businessId, businessId));
  for (const row of rows) {
    const name =
      (row.revenueItemId ? revenueItemPath(row.revenueItemId, maps) : null) ??
      (row.expenseItemId ? maps.expenseItems.get(row.expenseItemId)?.name : null) ??
      row.label ??
      null;
    if (name) names.set(row.id, name);
  }
  return names;
}

// ---------------------------------------------------------------------------
// Transaction list (filters + cursor pagination + server-side rollups)
// ---------------------------------------------------------------------------

export interface ListTransactionsQuery {
  startDate?: string;
  endDate?: string;
  direction?: "in" | "out";
  sourceId?: string;
  status?: string;
  origin?: string;
  categoryId?: string;
  itemType?: string;
  search?: string;
  cursor?: string;
  limit?: number;
  groupBy?: "type" | "category" | "source";
}

function typeLabel(header: Transaction): { key: string; label: string } {
  if (header.adjustmentType === "chargeback") return { key: "chargeback", label: "Chargeback" };
  if (header.adjustmentType) return { key: "refund", label: "Refund" };
  if (header.direction === "in") return { key: "revenue", label: "Revenue" };
  return { key: "expense", label: "Expense" };
}

function signedAmount(summary: TransactionSummary): number {
  return summary.direction === "in" ? summary.amountCents : -summary.amountCents;
}

interface CategoryShare {
  categoryId: string | null;
  amountCents: number;
  netRevenueCents: number;
  contributionProfitCents: number;
}

/** Fold per-line contributions into one entry per category. */
function foldByCategory(parts: CategoryShare[]): CategoryShare[] {
  const byCategory = new Map<string, CategoryShare>();
  for (const part of parts) {
    if (part.amountCents === 0 && part.netRevenueCents === 0 && part.contributionProfitCents === 0) continue;
    const key = part.categoryId ?? "";
    const found = byCategory.get(key);
    if (found) {
      found.amountCents += part.amountCents;
      found.netRevenueCents += part.netRevenueCents;
      found.contributionProfitCents += part.contributionProfitCents;
    } else {
      byCategory.set(key, { ...part });
    }
  }
  return [...byCategory.values()];
}

/**
 * How ONE transaction's money lands across categories.
 *
 * Per line, because a single sale can carry two products filed under different
 * categories plus a cost line of its own. Attributing the whole transaction to
 * whichever line the database happened to return first — which is what this
 * used to do, with no ORDER BY behind it — dropped the entire amount into an
 * arbitrary bucket, and a different one on a different day.
 *
 * The arithmetic is the ladder's own: the same domain helpers, the same
 * order-discount split, so these buckets agree with the P&L's category
 * breakdown rather than telling a second story about the same money.
 */
function categoryShares(header: Transaction, lines: TransactionLine[], maps: NameMaps): CategoryShare[] {
  const pLines = lines.map(profitLine);
  const categoryOf = (index: number) => lineCategoryId(lines[index], maps);
  const parts: CategoryShare[] = [];

  if (header.adjustmentType !== null) {
    // A refund gives money back and hands the frozen cost back with it; a fee
    // line on the same transaction is pure loss. Both are negative to the owner.
    lines.forEach((line, i) => {
      const p = pLines[i];
      const gross = grossLineRevenue(p);
      const recovered = line.refundedLineId ? lineCostTotal(p) : 0;
      parts.push({
        categoryId: categoryOf(i),
        amountCents: -gross,
        netRevenueCents: 0,
        contributionProfitCents: -gross + recovered,
      });
    });
    return foldByCategory(parts);
  }

  if (header.direction === "in") {
    const revIdx = pLines.map((l, i) => i).filter((i) => (pLines[i].direction ?? "in") === "in");
    const shares = orderDiscountShares(header.orderDiscountCents, revIdx.map((i) => pLines[i]));
    revIdx.forEach((i, n) => {
      const net = netLineRevenue(pLines[i], shares[n]);
      parts.push({
        categoryId: categoryOf(i),
        amountCents: net,
        netRevenueCents: net,
        contributionProfitCents: contributionProfitForLine(pLines[i], shares[n]),
      });
    });
    // An expense line inside a sale is the direct cost of that job: it never
    // counts as revenue, and it lands on ITS OWN category, not the sale's.
    pLines.forEach((p, i) => {
      if ((p.direction ?? "in") === "in") return;
      parts.push({
        categoryId: categoryOf(i),
        amountCents: 0,
        netRevenueCents: 0,
        contributionProfitCents: -lineSubtotal(p),
      });
    });
    // Shipping is charged on the header, so it belongs to no category — the
    // P&L files it as uncategorized and this must agree.
    if (header.shippingChargedCents > 0) {
      parts.push({
        categoryId: null,
        amountCents: header.shippingChargedCents,
        netRevenueCents: 0,
        contributionProfitCents: header.shippingChargedCents,
      });
    }
    return foldByCategory(parts);
  }

  // A plain expense: the order discount is split across the lines in proportion,
  // so the buckets still sum to exactly what left the business.
  const spends = expenseLineSpends(pLines, header.orderDiscountCents);
  pLines.forEach((_, i) => {
    parts.push({
      categoryId: categoryOf(i),
      amountCents: -spends[i],
      netRevenueCents: 0,
      contributionProfitCents: 0,
    });
  });
  return foldByCategory(parts);
}

export async function listTransactions(businessId: string, userId: string, query: ListTransactionsQuery) {
  const maps = await loadNameMaps(businessId, userId);

  const conditions = [eq(transactionsTable.businessId, businessId)];
  if (query.startDate) conditions.push(gte(transactionsTable.occurredAt, new Date(query.startDate)));
  if (query.endDate) conditions.push(lte(transactionsTable.occurredAt, new Date(query.endDate)));
  if (query.direction) conditions.push(eq(transactionsTable.direction, query.direction));
  if (query.sourceId) conditions.push(eq(transactionsTable.sourceId, query.sourceId));
  if (query.status) conditions.push(eq(transactionsTable.status, query.status));
  if (query.origin) conditions.push(eq(transactionsTable.origin, query.origin));

  let headers = await db.select().from(transactionsTable).where(and(...conditions));
  // Voids are hidden from the ledger unless explicitly requested.
  if (query.status !== "void") headers = headers.filter((h) => h.status !== "void");
  // Spread slices are kept out of the ledger LIST. They are real rows and every
  // number on every page counts them — but this list is the owner's record of
  // money events, and a slice is not one: no cash moved, and the purchase it
  // came from is already in the list saying "charged across N months". Left in,
  // one kiln would print thirteen near-identical rows across a year, which is
  // exactly the clutter this product exists to avoid. Refunds stay, because a
  // refund IS a money event.
  const sliceIds = new Set(
    (
      await db
        .select({ id: transactionsTable.id })
        .from(transactionsTable)
        .innerJoin(
          transactionLinesTable,
          eq(transactionLinesTable.transactionId, transactionsTable.parentTransactionId),
        )
        .where(
          and(
            eq(transactionsTable.businessId, businessId),
            isNull(transactionsTable.adjustmentType),
            isNotNull(transactionLinesTable.spreadMonths),
          ),
        )
    ).map((r) => r.id),
  );
  if (sliceIds.size > 0) headers = headers.filter((h) => !sliceIds.has(h.id));

  const linesByTxn = await loadLinesFor(headers.map((h) => h.id));
  const refundedTotals = await loadRefundedTotals(
    businessId,
    headers.filter((h) => h.status === "refunded" || h.status === "partially_refunded").map((h) => h.id),
  );
  const originalNames = await loadOriginalLineNames(businessId, maps);

  let summaries = headers
    .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime() || (a.id < b.id ? 1 : -1))
    .map((header) =>
      transactionSummary(header, linesByTxn.get(header.id) ?? [], maps, refundedTotals.get(header.id) ?? 0, originalNames),
    );

  // Post-filters that need resolved shape.
  if (query.categoryId) {
    summaries = summaries.filter((s) => s.lines.some((l) => l.categoryId === query.categoryId));
  }
  if (query.itemType) {
    summaries = summaries.filter((s) =>
      s.lines.some((l) => {
        const ri = l.revenueItemId ? maps.revenueItems.get(l.revenueItemId) : null;
        const ei = l.expenseItemId ? maps.expenseItems.get(l.expenseItemId) : null;
        return ri?.type === query.itemType || ei?.type === query.itemType;
      }),
    );
  }
  if (query.search) {
    const q = query.search.trim().toLowerCase();
    summaries = summaries.filter(
      (s) =>
        s.displayName.toLowerCase().includes(q) ||
        (s.personName ?? "").toLowerCase().includes(q) ||
        s.sourceName.toLowerCase().includes(q) ||
        (s.referenceNumber ?? "").toLowerCase().includes(q) ||
        s.lines.some((l) => (l.itemName ?? l.label ?? "").toLowerCase().includes(q)),
    );
  }

  const totalCount = summaries.length;

  /**
   * Server-side rollups over the FULL filtered set (not just the page).
   *
   * Each group also carries its MEMBERS, so the list can be drawn under its
   * headings from the same buckets the subtotals came from. Without that the
   * screen had to re-derive the grouping to lay the rows out, which is how two
   * views of one set of transactions start disagreeing.
   *
   * `type` and `source` are header facts, so a transaction sits in exactly one.
   * `category` lives on the LINES: a mixed sale genuinely belongs to more than
   * one, so it appears in each with the part that belongs there — and the parts
   * add up to the whole.
   */
  type Bucket = {
    label: string;
    count: number;
    amountCents: number;
    netRevenueCents: number;
    contributionProfitCents: number;
    members: Array<{ id: string; amountCents: number }>;
  };
  let groups: Array<Bucket & { key: string }> | null = null;
  if (query.groupBy) {
    const byKey = new Map<string, Bucket>();
    const bucketFor = (key: string, label: string) => {
      const found = byKey.get(key);
      if (found) return found;
      const made: Bucket = { label, count: 0, amountCents: 0, netRevenueCents: 0, contributionProfitCents: 0, members: [] };
      byKey.set(key, made);
      return made;
    };

    for (const s of summaries) {
      const header = headers.find((h) => h.id === s.id)!;

      if (query.groupBy === "category") {
        for (const share of categoryShares(header, linesByTxn.get(header.id) ?? [], maps)) {
          const key = share.categoryId ?? "uncategorized";
          const label = share.categoryId
            ? maps.categories.get(share.categoryId)?.name ?? "Uncategorized"
            : "Uncategorized";
          const bucket = bucketFor(key, label);
          bucket.count += 1;
          bucket.amountCents += share.amountCents;
          bucket.netRevenueCents += share.netRevenueCents;
          bucket.contributionProfitCents += share.contributionProfitCents;
          bucket.members.push({ id: s.id, amountCents: share.amountCents });
        }
        continue;
      }

      const { key, label } =
        query.groupBy === "source" ? { key: s.sourceId, label: s.sourceName } : typeLabel(header);
      const bucket = bucketFor(key, label);
      bucket.count += 1;
      bucket.amountCents += signedAmount(s);
      bucket.netRevenueCents += s.netRevenueCents ?? 0;
      bucket.contributionProfitCents += s.contributionProfitCents ?? 0;
      bucket.members.push({ id: s.id, amountCents: signedAmount(s) });
    }
    groups = [...byKey.entries()]
      .map(([key, v]) => ({ key, ...v }))
      .sort((a, b) => Math.abs(b.amountCents) - Math.abs(a.amountCents));
  }

  /**
   * The shape of the period — what the graph above the ledger draws.
   *
   * Computed here for the same reason the rollups are: it covers the FULL
   * filtered set, so narrowing to one source redraws the bars, and paging
   * through 200 rows at a time never changes them. The browser is not allowed
   * to add money up, and a separate report endpoint would know nothing about
   * the filters the owner has set.
   *
   * In and out are kept apart rather than netted: a day that took 200 and
   * spent 30 is not a day that made 170, and the two are drawn on opposite
   * sides of the baseline — which is also how the graph survives being read
   * without colour (DESIGN.md 3a).
   */
  const bucketRange = {
    start: query.startDate ? new Date(query.startDate) : summaries.length ? new Date(Math.min(...summaries.map((s) => new Date(s.occurredAt).getTime()))) : new Date(),
    end: query.endDate ? new Date(query.endDate) : summaries.length ? new Date(Math.max(...summaries.map((s) => new Date(s.occurredAt).getTime()))) : new Date(),
  };
  const bucket = chooseBucket(bucketRange.start, bucketRange.end);
  const boundaries = bucketBoundaries(bucketRange.start, bucketRange.end, bucket);
  const buckets = boundaries.map((start, i) => {
    const endExclusive = i + 1 < boundaries.length ? boundaries[i + 1] : nextBucketStart(start, bucket);
    const slice = summaries.filter((s) => {
      const at = new Date(s.occurredAt);
      return at >= start && at < endExclusive;
    });
    return {
      start: start.toISOString(),
      label: bucketLabel(start, bucket),
      inCents: slice.filter((s) => s.direction === "in").reduce((sum, s) => sum + s.amountCents, 0),
      outCents: slice.filter((s) => s.direction === "out").reduce((sum, s) => sum + s.amountCents, 0),
      count: slice.length,
    };
  });

  // Cursor pagination by id (stable within the sorted set).
  const limit = query.limit ?? 50;
  let startIdx = 0;
  if (query.cursor) {
    const idx = summaries.findIndex((s) => s.id === query.cursor);
    startIdx = idx >= 0 ? idx + 1 : 0;
  }
  const page = summaries.slice(startIdx, startIdx + limit);
  const nextCursor = startIdx + limit < summaries.length ? page[page.length - 1].id : null;

  return { items: page, nextCursor, totalCount, groups, bucket, buckets };
}

export async function getTransactionDetail(businessId: string, userId: string, id: string) {
  const [header] = await db
    .select()
    .from(transactionsTable)
    .where(and(eq(transactionsTable.businessId, businessId), eq(transactionsTable.id, id)));
  if (!header) return null;

  const maps = await loadNameMaps(businessId, userId);
  const originalNames = await loadOriginalLineNames(businessId, maps);

  const children = await db
    .select()
    .from(transactionsTable)
    .where(and(eq(transactionsTable.businessId, businessId), eq(transactionsTable.parentTransactionId, id)));
  const liveChildren = children.filter((c) => c.status !== "void");

  const allIds = [header.id, ...liveChildren.map((c) => c.id)];
  const linesByTxn = await loadLinesFor(allIds);
  const refundedTotals = await loadRefundedTotals(businessId, [header.id]);

  const transaction = transactionSummary(
    header,
    linesByTxn.get(header.id) ?? [],
    maps,
    refundedTotals.get(header.id) ?? 0,
    originalNames,
  );
  // Only ADJUSTMENTS are refund history. Spread slices are children too — they
  // hang off the same parent_transaction_id — and listing them here headed
  // "Refund history" told the owner a purchase they never refunded had been
  // refunded twenty-four times. The line's own "charged across N months" note
  // is where the spread is explained.
  const refunds = liveChildren
    .filter((c) => c.adjustmentType !== null)
    .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime())
    .map((c) => transactionSummary(c, linesByTxn.get(c.id) ?? [], maps, 0, originalNames));

  return { transaction, refunds };
}

// ---------------------------------------------------------------------------
// Period transaction loader (shared by item stats + P&L)
// ---------------------------------------------------------------------------

interface LoadedTxn {
  header: Transaction;
  lines: TransactionLine[];
}

/**
 * A DB row pair in the shape the profit ladder consumes. THE one place this
 * mapping happens — it used to be copy-pasted at five call sites, so every new
 * header field (input tax was the third) risked reaching some ladders and not
 * others, and two screens would quietly disagree about the same transaction.
 */
export function profitTransaction(header: Transaction, lines: TransactionLine[]): ProfitTransaction {
  return {
    direction: header.direction as "in" | "out",
    status: header.status as ProfitTransaction["status"],
    adjustmentType: header.adjustmentType as ProfitTransaction["adjustmentType"],
    orderDiscountCents: header.orderDiscountCents,
    shippingChargedCents: header.shippingChargedCents,
    taxCollectedCents: header.taxCollectedCents,
    taxPaidCents: header.taxPaidCents,
    taxReclaimable: header.taxReclaimable,
    lines: lines.map(profitLine),
  };
}

/**
 * Every money row in a period, ready for the ladder — filed under the date the
 * chosen basis measures, and converted into the business's base currency.
 *
 * `accrual` (the default, and what profit means) files a row under when it
 * HAPPENED. `cash` files it under when it was PAID and drops anything that has
 * not been paid at all, so a July bill settled in August appears in July's
 * profit and August's cash. See lib/domain/basis.ts for the rule.
 */
export async function loadPeriodTransactions(
  businessId: string,
  range: PeriodRange,
  basis: AccountingBasis = "accrual",
): Promise<LoadedTxn[]> {
  // Deduplicated per request: a single Insights load used to ask for the same
  // window eleven times, because each report builds its own facts without
  // knowing who else already loaded them. Nothing downstream mutates what it
  // gets back — every caller filters, maps or copies — so one window can be
  // safely shared by all of them. See lib/requestCache.ts.
  const key = `txns:${businessId}:${basis}:${range.start?.getTime() ?? "-"}:${range.end?.getTime() ?? "-"}`;

  return cachedRead(key, async () => {
    const dateColumn = basis === "cash" ? transactionsTable.paidAt : transactionsTable.occurredAt;
    const conditions = [eq(transactionsTable.businessId, businessId)];
    if (range.start) conditions.push(gte(dateColumn, range.start));
    if (range.end) conditions.push(lte(dateColumn, range.end));
    // Cash cannot place a row whose money never moved. Without this an unpaid
    // bill would slip into a cash total the moment the range had no end bound.
    if (basis === "cash") conditions.push(isNotNull(transactionsTable.paidAt));

    const headers = await db.select().from(transactionsTable).where(and(...conditions));
    const linesByTxn = await loadLinesFor(headers.map((h) => h.id));
    return headers.map((header) => toBaseCurrency(header, linesByTxn.get(header.id) ?? []));
  });
}

/**
 * Every money row still waiting to be settled, in the business's base currency.
 *
 * Deliberately NOT a period read. Owed money has no window: a bill from March
 * that nobody paid is exactly as outstanding today as one from last week, and
 * scoping this to the screen's date filter would hide the oldest debts — the
 * only ones that really matter. It hangs off `transactions_business_due_idx`,
 * which is partial on `paid_at IS NULL`, so it stays small however long the
 * ledger grows.
 */
export async function loadUnpaidTransactions(businessId: string): Promise<LoadedTxn[]> {
  return cachedRead(`unpaid:${businessId}`, async () => {
    const headers = await db
      .select()
      .from(transactionsTable)
      .where(and(eq(transactionsTable.businessId, businessId), isNull(transactionsTable.paidAt)));
    const linesByTxn = await loadLinesFor(headers.map((h) => h.id));
    return headers.map((header) => toBaseCurrency(header, linesByTxn.get(header.id) ?? []));
  });
}

/**
 * Restates one transaction in the business's base currency at the rate FROZEN
 * on it, so everything downstream adds up in one currency without knowing
 * anything about exchange rates.
 *
 * Done here, once, at the boundary: a conversion scattered across the read
 * paths would eventually be forgotten in one of them, and that path would
 * silently report foreign money as if it were local. Cost snapshots convert
 * too — they are stored in the transaction's currency, and interpreting a
 * frozen number is not the same as mutating it.
 */
function toBaseCurrency(header: Transaction, lines: TransactionLine[]): LoadedTxn {
  if (isIdentityRate(header.fxRateToBase)) return { header, lines };
  const rate = header.fxRateToBase;
  const conv = (cents: number) => toBaseCents(cents, rate);

  return {
    header: {
      ...header,
      orderDiscountCents: conv(header.orderDiscountCents),
      shippingChargedCents: conv(header.shippingChargedCents),
      taxCollectedCents: conv(header.taxCollectedCents),
      taxPaidCents: conv(header.taxPaidCents),
    },
    lines: lines.map((line) => {
      const snapshot = line.costSnapshot as CostSnapshot | null;
      return {
        ...line,
        unitPriceCents: conv(line.unitPriceCents),
        lineDiscountCents: conv(line.lineDiscountCents),
        costSnapshot: snapshot
          ? {
              ...snapshot,
              total_per_unit_cents: conv(snapshot.total_per_unit_cents),
              components: snapshot.components.map((c) => ({ ...c, per_unit_cents: conv(c.per_unit_cents) })),
            }
          : null,
      };
    }),
  };
}

// ---------------------------------------------------------------------------
// Revenue-item stats
// ---------------------------------------------------------------------------

interface ItemAgg {
  unitsSold: number;
  netRevenueCents: number;
  contributionProfitCents: number;
  grossItemRevenueCents: number;
  refundedCents: number;
  txnIds: Set<string>;
  /** Sold lines, and how many of them recorded a quantity other than 1 — the
   *  signal behind "this is priced fixed but sold by the hour". */
  lineCount: number;
  linesWithNonUnitQty: number;
}

function emptyAgg(): ItemAgg {
  return { unitsSold: 0, netRevenueCents: 0, contributionProfitCents: 0, grossItemRevenueCents: 0, refundedCents: 0, txnIds: new Set(), lineCount: 0, linesWithNonUnitQty: 0 };
}

async function computeItemAggregates(businessId: string, range: PeriodRange) {
  const txns = await loadPeriodTransactions(businessId, range);

  /**
   * lineId → revenueItemId for the originals this period's refunds point at.
   *
   * A refund may unwind a sale from outside the period, so these cannot be
   * resolved from `txns` alone. This used to load EVERY line in the business to
   * cover that, which read the entire ledger to answer a question about a
   * handful of refunds — and got slower every month regardless of how short the
   * reporting period was. Only the referenced originals are fetched now.
   */
  const refundedLineIds = [
    ...new Set(
      txns.flatMap(({ header, lines }) =>
        header.adjustmentType && COUNTED_STATUSES.has(header.status)
          ? lines.map((l) => l.refundedLineId).filter((id): id is string => !!id)
          : [],
      ),
    ),
  ];

  const allLineToItem = new Map<string, string>();
  if (refundedLineIds.length > 0) {
    const originals = await db
      .select({ id: transactionLinesTable.id, revenueItemId: transactionLinesTable.revenueItemId })
      .from(transactionLinesTable)
      .innerJoin(transactionsTable, eq(transactionLinesTable.transactionId, transactionsTable.id))
      .where(
        and(eq(transactionsTable.businessId, businessId), inArray(transactionLinesTable.id, refundedLineIds)),
      );
    for (const l of originals) if (l.revenueItemId) allLineToItem.set(l.id, l.revenueItemId);
  }

  const byItem = new Map<string, ItemAgg>();
  const agg = (id: string) => {
    const existing = byItem.get(id);
    if (existing) return existing;
    const created = emptyAgg();
    byItem.set(id, created);
    return created;
  };

  for (const { header, lines } of txns) {
    if (!COUNTED_STATUSES.has(header.status)) continue;
    const pLines = lines.map(profitLine);

    if (header.adjustmentType) {
      for (const line of lines) {
        if (!line.refundedLineId) continue;
        const itemId = allLineToItem.get(line.refundedLineId);
        if (!itemId) continue;
        agg(itemId).refundedCents += grossLineRevenue(profitLine(line));
      }
      continue;
    }
    if (header.direction !== "in") continue;

    const shares = orderDiscountShares(header.orderDiscountCents, pLines);
    lines.forEach((line, i) => {
      if (!line.revenueItemId) return;
      const a = agg(line.revenueItemId);
      const net = netLineRevenue(pLines[i], shares[i]);
      a.unitsSold += Number(line.qty);
      a.lineCount += 1;
      if (Number(line.qty) !== 1) a.linesWithNonUnitQty += 1;
      a.netRevenueCents += net;
      a.contributionProfitCents += net - lineCostTotal(pLines[i]);
      a.grossItemRevenueCents += grossLineRevenue(pLines[i]);
      a.txnIds.add(header.id);
    });
  }

  return byItem;
}

/**
 * Per-item figures, plus a note when the item's pricing model and the way it is
 * actually sold disagree. The note is DESCRIPTIVE — nothing is corrected on the
 * owner's behalf, because the app cannot know whether the model is wrong or the
 * entries are.
 */
function statsFromAgg(a: ItemAgg | undefined, item?: { pricingModel: string; unitLabel: string }) {
  const agg = a ?? emptyAgg();
  return {
    unitsSold: agg.unitsSold,
    netRevenueCents: agg.netRevenueCents,
    contributionProfitCents: agg.contributionProfitCents,
    marginPct: agg.netRevenueCents > 0 ? (agg.contributionProfitCents / agg.netRevenueCents) * 100 : null,
    refundedCents: agg.refundedCents,
    refundRatePct: agg.grossItemRevenueCents > 0 ? (agg.refundedCents / agg.grossItemRevenueCents) * 100 : 0,
    transactionCount: agg.txnIds.size,
    unitMismatch: item
      ? detectUnitMismatch({
          pricingModel: item.pricingModel,
          unitLabel: item.unitLabel,
          lineCount: agg.lineCount,
          linesWithNonUnitQty: agg.linesWithNonUnitQty,
        })
      : null,
  };
}

function mapComponent(
  c: typeof costComponentsTable.$inferSelect,
  sourceName: string | null,
) {
  return {
    id: c.id,
    name: c.name,
    calcType: c.calcType as "fixed_per_unit" | "percent_of_price" | "percent_of_subtotal",
    valueCents: c.valueCents ?? null,
    valueRate: c.valueRate ?? null,
    isFee: c.isFee ?? null,
    sourceId: c.sourceId ?? null,
    sourceName,
    effectiveFrom: c.effectiveFrom.toISOString(),
    effectiveTo: c.effectiveTo ? c.effectiveTo.toISOString() : null,
  };
}

export interface RevenueItemView {
  id: string;
  parentId: string | null;
  hasVariants: boolean;
  name: string;
  type: "product" | "service" | "subscription" | "rental" | "commission" | "royalty" | "other";
  categoryId: string | null;
  categoryName: string | null;
  pricingModel: "fixed" | "per_unit" | "hourly" | "variable" | "tiered";
  unitPriceCents: number | null;
  directCostCents: number | null;
  defaultBillingCycle: "daily" | "weekly" | "monthly" | "quarterly" | "yearly" | null;
  tiers: Array<{ upToQty: string | null; unitPriceCents: number }> | null;
  currency: string;
  unitLabel: string;
  status: "active" | "archived";
  notes: string | null;
  sources: Array<{ sourceId: string; sourceName: string; externalId: string | null; priceOverrideCents: number | null }>;
  openComponents: ReturnType<typeof mapComponent>[];
  createdAt: string;
  updatedAt: string;
}

/** The open "Direct cost" component surfaced as the form's one friendly number. */
function directCostOf(openComponents: ReturnType<typeof mapComponent>[]): number | null {
  const direct = openComponents.find(
    (c) => c.name === DIRECT_COST_COMPONENT_NAME && c.calcType === "fixed_per_unit" && c.sourceId === null,
  );
  return direct?.valueCents ?? null;
}

export async function revenueItemView(
  item: RevenueItem,
  maps: NameMaps,
  links: Array<{ sourceId: string; externalId: string | null; priceOverrideCents: number | null }>,
  openComponents: ReturnType<typeof mapComponent>[],
  hasVariants: boolean,
): Promise<RevenueItemView> {
  return {
    id: item.id,
    parentId: item.parentId ?? null,
    hasVariants,
    name: item.name,
    type: item.type as RevenueItemView["type"],
    categoryId: item.categoryId ?? null,
    categoryName: item.categoryId ? maps.categories.get(item.categoryId)?.name ?? null : null,
    pricingModel: item.pricingModel as RevenueItemView["pricingModel"],
    unitPriceCents: item.unitPriceCents ?? null,
    directCostCents: directCostOf(openComponents),
    defaultBillingCycle: (item.defaultBillingCycle as RevenueItemView["defaultBillingCycle"]) ?? null,
    tiers: item.tiersJson ?? null,
    currency: item.currency,
    unitLabel: item.unitLabel,
    status: item.status as RevenueItemView["status"],
    notes: item.notes ?? null,
    sources: links.map((l) => ({ ...l, sourceName: maps.sources.get(l.sourceId)?.name ?? "?" })),
    openComponents,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
  };
}

export async function listRevenueItemsWithStats(
  businessId: string,
  userId: string,
  range: PeriodRange,
  status?: "active" | "archived",
) {
  const maps = await loadNameMaps(businessId, userId);
  let items = [...maps.revenueItems.values()];
  if (status) items = items.filter((i) => i.status === status);
  items.sort((a, b) => a.name.localeCompare(b.name));

  const [aggs, links, components, sources] = await Promise.all([
    computeItemAggregates(businessId, range),
    db.select().from(revenueItemSourcesTable).where(inArray(revenueItemSourcesTable.revenueItemId, items.map((i) => i.id).length ? items.map((i) => i.id) : ["_none_"])),
    db.select().from(costComponentsTable).where(inArray(costComponentsTable.revenueItemId, items.map((i) => i.id).length ? items.map((i) => i.id) : ["_none_"])),
    db.select().from(sourcesTable).where(eq(sourcesTable.businessId, businessId)),
  ]);
  const sourceNames = new Map(sources.map((s) => [s.id, s.name]));
  const linksByItem = new Map<string, typeof links>();
  for (const l of links) {
    const list = linksByItem.get(l.revenueItemId) ?? [];
    list.push(l);
    linksByItem.set(l.revenueItemId, list);
  }
  const openByItem = new Map<string, ReturnType<typeof mapComponent>[]>();
  for (const c of components) {
    if (c.effectiveTo !== null) continue;
    const list = openByItem.get(c.revenueItemId) ?? [];
    list.push(mapComponent(c, c.sourceId ? sourceNames.get(c.sourceId) ?? null : null));
    openByItem.set(c.revenueItemId, list);
  }

  const parentIds = new Set([...maps.revenueItems.values()].flatMap((i) => (i.parentId ? [i.parentId] : [])));

  const out = [];
  let totalNetRevenueCents = 0;
  for (const item of items) {
    const view = await revenueItemView(
      item,
      maps,
      (linksByItem.get(item.id) ?? []).map((l) => ({ sourceId: l.sourceId, externalId: l.externalId ?? null, priceOverrideCents: l.priceOverrideCents ?? null })),
      openByItem.get(item.id) ?? [],
      parentIds.has(item.id),
    );
    const stats = statsFromAgg(aggs.get(item.id), item);
    totalNetRevenueCents += stats.netRevenueCents;
    out.push({ ...view, stats });
  }
  return { items: out, totalNetRevenueCents };
}

export async function getRevenueItemDetail(businessId: string, userId: string, id: string, range: PeriodRange) {
  const maps = await loadNameMaps(businessId, userId);
  const item = maps.revenueItems.get(id);
  if (!item) return null;

  const [links, components, sources, aggs, perSource] = await Promise.all([
    db.select().from(revenueItemSourcesTable).where(eq(revenueItemSourcesTable.revenueItemId, id)),
    db.select().from(costComponentsTable).where(eq(costComponentsTable.revenueItemId, id)),
    db.select().from(sourcesTable).where(eq(sourcesTable.businessId, businessId)),
    computeItemAggregates(businessId, range),
    computePerSourceSplit(businessId, id, range),
  ]);
  const sourceNames = new Map(sources.map((s) => [s.id, s.name]));

  const openComponents = components
    .filter((c) => c.effectiveTo === null)
    .map((c) => mapComponent(c, c.sourceId ? sourceNames.get(c.sourceId) ?? null : null));
  const componentHistory = components
    .sort((a, b) => a.effectiveFrom.getTime() - b.effectiveFrom.getTime())
    .map((c) => mapComponent(c, c.sourceId ? sourceNames.get(c.sourceId) ?? null : null));

  const hasVariants = [...maps.revenueItems.values()].some((i) => i.parentId === id);
  const view = await revenueItemView(
    item,
    maps,
    links.map((l) => ({ sourceId: l.sourceId, externalId: l.externalId ?? null, priceOverrideCents: l.priceOverrideCents ?? null })),
    openComponents,
    hasVariants,
  );

  return { item: view, stats: statsFromAgg(aggs.get(id), item), componentHistory, perSource };
}

async function computePerSourceSplit(businessId: string, itemId: string, range: PeriodRange) {
  const txns = await loadPeriodTransactions(businessId, range);
  const sources = await db.select().from(sourcesTable).where(eq(sourcesTable.businessId, businessId));
  const sourceNames = new Map(sources.map((s) => [s.id, s.name]));
  const bySource = new Map<string, { unitsSold: number; netRevenueCents: number; contributionProfitCents: number }>();
  for (const { header, lines } of txns) {
    if (!COUNTED_STATUSES.has(header.status) || header.adjustmentType || header.direction !== "in") continue;
    const pLines = lines.map(profitLine);
    const shares = orderDiscountShares(header.orderDiscountCents, pLines);
    lines.forEach((line, i) => {
      if (line.revenueItemId !== itemId) return;
      const bucket = bySource.get(header.sourceId) ?? { unitsSold: 0, netRevenueCents: 0, contributionProfitCents: 0 };
      const net = netLineRevenue(pLines[i], shares[i]);
      bucket.unitsSold += Number(line.qty);
      bucket.netRevenueCents += net;
      bucket.contributionProfitCents += net - lineCostTotal(pLines[i]);
      bySource.set(header.sourceId, bucket);
    });
  }
  return [...bySource.entries()].map(([sourceId, v]) => ({ sourceId, sourceName: sourceNames.get(sourceId) ?? "?", ...v }));
}

// ---------------------------------------------------------------------------
// Expense-item stats
// ---------------------------------------------------------------------------

/**
 * Money out per line of one transaction, and whether it was spent inside a job.
 * Mirrors the ladder's two cases (lib/domain/profit.ts):
 *
 *  - Standalone expense transaction → every line is spend, and the order
 *    discount reduces it (split proportionally so the parts sum exactly).
 *  - Expense lines inside a sale → the cost of THAT job. The order discount
 *    belongs to the revenue side there, so it never reduces these.
 *
 * Revenue lines yield nothing. Both the Expenses list and the item drawer read
 * through this, so they can no longer disagree about the same rows — the old
 * code skipped mixed transactions entirely and reported real spend as zero.
 */
function expenseSpendOf(
  header: Transaction,
  lines: TransactionLine[],
): Array<{ line: TransactionLine; spentCents: number; insideJob: boolean }> {
  const pLines = lines.map(profitLine);
  const dirOf = (i: number) => pLines[i].direction ?? (header.direction as "in" | "out");
  const hasRevenue = pLines.some((_, i) => dirOf(i) === "in");

  if (!hasRevenue) {
    const spends = expenseLineSpends(pLines, header.orderDiscountCents);
    return lines.map((line, i) => ({ line, spentCents: spends[i], insideJob: false }));
  }

  const out: Array<{ line: TransactionLine; spentCents: number; insideJob: boolean }> = [];
  lines.forEach((line, i) => {
    if (dirOf(i) !== "out") return;
    out.push({ line, spentCents: lineSubtotal(pLines[i]), insideJob: true });
  });
  return out;
}

export async function listExpenseItemsWithStats(
  businessId: string,
  userId: string,
  range: PeriodRange,
  status?: "active" | "archived",
) {
  const maps = await loadNameMaps(businessId, userId);
  let items = [...maps.expenseItems.values()];
  if (status) items = items.filter((i) => i.status === status);
  items.sort((a, b) => a.name.localeCompare(b.name));

  const txns = await loadPeriodTransactions(businessId, range);
  const spentByItem = new Map<string, { cents: number; jobCostCents: number; txns: Set<string> }>();
  let totalExpensesCents = 0;
  for (const { header, lines } of txns) {
    if (!COUNTED_STATUSES.has(header.status) || header.adjustmentType) continue;
    for (const { line, spentCents, insideJob } of expenseSpendOf(header, lines)) {
      totalExpensesCents += spentCents;
      if (!line.expenseItemId) continue;
      const bucket = spentByItem.get(line.expenseItemId) ?? { cents: 0, jobCostCents: 0, txns: new Set<string>() };
      bucket.cents += spentCents;
      if (insideJob) bucket.jobCostCents += spentCents;
      bucket.txns.add(header.id);
      spentByItem.set(line.expenseItemId, bucket);
    }
  }

  const out = items.map((item) => {
    const b = spentByItem.get(item.id);
    return {
      id: item.id,
      name: item.name,
      type: item.type as
        | "fixed"
        | "variable"
        | "marketing"
        | "operational"
        | "maintenance"
        | "payroll"
        | "cogs"
        | "custom",
      costNature: item.costNature as "fixed" | "variable" | "semi_variable",
      categoryId: item.categoryId ?? null,
      categoryName: item.categoryId ? maps.categories.get(item.categoryId)?.name ?? null : null,
      vendorName: item.vendorPersonId ? maps.people.get(item.vendorPersonId) ?? null : null,
      defaultAmountCents: item.defaultAmountCents ?? null,
      unitLabel: item.unitLabel ?? null,
      currency: item.currency,
      behavior: item.behavior as "one_time" | "recurring" | "usage_based",
      status: item.status as "active" | "archived",
      notes: item.notes ?? null,
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString(),
      stats: {
        spentCents: b?.cents ?? 0,
        /** The part of spentCents consumed inside sales — a cost of those jobs, not a period expense. */
        jobCostCents: b?.jobCostCents ?? 0,
        shareOfExpensesPct: totalExpensesCents > 0 ? ((b?.cents ?? 0) / totalExpensesCents) * 100 : 0,
        transactionCount: b?.txns.size ?? 0,
      },
    };
  });
  return { items: out, totalExpensesCents };
}

export async function getExpenseItemDetail(businessId: string, userId: string, id: string, range: PeriodRange) {
  const maps = await loadNameMaps(businessId, userId);
  const item = maps.expenseItems.get(id);
  if (!item) return null;

  const txns = await loadPeriodTransactions(businessId, range);
  const sources = await db.select().from(sourcesTable).where(eq(sourcesTable.businessId, businessId));
  const sourceNames = new Map(sources.map((s) => [s.id, s.name]));

  let spentCents = 0;
  let jobCostCents = 0;
  let totalExpensesCents = 0;
  const txnIds = new Set<string>();
  const bySource = new Map<string, { spentCents: number; txns: Set<string> }>();
  const recent: { id: string; occurredAt: string; sourceName: string; amountCents: number; status: string }[] = [];

  for (const { header, lines } of txns) {
    if (!COUNTED_STATUSES.has(header.status) || header.adjustmentType) continue;

    let spentHere = 0;
    let jobCostHere = 0;
    for (const { line, spentCents: lineSpend, insideJob } of expenseSpendOf(header, lines)) {
      totalExpensesCents += lineSpend;
      if (line.expenseItemId !== id) continue;
      spentHere += lineSpend;
      if (insideJob) jobCostHere += lineSpend;
    }
    if (spentHere <= 0) continue;

    spentCents += spentHere;
    jobCostCents += jobCostHere;
    txnIds.add(header.id);
    const bucket = bySource.get(header.sourceId) ?? { spentCents: 0, txns: new Set<string>() };
    bucket.spentCents += spentHere;
    bucket.txns.add(header.id);
    bySource.set(header.sourceId, bucket);
    recent.push({
      id: header.id,
      occurredAt: header.occurredAt.toISOString(),
      sourceName: sourceNames.get(header.sourceId) ?? "?",
      amountCents: spentHere,
      status: header.status,
    });
  }
  recent.sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime());

  return {
    item: {
      id: item.id,
      name: item.name,
      type: item.type as
        | "fixed"
        | "variable"
        | "marketing"
        | "operational"
        | "maintenance"
        | "payroll"
        | "cogs"
        | "custom",
      costNature: item.costNature as "fixed" | "variable" | "semi_variable",
      categoryId: item.categoryId ?? null,
      categoryName: item.categoryId ? maps.categories.get(item.categoryId)?.name ?? null : null,
      vendorName: item.vendorPersonId ? maps.people.get(item.vendorPersonId) ?? null : null,
      defaultAmountCents: item.defaultAmountCents ?? null,
      unitLabel: item.unitLabel ?? null,
      currency: item.currency,
      behavior: item.behavior as "one_time" | "recurring" | "usage_based",
      status: item.status as "active" | "archived",
      notes: item.notes ?? null,
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString(),
    },
    stats: {
      spentCents,
      /** The part of spentCents consumed inside sales — a cost of those jobs, not a period expense. */
      jobCostCents,
      shareOfExpensesPct: totalExpensesCents > 0 ? (spentCents / totalExpensesCents) * 100 : 0,
      transactionCount: txnIds.size,
    },
    perSource: [...bySource.entries()].map(([sourceId, v]) => ({
      sourceId,
      sourceName: sourceNames.get(sourceId) ?? "?",
      spentCents: v.spentCents,
      transactionCount: v.txns.size,
    })),
    recentTransactions: recent.slice(0, 10),
  };
}

// ---------------------------------------------------------------------------
// P&L ladder + breakdowns
// ---------------------------------------------------------------------------

export async function computePnl(
  businessId: string,
  userId: string,
  range: PeriodRange,
  basis: AccountingBasis = "accrual",
) {
  const maps = await loadNameMaps(businessId, userId);
  const txns = await loadPeriodTransactions(businessId, range, basis);

  const profitTxns = txns.map(({ header, lines }) => profitTransaction(header, lines));
  // The basis decides whether a spread cost defers to its slices (accrual) or
  // lands whole on the day it was paid (cash). See defersToSlices in profit.ts.
  const ladder = computeProfitLadder(profitTxns, basis);

  // Revenue groupings (gross revenue by type/category/source).
  const typeGroups = new Map<string, { label: string; amountCents: number; count: number }>();
  const categoryGroups = new Map<string, { label: string; amountCents: number; count: number }>();
  const sourceGroups = new Map<string, { label: string; amountCents: number; count: number }>();
  const costTotals = new Map<string, { kind: "fee" | "cost"; totalCents: number }>();
  const expenseGroups = new Map<string, { label: string; amountCents: number; count: number }>();

  const add = (m: Map<string, { label: string; amountCents: number; count: number }>, key: string, label: string, cents: number) => {
    const b = m.get(key) ?? { label, amountCents: 0, count: 0 };
    b.amountCents += cents;
    b.count += 1;
    m.set(key, b);
  };

  let counted = 0;
  for (const { header, lines } of txns) {
    if (!COUNTED_STATUSES.has(header.status)) continue;
    counted += 1;

    if (header.adjustmentType) {
      /*
       * A refund is not grouped as revenue — it has its own rung, and the ladder
       * owns it.
       *
       * But a NON-refund line on an adjustment is the chargeback fee, and
       * `computeProfitLadder` counts that as a period expense. Skipping the
       * whole header here left the "what the period cost" block short by exactly
       * that fee while the Period expenses rung above it included it — a
       * breakdown by TYPE that did not add up to the total it broke down, on the
       * P&L and in both exported reports. The rule is the ladder's; this reads
       * it the same way rather than keeping a second opinion.
       */
      for (const line of lines) {
        if (line.refundedLineId) continue;
        const spend = grossLineRevenue(profitLine(line)) - line.lineDiscountCents;
        const ei = line.expenseItemId ? maps.expenseItems.get(line.expenseItemId) : null;
        const typeKey = ei?.type ?? "custom";
        add(expenseGroups, typeKey, titleCase(typeKey), spend);
      }
      continue;
    }

    if (header.direction === "in") {
      const sourceName = maps.sources.get(header.sourceId)?.name ?? "Manual";
      // Deposits taken are cash in and not revenue yet, exactly as the ladder
      // treats them — see revenueLineGross.
      const revGross = revenueLineGross(lines.map(profitLine), basis);
      for (const [lineIndex, line] of lines.entries()) {
        // Mixed sale: an expense line is a direct "cost of that job" — itemize
        // it under the contribution cost breakdown, never as revenue.
        if ((line.direction as "in" | "out") === "out") {
          const name = lineItemName(line, maps) ?? line.label ?? "Cost";
          const b = costTotals.get(`cost:${name}`) ?? { kind: "cost" as const, totalCents: 0 };
          b.totalCents += lineSubtotal(profitLine(line));
          costTotals.set(`cost:${name}`, b);
          continue;
        }
        const gross = revGross[lineIndex];
        const item = line.revenueItemId ? maps.revenueItems.get(line.revenueItemId) : null;
        const typeKey = item?.type ?? "other";
        add(typeGroups, typeKey, titleCase(typeKey), gross);
        const cid = lineCategoryId(line, maps);
        add(categoryGroups, cid ?? "uncategorized", cid ? maps.categories.get(cid)?.name ?? "Uncategorized" : "Uncategorized", gross);
        add(sourceGroups, header.sourceId, sourceName, gross);
        // Snapshot cost components.
        const snap = snapshotOf(line);
        if (snap) {
          for (const comp of snap.components) {
            const key = `${comp.kind}:${comp.name}`;
            const b = costTotals.get(key) ?? { kind: comp.kind, totalCents: 0 };
            b.totalCents += Math.round(comp.per_unit_cents * Number(line.qty));
            costTotals.set(key, b);
          }
        }
      }
      // Shipping counts toward gross revenue (source bucket).
      if (header.shippingChargedCents > 0) {
        add(sourceGroups, header.sourceId, sourceName, header.shippingChargedCents);
        add(typeGroups, "shipping", "Shipping", header.shippingChargedCents);
        add(categoryGroups, "uncategorized", "Uncategorized", header.shippingChargedCents);
      }
    } else {
      // Attribute EACH line to its own expense type; the order discount is split
      // proportionally so these groups still sum exactly to the ladder's
      // period expenses.
      const spends = expenseLineSpends(lines.map(profitLine), header.orderDiscountCents, basis);
      lines.forEach((line, i) => {
        const ei = line.expenseItemId ? maps.expenseItems.get(line.expenseItemId) : null;
        const typeKey = ei?.type ?? "custom";
        add(expenseGroups, typeKey, titleCase(typeKey), spends[i]);
      });
    }
  }

  const groupRows = (m: Map<string, { label: string; amountCents: number; count: number }>) =>
    [...m.entries()].map(([key, v]) => ({ key, label: v.label, amountCents: v.amountCents, count: v.count })).sort((a, b) => b.amountCents - a.amountCents);

  return {
    ladder,
    revenueGroups: {
      type: groupRows(typeGroups),
      category: groupRows(categoryGroups),
      source: groupRows(sourceGroups),
    },
    costComponents: [...costTotals.entries()]
      .map(([key, v]) => ({ name: key.split(":").slice(1).join(":"), kind: v.kind, totalCents: v.totalCents }))
      .sort((a, b) => b.totalCents - a.totalCents),
    expenseGroups: groupRows(expenseGroups),
    transactionCount: counted,
  };
}

function titleCase(s: string): string {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// ---------------------------------------------------------------------------
// Break-even
// ---------------------------------------------------------------------------

/**
 * Splits the period's expenses by cost nature and asks lib/domain how much must
 * sell to cover the fixed half.
 *
 * The split walks transactions with the SAME rules as computeProfitLadder, so
 * `fixed + variable` equals the ladder's periodExpenses to the cent — asserted
 * below, because a break-even built on a different total would quietly disagree
 * with the P&L on the same screen. In particular it counts adjustment fee lines
 * (a chargeback fee), which the P&L's expense-type breakdown skips.
 */
export async function computeBreakEvenReport(
  businessId: string,
  userId: string,
  range: PeriodRange,
  targetProfitCents?: number,
) {
  const maps = await loadNameMaps(businessId, userId);
  const txns = await loadPeriodTransactions(businessId, range);

  const profitTxns = txns.map(({ header, lines }) => profitTransaction(header, lines));
  const ladder = computeProfitLadder(profitTxns);

  let fixedExpensesCents = 0;
  let variableExpensesCents = 0;
  let unclassifiedExpensesCents = 0;
  let revenueTransactionCount = 0;
  let unitsSold = new Decimal(0);
  const unitLabelsSold = new Set<string>();
  const fixedByItem = new Map<string, { name: string; amountCents: number; costNature: "fixed" | "semi_variable" }>();

  /** Semi-variable has no split yet, so it sits with fixed — see costNature. */
  const bucketFor = (line: TransactionLine): "fixed" | "variable" => {
    const item = line.expenseItemId ? maps.expenseItems.get(line.expenseItemId) : null;
    if (!item) return UNCLASSIFIED_NATURE === "fixed" ? "fixed" : "variable";
    return item.costNature === "variable" ? "variable" : "fixed";
  };

  const bookExpense = (line: TransactionLine, cents: number) => {
    const item = line.expenseItemId ? maps.expenseItems.get(line.expenseItemId) : null;
    if (!item) unclassifiedExpensesCents += cents;
    if (bucketFor(line) === "variable") {
      variableExpensesCents += cents;
      return;
    }
    fixedExpensesCents += cents;
    if (!item) return;
    const nature = item.costNature === "semi_variable" ? "semi_variable" : "fixed";
    const bucket = fixedByItem.get(item.id) ?? { name: item.name, amountCents: 0, costNature: nature };
    bucket.amountCents += cents;
    fixedByItem.set(item.id, bucket);
  };

  for (const { header, lines } of txns) {
    if (!COUNTED_STATUSES.has(header.status)) continue;
    const pLines = lines.map(profitLine);

    if (header.adjustmentType) {
      // A line that reverses no sale — a chargeback fee — is money out with
      // nothing behind it, so it lands in the same place the ladder puts it.
      lines.forEach((line, i) => {
        if (line.refundedLineId) return;
        bookExpense(line, grossLineRevenue(pLines[i]) - pLines[i].lineDiscountCents);
      });
      continue;
    }

    const dirOf = (i: number) => pLines[i].direction ?? (header.direction as "in" | "out");
    const hasRevenue = pLines.some((_, i) => dirOf(i) === "in");

    if (hasRevenue) {
      // Expense lines here are the cost of THAT job and already sit inside
      // contribution profit; re-counting them as period expenses would
      // subtract them twice.
      revenueTransactionCount += 1;
      lines.forEach((line, i) => {
        if (dirOf(i) !== "in") return;
        unitsSold = unitsSold.plus(new Decimal(line.qty));
        // Which units the period was sold in. More than one and a single count
        // is unreadable — mugs plus hours plus months is a number of nothing.
        if (line.unitLabel) unitLabelsSold.add(line.unitLabel);
      });
      continue;
    }

    const spends = expenseLineSpends(pLines, header.orderDiscountCents);
    // Reclaimable input tax is not a cost, and the ladder has already taken it
    // off this transaction's period expenses. Spread the same relief across the
    // lines it came from so the fixed/variable buckets still add up to the
    // ladder — allocateProportionally sums to the total exactly, so no cent of
    // the relief is lost or invented.
    const relief = reclaimableTaxOf(profitTransaction(header, lines));
    const reliefShares = relief > 0 ? allocateProportionally(relief, spends.map((s) => Math.max(0, s))) : null;
    lines.forEach((line, i) => bookExpense(line, spends[i] - (reliefShares?.[i] ?? 0)));
  }

  const split = fixedExpensesCents + variableExpensesCents;
  if (split !== ladder.periodExpenses) {
    // Loud on purpose: silently shipping a break-even that disagrees with the
    // P&L is the exact class of bug this phase exists to remove.
    throw new Error(
      `break-even expense split ${split} does not reconcile with ladder period expenses ${ladder.periodExpenses}`,
    );
  }

  const input = {
    netRevenueCents: ladder.netRevenue,
    contributionProfitCents: ladder.contributionProfit,
    fixedExpensesCents,
    variableExpensesCents,
  };
  const result = computeBreakEven(input, {
    revenueTransactionCount,
    unitsSold: unitsSold.toString(),
    // One unit across the whole period, or none at all — the revenue target is
    // always there to fall back on and it needs no unit to be read.
    unitLabel: unitLabelsSold.size === 1 ? [...unitLabelsSold][0] : null,
  });

  return {
    ...result,
    unclassifiedExpensesCents,
    revenueForTargetProfitCents:
      targetProfitCents === undefined ? null : revenueForTargetProfit(input, targetProfitCents),
    netRevenueCents: ladder.netRevenue,
    contributionProfitCents: ladder.contributionProfit,
    periodExpensesCents: ladder.periodExpenses,
    trueProfitCents: ladder.trueProfit,
    fixedCostBreakdown: [...fixedByItem.entries()]
      .map(([id, v]) => ({ id, name: v.name, amountCents: v.amountCents, costNature: v.costNature }))
      .sort((a, b) => b.amountCents - a.amountCents),
  };
}

// ---------------------------------------------------------------------------
// Quick-Add live preview — resolves the SAME way create does, no persistence.
// ---------------------------------------------------------------------------

export async function buildPreview(businessId: string, input: CreateTransactionInput) {
  const { resolvedLines, orderDiscountCents, shippingChargedCents } = await resolveTransactionLines(businessId, input);

  const pLines: ProfitLine[] = resolvedLines.map((l) => ({
    direction: l.direction,
    qty: l.qty,
    unitPriceCents: l.unitPriceCents,
    lineDiscountCents: l.lineDiscountCents,
    costSnapshot: l.costSnapshot,
  }));
  // The order discount rides only the revenue side. Keep index alignment so a
  // revenue line can look up its own share.
  const revIndexes = pLines.map((l, i) => (l.direction === "in" ? i : -1)).filter((i) => i >= 0);
  const revLines = revIndexes.map((i) => pLines[i]);
  const revShares = orderDiscountShares(orderDiscountCents, revLines);
  const shareByIndex = new Map<number, number>();
  revIndexes.forEach((idx, k) => shareByIndex.set(idx, revShares[k]));

  const lines = resolvedLines.map((l, i) => {
    const p = pLines[i];
    if (p.direction === "in") {
      const net = netLineRevenue(p, shareByIndex.get(i) ?? 0);
      return {
        name: l.itemName ?? l.label ?? "Item",
        qty: l.qty,
        unitPriceCents: l.unitPriceCents,
        lineDiscountCents: l.lineDiscountCents,
        costSnapshot: l.costSnapshot,
        netRevenueCents: net,
        contributionProfitCents: net - lineCostTotal(p),
      };
    }
    // Expense/cost line — a direct cost of the job (reduces contribution).
    const sub = lineSubtotal(p);
    return {
      name: l.itemName ?? l.label ?? "Cost",
      qty: l.qty,
      unitPriceCents: l.unitPriceCents,
      lineDiscountCents: l.lineDiscountCents,
      costSnapshot: l.costSnapshot,
      netRevenueCents: 0,
      contributionProfitCents: -sub,
    };
  });

  const gross = revLines.reduce((sum, l) => sum + grossLineRevenue(l), 0);
  const lineDiscounts = revLines.reduce((sum, l) => sum + l.lineDiscountCents, 0);
  const netRevenueCents = revLines.reduce((sum, l, k) => sum + netLineRevenue(l, revShares[k]), 0);

  const costMap = new Map<string, { kind: "fee" | "cost"; totalCents: number }>();
  resolvedLines.forEach((l, i) => {
    if (pLines[i].direction === "out") {
      // Job-cost line → itemize under the contribution cost breakdown.
      const name = l.itemName ?? l.label ?? "Cost";
      const b = costMap.get(`cost:${name}`) ?? { kind: "cost" as const, totalCents: 0 };
      b.totalCents += lineSubtotal(pLines[i]);
      costMap.set(`cost:${name}`, b);
      return;
    }
    if (!l.costSnapshot) return;
    for (const comp of l.costSnapshot.components) {
      const key = `${comp.kind}:${comp.name}`;
      const b = costMap.get(key) ?? { kind: comp.kind, totalCents: 0 };
      b.totalCents += Math.round(comp.per_unit_cents * Number(l.qty));
      costMap.set(key, b);
    }
  });
  const costBreakdown = [...costMap.entries()].map(([key, v]) => ({ name: key.split(":").slice(1).join(":"), kind: v.kind, totalCents: v.totalCents }));
  const totalCostCents = costBreakdown.reduce((sum, c) => sum + c.totalCents, 0);

  const hasRevenue = revLines.length > 0;
  return {
    lines,
    grossCents: gross,
    discountCents: lineDiscounts + orderDiscountCents,
    shippingCents: shippingChargedCents,
    netRevenueCents,
    costBreakdown,
    totalCostCents,
    contributionProfitCents: hasRevenue ? netRevenueCents + shippingChargedCents - totalCostCents : 0,
    // The same figure the ledger will list once saved, so the form can say what
    // an entry typed in another currency comes to in the business's own.
    amountCents: entryAmountCents({
      direction: hasRevenue ? "in" : "out",
      orderDiscountCents,
      shippingChargedCents,
      lines: pLines,
    }),
  };
}
