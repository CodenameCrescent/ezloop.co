import Decimal from "decimal.js";
import type { Cents } from "./money";

/**
 * Break-even: how much you must sell before the month stops costing you money.
 *
 * THE ONE PLACE this is computed. The UI renders what comes out of here and
 * never re-derives it, exactly as it never re-derives the profit ladder.
 *
 * ── Why the textbook formula is wrong here ──────────────────────────────────
 *
 * The usual formula is `fixed costs ÷ contribution margin`. That silently
 * assumes every cost is either a direct cost of a sale or a fixed overhead.
 * This app's ladder has a third place money sits: PERIOD EXPENSES, which arrive
 * below contribution profit and contain both kinds mixed together. Ad spend is
 * a period expense and grows with sales; rent is a period expense and does not.
 *
 * Feeding all period expenses in as "fixed" would overstate the target; feeding
 * only the fixed ones in and stopping there would ignore that ads have to be
 * paid for too. So variable period expenses are moved UP, into the margin:
 *
 *     margin ratio r = (contribution profit − variable expenses) ÷ net revenue
 *     break-even revenue = fixed expenses ÷ r
 *
 * That reconciles to the ladder exactly. With net revenue N, contribution C,
 * variable expenses V and fixed expenses F:
 *
 *     true profit = C − (V + F)          (the ladder)
 *                 = rN − F               (this module)
 *
 * so true profit is zero precisely at N = F ÷ r. `breakEvenReconciles` below is
 * the executable statement of that, and the tests assert it on real shapes.
 */

const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

/** The period's money, already summed by the caller from the ledger. */
export interface BreakEvenInput {
  netRevenueCents: Cents;
  contributionProfitCents: Cents;
  /** Period expenses whose item is fixed (or semi-variable — see costNature). */
  fixedExpensesCents: Cents;
  /** Period expenses that grow with sales, plus everything unclassified. */
  variableExpensesCents: Cents;
}

/** Optional volume, so the answer can also be said in sales and in units. */
export interface BreakEvenVolume {
  /** Transactions in the period that earned revenue. */
  revenueTransactionCount: number;
  /** Total quantity sold, as a decimal string (quantities are never floats). */
  unitsSold: string;
  /**
   * What that quantity is counted in — but ONLY when the whole period was sold
   * in one unit. Null when the period mixes units, because "7 units" made of
   * mugs, hours and months is seven of nothing. The caller decides; this just
   * refuses to print a number that cannot be read.
   */
  unitLabel?: string | null;
}

/**
 * Why a break-even number is or isn't available. The UI picks its sentence from
 * this rather than inferring one from nulls.
 */
export type BreakEvenReason =
  /** A real target was computed. */
  | "ok"
  /** No fixed costs in the period, so the first sale is already ahead. */
  | "no_fixed_costs"
  /** No sales in the period — nothing to measure a margin against. */
  | "no_sales"
  /** Sales cost more than they bring in; no amount of revenue covers the fixed costs. */
  | "no_margin";

export interface BreakEven {
  fixedExpensesCents: Cents;
  variableExpensesCents: Cents;
  /** What sales leave toward fixed costs once the costs that scale are paid. */
  contributionAfterVariableCents: Cents;
  /** That figure as a share of net revenue, 0–100. Null when there were no sales. */
  contributionMarginPct: number | null;
  /** Net revenue needed to reach zero true profit. Null unless reason is "ok"/"no_fixed_costs". */
  breakEvenRevenueCents: Cents | null;
  /** Revenue-earning transactions needed at the period's average sale size. */
  breakEvenTransactions: number | null;
  /** Units needed at the period's average revenue per unit. Null when the period mixes units. */
  breakEvenUnits: number | null;
  /** What the unit count above is counted in. Null whenever that count is null. */
  breakEvenUnitLabel: string | null;
  /** Net revenue minus the target. Positive means the period is past break-even. */
  surplusCents: Cents | null;
  /** How far through the target the period got, 0–100 (uncapped above 100). */
  coveredPct: number | null;
  reason: BreakEvenReason;
}

function assertCents(value: number, field: string): void {
  if (!Number.isSafeInteger(value)) {
    throw new TypeError(`computeBreakEven: ${field} must be integer minor units, got ${value}`);
  }
}

function pct(part: Decimal, whole: Decimal): number {
  return Number(part.div(whole).times(100).toDecimalPlaces(1, Decimal.ROUND_HALF_UP));
}

export function computeBreakEven(input: BreakEvenInput, volume?: BreakEvenVolume): BreakEven {
  assertCents(input.netRevenueCents, "netRevenueCents");
  assertCents(input.contributionProfitCents, "contributionProfitCents");
  assertCents(input.fixedExpensesCents, "fixedExpensesCents");
  assertCents(input.variableExpensesCents, "variableExpensesCents");

  const netRevenue = new D(input.netRevenueCents);
  const fixed = new D(input.fixedExpensesCents);
  const contributionAfterVariableCents = input.contributionProfitCents - input.variableExpensesCents;
  const contributionAfterVariable = new D(contributionAfterVariableCents);

  const base = {
    fixedExpensesCents: input.fixedExpensesCents,
    variableExpensesCents: input.variableExpensesCents,
    contributionAfterVariableCents,
  };
  const noAnswer = {
    breakEvenRevenueCents: null,
    breakEvenTransactions: null,
    breakEvenUnits: null,
    breakEvenUnitLabel: null,
    surplusCents: null,
    coveredPct: null,
  };

  const hasSales = netRevenue.greaterThan(0);
  const contributionMarginPct = hasSales ? pct(contributionAfterVariable, netRevenue) : null;

  // The three checks are ordered by what each one would make the others mean.

  // Without sales there is no measured margin, so there is no honest way to say
  // how much revenue would cover anything — including when nothing is owed.
  if (!hasSales) return { ...base, contributionMarginPct, ...noAnswer, reason: "no_sales" };

  // Each sale loses money once the costs that scale with it are paid, so no
  // volume of sales ever reaches the fixed costs. Selling MORE makes this
  // worse, and any number here would imply the opposite. Checked before the
  // fixed-costs shortcut: with no fixed costs the arithmetic would otherwise
  // answer "break even at zero revenue", i.e. stop trading.
  if (contributionAfterVariable.lessThanOrEqualTo(0)) {
    return { ...base, contributionMarginPct, ...noAnswer, reason: "no_margin" };
  }

  // Nothing standing to be covered — every sale is already profit.
  if (input.fixedExpensesCents <= 0) {
    return {
      ...base,
      contributionMarginPct,
      breakEvenRevenueCents: 0,
      breakEvenTransactions: 0,
      breakEvenUnits: 0,
      breakEvenUnitLabel: null,
      surplusCents: input.netRevenueCents,
      coveredPct: 100,
      reason: "no_fixed_costs",
    };
  }

  // revenue = fixed ÷ r, with r = contributionAfterVariable ÷ netRevenue.
  const breakEvenRevenue = fixed.times(netRevenue).div(contributionAfterVariable);
  const breakEvenRevenueCents = Number(breakEvenRevenue.toDecimalPlaces(0, Decimal.ROUND_UP));

  // Volume at the period's own average sale size and average revenue per unit.
  // Rounded UP: a fraction of a sale does not pay a bill.
  let breakEvenTransactions: number | null = null;
  let breakEvenUnits: number | null = null;
  let breakEvenUnitLabel: string | null = null;
  if (volume) {
    if (volume.revenueTransactionCount > 0) {
      breakEvenTransactions = Number(
        breakEvenRevenue.times(volume.revenueTransactionCount).div(netRevenue).toDecimalPlaces(0, Decimal.ROUND_UP),
      );
    }
    const units = new D(volume.unitsSold);
    // A unit count is only meaningful when everything sold shares one unit.
    if (units.greaterThan(0) && volume.unitLabel) {
      breakEvenUnits = Number(breakEvenRevenue.times(units).div(netRevenue).toDecimalPlaces(0, Decimal.ROUND_UP));
      breakEvenUnitLabel = volume.unitLabel;
    }
  }

  return {
    ...base,
    contributionMarginPct,
    breakEvenRevenueCents,
    breakEvenTransactions,
    breakEvenUnits,
    breakEvenUnitLabel,
    surplusCents: input.netRevenueCents - breakEvenRevenueCents,
    coveredPct: pct(netRevenue, breakEvenRevenue),
    reason: "ok",
  };
}

/**
 * Revenue needed to reach a chosen profit, not merely to survive. Same margin,
 * with the target treated as one more fixed cost to cover.
 */
export function revenueForTargetProfit(input: BreakEvenInput, targetProfitCents: Cents): Cents | null {
  assertCents(targetProfitCents, "targetProfitCents");
  const withTarget = { ...input, fixedExpensesCents: input.fixedExpensesCents + targetProfitCents };
  const result = computeBreakEven(withTarget);
  return result.breakEvenRevenueCents;
}

/**
 * The reconciliation contract, executable: at exactly the break-even revenue,
 * the ladder's own true-profit arithmetic must land on zero.
 *
 * Exported so the server can assert it against live data, the same way the
 * drivers axis is asserted to sum to true profit.
 */
export function breakEvenReconciles(input: BreakEvenInput, result: BreakEven): boolean {
  if (result.reason !== "ok" || result.breakEvenRevenueCents === null) return true;
  const ratio = new D(result.contributionAfterVariableCents).div(input.netRevenueCents);
  const projectedTrueProfit = new D(result.breakEvenRevenueCents).times(ratio).minus(input.fixedExpensesCents);
  // Break-even revenue is rounded up to whole cents, so the landing point is
  // zero or a hair above it — never below, which would mean a target that
  // doesn't actually clear the fixed costs.
  return projectedTrueProfit.greaterThanOrEqualTo(-1) && projectedTrueProfit.lessThanOrEqualTo(1);
}
