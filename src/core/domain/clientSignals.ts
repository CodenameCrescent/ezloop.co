import type { Cents } from "./money";
import type { Coverage, ProfitSummary, TargetProfit } from "./clientProfit";
import type { Concentration, ScopeCreep, Utilization } from "./workInsights";

/**
 * What the hours are telling the owner, in sentences.
 *
 * The profitability screen answers "which clients are worth having" for anyone
 * who goes looking. This turns the same figures into nudges that find the owner
 * instead — on the Insights overview, next to the refund and margin warnings
 * that already live there.
 *
 * Two rules carry over from the screen and matter more here, because a nudge is
 * read in isolation with no table underneath it to check against:
 *
 * 1. NEVER SPEAK FOR AN UNCOSTED CLIENT. A client with revenue and no hours has
 *    no margin, so it cannot be "losing money" and cannot be "your best". The
 *    only honest nudge about them is that nobody has logged their hours — which
 *    is itself the most useful thing to say.
 *
 * 2. SAY WHEN A FIGURE IS A GUESS. A nudge built on estimated hours has to
 *    admit it inside its own sentence. There is no banner above a signal to
 *    carry the caveat for it.
 */

export type SignalSeverity = "positive" | "info" | "warning" | "critical";

export interface ClientSignal {
  id: string;
  severity: SignalSeverity;
  title: string;
  plainEnglish: string;
  href: string;
}

/** Everything the nudges read. Exactly the shape the profitability report returns. */
export interface ClientSignalInput {
  rows: TargetProfit[];
  summary: ProfitSummary;
  scopeCreep: Array<ScopeCreep & { targetId: string; label: string }>;
  utilization: { overall: Utilization };
  concentration: Concentration;
  coverage: Coverage;
}

const HOURS_PAGE = "/workbench/hours";
const PROFIT_PAGE = "/workbench/profitability";

/** Appended to any sentence whose figure rests on estimated hours. */
const ROUGHLY = " These hours are estimates, so treat it as roughly right.";

/** Money as the nudges say it: whole units, grouped, no decimals to squint at. */
function say(cents: Cents): string {
  return Math.abs(Math.round(cents / 100)).toLocaleString("en-US");
}

/**
 * The nudges, most urgent first.
 *
 * Deliberately capped in scope: one signal per KIND, naming the worst case
 * rather than listing every client. Six warnings about six clients would push
 * the refund and margin signals off the overview and train the owner to skim
 * past all of them.
 */
export function computeClientSignals(input: ClientSignalInput): ClientSignal[] {
  const signals: ClientSignal[] = [];
  const { summary, rows, coverage } = input;

  // Clients only. A product row is the same money seen through the other lens,
  // and warning about both would say the same thing twice in different words.
  const clients = rows.filter((r) => r.targetType === "client");
  const costed = clients.filter((r) => r.isCosted);

  // ── The one that pays for the whole module ────────────────────────────────
  // A client whose time costs more than they pay. Invisible in a P&L, which is
  // the entire reason any of this exists.
  const worst = costed
    .filter((r) => (r.contributionCents ?? 0) < 0)
    .sort((a, b) => (a.contributionCents ?? 0) - (b.contributionCents ?? 0))[0];
  if (worst) {
    signals.push({
      id: "client-loss",
      severity: "critical",
      title: `${worst.label} costs more than they pay`,
      plainEnglish:
        `Their time cost ${say(worst.labourCostCents ?? 0)} against ${say(worst.revenueCents)} of revenue — ` +
        `you are down ${say(worst.contributionCents ?? 0)} on them.` +
        (worst.hasEstimates ? ROUGHLY : ""),
      href: PROFIT_PAGE,
    });
  }

  // ── Earning money with nobody's hours behind it ───────────────────────────
  // Not a failure of the business, a gap in the data — and the honest version
  // of the flattering lie the whole design exists to prevent.
  if (summary.uncostedWithRevenueCount > 0) {
    const n = summary.uncostedWithRevenueCount;
    signals.push({
      id: "client-uncosted",
      severity: "info",
      title: n === 1 ? "One client has no hours logged" : `${n} clients have no hours logged`,
      plainEnglish:
        `${say(summary.uncostedRevenueCents)} of revenue has no time behind it, so there is no profit figure for it. ` +
        `Log a week — or estimate it — to find out whether it is worth having.`,
      href: HOURS_PAGE,
    });
  }

  // ── Scope creep: the gap between what they think they pay and what you get ─
  const creep = input.scopeCreep.filter((c) => c.isOver && (c.overPct ?? 0) >= 20)[0];
  if (creep) {
    const rates =
      creep.agreedHourlyRateCents !== null && creep.effectiveHourlyRateCents !== null
        ? ` You priced it at ${say(creep.agreedHourlyRateCents)} an hour and are earning ${say(creep.effectiveHourlyRateCents)}.`
        : "";
    signals.push({
      id: "client-scope-creep",
      severity: "warning",
      title: `${creep.label} is over the hours agreed`,
      plainEnglish: `${creep.overHours} hours past the ${creep.agreedHours} agreed — ${Math.round(creep.overPct ?? 0)}% over.${rates}`,
      href: PROFIT_PAGE,
    });
  }

  // ── Concentration: how much of the book rests on one name ─────────────────
  if (input.concentration.risk === "high" && input.concentration.topLabel) {
    const share = input.concentration.topSharePct ?? 0;
    signals.push({
      id: "client-concentration",
      severity: "warning",
      title: `${input.concentration.topLabel} is ${Math.round(share)}% of your income`,
      plainEnglish:
        share >= 99
          ? "Every rupee comes from one client. Losing them would leave you with nothing."
          : `Losing them would take ${Math.round(share)}% of your income with them.`,
      href: PROFIT_PAGE,
    });
  }

  // ── Utilization: paid time that earns nothing ────────────────────────────
  const util = input.utilization.overall;
  if (util.pct !== null && util.pct < 50 && Number(util.totalHours) >= 20) {
    signals.push({
      id: "client-utilization",
      severity: "info",
      title: "Under half the team's time is billable",
      plainEnglish:
        `${util.nonBillableHours} of ${util.totalHours} hours went to work nobody is paying for. ` +
        `That is not automatically wrong, but it is worth knowing where it goes.`,
      href: PROFIT_PAGE,
    });
  }

  // ── Coverage: does the sheet account for the wage bill? ───────────────────
  // Under is the dangerous direction, because missing hours make every client
  // look better than they are and nothing else on screen would say so.
  if (coverage.reason === "ok" && coverage.direction === "under" && (coverage.pct ?? 100) < 70) {
    signals.push({
      id: "client-coverage",
      severity: "warning",
      title: "The timesheet is missing most of the wage bill",
      plainEnglish:
        `Logged hours account for only ${Math.round(coverage.pct ?? 0)}% of what you actually pay in wages, ` +
        `so every client below looks cheaper than they really are.`,
      href: HOURS_PAGE,
    });
  }

  // ── And the good news, when there is some ─────────────────────────────────
  const best = costed
    .filter((r) => (r.marginPct ?? 0) >= 50 && r.revenueCents > 0)
    .sort((a, b) => (b.contributionCents ?? 0) - (a.contributionCents ?? 0))[0];
  if (best && !worst) {
    signals.push({
      id: "client-best",
      severity: "positive",
      title: `${best.label} is your most profitable client`,
      plainEnglish:
        `${say(best.contributionCents ?? 0)} left after their time and costs — a ${Math.round(best.marginPct ?? 0)}% margin.` +
        (best.hasEstimates ? ROUGHLY : ""),
      href: PROFIT_PAGE,
    });
  }

  const rank: Record<SignalSeverity, number> = { critical: 0, warning: 1, info: 2, positive: 3 };
  return signals.sort((a, b) => rank[a.severity] - rank[b.severity]);
}
