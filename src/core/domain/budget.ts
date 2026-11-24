import Decimal from "decimal.js";
import { allocateProportionally, assertCents, type Cents } from "./money";

/**
 * Budgets: what you planned, against what actually happened.
 *
 * THE ONE PLACE this is computed, the way the ladder lives in profit.ts.
 *
 * ── What this replaces, and why it had to go ────────────────────────────────
 *
 * The old budget stored six fixed categories in a settings blob and worked out
 * "actual spend" by SEARCHING EXPENSE NAMES FOR WORDS — "rent", "salary",
 * "warehouse", "courier". Three things were wrong with that, in rising order of
 * seriousness. It could not be extended, because the six were hardcoded. It
 * matched wrongly, because "Rent" also claims "Equipment rental". And worst, the
 * money it failed to match simply VANISHED from the comparison: a business could
 * be far over its real spending while every line on the page read comfortably
 * under, and nothing on the screen would say so.
 *
 * So: matching is by FOREIGN KEY, a label match is exact, and everything that
 * matches nothing goes into a bucket that is shown. `budgetReconciles` states
 * that as a property a test can assert.
 *
 * ── What a budget line may claim ────────────────────────────────────────────
 *
 * An expense item, a revenue item, a category, or an exact label — most
 * specific first. The order matters: a cost that is both "Cement" (the item) and
 * "Materials" (the category) belongs to whichever the owner named more
 * precisely, and without a rule it would land in whichever line happened to come
 * first.
 */

export type BudgetSide = "in" | "out";
export type BudgetBasis = "total" | "per_month";

/** What a budget line claims. Ordered here most specific to least. */
export type BudgetMatchKind = "expense_item" | "revenue_item" | "category" | "label";

const MATCH_PRECEDENCE: BudgetMatchKind[] = ["expense_item", "revenue_item", "category", "label"];

export interface BudgetMatch {
  kind: BudgetMatchKind;
  /** An id for the three key kinds; the exact text for a label. */
  value: string;
}

export interface BudgetLineInput {
  id: string;
  side: BudgetSide;
  match: BudgetMatch;
  amountCents: Cents;
  /** `per_month` multiplies across the span; `total` is the span's whole figure. */
  basis: BudgetBasis;
}

/** One line of real money from the ledger, already summed to its own amount. */
export interface LedgerAmount {
  side: BudgetSide;
  amountCents: Cents;
  expenseItemId: string | null;
  revenueItemId: string | null;
  categoryId: string | null;
  label: string | null;
}

export interface BudgetInput {
  /** Whole calendar months the budget covers. At least 1. */
  months: number;
  lines: BudgetLineInput[];
  actuals: LedgerAmount[];
}

export interface BudgetRow extends BudgetLineInput {
  /** The line's amount for the WHOLE span, after applying its basis. */
  budgetedCents: Cents;
  actualCents: Cents;
  /** What is left. Never negative — you cannot have less than none of a budget. */
  remainingCents: Cents;
  /** How far past the budget, when past it. Zero otherwise. */
  overByCents: Cents;
  /** 0–100 and beyond. NULL when nothing was budgeted — there is nothing to be a share of. */
  pctUsed: number | null;
  over: boolean;
}

export interface BudgetSideTotals {
  budgetedCents: Cents;
  actualCents: Cents;
}

export interface BudgetResult {
  rows: BudgetRow[];
  totals: Record<BudgetSide, BudgetSideTotals>;
  /** Real money that no budget line claimed. Shown, never dropped. */
  unbudgetedCents: Record<BudgetSide, Cents>;
  unbudgetedCount: number;
}

/** Whole calendar months a span covers, counting both ends. */
export function monthsInSpan(startDate: string, endDate: string): number {
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  const months =
    (end.getUTCFullYear() - start.getUTCFullYear()) * 12 + (end.getUTCMonth() - start.getUTCMonth()) + 1;
  return Math.max(1, months);
}

/**
 * A span's total split into per-month caps that add back to it EXACTLY.
 *
 * The same largest-remainder allocator the order discount and the spread
 * schedule use, for the same reason: twelve caps of "a twelfth" do not sum to
 * the figure the owner typed, and a budget that disagrees with itself by two
 * paisa is a budget nobody trusts.
 */
export function monthlySchedule(totalCents: Cents, months: number): Cents[] {
  assertCents(totalCents, "monthlySchedule");
  if (months < 1) throw new RangeError("monthlySchedule: a budget covers at least one month");
  return allocateProportionally(totalCents, Array.from({ length: months }, () => 1));
}

/** What a line budgets across the whole span. */
function budgetedForSpan(line: BudgetLineInput, months: number): Cents {
  return line.basis === "per_month" ? line.amountCents * months : line.amountCents;
}

/** The value on a ledger amount that a given match kind would compare against. */
function ledgerKeyFor(amount: LedgerAmount, kind: BudgetMatchKind): string | null {
  switch (kind) {
    case "expense_item":
      return amount.expenseItemId;
    case "revenue_item":
      return amount.revenueItemId;
    case "category":
      return amount.categoryId;
    case "label":
      return amount.label;
  }
}

/**
 * Which budget line claims this money, or null.
 *
 * Most specific wins, and a label is compared EXACTLY — the old budget searched
 * names for words, which is how "Rent" came to swallow "Equipment rental".
 */
export function matchBudgetLine(amount: LedgerAmount, lines: BudgetLineInput[]): string | null {
  for (const kind of MATCH_PRECEDENCE) {
    const key = ledgerKeyFor(amount, kind);
    if (key === null) continue;
    const found = lines.find(
      (line) => line.side === amount.side && line.match.kind === kind && line.match.value === key,
    );
    if (found) return found.id;
  }
  return null;
}

function matchKey(line: BudgetLineInput): string {
  return `${line.side}:${line.match.kind}:${line.match.value}`;
}

export function computeBudget(input: BudgetInput): BudgetResult {
  /**
   * Two lines claiming the same thing is refused rather than resolved.
   *
   * Counting the money twice overstates spending; picking one silently leaves
   * the other reading Rs 0 for no visible reason. Both are worse than saying so.
   */
  const seen = new Set<string>();
  for (const line of input.lines) {
    assertCents(line.amountCents, `budget line ${line.id}`);
    const key = matchKey(line);
    if (seen.has(key)) {
      throw new RangeError(`computeBudget: two budget lines both claim ${key}`);
    }
    seen.add(key);
  }

  const actualById = new Map<string, Cents>(input.lines.map((line) => [line.id, 0]));
  const unbudgetedCents: Record<BudgetSide, Cents> = { in: 0, out: 0 };
  let unbudgetedCount = 0;

  for (const amount of input.actuals) {
    const id = matchBudgetLine(amount, input.lines);
    if (id === null) {
      unbudgetedCents[amount.side] += amount.amountCents;
      unbudgetedCount += 1;
      continue;
    }
    actualById.set(id, (actualById.get(id) ?? 0) + amount.amountCents);
  }

  const rows: BudgetRow[] = input.lines.map((line) => {
    const budgetedCents = budgetedForSpan(line, input.months);
    const actualCents = actualById.get(line.id) ?? 0;
    const over = budgetedCents > 0 ? actualCents > budgetedCents : actualCents > 0;
    return {
      ...line,
      budgetedCents,
      actualCents,
      remainingCents: Math.max(0, budgetedCents - actualCents),
      overByCents: Math.max(0, actualCents - budgetedCents),
      // Nothing budgeted means there is nothing to be a share OF. Zero percent
      // would read as "none of it used", which is the opposite of the truth.
      pctUsed:
        budgetedCents > 0
          ? Number(new Decimal(actualCents).div(budgetedCents).times(100).toDecimalPlaces(1))
          : null,
      over,
    };
  });

  const totals: Record<BudgetSide, BudgetSideTotals> = {
    in: { budgetedCents: 0, actualCents: 0 },
    out: { budgetedCents: 0, actualCents: 0 },
  };
  for (const row of rows) {
    totals[row.side].budgetedCents += row.budgetedCents;
    totals[row.side].actualCents += row.actualCents;
  }
  // The unbudgeted money is real spending and belongs in the actual total, or
  // the headline figure would understate exactly as the old screen did.
  totals.in.actualCents += unbudgetedCents.in;
  totals.out.actualCents += unbudgetedCents.out;

  return { rows, totals, unbudgetedCents, unbudgetedCount };
}

/**
 * The property a test can assert directly: every rupee of real money is either
 * on a budget line or in the unbudgeted bucket.
 *
 * Stated as a function because it is the whole safety claim. A gap means money
 * is missing from the comparison, and — this is the point — nothing on the
 * screen would show it.
 */
export function budgetReconciles(input: BudgetInput, result: BudgetResult): boolean {
  for (const side of ["in", "out"] as BudgetSide[]) {
    const fromLedger = input.actuals
      .filter((amount) => amount.side === side)
      .reduce((sum, amount) => sum + amount.amountCents, 0);
    if (result.totals[side].actualCents !== fromLedger) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Chasing the goal
// ---------------------------------------------------------------------------

export interface BudgetPaceInput {
  targetProfitCents: Cents;
  profitSoFarCents: Cents;
  periodStart: string;
  periodEnd: string;
  /** Today, or any date to measure from. */
  asOf: string;
}

export interface BudgetPace {
  monthsTotal: number;
  monthsElapsed: number;
  monthsRemaining: number;
  /** What a steady run at the target would have produced by now. */
  expectedByNowCents: Cents;
  /** Positive is ahead, negative is behind. */
  aheadByCents: Cents;
  onTrack: boolean;
  /**
   * What each remaining month has to bring to still hit the target. Zero once
   * the target is met, and NULL when the period is over — there are no months
   * left to spread anything across, and a number there would be nonsense.
   */
  neededPerRemainingMonthCents: Cents | null;
}

/**
 * Are you keeping up with the goal?
 *
 * Straight-line pacing, deliberately: apportioning a target by last year's
 * seasonality would be a forecast dressed as a plan, and the owner has not been
 * asked whether they believe it. A flat expectation is easy to argue with, which
 * is the right property for a number that is telling someone off.
 */
export function budgetPace(input: BudgetPaceInput): BudgetPace {
  assertCents(input.targetProfitCents, "budgetPace.targetProfitCents");
  assertCents(input.profitSoFarCents, "budgetPace.profitSoFarCents");

  const monthsTotal = monthsInSpan(input.periodStart, input.periodEnd);
  const started = new Date(`${input.asOf}T00:00:00Z`) >= new Date(`${input.periodStart}T00:00:00Z`);
  /**
   * COMPLETE months only. `monthsInSpan` counts both ends, which is right for a
   * budget's length and wrong for elapsed time: on 1 July, six months have
   * finished and July has barely begun. Counting July would hold the owner to a
   * month they have not had yet, and tell them they are behind when they are
   * exactly on pace.
   */
  const monthsElapsed = started ? Math.min(monthsTotal, monthsInSpan(input.periodStart, input.asOf) - 1) : 0;
  const monthsRemaining = Math.max(0, monthsTotal - monthsElapsed);

  const expectedByNowCents = Number(
    new Decimal(input.targetProfitCents).times(monthsElapsed).div(monthsTotal).toDecimalPlaces(0),
  );
  const shortfall = Math.max(0, input.targetProfitCents - input.profitSoFarCents);

  return {
    monthsTotal,
    monthsElapsed,
    monthsRemaining,
    expectedByNowCents,
    aheadByCents: input.profitSoFarCents - expectedByNowCents,
    onTrack: input.profitSoFarCents >= expectedByNowCents,
    neededPerRemainingMonthCents:
      shortfall === 0
        ? 0
        : monthsRemaining === 0
          ? null
          : Number(new Decimal(shortfall).div(monthsRemaining).toDecimalPlaces(0, Decimal.ROUND_UP)),
  };
}
