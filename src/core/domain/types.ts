/**
 * Domain-owned shapes. Structurally compatible with the DB rows in
 * lib/db/src/schema, but defined here so this package stays pure — the server
 * maps Drizzle rows into these; the domain never imports Drizzle.
 */

export type CostCalcType = "fixed_per_unit" | "percent_of_price" | "percent_of_subtotal";
export type ComponentKind = "fee" | "cost";
export type TransactionDirection = "in" | "out";
export type TransactionStatus =
  | "pending"
  | "completed"
  | "refunded"
  | "partially_refunded"
  | "void"
  | "disputed";
export type AdjustmentType = "refund" | "chargeback" | "correction";

/** An effective-dated cost/fee definition, as stored on the catalog. */
export interface CostComponentInput {
  name: string;
  calcType: CostCalcType;
  /** Set iff calcType = fixed_per_unit. */
  valueCents: number | null;
  /** Decimal string of percentage points (e.g. "20" = 20%); set iff calcType is a percent type. */
  valueRate: string | null;
  /** Null = kind follows the calc-type default (percent → fee, fixed → cost). */
  isFee?: boolean | null;
  /** Null = applies to every source; set = only to sales from that source. */
  sourceId: string | null;
  effectiveFrom: Date | string;
  effectiveTo: Date | string | null;
}

export interface SnapshotComponent {
  name: string;
  calc: CostCalcType;
  /** The raw input the resolution used: cents (fixed) or rate string (percent). */
  input: string;
  per_unit_cents: number;
  kind: ComponentKind;
}

/**
 * Frozen at line creation; all profit math reads this forever. Editing catalog
 * costs never changes historical profit (CLAUDE.md).
 */
export interface CostSnapshot {
  version: 1;
  components: SnapshotComponent[];
  total_per_unit_cents: number;
  /** On refund lines: the decimal-string qty the recovered amounts correspond to. */
  qty_basis?: string;
}

/** The line shape profit math needs — a subset of the DB row. */
export interface ProfitLine {
  /**
   * Per-line direction. "in" = revenue, "out" = expense/cost. Optional for
   * back-compat: when absent, the ladder falls back to the header direction.
   */
  direction?: TransactionDirection;
  /** Decimal string quantity. */
  qty: string;
  unitPriceCents: number;
  lineDiscountCents: number;
  costSnapshot: CostSnapshot | null;
  /** Set on refund/chargeback lines: which original line this reverses. */
  refundedLineId?: string | null;
  restocked?: boolean | null;
  feesRecovered?: boolean | null;
  /**
   * Spread over N months: this line is CAPITALISED and contributes nothing to
   * the period it sits in. The generated slice transactions carry the cost
   * instead, and sum back to exactly this amount. See spread.ts.
   */
  spreadMonths?: number | null;
  /**
   * Money that moved BEFORE the work did: an advance to a subcontractor, a
   * deposit taken from a customer. Real cash, and not yet earned or consumed.
   *
   * Spends nothing under accrual and everything under cash — the same shape as
   * `spreadMonths`, and different in what it means: a spread cost has been
   * incurred and belongs to later months, an advance has not been incurred at
   * all. See advances.ts.
   */
  isAdvance?: boolean | null;
}

/** The header shape profit math needs — a subset of the DB row. */
export interface ProfitTransaction {
  direction: TransactionDirection;
  status: TransactionStatus;
  adjustmentType?: AdjustmentType | null;
  orderDiscountCents: number;
  shippingChargedCents: number;
  /** Excluded from every revenue/profit number — pass-through money. */
  taxCollectedCents: number;
  /** Input tax paid inside these amounts (GST/VAT on a purchase). */
  taxPaidCents?: number;
  /** True when that input tax is claimable back, and so is not a cost. */
  taxReclaimable?: boolean;
  lines: ProfitLine[];
}
