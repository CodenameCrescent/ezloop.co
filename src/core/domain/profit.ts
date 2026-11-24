import { REAL_STATUSES, type AccountingBasis } from "./basis";
import { addCents, allocateProportionally, mulCentsQty } from "./money";
import { isCapitalised } from "./spread";
import type { ProfitLine, ProfitTransaction } from "./types";

/**
 * THE profit ladder. This module is the only place the ladder is computed
 * (CLAUDE.md); the UI uses this vocabulary verbatim and never re-derives it.
 *
 *   Gross revenue → Net revenue → Contribution profit → True profit
 *
 * Rules baked in here:
 * - Taxes collected are pass-through, excluded from every number.
 * - Input tax you can RECLAIM is not a cost: the business is holding it for
 *   the tax authority, not spending it, so it comes back off the cost side.
 *   Input tax you cannot reclaim stays in the cost, because it really was one.
 * - Void transactions are excluded everywhere, and so are unconfirmed recurring
 *   posts (`pending`) — the owner has not agreed they happened. "Unpaid" is no
 *   longer a status: it is a null paid_at, and an unpaid bill IS profit.
 * - Which transactions arrive here, and under which date, is the caller's
 *   choice of accrual or cash basis (see ./basis). This module totals whatever
 *   it is handed; refunds subtract in whichever period the caller filed them.
 * - Fixed costs are never allocated per unit: item-level math stops at
 *   contribution profit; period expenses only enter at the True-profit step.
 */

export const LADDER_LABELS = {
  grossRevenue: {
    label: "Gross revenue",
    tooltip: "Everything customers paid you, before discounts, refunds, or costs. Taxes you collected are never counted.",
  },
  netRevenue: {
    label: "Net revenue",
    tooltip: "Gross revenue minus discounts and refunds — the money that actually stayed.",
  },
  contributionProfit: {
    label: "Contribution profit",
    tooltip: "Net revenue minus the direct costs and fees of what you sold — what your sales really contribute.",
  },
  trueProfit: {
    label: "True profit",
    tooltip: "Contribution profit minus your period expenses — what the business actually made.",
  },
} as const;

export interface ProfitLadder {
  grossRevenue: number;
  discounts: number;
  refunds: number;
  netRevenue: number;
  /**
   * What the things you sold cost you — the frozen cost snapshots on revenue
   * lines, plus their fees. Already the rung between net revenue and
   * contribution profit; it was computed here and thrown away, which left every
   * screen to infer it by subtraction or, worse, to show period expenses beside
   * total costs and let the reader assume they were the same number.
   */
  directCosts: number;
  contributionProfit: number;
  periodExpenses: number;
  trueProfit: number;
}

/**
 * The part of a transaction's input tax that is not a cost. Zero unless the
 * owner marked it reclaimable — anyone not registered to claim it back really
 * did spend that money, and for them the tax stays in the cost.
 */
export function reclaimableTaxOf(transaction: ProfitTransaction): number {
  if (!transaction.taxReclaimable) return 0;
  return transaction.taxPaidCents ?? 0;
}

/**
 * Statuses that describe a real money event. Shared with ./basis so the ladder
 * and the accrual/cash filter can never disagree about what counts.
 */
const COUNTED_STATUSES = REAL_STATUSES;

export function grossLineRevenue(line: ProfitLine): number {
  return mulCentsQty(line.unitPriceCents, line.qty);
}

/** Line total after its own discount — the weight used to share an order-level discount. */
export function lineSubtotal(line: ProfitLine): number {
  return Math.max(0, grossLineRevenue(line) - line.lineDiscountCents);
}

/** Order-level discount split across lines proportionally to their subtotals (exact sum). */
export function orderDiscountShares(orderDiscountCents: number, lines: ProfitLine[]): number[] {
  if (lines.length === 0) return [];
  return allocateProportionally(orderDiscountCents, lines.map(lineSubtotal));
}

/**
 * Money out attributable to EACH expense line, with the order discount split
 * proportionally so the parts sum exactly to the transaction's expense total.
 *
 * Every expense read path goes through this so they cannot drift: attributing a
 * whole multi-line expense transaction to its first line (the old behaviour)
 * misreported every type but one. Pass `orderDiscountCents: 0` for expense lines
 * inside a sale — there the order discount reduces the revenue side, not the
 * job cost (see computeProfitLadder).
 */
/**
 * Whether a line hands its cost to slice transactions instead of spending it here.
 *
 * Only under ACCRUAL. Accrual asks "which months does this cost belong to", and
 * the answer for a spread purchase is "the months it covers". Cash asks "when
 * did the money leave the bank", and the answer is "all of it, on the day it
 * was paid" — so under cash the purchase spends its full amount and the slices,
 * which are never paid, are already filtered out before they get here.
 *
 * Getting this wrong in the generous direction hides a real outflow from the
 * cash view, which is worse than the lumpy month the spread exists to fix.
 */
function defersToSlices(line: ProfitLine, basis: AccountingBasis): boolean {
  return basis === "accrual" && isCapitalised(line.spreadMonths);
}

/**
 * Whether a line is money that moved before the work did.
 *
 * The sibling of `defersToSlices`, and deliberately separate: both defer under
 * accrual, and they defer to different places. A spread cost is already
 * incurred and belongs to the months it covers. An advance is not incurred at
 * all — it belongs to whenever the bill finally arrives, which may be never.
 *
 * A line that is somehow both defers once, not twice into nothing: these are
 * checked with `||`, never summed.
 */
function defersUntilUsed(line: ProfitLine, basis: AccountingBasis): boolean {
  return basis === "accrual" && line.isAdvance === true;
}

/** Either reason a line hands its money to a later period. */
function deferred(line: ProfitLine, basis: AccountingBasis): boolean {
  return defersToSlices(line, basis) || defersUntilUsed(line, basis);
}

export function expenseLineSpends(
  lines: ProfitLine[],
  orderDiscountCents = 0,
  basis: AccountingBasis = "accrual",
): number[] {
  if (lines.length === 0) return [];
  const shares = orderDiscountShares(orderDiscountCents, lines);
  // A capitalised line spends nothing in this period — its slice transactions
  // do, and they carry the same item and category. Zeroing it HERE rather than
  // at each call site is what keeps the category and expense-type breakdowns
  // agreeing with the ladder instead of each remembering the rule separately.
  return lines.map((line, i) => (deferred(line, basis) ? 0 : lineSubtotal(line) - shares[i]));
}

/**
 * Per-line GROSS revenue for a period, with deposits taken out.
 *
 * The sibling of `expenseLineSpends`, and here for the identical reason: a
 * deposit taken is cash in and not revenue yet (`computeProfitLadder` skips it),
 * so any breakdown that adds `grossLineRevenue` itself reports more revenue than
 * the rung it claims to explain. Zeroing it HERE rather than at each call site
 * is what keeps the type, category and source breakdowns agreeing with the
 * ladder instead of each remembering the rule separately.
 *
 * Only `defersUntilUsed` applies. A spread cost is an expense-side idea — a
 * revenue line is never capitalised — so `deferred` would be the wrong test and
 * would read as though it could be.
 */
export function revenueLineGross(
  lines: ProfitLine[],
  basis: AccountingBasis = "accrual",
): number[] {
  return lines.map((line) => (defersUntilUsed(line, basis) ? 0 : grossLineRevenue(line)));
}

export function netLineRevenue(line: ProfitLine, orderDiscountShareCents = 0): number {
  return grossLineRevenue(line) - line.lineDiscountCents - orderDiscountShareCents;
}

/** Direct cost of a line from its FROZEN snapshot — catalog edits never reach here. */
export function lineCostTotal(line: ProfitLine): number {
  if (!line.costSnapshot) return 0;
  return mulCentsQty(line.costSnapshot.total_per_unit_cents, line.qty);
}

export function contributionProfitForLine(line: ProfitLine, orderDiscountShareCents = 0): number {
  return netLineRevenue(line, orderDiscountShareCents) - lineCostTotal(line);
}

/**
 * Period aggregates over a set of transactions (already filtered to the
 * period). Sales add; refund/chargeback transactions subtract (their recovered
 * costs/fees ride in the refund lines' snapshots, written by buildRefund);
 * plain out-transactions are period expenses; fee lines on adjustment
 * transactions (e.g. "Chargeback fee") are period expenses too.
 */
export function computeProfitLadder(
  transactions: ProfitTransaction[],
  basis: AccountingBasis = "accrual",
): ProfitLadder {
  let grossRevenue = 0;
  let discounts = 0;
  let refunds = 0;
  let directCosts = 0;
  let periodExpenses = 0;

  for (const transaction of transactions) {
    if (!COUNTED_STATUSES.has(transaction.status)) continue;

    const isAdjustment = transaction.adjustmentType !== null && transaction.adjustmentType !== undefined;

    if (isAdjustment) {
      for (const line of transaction.lines) {
        const amount = addCents(grossLineRevenue(line), -line.lineDiscountCents);
        if (line.refundedLineId) {
          refunds = addCents(refunds, amount);
          // Recovered costs/fees (restocked goods, refunded platform fees)
          // reduce the period's direct costs.
          directCosts = addCents(directCosts, -lineCostTotal(line));
        } else {
          // e.g. the chargeback fee — money out that reverses no sale line.
          periodExpenses = addCents(periodExpenses, amount);
        }
      }
      continue;
    }

    // Classify EACH line by its own direction so one transaction can carry both
    // revenue and expense lines. An expense line inside a sale is a direct
    // "cost of that job" (contribution level); a standalone expense transaction
    // is a period expense (True-profit level).
    const dirOf = (line: ProfitLine) => line.direction ?? transaction.direction;
    const hasRevenue = transaction.lines.some((line) => dirOf(line) === "in");

    for (const line of transaction.lines) {
      if (dirOf(line) === "in") {
        // A DEPOSIT TAKEN is cash in and not revenue yet. Counting it would let
        // a business book a year of deposits as a record year and only then
        // discover the work still has to be done.
        if (defersUntilUsed(line, basis)) continue;
        grossRevenue = addCents(grossRevenue, grossLineRevenue(line));
        discounts = addCents(discounts, line.lineDiscountCents);
        directCosts = addCents(directCosts, lineCostTotal(line));
      } else if (hasRevenue) {
        // Cost of the job → contribution level.
        directCosts = addCents(directCosts, lineSubtotal(line));
      } else if (deferred(line, basis)) {
        // Two reasons a standalone cost contributes nothing to this period.
        //
        // CAPITALISED: it belongs to the months it covers, not the month it was
        // paid in — the generated slices carry it and sum back to exactly this
        // amount, so counting both would double it (spread.ts).
        //
        // AN ADVANCE: it has not been incurred at all yet. Charging it here
        // reports a loss in a month where no work happened, and leaves the
        // month the work does happen looking better than it was (advances.ts).
        continue;
      } else {
        // Standalone operating expense → period expense.
        periodExpenses = addCents(periodExpenses, lineSubtotal(line));
      }
    }

    if (hasRevenue) {
      // Shipping is revenue; the order discount reduces the revenue side only.
      grossRevenue = addCents(grossRevenue, transaction.shippingChargedCents);
      discounts = addCents(discounts, transaction.orderDiscountCents);
    } else {
      // Expense-only: keep today's rule that an order discount reduces spend.
      periodExpenses = addCents(periodExpenses, -transaction.orderDiscountCents);
    }

    // Reclaimable input tax was never really spent, so take it back off the
    // cost side — the same side the spend landed on, so the two cancel: a job's
    // materials reduce that job's contribution, a standalone bill reduces the
    // period's expenses.
    const reclaimable = reclaimableTaxOf(transaction);
    if (reclaimable > 0) {
      if (hasRevenue) directCosts = addCents(directCosts, -reclaimable);
      else periodExpenses = addCents(periodExpenses, -reclaimable);
    }
  }

  const netRevenue = grossRevenue - discounts - refunds;
  const contributionProfit = netRevenue - directCosts;
  const trueProfit = contributionProfit - periodExpenses;

  return { grossRevenue, discounts, refunds, netRevenue, directCosts, contributionProfit, periodExpenses, trueProfit };
}
