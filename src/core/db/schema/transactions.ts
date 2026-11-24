import {
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { businessesTable } from "./businesses";
import { categoriesTable } from "./categories";
import { expenseItemsTable } from "./expenseItems";
import { importBatchesTable } from "./imports";
import { peopleTable } from "./people";
import { revenueItemsTable } from "./revenueItems";
import { sourcesTable } from "./sources";

export const transactionDirectionValues = ["in", "out"] as const;
export type TransactionDirection = (typeof transactionDirectionValues)[number];

export const transactionStatusValues = [
  "pending",
  "completed",
  "refunded",
  "partially_refunded",
  "void",
  "disputed",
] as const;
export type TransactionStatus = (typeof transactionStatusValues)[number];

export const transactionOriginValues = ["manual", "integration", "recurring_engine", "import"] as const;
export type TransactionOrigin = (typeof transactionOriginValues)[number];

export const adjustmentTypeValues = ["refund", "chargeback", "correction"] as const;
export type AdjustmentType = (typeof adjustmentTypeValues)[number];

/**
 * Ledger header — the single source of truth for every money event.
 * APPEND-ONLY: refunds/chargebacks/corrections are NEW transactions carrying
 * parent_transaction_id; voiding is a status change; rows are never
 * hard-deleted (CLAUDE.md).
 */
export const transactionsTable = pgTable(
  "transactions",
  {
    id: text("id").primaryKey(),
    businessId: text("business_id")
      .notNull()
      .references(() => businessesTable.id),
    direction: text("direction").notNull(),
    /**
     * When the money event HAPPENED — the accrual date. A July bill belongs to
     * July's profit even if it is paid in August.
     */
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    /**
     * When the cash actually moved. NULL = not paid yet, which is what makes a
     * row a receivable or a bill outstanding.
     *
     * This is why `status` no longer answers "is it paid": it was carrying two
     * unrelated meanings, "unpaid" and "a recurring post the owner has not
     * confirmed happened". Paid-ness lives here; `status` keeps the lifecycle.
     */
    paidAt: timestamp("paid_at", { withTimezone: true }),
    /**
     * When it was AGREED the money would move. Null means no date was agreed,
     * which is not the same as "due now" — see `lib/domain/owed.ts`. Nothing
     * without a due date can ever be reported as late, because there is no
     * agreement for it to be late against.
     *
     * A `date`, not a timestamp: terms are agreed in days ("net 30"), and giving
     * a deadline a time of day would make it late at an hour nobody chose.
     */
    dueDate: date("due_date"),
    sourceId: text("source_id")
      .notNull()
      .references(() => sourcesTable.id),
    personId: text("person_id").references(() => peopleTable.id),
    status: text("status").notNull().default("completed"),
    /** The currency the amounts on this transaction are actually in. */
    currency: text("currency").notNull().default("PKR"),
    /**
     * Decimal string: multiply an amount in `currency` by this to get the
     * business's base currency. FROZEN at write time, exactly like a cost
     * snapshot — tomorrow's rate must never move yesterday's profit.
     */
    fxRateToBase: text("fx_rate_to_base").notNull().default("1"),
    /**
     * Set when the owner TYPED this entry in another currency and it was
     * converted into base on save (`convertEntryToBase`). Every amount on the
     * row is already base; these only remember what was typed, for display.
     * Distinct from `currency`/`fx_rate_to_base`, which mean the stored amounts
     * themselves are foreign. All three are set together or not at all.
     */
    enteredCurrency: text("entered_currency"),
    /** Decimal string, base per one unit of `entered_currency`. Frozen. */
    enteredFxRate: text("entered_fx_rate"),
    /** The entry's amount as typed, in `entered_currency` minor units. */
    enteredAmountCents: bigint("entered_amount_cents", { mode: "number" }),
    origin: text("origin").notNull().default("manual"),
    externalRef: text("external_ref"),
    /**
     * Owner-facing invoice/receipt number. Deliberately NON-unique and separate
     * from external_ref (whose partial-unique index is reserved for integration
     * dedupe) — repeating an invoice number must never throw.
     */
    referenceNumber: text("reference_number"),
    parentTransactionId: text("parent_transaction_id").references(
      (): AnyPgColumn => transactionsTable.id,
    ),
    adjustmentType: text("adjustment_type"),
    orderDiscountCents: bigint("order_discount_cents", { mode: "number" }).notNull().default(0),
    discountCode: text("discount_code"),
    shippingChargedCents: bigint("shipping_charged_cents", { mode: "number" }).notNull().default(0),
    /** Taxes collected are NOT revenue — excluded from every revenue/profit number. */
    taxCollectedCents: bigint("tax_collected_cents", { mode: "number" }).notNull().default(0),
    /**
     * Input tax PAID inside this transaction's amounts (GST/VAT on a purchase).
     * The counterpart to tax_collected_cents, which is tax charged to customers.
     */
    taxPaidCents: bigint("tax_paid_cents", { mode: "number" }).notNull().default(0),
    /**
     * True when that input tax can be claimed back from the tax authority. Then
     * it is not a cost — the business is holding it, not spending it — and the
     * profit ladder removes it. False (the default) leaves it in the cost, which
     * is correct for anyone not registered to reclaim.
     */
    taxReclaimable: boolean("tax_reclaimable").notNull().default(false),
    notes: text("notes"),
    /** Set when this row arrived from a CSV import; drives undo. */
    importBatchId: text("import_batch_id").references(() => importBatchesTable.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Integration dedupe from day one.
    uniqueIndex("transactions_source_external_ref_uq")
      .on(t.sourceId, t.externalRef)
      .where(sql`${t.externalRef} IS NOT NULL`),
    index("transactions_business_occurred_idx").on(t.businessId, t.occurredAt),
    // Cash-basis reads filter on paid_at the way accrual reads filter occurred_at.
    index("transactions_business_paid_idx").on(t.businessId, t.paidAt),
    // The owed lists read exactly this shape: unpaid rows, oldest deadline
    // first. Partial, because a settled transaction is never on them.
    index("transactions_business_due_idx")
      .on(t.businessId, t.dueDate)
      .where(sql`${t.paidAt} IS NULL`),
    index("transactions_business_source_occurred_idx").on(t.businessId, t.sourceId, t.occurredAt),
    index("transactions_parent_idx").on(t.parentTransactionId),
    index("transactions_import_batch_idx").on(t.importBatchId),
  ],
);

export type Transaction = typeof transactionsTable.$inferSelect;

/**
 * Ledger line. May link a catalog item OR carry only a label (fast one-off
 * entry, zero catalog setup). cost_snapshot freezes the item's effective
 * CostComponents at line creation; all profit math reads snapshots forever.
 */
export const transactionLinesTable = pgTable(
  "transaction_lines",
  {
    id: text("id").primaryKey(),
    transactionId: text("transaction_id")
      .notNull()
      .references(() => transactionsTable.id),
    /**
     * Per-line money direction ("in" = revenue, "out" = expense/cost). Lets ONE
     * transaction carry both revenue and expense lines (a job you're paid for
     * AND buy materials for). Insights classify per line, never per header.
     */
    direction: text("direction").notNull(),
    revenueItemId: text("revenue_item_id").references(() => revenueItemsTable.id),
    expenseItemId: text("expense_item_id").references(() => expenseItemsTable.id),
    label: text("label"),
    categoryId: text("category_id").references(() => categoriesTable.id),
    /** Decimal string quantity, e.g. "1", "2.5". */
    qty: text("qty").notNull().default("1"),
    /**
     * What that quantity is COUNTED IN, frozen at write time from the item's
     * `unit_label` — "hour", "unit", "month". Null for a label-only line, which
     * counts nothing in particular.
     *
     * Frozen rather than resolved on read, for the same reason cost snapshots
     * are: renaming an item's unit from "hour" to "day" must not silently
     * restate what past sales were sold in.
     */
    unitLabel: text("unit_label"),
    unitPriceCents: bigint("unit_price_cents", { mode: "number" }).notNull(),
    lineDiscountCents: bigint("line_discount_cents", { mode: "number" }).notNull().default(0),
    /** { version: 1, components: [{name, calc, input, per_unit_cents, kind}], total_per_unit_cents } */
    costSnapshot: jsonb("cost_snapshot"),
    refundedLineId: text("refunded_line_id").references((): AnyPgColumn => transactionLinesTable.id),
    restocked: boolean("restocked"),
    feesRecovered: boolean("fees_recovered"),
    /**
     * What this line was FOR — a client, a revenue item, an internal category,
     * or a project.
     *
     * Exactly ONE target, no splits or percentages: a split is N lines, each
     * with its own target. It lives on the line rather than the header because
     * the ledger already attributes multi-line receipts per line, and one
     * receipt can legitimately cover two clients. Distinct from `category_id`,
     * which stays a grouping label and is never a target.
     *
     * ── Which lines may carry one ───────────────────────────────────────────
     *
     * COST lines: any target. That is what "who was this bill for" means.
     *
     * REVENUE lines: a PROJECT and nothing else, enforced by the CHECK below.
     * A revenue line cannot be "for a client" — the transaction already carries
     * `person_id` — and it cannot be "for a revenue item", because it IS one.
     * A project is the only target a sale can meaningfully belong to, and it has
     * to be able to, or a project could show its costs and never its earnings.
     *
     * This adds no new money path either way: a targeted line is an ordinary
     * line that also says what it was for.
     */
    targetType: text("target_type"),
    targetId: text("target_id"),
    /**
     * Spread this line's cost over N months instead of landing it whole.
     *
     * Set on the ORIGINAL purchase line, which then counts as CAPITALISED: it
     * contributes nothing to that month's expenses, and N generated slice
     * transactions (each carrying `parent_transaction_id` back to here) carry
     * the cost across the months it covers.
     *
     * The purchase itself keeps its real amount and its real dates, so the
     * cash-basis view still says "Rs 95,000 left the bank in April" while the
     * accrual view says "this costs you Rs 3,958 a month for two years". Both
     * are true; they are answering different questions.
     *
     * Null or 1 means an ordinary expense. Slices themselves never carry it.
     */
    spreadMonths: integer("spread_months"),
    /**
     * Money that moved BEFORE the work did — an advance paid to a
     * subcontractor, a deposit taken from a customer.
     *
     * Real cash, and not yet earned or consumed. Spends nothing under accrual
     * and everything under cash, which is the same shape as `spread_months` and
     * a different meaning: a spread cost has been incurred and belongs to later
     * months, an advance has not been incurred at all.
     *
     * It ends through `payment_applications`, which say how much of it settles
     * a real bill when one finally arrives. See `lib/domain/advances.ts`.
     */
    isAdvance: boolean("is_advance").notNull().default(false),
    /**
     * How much of what was bought never made it into the work.
     *
     * INFORMATION, NEVER MONEY. You already paid for the 200 bags; the 12 that
     * were ruined are a slice of a cost the ledger already holds, not an extra
     * one. Nothing derived from this column is ever added to a total — see
     * `lib/domain/waste.ts`, which carries that rule in its header.
     *
     * A decimal string like every other quantity here, and never larger than
     * `qty`: wasting more than you bought is a typo, not a fact.
     */
    wastedQty: text("wasted_qty"),
    /** Reserved for the attribution engine — no logic yet. */
    attributedCampaignId: text("attributed_campaign_id"),
    attributionMethod: text("attribution_method"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("transaction_lines_transaction_idx").on(t.transactionId),
    index("transaction_lines_revenue_item_idx").on(t.revenueItemId),
    index("transaction_lines_expense_item_idx").on(t.expenseItemId),
    // A line links at most one catalog item, and unlinked lines must carry a label.
    check(
      "transaction_lines_one_item_check",
      sql`NOT (revenue_item_id IS NOT NULL AND expense_item_id IS NOT NULL)`,
    ),
    check(
      "transaction_lines_label_check",
      sql`revenue_item_id IS NOT NULL OR expense_item_id IS NOT NULL OR refunded_line_id IS NOT NULL OR label IS NOT NULL`,
    ),
    // Line kind must agree with its direction: revenue lines never link an
    // expense item, expense lines never link a revenue item. Label-only and
    // refund lines (both FKs null) satisfy either direction.
    check(
      "transaction_lines_direction_item_check",
      sql`(direction = 'in' AND expense_item_id IS NULL) OR (direction = 'out' AND revenue_item_id IS NULL)`,
    ),
    // A sale may belong to a project and to nothing else. "For a client" is
    // already the transaction's person, and "for a revenue item" is what the
    // line is. Enforced here so no write path can invent a third meaning.
    check(
      "transaction_lines_revenue_target_check",
      sql`direction = 'out' OR target_type IS NULL OR target_type = 'project'`,
    ),
  ],
);

export type TransactionLine = typeof transactionLinesTable.$inferSelect;
