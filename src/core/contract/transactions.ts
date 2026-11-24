import { z } from "zod";
import { defineEndpoint, moneyCents, splitTargetType } from "./shared";

export { splitTargetType };

export const transactionDirection = z.enum(["in", "out"]);
export const transactionStatus = z.enum([
  "pending",
  "completed",
  "refunded",
  "partially_refunded",
  "void",
  "disputed",
]);
export const transactionOrigin = z.enum(["manual", "integration", "recurring_engine", "import"]);
/**
 * Where a row stands on getting paid. Separate from `status`: "unpaid" is a
 * missing paid date, while "not confirmed" is a recurring post nobody has
 * agreed happened yet.
 */
export const paymentState = z.enum(["paid", "unpaid", "not_confirmed"]);
/** Which date a money question is measured by. */
export const accountingBasis = z.enum(["accrual", "cash"]);
export const adjustmentType = z.enum(["refund", "chargeback", "correction"]);

/** Frozen at line creation (see CLAUDE.md); the UI renders it, never recomputes it. */
export const costSnapshot = z.object({
  version: z.literal(1),
  components: z.array(
    z.object({
      name: z.string(),
      calc: z.enum(["fixed_per_unit", "percent_of_price", "percent_of_subtotal"]),
      input: z.string(),
      per_unit_cents: moneyCents,
      kind: z.enum(["fee", "cost"]),
    }),
  ),
  total_per_unit_cents: moneyCents,
  qty_basis: z.string().optional(),
});
export type CostSnapshotShape = z.infer<typeof costSnapshot>;

export const transactionLine = z.object({
  id: z.string(),
  /** Per-line direction: "in" = revenue, "out" = expense/cost (mixed entries). */
  direction: transactionDirection,
  revenueItemId: z.string().nullable(),
  expenseItemId: z.string().nullable(),
  /**
   * Resolved catalog item name (null for unlinked label-only lines).
   *
   * For a variant this is the FULL path — "Shirt / Black / Medium" — because a
   * leaf name alone does not say which product was sold, and two products can
   * both have a "Medium".
   */
  itemName: z.string().nullable(),
  label: z.string().nullable(),
  categoryId: z.string().nullable(),
  categoryName: z.string().nullable(),
  qty: z.string(),
  /**
   * What that quantity is counted in — "hour", "unit", "month" — frozen from
   * the item when the line was written. Null on a label-only line, which counts
   * nothing in particular. Never re-resolved: renaming an item's unit must not
   * restate what a past sale was sold in.
   */
  unitLabel: z.string().nullable(),
  unitPriceCents: moneyCents,
  lineDiscountCents: moneyCents,
  costSnapshot: costSnapshot.nullable(),
  refundedLineId: z.string().nullable(),
  restocked: z.boolean().nullable(),
  feesRecovered: z.boolean().nullable(),
  /**
   * Set when this cost is spread: the number of months it is charged across.
   * The row still shows its real amount and its real date — the spread is a
   * statement about which months carry the cost, not about what was paid.
   */
  spreadMonths: z.number().int().nullable(),
  /** Money that moved before the work did — cash now, cost when it is settled. */
  isAdvance: z.boolean(),
  /** How much of it was wasted. Information only — never added to any total. */
  wastedQty: z.string().nullable(),
  /**
   * Who the cost was for. A split bill arrives as several lines, each with its
   * own target and its own share — there is no separate "split" object,
   * because a split IS the lines.
   */
  targetType: splitTargetType.nullable(),
  targetId: z.string().nullable(),
  targetLabel: z.string().nullable(),
});
export type TransactionLineShape = z.infer<typeof transactionLine>;

/**
 * One ledger row, fully resolved for display. All money is server-computed
 * integer cents — the UI never computes money (CLAUDE.md).
 */
export const transactionSummary = z.object({
  id: z.string(),
  direction: transactionDirection,
  /** When it HAPPENED — the date profit is measured by. */
  occurredAt: z.string(),
  /** When the cash moved. Null = not paid yet. */
  paidAt: z.string().nullable(),
  /** When it was agreed the money would move. Null = no date was agreed. */
  dueDate: z.string().nullable(),
  paymentState: paymentState,
  status: transactionStatus,
  origin: transactionOrigin,
  adjustmentType: adjustmentType.nullable(),
  parentTransactionId: z.string().nullable(),
  sourceId: z.string(),
  sourceName: z.string(),
  personId: z.string().nullable(),
  personName: z.string().nullable(),
  currency: z.string(),
  /** Rate to base currency, frozen when this transaction was written. */
  fxRateToBase: z.string(),
  /**
   * What the owner typed, when they typed it in another currency. Every amount
   * on this row is already in base; this is only the "$100 at 280.50" to show.
   */
  entered: z
    .object({ currency: z.string(), fxRate: z.string(), amountCents: moneyCents })
    .nullable(),
  orderDiscountCents: moneyCents,
  shippingChargedCents: moneyCents,
  taxCollectedCents: moneyCents,
  /** Input tax paid inside these amounts. */
  taxPaidCents: moneyCents,
  /** True when that tax is claimable back, and so is not a cost. */
  taxReclaimable: z.boolean(),
  discountCode: z.string().nullable(),
  externalRef: z.string().nullable(),
  /** Owner-facing invoice/receipt number — non-unique, free-form. */
  referenceNumber: z.string().nullable(),
  notes: z.string().nullable(),
  /** "Logo design", "Ceramic mug +2", or the unlinked label. */
  displayName: z.string(),
  /** Money moved: sales = net lines + shipping; expenses = total; adjustments = amount returned. */
  amountCents: moneyCents,
  /** Sales only (null elsewhere): line revenue net of all discounts, ex shipping/tax. */
  netRevenueCents: moneyCents.nullable(),
  /** Sales: net + shipping − snapshot costs. Adjustments: the (negative) profit impact. Expenses: null. */
  contributionProfitCents: moneyCents.nullable(),
  /** Total refunded against this transaction so far (parent rows). */
  refundedCents: moneyCents,
  lines: z.array(transactionLine),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type TransactionSummaryShape = z.infer<typeof transactionSummary>;

export const transactionGroupKey = z.enum(["type", "category", "source"]);

export const transactionRollup = z.object({
  key: z.string(),
  label: z.string(),
  count: z.number().int(),
  amountCents: moneyCents,
  netRevenueCents: moneyCents,
  contributionProfitCents: moneyCents,
  /**
   * Which transactions are in this group, and how much of each belongs to it.
   *
   * The list is drawn under its headings from these, so the rows and the
   * subtotal above them always come from one calculation. Grouping by category
   * splits a mixed sale across the categories its LINES belong to, so the same
   * transaction can appear in two groups carrying a part of its amount in each
   * — and the parts add up to the whole.
   */
  members: z.array(z.object({ id: z.string(), amountCents: moneyCents })),
});
export type TransactionRollupShape = z.infer<typeof transactionRollup>;

/**
 * One bar of the graph above the ledger.
 *
 * Money in and money out stay apart — netting them would turn a busy day into
 * a quiet one — and both are positive magnitudes: the SIDE of the baseline
 * carries the direction, so the chart still reads with the colour removed.
 */
export const transactionBucket = z.object({
  /** Local midnight (or month/year start) this bucket opens at, as ISO. */
  start: z.string(),
  label: z.string(),
  inCents: moneyCents,
  outCents: moneyCents,
  count: z.number().int(),
});
export type TransactionBucketShape = z.infer<typeof transactionBucket>;

export const seriesBucket = z.enum(["day", "week", "month", "year"]);

const listQuery = z.object({
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  direction: transactionDirection.optional(),
  sourceId: z.string().optional(),
  status: transactionStatus.optional(),
  origin: transactionOrigin.optional(),
  categoryId: z.string().optional(),
  /** Catalog item type filter (revenue item type or expense item type). */
  itemType: z.string().optional(),
  search: z.string().optional(),
  /** Opaque cursor from a previous page. */
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  groupBy: transactionGroupKey.optional(),
});

export const listTransactions = defineEndpoint({
  method: "GET",
  path: "/transactions",
  query: listQuery,
  response: z.object({
    items: z.array(transactionSummary),
    nextCursor: z.string().nullable(),
    totalCount: z.number().int(),
    /** Server-computed rollup subtotals when groupBy was requested. */
    groups: z.array(transactionRollup).nullable(),
    /** How wide one bar is — chosen from the length of the period. */
    bucket: seriesBucket,
    /**
     * The period's shape, over the FULL filtered set rather than the page:
     * every bucket in the range, quiet ones included.
     */
    buckets: z.array(transactionBucket),
  }),
});

export const getTransaction = defineEndpoint({
  method: "GET",
  path: "/transactions/:id",
  params: z.object({ id: z.string() }),
  response: z.object({
    transaction: transactionSummary,
    refunds: z.array(transactionSummary),
  }),
});

export const createTransactionLineInput = z.object({
  /** "in" = revenue, "out" = expense/cost. Optional: inferred from the linked item, else the header direction. */
  direction: transactionDirection.optional(),
  revenueItemId: z.string().nullish(),
  expenseItemId: z.string().nullish(),
  label: z.string().max(255).nullish(),
  categoryId: z.string().nullish(),
  qty: z.string().optional(),
  unitPriceCents: moneyCents.optional(),
  lineDiscountCents: moneyCents.optional(),
  /**
   * Spread this cost over N months instead of landing it whole in the month it
   * was paid. Costs only, never on a transaction that also has a sale on it.
   * Null or absent = an ordinary expense.
   */
  spreadMonths: z.number().int().min(2).max(120).nullish(),
  /**
   * Mark this line as money paid (or taken) BEFORE the work. It spends nothing
   * in profit until an advance application settles it against a real bill.
   */
  isAdvance: z.boolean().optional(),
  /**
   * How much of what was bought never made it into the work. INFORMATION, never
   * money: you already paid for it, so this is a slice of a cost the ledger
   * holds, not an extra one. Never larger than the quantity.
   */
  wastedQty: z.string().max(40).nullish(),
  /**
   * Who this cost was FOR — a client, one of your offers, or an internal
   * category. Costs only; revenue already records who paid on the header.
   */
  targetType: splitTargetType.nullish(),
  targetId: z.string().nullish(),
  /**
   * One bill, several things it was really for. The server turns this into one
   * line per share, with exact amounts that add back to the bill — the client
   * never computes the money. Weights are relative, so 50/30/20 and 5/3/2 mean
   * the same thing.
   */
  split: z
    .array(
      z.object({
        targetType: splitTargetType,
        targetId: z.string(),
        weight: z.string(),
      }),
    )
    .min(2)
    .max(20)
    .nullish(),
});

export const createTransactionBody = z.object({
  direction: transactionDirection,
  /** When it happened. */
  occurredAt: z.string(),
  /**
   * When the cash moved. Omit and it follows occurredAt (paid on the day);
   * pass null for a bill or invoice that has not been paid yet.
   */
  paidAt: z.string().nullish(),
  /**
   * When payment was agreed for. Null or omitted means nothing was agreed —
   * which is NOT the same as due today, and never makes a row late.
   */
  dueDate: z.string().nullish(),
  sourceId: z.string().optional(),
  personId: z.string().nullish(),
  /** Free-typed customer name — resolved to an existing or new person server-side. */
  personName: z.string().max(255).nullish(),
  status: z.enum(["pending", "completed"]).optional(),
  notes: z.string().max(2000).nullish(),
  referenceNumber: z.string().max(100).nullish(),
  discountCode: z.string().max(100).nullish(),
  orderDiscountCents: moneyCents.optional(),
  shippingChargedCents: moneyCents.optional(),
  taxCollectedCents: moneyCents.optional(),
  /** Input tax inside these amounts (GST/VAT on a purchase). */
  taxPaidCents: moneyCents.optional(),
  /** True when that tax is claimable back, so it should not count as a cost. */
  taxReclaimable: z.boolean().optional(),
  /** Currency of these amounts; defaults to the source's. */
  currency: z.string().length(3).optional(),
  /** Rate to base currency, frozen at write time. Decimal string, defaults "1". */
  fxRateToBase: z.string().optional(),
  /**
   * The amounts below were TYPED in this currency. The server converts them
   * into base at `fxRate` (base per one unit, decimal string) before saving and
   * remembers the original. Every line must then carry its own price.
   */
  enteredIn: z.object({ currency: z.string().length(3), fxRate: z.string() }).optional(),
  lines: z.array(createTransactionLineInput).min(1).max(50),
});

export const createTransaction = defineEndpoint({
  method: "POST",
  path: "/transactions",
  body: createTransactionBody,
  response: transactionSummary,
});

/** Live Quick-Add preview: the would-be snapshot + ladder numbers, server-computed. */
export const previewTransaction = defineEndpoint({
  method: "POST",
  path: "/transactions/preview",
  body: createTransactionBody,
  response: z.object({
    lines: z.array(
      z.object({
        name: z.string(),
        qty: z.string(),
        unitPriceCents: moneyCents,
        lineDiscountCents: moneyCents,
        costSnapshot: costSnapshot.nullable(),
        netRevenueCents: moneyCents,
        contributionProfitCents: moneyCents,
      }),
    ),
    grossCents: moneyCents,
    discountCents: moneyCents,
    shippingCents: moneyCents,
    netRevenueCents: moneyCents,
    costBreakdown: z.array(z.object({ name: z.string(), kind: z.enum(["fee", "cost"]), totalCents: moneyCents })),
    totalCostCents: moneyCents,
    contributionProfitCents: moneyCents,
    /** What this entry amounts to in the business's own currency, as the ledger will list it. */
    amountCents: moneyCents,
  }),
});

/**
 * Today's rate for typing an entry in another currency: base per one unit of
 * `from`, as a decimal string. Null when no rate could be fetched — the owner
 * types one instead. A suggestion only; the rate saved is whatever they send.
 */
export const getFxRate = defineEndpoint({
  method: "GET",
  path: "/fx-rate",
  query: z.object({ from: z.string().length(3) }),
  response: z.object({
    from: z.string(),
    to: z.string(),
    rate: z.string().nullable(),
    /** When the provider published this rate. */
    asOf: z.string().nullable(),
  }),
});

/**
 * Safe header-only edit (append-only ledger, CLAUDE.md): notes, dates, customer,
 * and the paid/unpaid toggle. Money — amounts, lines, discounts, refunds, voids
 * — is NEVER edited here; it moves through refund/chargeback/void.
 */
export const updateTransactionBody = z.object({
  notes: z.string().max(2000).nullish(),
  referenceNumber: z.string().max(100).nullish(),
  occurredAt: z.string().optional(),
  /**
   * Settle or un-settle: a date marks it paid, null puts it back to unpaid.
   * Replaced the old status toggle — "unpaid" was never a lifecycle state.
   */
  paidAt: z.string().nullish(),
  /** Set or clear the agreed payment date. */
  dueDate: z.string().nullish(),
  personId: z.string().nullish(),
  /** Free-typed customer name — resolved to an existing or new person server-side. */
  personName: z.string().max(255).nullish(),
});

export const updateTransaction = defineEndpoint({
  method: "PATCH",
  path: "/transactions/:id",
  params: z.object({ id: z.string() }),
  body: updateTransactionBody,
  response: transactionSummary,
});

const refundLinesBody = z.object({
  occurredAt: z.string().optional(),
  notes: z.string().max(2000).nullish(),
  lines: z
    .array(
      z.object({
        lineId: z.string(),
        qtyRefunded: z.string(),
        amountRefundedCents: moneyCents,
        restocked: z.boolean().optional(),
        feesRecovered: z.boolean().optional(),
      }),
    )
    .min(1),
});

export const refundTransaction = defineEndpoint({
  method: "POST",
  path: "/transactions/:id/refund",
  params: z.object({ id: z.string() }),
  body: refundLinesBody,
  response: z.object({ transaction: transactionSummary, parentStatus: transactionStatus }),
});

export const chargebackTransaction = defineEndpoint({
  method: "POST",
  path: "/transactions/:id/chargeback",
  params: z.object({ id: z.string() }),
  body: refundLinesBody.extend({ feeCents: moneyCents.optional() }),
  response: z.object({ transaction: transactionSummary, parentStatus: transactionStatus }),
});

export const voidTransaction = defineEndpoint({
  method: "POST",
  path: "/transactions/:id/void",
  params: z.object({ id: z.string() }),
  body: z.object({}).optional(),
  response: transactionSummary,
});

// ── Transaction templates (reusable Quick-Add drafts) ───────────────────────

/** A saved draft: the create body minus the date — using one still posts through createTransaction. */
export const transactionTemplatePayload = createTransactionBody.omit({ occurredAt: true });

export const transactionTemplate = z.object({
  id: z.string(),
  name: z.string(),
  payload: transactionTemplatePayload,
  createdAt: z.string(),
});

export const listTransactionTemplates = defineEndpoint({
  method: "GET",
  path: "/transaction-templates",
  response: z.object({ items: z.array(transactionTemplate) }),
});

export const createTransactionTemplate = defineEndpoint({
  method: "POST",
  path: "/transaction-templates",
  body: z.object({ name: z.string().min(1).max(100), payload: transactionTemplatePayload }),
  response: transactionTemplate,
});

export const deleteTransactionTemplate = defineEndpoint({
  method: "DELETE",
  path: "/transaction-templates/:id",
  params: z.object({ id: z.string() }),
  response: z.object({ ok: z.boolean() }),
});

// ── Attachments / receipts (metadata via contract; bytes via binary routes) ─
//
// Upload is POST /transactions/:id/attachments with the raw file body
// (Content-Type = the file's MIME, `x-filename` header) and download is
// GET /attachments/:id/download — both are binary, so they are dedicated
// Express routes rather than Zod endpoints. Metadata list/delete are typed.

export const transactionAttachment = z.object({
  id: z.string(),
  filename: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number().int(),
  createdAt: z.string(),
});

export const listTransactionAttachments = defineEndpoint({
  method: "GET",
  path: "/transactions/:id/attachments",
  params: z.object({ id: z.string() }),
  response: z.object({ items: z.array(transactionAttachment) }),
});

export const deleteTransactionAttachment = defineEndpoint({
  method: "DELETE",
  path: "/attachments/:id",
  params: z.object({ id: z.string() }),
  response: z.object({ ok: z.boolean() }),
});

// ── Pending recurring queue (confirm_first posts) ───────────────────────────

export const confirmPendingTransaction = defineEndpoint({
  method: "POST",
  path: "/transactions/:id/confirm",
  params: z.object({ id: z.string() }),
  body: z.object({}).optional(),
  response: transactionSummary,
});

export const skipPendingTransaction = defineEndpoint({
  method: "POST",
  path: "/transactions/:id/skip",
  params: z.object({ id: z.string() }),
  body: z.object({}).optional(),
  response: z.object({ ok: z.boolean() }),
});

export const editPendingTransactionAmount = defineEndpoint({
  method: "POST",
  path: "/transactions/:id/edit-amount",
  params: z.object({ id: z.string() }),
  body: z.object({ amountCents: moneyCents }),
  response: transactionSummary,
});

// ── Who a cost can be booked against ────────────────────────────────────────

/**
 * The same list the timesheet targets, served on its own so the expense entry
 * screen can offer it without fetching a week of hours to get at it.
 */
export const listCostTargets = defineEndpoint({
  method: "GET",
  path: "/cost-targets",
  response: z.object({
    items: z.array(
      z.object({
        targetType: splitTargetType,
        targetId: z.string(),
        label: z.string(),
        /** "Clients", "What you sell", "Internal" — the picker's headings. */
        group: z.string(),
      }),
    ),
  }),
});
