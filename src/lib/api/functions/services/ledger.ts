import {
  businessesTable,
  costComponentsTable,
  db,
  expenseItemsTable,
  peopleTable,
  revenueItemSourcesTable,
  revenueItemsTable,
  sourcesTable,
  transactionLinesTable,
  transactionsTable,
  type TransactionDirection,
  type TransactionOrigin,
  type TransactionStatus,
} from "@workspace/db";
import {
  Decimal,
  buildCostSnapshot,
  buildRefund,
  buildSpread,
  buildSplit,
  isCapitalised,
  wasteReconciles,
  mulCentsQty,
  netLineRevenue,
  orderDiscountShares,
  spreadReconciles,
  splitReconciles,
  MAX_SPREAD_MONTHS,
  MIN_SPREAD_MONTHS,
  IDENTITY_FX_RATE,
  isIdentityRate,
  isValidFxRate,
  type AdjustmentType,
  type CostComponentInput,
  type CostSnapshot,
  type PriorRefundLine,
  type RefundRequestLine,
  type SplitPart,
  type SplitTargetType,
} from "@workspace/domain";
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { uid } from "../lib/uid";
import { invalid, notFound } from "./errors";
import { assertOwnedRefs } from "./ownership";
import { listTimeTargets } from "./timesheet";

/**
 * The ONLY write paths into the ledger. Engines, routes, seeds, and future
 * integrations all post through these functions (CLAUDE.md: engines write
 * only through the same domain services the UI uses).
 */

export interface CreateTransactionLineInput {
  /**
   * Per-line direction ("in" = revenue, "out" = expense/cost). Optional: a
   * revenue-item line is always "in", an expense-item line always "out", and a
   * label-only line falls back to this then the header direction. Lets one
   * transaction mix both sides ("a job you're paid for AND buy materials for").
   */
  direction?: TransactionDirection;
  revenueItemId?: string | null;
  expenseItemId?: string | null;
  label?: string | null;
  categoryId?: string | null;
  /** Decimal string, default "1". */
  qty?: string;
  /** Cents. Optional for catalog lines (falls back to source override, then item price). */
  unitPriceCents?: number;
  lineDiscountCents?: number;
  /**
   * Spread this cost over N months rather than landing it whole.
   *
   * Only meaningful on a standalone expense line. The purchase keeps its real
   * amount and dates; this line becomes capitalised and N slice transactions
   * are generated to carry the cost across the months it covers. See
   * `lib/domain/spread.ts`.
   */
  spreadMonths?: number | null;
  /**
   * Money that moved BEFORE the work did — an advance to a subcontractor, a
   * deposit taken from a customer. Real cash, not yet earned or consumed.
   * See `lib/domain/advances.ts`.
   */
  isAdvance?: boolean | null;
  /**
   * How much of what was bought never made it into the work.
   *
   * INFORMATION, NEVER MONEY — see `lib/domain/waste.ts`. Nothing derived from
   * it is added to any total.
   */
  wastedQty?: string | null;
  /**
   * Who this cost was FOR — a client, a revenue item, or an internal category.
   * Costs only. This is what makes "what did Acme actually cost me?" answerable;
   * an untargeted bill is still in True profit, it just belongs to nobody.
   */
  targetType?: SplitTargetType | null;
  targetId?: string | null;
  /**
   * One bill, several things it was really for. The server expands this ONE
   * input line into N lines with exact amounts that sum back to the bill —
   * a split is lines, not a second money path. See `lib/domain/split.ts`.
   */
  split?: SplitPart[] | null;
}

export interface CreateTransactionInput {
  direction: TransactionDirection;
  /** When the money event HAPPENED — the accrual date. */
  occurredAt: Date;
  /**
   * When the cash moved. Omit and it follows `occurredAt` (paid on the day, the
   * ordinary case); pass null for a bill or invoice that is not paid yet.
   */
  paidAt?: Date | null;
  /** Agreed payment date, as a plain "YYYY-MM-DD". Null = nothing agreed. */
  dueDate?: string | null;
  sourceId: string;
  personId?: string | null;
  status?: TransactionStatus;
  currency?: string;
  /** Decimal string rate to base currency, FROZEN here. Defaults to "1". */
  fxRateToBase?: string;
  /**
   * What the owner typed, when the entry was typed in another currency and has
   * ALREADY been converted into base (`convertEntryToBase`). Remembered for
   * display only — every amount on this input is base.
   */
  entered?: { currency: string; fxRate: string; amountCents: number } | null;
  /** Input tax included in these amounts. */
  taxPaidCents?: number;
  /** True when that input tax is claimable back, so it is not a cost. */
  taxReclaimable?: boolean;
  origin?: TransactionOrigin;
  externalRef?: string | null;
  /** Owner-facing invoice/receipt number — non-unique by design. */
  referenceNumber?: string | null;
  orderDiscountCents?: number;
  discountCode?: string | null;
  shippingChargedCents?: number;
  taxCollectedCents?: number;
  notes?: string | null;
  lines: CreateTransactionLineInput[];
}

function assertCentsField(value: number, field: string) {
  if (!Number.isSafeInteger(value) || value < 0) throw invalid(`${field} must be non-negative integer cents`);
}

function parseQty(qty: string): string {
  if (!/^\d+(\.\d+)?$/.test(qty) || Number(qty) <= 0) throw invalid(`qty "${qty}" must be a positive decimal string`);
  return qty;
}

export interface ResolvedLine extends CreateTransactionLineInput {
  qty: string;
  lineDiscountCents: number;
  unitPriceCents: number;
  /** Resolved per-line direction: revenue "in" or expense/cost "out". */
  direction: TransactionDirection;
  costSnapshot: CostSnapshot | null;
  /** Resolved catalog display name (null for unlinked label-only lines). */
  itemName: string | null;
  /** What the quantity is counted in, frozen from the item at write time. */
  unitLabel: string | null;
}

export interface ResolvedTransaction {
  source: typeof sourcesTable.$inferSelect;
  orderDiscountCents: number;
  shippingChargedCents: number;
  taxCollectedCents: number;
  resolvedLines: ResolvedLine[];
}

/**
 * Validates a transaction input, resolves each line's price (explicit → source
 * override → catalog price) and freezes its cost snapshot — WITHOUT persisting.
 * Shared verbatim by createTransaction and previewTransaction so the Quick-Add
 * live preview is byte-identical to what actually gets written.
 */
export async function resolveTransactionLines(
  businessId: string,
  input: CreateTransactionInput,
): Promise<ResolvedTransaction> {
  if (input.lines.length === 0) throw invalid("A transaction needs at least one line");

  const [source] = await db
    .select()
    .from(sourcesTable)
    .where(and(eq(sourcesTable.businessId, businessId), eq(sourcesTable.id, input.sourceId)));
  if (!source) throw notFound("Source");

  // The customer and every line's category must be this business's own —
  // checked before anything is written (ownership.ts).
  await assertOwnedRefs(businessId, {
    personIds: [input.personId],
    categoryIds: input.lines.map((line) => line.categoryId),
  });

  const orderDiscountCents = input.orderDiscountCents ?? 0;
  const shippingChargedCents = input.shippingChargedCents ?? 0;
  const taxCollectedCents = input.taxCollectedCents ?? 0;
  assertCentsField(orderDiscountCents, "order_discount_cents");
  assertCentsField(shippingChargedCents, "shipping_charged_cents");
  assertCentsField(taxCollectedCents, "tax_collected_cents");

  // A line's effective direction: a revenue-item line is always "in", an
  // expense-item line always "out", and a label-only line falls back to its own
  // `direction`, then the header. One transaction may mix both.
  const effectiveDirection = (line: CreateTransactionLineInput): TransactionDirection =>
    line.revenueItemId ? "in" : line.expenseItemId ? "out" : line.direction ?? input.direction;

  for (const line of input.lines) {
    if (line.revenueItemId && line.expenseItemId) throw invalid("A line links at most one catalog item");
    const dir = effectiveDirection(line);
    if (dir === "in" && line.expenseItemId) throw invalid("Revenue lines cannot link an expense item");
    if (dir === "out" && line.revenueItemId) throw invalid("Expense lines cannot link a revenue item");
    if (!line.revenueItemId && !line.expenseItemId && !line.label?.trim()) {
      throw invalid("Unlinked lines need a label");
    }

    if (line.spreadMonths !== null && line.spreadMonths !== undefined) {
      // Spreading is about PERIOD expenses. A cost booked against a sale is
      // that job's cost and belongs at contribution level whatever else is
      // true of it — deferring it would move money between two rungs of the
      // ladder, which is a different and much worse change.
      if (dir === "in") throw invalid("Only a cost can be spread over months, not a sale");
      if (input.lines.some((l) => effectiveDirection(l) === "in")) {
        throw invalid("A cost recorded against a sale belongs to that sale, so it cannot be spread");
      }
      // An order-level discount is shared across the whole transaction, so a
      // spread line's real net cost would depend on its neighbours — and the
      // slices would be built from the pre-discount figure while the ladder
      // still took the discount off in the purchase month. Rather than guess a
      // split, refuse: the discount belongs on the line.
      if (input.orderDiscountCents && input.orderDiscountCents > 0) {
        throw invalid("Put the discount on the line itself when you spread a cost over months");
      }
      if (
        !Number.isInteger(line.spreadMonths) ||
        line.spreadMonths < MIN_SPREAD_MONTHS ||
        line.spreadMonths > MAX_SPREAD_MONTHS
      ) {
        throw invalid(
          `Spread it over a whole number of months between ${MIN_SPREAD_MONTHS} and ${MAX_SPREAD_MONTHS}`,
        );
      }
    }

    // ── What the line was for, and splitting one bill between several ───────
    //
    // A target on a COST says who the money was spent for. On REVENUE the only
    // meaningful answer is a PROJECT: "for a client" is already the header's
    // person, and "for a revenue item" is what the line is. But a sale must be
    // able to name its project, or a site could show every cost it ran up and
    // never the money it brought in — which is a worse lie than no figure.
    //
    // A split stays cost-only: dividing one sale across several projects is a
    // statement about revenue attribution nobody has asked for, and the CHECK
    // constraint on the table would refuse the non-project parts anyway.
    const hasTarget = !!(line.targetType && line.targetId);
    const hasSplit = !!(line.split && line.split.length > 0);

    if (hasSplit && dir === "in") {
      throw invalid("A sale cannot be split between targets — record it against one project");
    }
    if (hasTarget && dir === "in" && line.targetType !== "project") {
      throw invalid("A sale can only be recorded against a project");
    }
    if (hasTarget && hasSplit) {
      throw invalid("Either say who this cost was for, or split it — not both on one line");
    }
    if (hasSplit && input.lines.some((l) => effectiveDirection(l) === "in")) {
      throw invalid("A cost recorded against a sale belongs to that sale, so it cannot be split");
    }
    if (line.targetType && !line.targetId) throw invalid("Pick who this cost was for");
    if (line.targetId && !line.targetType) throw invalid("Pick who this cost was for");

    // ── Waste is a slice of THIS line, so it cannot exceed it ───────────────
    if (line.wastedQty !== null && line.wastedQty !== undefined && line.wastedQty.trim() !== "") {
      if (dir === "in") throw invalid("Only something you bought can be wasted");
      if (!wasteReconciles({ name: "", qty: parseQty(line.qty ?? "1"), wastedQty: line.wastedQty, unitPriceCents: 0 })) {
        throw invalid("You cannot waste more than you bought");
      }
    }

    // ── An advance is money ahead of work, so two shapes are contradictions ──
    if (line.isAdvance) {
      // A cost recorded INSIDE a sale is that job's cost and has already been
      // incurred; calling it an advance would defer a cost the job already ate.
      if (dir === "out" && input.lines.some((l) => effectiveDirection(l) === "in")) {
        throw invalid("A cost recorded against a sale has already happened, so it cannot be an advance");
      }
      // Both defer under accrual, and they defer to different places. Marking
      // one line as both is a statement nobody can act on later.
      if (line.spreadMonths) {
        throw invalid("Money paid ahead cannot also be spread over months — settle it first");
      }
    }
  }

  // Targets are checked against the SAME list hours use, so a cost and an hour
  // booked to "Acme" can never mean two different Acmes. Gathered first and
  // checked once — a five-way split would otherwise reload the target list
  // five times.
  const targetsUsed = new Map<string, { targetType: SplitTargetType; targetId: string }>();
  for (const line of input.lines) {
    if (line.targetType && line.targetId) {
      targetsUsed.set(`${line.targetType}:${line.targetId}`, {
        targetType: line.targetType,
        targetId: line.targetId,
      });
    }
    for (const part of line.split ?? []) {
      targetsUsed.set(`${part.targetType}:${part.targetId}`, {
        targetType: part.targetType,
        targetId: part.targetId,
      });
    }
  }
  if (targetsUsed.size > 0) {
    const known = await listTimeTargets(businessId);
    for (const [key, target] of targetsUsed) {
      const found = known.some((t) => t.targetType === target.targetType && t.targetId === target.targetId);
      if (!found) throw notFound(`Target ${key}`);
    }
  }

  // Load referenced catalog rows in bulk.
  const revenueItemIds = [...new Set(input.lines.flatMap((l) => (l.revenueItemId ? [l.revenueItemId] : [])))];
  const expenseItemIds = [...new Set(input.lines.flatMap((l) => (l.expenseItemId ? [l.expenseItemId] : [])))];

  const revenueItems = revenueItemIds.length
    ? await db
        .select()
        .from(revenueItemsTable)
        .where(and(eq(revenueItemsTable.businessId, businessId), inArray(revenueItemsTable.id, revenueItemIds)))
    : [];
  if (revenueItems.length !== revenueItemIds.length) throw notFound("Revenue item");
  const revenueItemById = new Map(revenueItems.map((item) => [item.id, item]));

  // Only leaves of a variant tree are sellable: a parent groups, it doesn't sell.
  if (revenueItemIds.length) {
    const children = await db
      .select({ parentId: revenueItemsTable.parentId })
      .from(revenueItemsTable)
      .where(inArray(revenueItemsTable.parentId, revenueItemIds));
    if (children.length) {
      const grouping = new Set(children.map((c) => c.parentId));
      const offending = revenueItems.find((item) => grouping.has(item.id));
      if (offending) throw invalid(`"${offending.name}" has variants — record the sale against one of its variants`);
    }
  }

  const expenseItems = expenseItemIds.length
    ? await db
        .select()
        .from(expenseItemsTable)
        .where(and(eq(expenseItemsTable.businessId, businessId), inArray(expenseItemsTable.id, expenseItemIds)))
    : [];
  if (expenseItems.length !== expenseItemIds.length) throw notFound("Expense item");
  const expenseItemById = new Map(expenseItems.map((item) => [item.id, item]));

  const overrides = revenueItemIds.length
    ? await db
        .select()
        .from(revenueItemSourcesTable)
        .where(
          and(
            inArray(revenueItemSourcesTable.revenueItemId, revenueItemIds),
            eq(revenueItemSourcesTable.sourceId, input.sourceId),
          ),
        )
    : [];
  const overrideByItemId = new Map(overrides.map((o) => [o.revenueItemId, o]));

  const components = revenueItemIds.length
    ? await db.select().from(costComponentsTable).where(inArray(costComponentsTable.revenueItemId, revenueItemIds))
    : [];
  const componentsByItemId = new Map<string, typeof components>();
  for (const component of components) {
    const list = componentsByItemId.get(component.revenueItemId) ?? [];
    list.push(component);
    componentsByItemId.set(component.revenueItemId, list);
  }

  // Resolve prices and freeze snapshots. A flatMap rather than a map because a
  // split line resolves into SEVERAL lines — one per target, with exact amounts.
  const resolvedLines: ResolvedLine[] = input.lines.flatMap((line): ResolvedLine[] => {
    const qty = parseQty(line.qty ?? "1");
    const lineDiscountCents = line.lineDiscountCents ?? 0;
    assertCentsField(lineDiscountCents, "line_discount_cents");

    let unitPriceCents = line.unitPriceCents;
    let costSnapshot: CostSnapshot | null = null;
    let itemName: string | null = null;
    // What this quantity is counted in, frozen here so a later rename of the
    // item's unit never restates what a past sale was sold in.
    let unitLabel: string | null = null;

    if (line.revenueItemId) {
      const item = revenueItemById.get(line.revenueItemId)!;
      itemName = item.name;
      unitLabel = item.unitLabel ?? null;
      unitPriceCents =
        unitPriceCents ?? overrideByItemId.get(item.id)?.priceOverrideCents ?? item.unitPriceCents ?? undefined;
      if (unitPriceCents === undefined) {
        throw invalid(`"${item.name}" has no price — variable-priced items need an explicit unit price`);
      }
      assertCentsField(unitPriceCents, "unit_price_cents");
      costSnapshot = buildCostSnapshot({
        components: (componentsByItemId.get(item.id) ?? []) as unknown as CostComponentInput[],
        occurredAt: input.occurredAt,
        sourceId: input.sourceId,
        unitPriceCents,
        qty,
      });
    } else if (line.expenseItemId) {
      const item = expenseItemById.get(line.expenseItemId)!;
      itemName = item.name;
      // Frozen here for the same reason a sale's unit is: renaming "bag" to
      // "sack" next year must not restate what past purchases were counted in.
      unitLabel = item.unitLabel ?? null;
      unitPriceCents = unitPriceCents ?? item.defaultAmountCents ?? undefined;
      if (unitPriceCents === undefined) throw invalid(`"${item.name}" has no default amount — pass unit_price_cents`);
      assertCentsField(unitPriceCents, "unit_price_cents");
    } else {
      if (unitPriceCents === undefined) throw invalid("Unlinked lines need unit_price_cents");
      assertCentsField(unitPriceCents, "unit_price_cents");
    }

    const resolved: ResolvedLine = {
      ...line,
      qty,
      lineDiscountCents,
      unitPriceCents,
      costSnapshot,
      itemName,
      unitLabel,
      direction: effectiveDirection(line),
    };
    if (!line.split || line.split.length === 0) return [resolved];

    // ── One bill becomes N lines ────────────────────────────────────────────
    //
    // The split is taken from what the bill actually cost — quantity times
    // price, less this line's own discount — so the parts add back to the money
    // that was really spent, not to a pre-discount figure.
    const total = mulCentsQty(unitPriceCents, qty) - lineDiscountCents;
    let shares;
    try {
      shares = buildSplit(total, line.split);
    } catch (err) {
      // The domain throws RangeError for a nonsense split; the owner needs a
      // 400 with the reason, not a 500.
      throw invalid(err instanceof Error ? err.message.replace(/^buildSplit: /, "") : "That split does not add up");
    }
    if (!splitReconciles(total, shares)) {
      throw new Error(`Split does not reconcile: ${shares.length} parts do not sum to ${total}`);
    }

    return shares.map((share) => ({
      ...resolved,
      // Each part is its own whole line for its own share, so the discount is
      // already inside the amount and must not be subtracted a second time.
      qty: "1",
      unitPriceCents: share.amountCents,
      lineDiscountCents: 0,
      targetType: share.targetType,
      targetId: share.targetId,
      split: null,
    }));
  });

  return { source, orderDiscountCents, shippingChargedCents, taxCollectedCents, resolvedLines };
}

/**
 * Write the monthly slices a capitalised purchase defers into.
 *
 * Each slice is an ordinary expense transaction carrying
 * `parent_transaction_id` back to the purchase, so the relationship is visible
 * in the ledger rather than implied. They are deliberately left UNPAID: the
 * cash went out once, on the purchase, and the cash-basis view reads `paid_at`
 * — so the slices are invisible to it and visible to accrual, which is exactly
 * the split that makes both bases true at once.
 */
async function writeSpreadSlices(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  args: {
    businessId: string;
    parent: typeof transactionsTable.$inferSelect;
    line: typeof transactionLinesTable.$inferSelect;
    months: number;
  },
) {
  const { businessId, parent, line, months } = args;
  const total = mulCentsQty(line.unitPriceCents, line.qty) - line.lineDiscountCents;
  const slices = buildSpread(total, parent.occurredAt, months);

  // The guard, not an assumption: a spread that does not add back to what was
  // spent would quietly lose or invent money, and the purchase has already
  // stopped counting itself.
  if (!spreadReconciles(total, slices)) {
    throw new Error(
      `Spread does not reconcile for line ${line.id}: ${slices.length} slices do not sum to ${total}`,
    );
  }

  for (const slice of slices) {
    const [sliceHeader] = await tx
      .insert(transactionsTable)
      .values({
        id: uid("txn"),
        businessId,
        direction: "out",
        occurredAt: slice.occursAt,
        // Never paid: the money left once, on the parent. Cash basis reads
        // paid_at and therefore ignores these entirely.
        paidAt: null,
        sourceId: parent.sourceId,
        status: "completed",
        currency: parent.currency,
        fxRateToBase: parent.fxRateToBase,
        origin: parent.origin,
        parentTransactionId: parent.id,
        notes: `Month ${slice.monthOffset + 1} of ${months}`,
      })
      .returning();

    await tx.insert(transactionLinesTable).values({
      id: uid("line"),
      transactionId: sliceHeader.id,
      direction: "out",
      expenseItemId: line.expenseItemId ?? null,
      label: line.label,
      categoryId: line.categoryId ?? null,
      qty: "1",
      unitPriceCents: slice.amountCents,
      lineDiscountCents: 0,
      costSnapshot: null,
      // Slices are the spread; they are never themselves spread.
      spreadMonths: null,
      // A cost booked to a client and then deferred is still that client's
      // cost — it just belongs to the months it covers. Dropping the target
      // here would make a spread cost silently belong to nobody.
      targetType: line.targetType,
      targetId: line.targetId,
    });
  }
}

export async function createTransaction(businessId: string, input: CreateTransactionInput) {
  const { source, orderDiscountCents, shippingChargedCents, taxCollectedCents, resolvedLines } =
    await resolveTransactionLines(businessId, input);

  // The header's direction is a summary of its lines: "in" if it earns anything
  // (a sale, possibly with cost lines), else "out" (a pure expense).
  const headerDirection: TransactionDirection = resolvedLines.some((l) => l.direction === "in") ? "in" : "out";

  const status = input.status ?? "completed";
  // Omitting the paid date means "paid on the day", which is what every caller
  // written before two dates existed meant. An unconfirmed recurring post has
  // not been paid by definition, so it never inherits a date it did not earn.
  const paidAt =
    input.paidAt !== undefined ? input.paidAt : status === "pending" ? null : input.occurredAt;

  // Frozen here and never recomputed: tomorrow's rate must not move today's
  // profit, the same rule cost snapshots follow.
  const fxRateToBase = input.fxRateToBase ?? IDENTITY_FX_RATE;
  if (!isValidFxRate(fxRateToBase)) throw invalid(`fxRateToBase "${fxRateToBase}" must be a positive decimal string`);
  if (input.currency !== undefined && isIdentityRate(fxRateToBase)) {
    // A named foreign currency at a rate of one is how $100 became Rs 100:
    // nothing refused it, so it was counted as if it were local money.
    const [business] = await db
      .select({ baseCurrency: businessesTable.baseCurrency })
      .from(businessesTable)
      .where(eq(businessesTable.id, businessId));
    if (business && input.currency !== business.baseCurrency) {
      throw invalid(`Amounts in ${input.currency} need an exchange rate to ${business.baseCurrency}`);
    }
  }
  const entered = input.entered ?? null;
  if (entered && (!isValidFxRate(entered.fxRate) || isIdentityRate(entered.fxRate))) {
    throw invalid(`"${entered.fxRate}" is not an exchange rate — it has to be a number above zero, and not 1`);
  }
  if (entered) assertCentsField(entered.amountCents, "entered_amount_cents");

  const taxPaidCents = input.taxPaidCents ?? 0;
  assertCentsField(taxPaidCents, "taxPaidCents");

  return db.transaction(async (tx) => {
    const [header] = await tx
      .insert(transactionsTable)
      .values({
        id: uid("txn"),
        businessId,
        direction: headerDirection,
        occurredAt: input.occurredAt,
        paidAt,
        dueDate: input.dueDate ?? null,
        sourceId: input.sourceId,
        personId: input.personId ?? null,
        status,
        currency: input.currency ?? source.defaultCurrency,
        fxRateToBase,
        enteredCurrency: entered?.currency ?? null,
        enteredFxRate: entered?.fxRate ?? null,
        enteredAmountCents: entered?.amountCents ?? null,
        taxPaidCents,
        taxReclaimable: input.taxReclaimable ?? false,
        origin: input.origin ?? "manual",
        externalRef: input.externalRef ?? null,
        referenceNumber: input.referenceNumber?.trim() || null,
        orderDiscountCents,
        discountCode: input.discountCode ?? null,
        shippingChargedCents,
        taxCollectedCents,
        notes: input.notes ?? null,
      })
      .returning();

    const lines = await tx
      .insert(transactionLinesTable)
      .values(
        resolvedLines.map((line) => ({
          id: uid("line"),
          transactionId: header.id,
          direction: line.direction,
          revenueItemId: line.revenueItemId ?? null,
          expenseItemId: line.expenseItemId ?? null,
          label: line.label?.trim() || null,
          categoryId: line.categoryId ?? null,
          qty: line.qty,
          unitLabel: line.unitLabel,
          unitPriceCents: line.unitPriceCents!,
          lineDiscountCents: line.lineDiscountCents,
          costSnapshot: line.costSnapshot,
          spreadMonths: line.spreadMonths ?? null,
          isAdvance: line.isAdvance ?? false,
          wastedQty: line.wastedQty?.trim() || null,
          targetType: line.targetType ?? null,
          targetId: line.targetId ?? null,
        })),
      )
      .returning();

    // ── Spread lines generate their slices, inside the same transaction ─────
    //
    // All or nothing: a purchase whose slices half-wrote would be capitalised
    // (contributing nothing) while carrying only part of its cost, which is
    // the one outcome worse than not spreading at all.
    for (const line of lines) {
      if (!isCapitalised(line.spreadMonths)) continue;
      await writeSpreadSlices(tx, {
        businessId,
        parent: header,
        line,
        months: line.spreadMonths!,
      });
    }

    // Remember when we first saw this person — the cohort anchor.
    if (header.personId) {
      await tx
        .update(peopleTable)
        .set({
          firstTransactionAt: sql`LEAST(coalesce(${peopleTable.firstTransactionAt}, ${header.occurredAt}), ${header.occurredAt})`,
        })
        .where(and(eq(peopleTable.id, header.personId), eq(peopleTable.businessId, businessId)));
    }

    return { transaction: header, lines };
  });
}

export interface UpdateTransactionHeaderInput {
  notes?: string | null;
  referenceNumber?: string | null;
  occurredAt?: Date;
  /** undefined = leave unchanged; null = clear the person. */
  personId?: string | null;
  /**
   * Settle or un-settle: a date marks it paid, null puts it back to unpaid.
   * This replaced the old pending↔completed toggle — "unpaid" was never a
   * lifecycle state, and using `status` for it collided with the recurring
   * engine's meaning of pending ("not confirmed to have happened").
   */
  paidAt?: Date | null;
  /** Set or clear the agreed payment date. A plain "YYYY-MM-DD". */
  dueDate?: string | null;
}

/**
 * Safe header-only edit (CLAUDE.md append-only): notes, date, person, the
 * paid/unpaid toggle and the agreed payment date. It NEVER touches lines or any cent amount — money
 * corrections go through createRefund / voidTransaction.
 */
export async function updateTransactionHeader(
  businessId: string,
  transactionId: string,
  patch: UpdateTransactionHeaderInput,
) {
  const [existing] = await db
    .select()
    .from(transactionsTable)
    .where(and(eq(transactionsTable.businessId, businessId), eq(transactionsTable.id, transactionId)));
  if (!existing) throw notFound("Transaction");
  if (existing.adjustmentType) {
    throw invalid("Refunds and chargebacks can't be edited — post a correction instead");
  }
  // An unconfirmed recurring post has not happened yet as far as the owner is
  // concerned, so it cannot be marked paid — confirm it first.
  if (patch.paidAt !== undefined && existing.status === "pending") {
    throw invalid("Confirm this recurring entry before marking it paid");
  }
  if (patch.paidAt !== undefined && existing.status === "void") {
    throw invalid("A voided transaction can't be marked paid");
  }

  const updates: Partial<typeof transactionsTable.$inferInsert> = { updatedAt: new Date() };
  if (patch.notes !== undefined) updates.notes = patch.notes;
  if (patch.referenceNumber !== undefined) updates.referenceNumber = patch.referenceNumber?.trim() || null;
  if (patch.occurredAt !== undefined) updates.occurredAt = patch.occurredAt;
  if (patch.personId !== undefined) {
    // A new customer must be this business's own.
    await assertOwnedRefs(businessId, { personIds: [patch.personId] });
    updates.personId = patch.personId;
  }
  if (patch.paidAt !== undefined) updates.paidAt = patch.paidAt;
  if (patch.dueDate !== undefined) updates.dueDate = patch.dueDate;

  const [updated] = await db
    .update(transactionsTable)
    .set(updates)
    .where(and(eq(transactionsTable.id, transactionId), eq(transactionsTable.businessId, businessId)))
    .returning();

  // Keep the cohort anchor consistent if the date moved earlier.
  if (updated.personId && patch.occurredAt) {
    await db
      .update(peopleTable)
      .set({
        firstTransactionAt: sql`LEAST(coalesce(${peopleTable.firstTransactionAt}, ${updated.occurredAt}), ${updated.occurredAt})`,
      })
      .where(and(eq(peopleTable.id, updated.personId), eq(peopleTable.businessId, businessId)));
  }

  return updated;
}

// ---------------------------------------------------------------------------
// Refunds / chargebacks
// ---------------------------------------------------------------------------

function snapshotOf(line: { costSnapshot: unknown }): CostSnapshot | null {
  return (line.costSnapshot as CostSnapshot | null) ?? null;
}

async function loadPriorRefunds(originalId: string): Promise<PriorRefundLine[]> {
  const children = await db
    .select()
    .from(transactionsTable)
    .where(and(eq(transactionsTable.parentTransactionId, originalId), ne(transactionsTable.status, "void")));
  if (children.length === 0) return [];
  const childLines = await db
    .select()
    .from(transactionLinesTable)
    .where(inArray(transactionLinesTable.transactionId, children.map((child) => child.id)));
  return childLines.flatMap((line) =>
    line.refundedLineId
      ? [
          {
            refundedLineId: line.refundedLineId,
            qtyRefunded: snapshotOf(line)?.qty_basis ?? "0",
            amountRefundedCents: line.unitPriceCents,
          },
        ]
      : [],
  );
}

export async function createRefund(
  businessId: string,
  input: {
    transactionId: string;
    requests: RefundRequestLine[];
    adjustmentType?: Extract<AdjustmentType, "refund" | "chargeback">;
    chargebackFeeCents?: number;
    occurredAt?: Date;
    notes?: string | null;
    /**
     * The platform's own id for this refund, when one posted it.
     *
     * A refund needs the same idempotency the sale gets, and for the same
     * reason: Shopify re-delivers a webhook whenever it feels unsure, and a
     * second copy of a refund would hand the customer their money back twice
     * in the books. Rides `unique(source_id, external_ref)` — the identical
     * mechanism, not a second one.
     */
    externalRef?: string | null;
  },
) {
  const [original] = await db
    .select()
    .from(transactionsTable)
    .where(and(eq(transactionsTable.businessId, businessId), eq(transactionsTable.id, input.transactionId)));
  if (!original) throw notFound("Transaction");
  if (original.adjustmentType) throw invalid("Refunds and chargebacks cannot be refunded — post a correction instead");
  if (original.status === "void" || original.status === "pending") {
    throw invalid(`A ${original.status} transaction cannot be refunded`);
  }

  const originalLines = await db
    .select()
    .from(transactionLinesTable)
    .where(eq(transactionLinesTable.transactionId, original.id));
  /** So a refund line can be counted in the same unit the sale it reverses was. */
  const unitByOriginalLineId = new Map(originalLines.map((l) => [l.id, l.unitLabel ?? null]));
  /**
   * So a refund also reverses WHAT IT WAS FOR.
   *
   * Without this a refund is invisible to anything that reads by target: a site
   * billed Rs 2,000,000 and refunded Rs 500,000 went on reporting Rs 2,000,000
   * earned, because the refund line named nobody. The refund carries the
   * original line's target, and the readers subtract it — see
   * `services/project.ts`.
   */
  const targetByOriginalLineId = new Map(
    originalLines.map((l) => [l.id, { targetType: l.targetType, targetId: l.targetId }]),
  );

  const priorRefunds = await loadPriorRefunds(original.id);

  const built = buildRefund(
    {
      id: original.id,
      direction: original.direction as TransactionDirection,
      sourceId: original.sourceId,
      currency: original.currency,
      orderDiscountCents: original.orderDiscountCents,
    },
    originalLines.map((line) => ({
      id: line.id,
      label: line.label,
      qty: line.qty,
      unitPriceCents: line.unitPriceCents,
      lineDiscountCents: line.lineDiscountCents,
      costSnapshot: snapshotOf(line),
    })),
    input.requests,
    {
      adjustmentType: input.adjustmentType,
      chargebackFeeCents: input.chargebackFeeCents,
      priorRefunds,
    },
  );

  return db.transaction(async (tx) => {
    const [header] = await tx
      .insert(transactionsTable)
      .values({
        id: uid("txn"),
        businessId,
        direction: built.transaction.direction,
        occurredAt: input.occurredAt ?? new Date(),
        // Giving money back IS the cash moving, so a refund is paid the moment
        // it is posted — it is never an outstanding bill.
        paidAt: input.occurredAt ?? new Date(),
        sourceId: built.transaction.sourceId,
        personId: original.personId,
        status: built.transaction.adjustmentType === "chargeback" ? "disputed" : "completed",
        currency: built.transaction.currency,
        // Inherit the ORIGINAL's frozen rate, not today's: a refund has to
        // cancel the sale it reverses to the cent, and it cannot do that if the
        // two are converted at different rates.
        fxRateToBase: original.fxRateToBase,
        // A refund the connector posted came from the platform, and the UI says
        // so — the same origin transparency every other imported row gets.
        origin: input.externalRef ? "integration" : "manual",
        externalRef: input.externalRef ?? null,
        parentTransactionId: built.transaction.parentTransactionId,
        adjustmentType: built.transaction.adjustmentType,
        notes: input.notes ?? null,
      })
      .returning();

    const lines = await tx
      .insert(transactionLinesTable)
      .values(
        built.lines.map((line) => ({
          id: uid("line"),
          transactionId: header.id,
          // Refund/fee lines are label-only; they inherit the original's
          // direction (the check passes either way, and the ladder classifies
          // adjustments by refundedLineId, not by line direction).
          direction: original.direction as TransactionDirection,
          label: line.label,
          qty: line.qty,
          // A refund is counted in whatever the sale it reverses was counted in,
          // so "6 hours back" reads the same way the sale did.
          unitLabel: line.refundedLineId ? unitByOriginalLineId.get(line.refundedLineId) ?? null : null,
          unitPriceCents: line.unitPriceCents,
          lineDiscountCents: line.lineDiscountCents,
          costSnapshot: line.costSnapshot,
          refundedLineId: line.refundedLineId,
          // A chargeback fee is a new cost of its own, not a reversal, so it
          // has no original line and correctly inherits no target.
          targetType: line.refundedLineId
            ? targetByOriginalLineId.get(line.refundedLineId)?.targetType ?? null
            : null,
          targetId: line.refundedLineId
            ? targetByOriginalLineId.get(line.refundedLineId)?.targetId ?? null
            : null,
          restocked: line.restocked,
          feesRecovered: line.feesRecovered,
        })),
      )
      .returning();

    await tx
      .update(transactionsTable)
      .set({ status: built.parentStatus, updatedAt: new Date() })
      .where(eq(transactionsTable.id, original.id));

    return { transaction: header, lines, parentStatus: built.parentStatus, profitImpactCents: built.profitImpactCents };
  });
}

/**
 * Legacy-dialog convenience: refund a flat AMOUNT against a transaction. The
 * amount is consumed across the refundable lines in order (exact decimal qty
 * math), then posted through createRefund — same limits, same append-only
 * rules. TODO(R4): the rebuilt refund UI will pick lines explicitly.
 */
export async function createRefundForAmount(
  businessId: string,
  input: {
    transactionId: string;
    amountCents: number;
    restocked?: boolean;
    occurredAt?: Date;
    notes?: string | null;
    /** The platform's id for this refund, when a connector posted it. */
    externalRef?: string | null;
  },
) {
  if (!Number.isSafeInteger(input.amountCents) || input.amountCents <= 0) {
    throw invalid("Refund amount must be positive");
  }
  const [original] = await db
    .select()
    .from(transactionsTable)
    .where(and(eq(transactionsTable.businessId, businessId), eq(transactionsTable.id, input.transactionId)));
  if (!original) throw notFound("Transaction");

  const originalLines = await db
    .select()
    .from(transactionLinesTable)
    .where(eq(transactionLinesTable.transactionId, original.id));
  const priorRefunds = await loadPriorRefunds(original.id);

  const profitLines = originalLines.map((line) => ({
    qty: line.qty,
    unitPriceCents: line.unitPriceCents,
    lineDiscountCents: line.lineDiscountCents,
    costSnapshot: snapshotOf(line),
  }));
  const shares = orderDiscountShares(original.orderDiscountCents, profitLines);

  let remaining = input.amountCents;
  const requests: RefundRequestLine[] = [];
  for (let i = 0; i < originalLines.length && remaining > 0; i += 1) {
    const line = originalLines[i];
    const refundable = netLineRevenue(profitLines[i], shares[i]);
    const priorForLine = priorRefunds.filter((r) => r.refundedLineId === line.id);
    const priorAmount = priorForLine.reduce((sum, r) => sum + r.amountRefundedCents, 0);
    const priorQty = priorForLine.reduce((sum, r) => sum.plus(r.qtyRefunded), new Decimal(0));
    const availableAmount = refundable - priorAmount;
    const availableQty = new Decimal(line.qty).minus(priorQty);
    if (availableAmount <= 0 || availableQty.lte(0)) continue;

    const take = Math.min(remaining, availableAmount);
    // Quantity returned scales with the share of the line's remaining value.
    const qtyRefunded =
      take === availableAmount
        ? availableQty
        : availableQty.mul(take).div(availableAmount).toDecimalPlaces(4, Decimal.ROUND_DOWN);
    if (qtyRefunded.lte(0)) continue;

    requests.push({
      lineId: line.id,
      qtyRefunded: qtyRefunded.toString(),
      amountRefundedCents: take,
      restocked: input.restocked ?? false,
    });
    remaining -= take;
  }

  if (remaining > 0) {
    const max = requests.reduce((sum, r) => sum + r.amountRefundedCents, 0);
    throw invalid(`Refund exceeds what's left on this sale (maximum ${(max / 100).toFixed(2)})`);
  }

  return createRefund(businessId, {
    transactionId: input.transactionId,
    requests,
    occurredAt: input.occurredAt,
    notes: input.notes,
    externalRef: input.externalRef,
  });
}

// ---------------------------------------------------------------------------
// Void
// ---------------------------------------------------------------------------

/** Voiding is a status change — money rows are never hard-deleted. */
export async function voidTransaction(businessId: string, transactionId: string) {
  const [transaction] = await db
    .select()
    .from(transactionsTable)
    .where(and(eq(transactionsTable.businessId, businessId), eq(transactionsTable.id, transactionId)));
  if (!transaction) throw notFound("Transaction");
  if (transaction.status === "void") return transaction;

  const children = await db
    .select()
    .from(transactionsTable)
    .where(and(eq(transactionsTable.parentTransactionId, transactionId), ne(transactionsTable.status, "void")));

  // Two kinds of child, two different rules. An adjustment is its own money
  // event and the owner must deal with it deliberately. A spread slice is not
  // — it is bookkeeping this purchase generated, and leaving the slices alive
  // after voiding the purchase would keep charging for a thing that no longer
  // happened.
  const adjustments = children.filter((c) => c.adjustmentType !== null);
  const slices = children.filter((c) => c.adjustmentType === null);
  if (adjustments.length > 0) throw invalid("Void the refunds/chargebacks of this transaction first");

  return db.transaction(async (tx) => {
    const [voided] = await tx
      .update(transactionsTable)
      .set({ status: "void", updatedAt: new Date() })
      .where(eq(transactionsTable.id, transactionId))
      .returning();

    for (const slice of slices) {
      await tx
        .update(transactionsTable)
        .set({ status: "void", updatedAt: new Date() })
        .where(eq(transactionsTable.id, slice.id));
    }

    // Voiding an adjustment un-counts it from the parent's refunded status.
    if (transaction.parentTransactionId) {
      await recomputeParentStatus(tx, transaction.parentTransactionId);
    }
    return voided;
  });
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function recomputeParentStatus(tx: Tx, parentId: string) {
  const [parent] = await tx.select().from(transactionsTable).where(eq(transactionsTable.id, parentId));
  if (!parent || parent.status === "void") return;

  const parentLines = await tx
    .select()
    .from(transactionLinesTable)
    .where(eq(transactionLinesTable.transactionId, parentId));
  const profitLines = parentLines.map((line) => ({
    qty: line.qty,
    unitPriceCents: line.unitPriceCents,
    lineDiscountCents: line.lineDiscountCents,
    costSnapshot: snapshotOf(line),
  }));
  const shares = orderDiscountShares(parent.orderDiscountCents, profitLines);
  const totalRefundable = profitLines.reduce((sum, line, i) => sum + netLineRevenue(line, shares[i]), 0);

  const children = await tx
    .select()
    .from(transactionsTable)
    .where(and(eq(transactionsTable.parentTransactionId, parentId), ne(transactionsTable.status, "void")));
  let refunded = 0;
  if (children.length > 0) {
    const childLines = await tx
      .select()
      .from(transactionLinesTable)
      .where(inArray(transactionLinesTable.transactionId, children.map((child) => child.id)));
    refunded = childLines.reduce((sum, line) => (line.refundedLineId ? sum + line.unitPriceCents : sum), 0);
  }

  const status = refunded <= 0 ? "completed" : refunded >= totalRefundable ? "refunded" : "partially_refunded";
  await tx
    .update(transactionsTable)
    .set({ status, updatedAt: new Date() })
    .where(eq(transactionsTable.id, parentId));
}
