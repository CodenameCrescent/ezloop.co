import { addCents, type Cents } from "./money";
import type { ProfitLadder } from "./profit";

/**
 * The money waterfall: revenue on the left, each cost knocking it down, profit
 * standing at the right.
 *
 * Not a line chart, deliberately. For a reader who has never opened a P&L this
 * is the most legible chart in finance — you watch the money get eaten, and the
 * bar left standing IS your profit. A line chart of revenue over time answers a
 * different and less useful question.
 *
 * **The reconciliation is the contract.** `startCents` minus every deduction
 * must equal `endCents` exactly, and `waterfallReconciles` is asserted by test.
 * A chart whose bars do not add up to the number printed beside it is worse
 * than no chart: it teaches the reader that the figures are decorative.
 *
 * That is why every split carries a remainder. The P&L can break direct costs
 * down by cost-component name, but an expense line booked inside a sale (the
 * materials for a job) has no component name to sit under — so the named parts
 * are always reconciled against the total and the difference is shown rather
 * than dropped.
 */

/**
 * `credit` is a bar that gives money BACK.
 *
 * It exists because refunds recover costs: when a sale is refunded the ladder
 * takes the goods' cost back off the period's direct costs, so the named cost
 * components can legitimately sum to MORE than the net figure. The difference
 * is real money returning, and an earlier version dropped it for being negative
 * — which silently broke the one property this chart has to keep.
 */
export type WaterfallStepKind = "start" | "deduction" | "credit" | "end";

export interface WaterfallStep {
  /** Stable key for React and for tests. */
  id: string;
  label: string;
  kind: WaterfallStepKind;
  /** Positive for the start and end bars; positive magnitude for deductions. */
  amountCents: Cents;
  /** Where this bar drills into. Null when there is nothing more to show. */
  href: string | null;
  /**
   * A rung of the profit ladder lands here — the running total AFTER this step.
   * Used to draw the ladder's own labels against the bars.
   */
  runningTotalCents: Cents;
  /** The ladder rung name, when this step completes one. */
  rungLabel?: string;
}

export interface WaterfallBreakdownInput {
  /** Direct-cost split by frozen snapshot component name. */
  costComponents: Array<{ name: string; kind: "fee" | "cost"; totalCents: Cents }>;
  /** Period-expense split by expense item type. */
  expenseGroups: Array<{ key: string; label: string; amountCents: Cents }>;
}

export interface Waterfall {
  steps: WaterfallStep[];
  startCents: Cents;
  endCents: Cents;
  /** True when start − deductions === end. Always true by construction; asserted anyway. */
  reconciles: boolean;
  /**
   * Revenue was recorded but nothing has a cost behind it, so the profit bar is
   * the full revenue bar.
   *
   * The page must SAY this rather than draw it silently. A waterfall with no
   * COGS in it does not look broken — it looks like a wildly profitable
   * business, which is the single most damaging thing this screen could imply.
   */
  missingCosts: boolean;
}

const LEAKS = "/insights/leaks";
const LEDGER = "/record/transactions";

/** Drops zero-value slices: a bar of nothing is noise, not information. */
function nonZero<T extends { totalCents?: Cents; amountCents?: Cents }>(rows: T[]): T[] {
  return rows.filter((r) => Math.abs(r.totalCents ?? r.amountCents ?? 0) > 0);
}

export function buildWaterfall(ladder: ProfitLadder, breakdown: WaterfallBreakdownInput): Waterfall {
  const steps: WaterfallStep[] = [];
  let running = ladder.grossRevenue;

  steps.push({
    id: "gross",
    label: "Money in",
    kind: "start",
    amountCents: ladder.grossRevenue,
    href: LEDGER,
    runningTotalCents: running,
  });

  /**
   * Add a bar. A positive amount takes money off, a negative one gives it back,
   * and zero draws nothing.
   *
   * Both directions have to be representable or the chart cannot reconcile —
   * see the `credit` note above.
   */
  const applyStep = (
    id: string,
    label: string,
    amountCents: Cents,
    href: string | null,
    creditLabel?: string,
  ) => {
    if (amountCents === 0) return;
    const credit = amountCents < 0;
    running = addCents(running, -amountCents);
    steps.push({
      id,
      label: credit ? creditLabel ?? label : label,
      kind: credit ? "credit" : "deduction",
      amountCents: Math.abs(amountCents),
      href,
      runningTotalCents: running,
    });
  };

  const deduct = (id: string, label: string, amountCents: Cents, href: string | null, creditLabel?: string) =>
    applyStep(id, label, amountCents, href, creditLabel);

  deduct("discounts", "Discounts you gave", ladder.discounts, LEAKS);
  deduct("refunds", "Refunds", ladder.refunds, LEAKS);
  // Net revenue is a rung, so mark whichever step landed on it.
  if (steps.length > 1) steps[steps.length - 1].rungLabel = "Net revenue";

  /**
   * Direct costs are not on the ladder as a field — they are the gap between
   * net revenue and contribution profit. Deriving them rather than adding a
   * column keeps this in step with `computeProfitLadder` forever: if the ladder
   * changes how a cost is classified, this follows automatically.
   */
  const directCosts = addCents(ladder.netRevenue, -ladder.contributionProfit);

  const namedCosts = nonZero(breakdown.costComponents);
  let namedCostTotal = 0;
  for (const component of namedCosts) {
    namedCostTotal = addCents(namedCostTotal, component.totalCents);
  }

  for (const component of namedCosts) {
    deduct(
      `cost:${component.name}`,
      component.kind === "fee" ? `${component.name} (fee)` : component.name,
      component.totalCents,
      LEAKS,
    );
  }

  // Whatever the named components did not account for. Positive when materials
  // were booked straight onto a job with no component name to sit under;
  // NEGATIVE when refunds handed cost back, which is why this can be a credit.
  // Shown either way, never dropped.
  const costRemainder = addCents(directCosts, -namedCostTotal);
  deduct("cost:other", "Other costs of sales", costRemainder, LEDGER, "Costs recovered on refunds");

  if (directCosts > 0) {
    const last = steps[steps.length - 1];
    if (last) last.rungLabel = "Contribution profit";
  }

  const namedExpenses = nonZero(breakdown.expenseGroups);
  let namedExpenseTotal = 0;
  for (const group of namedExpenses) {
    namedExpenseTotal = addCents(namedExpenseTotal, group.amountCents);
  }

  for (const group of namedExpenses) {
    deduct(`expense:${group.key}`, group.label, group.amountCents, LEDGER);
  }

  const expenseRemainder = addCents(ladder.periodExpenses, -namedExpenseTotal);
  deduct("expense:other", "Other running costs", expenseRemainder, LEDGER, "Running costs recovered");

  steps.push({
    id: "true-profit",
    label: "What you kept",
    kind: "end",
    amountCents: ladder.trueProfit,
    href: null,
    runningTotalCents: ladder.trueProfit,
    rungLabel: "True profit",
  });

  return {
    steps,
    startCents: ladder.grossRevenue,
    endCents: ladder.trueProfit,
    reconciles: waterfallReconciles(ladder, steps),
    missingCosts: ladder.grossRevenue > 0 && directCosts === 0,
  };
}

/**
 * Executable statement of the contract: every deduction taken off the start
 * lands exactly on the end.
 *
 * Written as its own exported function, like `breakEvenReconciles`, so the
 * property can be asserted from a test rather than inferred from the code that
 * produces it.
 */
export function waterfallReconciles(ladder: ProfitLadder, steps: WaterfallStep[]): boolean {
  let running = ladder.grossRevenue;
  for (const step of steps) {
    if (step.kind === "deduction") running = addCents(running, -step.amountCents);
    if (step.kind === "credit") running = addCents(running, step.amountCents);
  }
  return running === ladder.trueProfit;
}

/**
 * The verdict sentence above the chart.
 *
 * Structure is fixed: what came in, what is left, and how that compares. Two
 * clauses, present tense, never a question, always at least one real number.
 */
export function waterfallSentence(
  ladder: ProfitLadder,
  priorTrueProfit: Cents | null,
  money: (cents: Cents) => string,
): string {
  if (ladder.grossRevenue === 0) {
    return "No money came in this period, so there is nothing to follow through yet.";
  }

  const kept = money(ladder.trueProfit);
  const inMoney = money(ladder.grossRevenue);

  if (ladder.trueProfit < 0) {
    return `${inMoney} came in and more than that went out — you are down ${money(Math.abs(ladder.trueProfit))}.`;
  }

  if (priorTrueProfit === null) {
    return `${inMoney} came in and you kept ${kept}.`;
  }

  const change = addCents(ladder.trueProfit, -priorTrueProfit);
  if (change === 0) return `${inMoney} came in and you kept ${kept} — the same as last period.`;
  const direction = change > 0 ? "more" : "less";
  return `${inMoney} came in and you kept ${kept} — ${money(Math.abs(change))} ${direction} than last period.`;
}
