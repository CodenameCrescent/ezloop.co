import { addCents, type Cents } from "./money";

/**
 * Who pays you, and are they staying.
 *
 * The concentration bar is the point of this page. For a service business
 * "Acme is 38% of your revenue, and losing them would take you to a loss" is
 * the single highest-value warning the product can produce — it is a fact the
 * owner half-knows and has never had priced.
 *
 * For a shop with hundreds of small customers the same bar reads as mostly
 * "everyone else", which is the correct and reassuring answer. No special
 * casing: the honest picture is the useful one in both directions.
 */

export interface CustomerStat {
  id: string;
  name: string;
  /** Revenue in the period being shown. */
  netRevenueCents: Cents;
  /** What was left after the cost of serving them, in the same period. */
  contributionProfitCents: Cents;
  /** How many separate purchases, EVER — used to know whether a rhythm exists. */
  lifetimeOrderCount: number;
  /** ISO timestamps, or null when they have never bought. */
  firstPurchaseAt: string | null;
  lastPurchaseAt: string | null;
  /** What they were worth over the trailing year. */
  trailingYearContributionCents: Cents;
}

// ── Concentration ────────────────────────────────────────────────────────────

/** Above this share of revenue from one name, the segment turns red. */
export const CONCENTRATION_WARN_PCT = 30;

export interface ConcentrationSegment {
  id: string | null;
  name: string;
  netRevenueCents: Cents;
  sharePct: number;
  /** True for the top segment once it passes the warning threshold. */
  atRisk: boolean;
}

export type ConcentrationRisk = "none" | "watch" | "high" | "sole";

export interface CustomerConcentration {
  segments: ConcentrationSegment[];
  topName: string | null;
  topSharePct: number | null;
  risk: ConcentrationRisk;
  /**
   * True when losing the top customer would take the business into a loss.
   *
   * Their CONTRIBUTION is what disappears, not their revenue — the rent and the
   * payroll stay exactly where they are. That is the whole reason this can be
   * computed honestly rather than guessed at.
   */
  losingThemMeansLoss: boolean;
  /** Profit that would remain. Negative when `losingThemMeansLoss`. */
  profitWithoutTopCents: Cents | null;
  /** Revenue with no customer attached — real money that cannot concentrate. */
  unattributedCents: Cents;
}

/**
 * Build the bar.
 *
 * `namedCap` segments are shown individually and the rest are pooled into
 * "everyone else", because thirty slivers is not a chart. Revenue with nobody
 * attached is pooled separately and named as such, rather than being silently
 * dropped or silently counted against a customer.
 */
export function buildConcentration(
  customers: CustomerStat[],
  trueProfitCents: Cents,
  unattributedCents: Cents = 0,
  namedCap = 3,
): CustomerConcentration {
  const earning = customers
    .filter((c) => c.netRevenueCents > 0)
    .sort((a, b) => b.netRevenueCents - a.netRevenueCents);

  const total = addCents(
    earning.reduce((sum, c) => addCents(sum, c.netRevenueCents), 0),
    Math.max(0, unattributedCents),
  );

  if (total <= 0) {
    return {
      segments: [],
      topName: null,
      topSharePct: null,
      risk: "none",
      losingThemMeansLoss: false,
      profitWithoutTopCents: null,
      unattributedCents,
    };
  }

  const share = (cents: Cents) => (cents / total) * 100;
  const top = earning[0] ?? null;
  const topSharePct = top ? share(top.netRevenueCents) : null;

  const named = earning.slice(0, namedCap);
  const rest = earning.slice(namedCap);
  const restTotal = rest.reduce((sum, c) => addCents(sum, c.netRevenueCents), 0);

  const segments: ConcentrationSegment[] = named.map((c, i) => ({
    id: c.id,
    name: c.name,
    netRevenueCents: c.netRevenueCents,
    sharePct: share(c.netRevenueCents),
    atRisk: i === 0 && share(c.netRevenueCents) >= CONCENTRATION_WARN_PCT,
  }));

  if (restTotal > 0) {
    segments.push({
      id: null,
      name: "everyone else",
      netRevenueCents: restTotal,
      sharePct: share(restTotal),
      atRisk: false,
    });
  }
  if (unattributedCents > 0) {
    segments.push({
      id: null,
      // Named plainly. Folding it into "everyone else" would overstate how
      // spread the customer base is.
      name: "no customer recorded",
      netRevenueCents: unattributedCents,
      sharePct: share(unattributedCents),
      atRisk: false,
    });
  }

  const profitWithoutTop = top ? addCents(trueProfitCents, -top.contributionProfitCents) : null;

  const risk: ConcentrationRisk =
    topSharePct === null
      ? "none"
      : earning.length === 1 && unattributedCents === 0
        ? "sole"
        : topSharePct >= 50
          ? "high"
          : topSharePct >= CONCENTRATION_WARN_PCT
            ? "watch"
            : "none";

  return {
    segments,
    topName: top?.name ?? null,
    topSharePct,
    risk,
    losingThemMeansLoss: profitWithoutTop !== null && trueProfitCents >= 0 && profitWithoutTop < 0,
    profitWithoutTopCents: profitWithoutTop,
    unattributedCents,
  };
}

/**
 * The sentence under the bar — the highest-value warning on the page.
 *
 * Every branch states a real number and none of them ask a question.
 */
export function customerConcentrationSentence(
  c: CustomerConcentration,
  money: (cents: Cents) => string,
): string {
  if (c.topSharePct === null || !c.topName) {
    return "No sales are recorded against a customer yet, so there is nothing to spread.";
  }

  if (c.risk === "sole") {
    // A freelancer with one client: the warning is true but useless as a
    // percentage, so it becomes the advice instead.
    return `All your revenue comes from ${c.topName}. Adding a second customer is the single biggest risk reduction available to you.`;
  }

  const head = `${c.topName} is ${c.topSharePct.toFixed(0)}% of your revenue.`;

  if (c.losingThemMeansLoss) {
    return `${head} Losing them would take you to a loss.`;
  }
  if (c.risk === "high" || c.risk === "watch") {
    return c.profitWithoutTopCents !== null
      ? `${head} Without them you would have kept ${money(c.profitWithoutTopCents)}.`
      : head;
  }
  return `${head} Your income is well spread across the rest.`;
}

// ── Gone quiet ───────────────────────────────────────────────────────────────

/**
 * Customers who used to buy and stopped.
 *
 * The sleeper feature of this page. Most tools report churn as a percentage,
 * and a percentage is not something anybody can act on — a list of names is.
 *
 * "Stopped" is judged against each customer's OWN rhythm rather than a fixed
 * 90 days, for the same reason every other threshold in this app is: a monthly
 * retainer client who has not been seen in 60 days is a crisis, and a customer
 * who buys every eight months is fine at 60 days. Somebody with fewer than two
 * purchases has no rhythm to break and can never appear here.
 */
export const QUIET_MULTIPLE = 2;

export interface QuietCustomer {
  id: string;
  name: string;
  lastPurchaseAt: string;
  daysSince: number;
  /** Their own usual gap between purchases, in days. */
  usualGapDays: number;
  /** What they were worth over the trailing year. */
  worthPerYearCents: Cents;
}

export interface GoneQuiet {
  customers: QuietCustomer[];
  totalAtRiskCents: Cents;
  /** Customers with too few purchases to have a rhythm — cannot be judged. */
  unjudgeableCount: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function findGoneQuiet(customers: CustomerStat[], now: Date): GoneQuiet {
  const quiet: QuietCustomer[] = [];
  let unjudgeable = 0;

  for (const c of customers) {
    if (!c.firstPurchaseAt || !c.lastPurchaseAt) continue;

    // Fewer than two purchases is not a rhythm, it is a single event.
    if (c.lifetimeOrderCount < 2) {
      unjudgeable += 1;
      continue;
    }

    const first = new Date(c.firstPurchaseAt).getTime();
    const last = new Date(c.lastPurchaseAt).getTime();
    const span = last - first;
    if (span <= 0) {
      unjudgeable += 1;
      continue;
    }

    // Gaps between purchases = span ÷ (purchases − 1).
    const usualGapDays = Math.max(1, Math.round(span / DAY_MS / (c.lifetimeOrderCount - 1)));
    const daysSince = Math.floor((now.getTime() - last) / DAY_MS);

    if (daysSince > usualGapDays * QUIET_MULTIPLE) {
      quiet.push({
        id: c.id,
        name: c.name,
        lastPurchaseAt: c.lastPurchaseAt,
        daysSince,
        usualGapDays,
        worthPerYearCents: c.trailingYearContributionCents,
      });
    }
  }

  quiet.sort((a, b) => b.worthPerYearCents - a.worthPerYearCents);

  return {
    customers: quiet,
    totalAtRiskCents: quiet.reduce((sum, q) => addCents(sum, Math.max(0, q.worthPerYearCents)), 0),
    unjudgeableCount: unjudgeable,
  };
}

// ── Thin data ────────────────────────────────────────────────────────────────

/**
 * Below this, a repeat rate is noise dressed as a metric.
 *
 * Never render a cohort chart on twelve customers: the numbers move violently
 * on one person's behaviour and the reader has no way to know that.
 */
export const MIN_CUSTOMERS_FOR_REPEAT = 20;

export function repeatRateIsMeaningful(customerCount: number): boolean {
  return customerCount >= MIN_CUSTOMERS_FOR_REPEAT;
}

/** Average revenue per paying customer. Null when nobody has paid. */
export function revenuePerCustomer(customers: CustomerStat[]): Cents | null {
  const paying = customers.filter((c) => c.netRevenueCents > 0);
  if (paying.length === 0) return null;
  const total = paying.reduce((sum, c) => addCents(sum, c.netRevenueCents), 0);
  return Math.round(total / paying.length);
}

/**
 * The one that surprises people: your biggest customer is not your most
 * profitable one.
 */
export interface BiggestVsBestCustomer {
  biggest: CustomerStat;
  best: CustomerStat;
}

export function biggestVsBest(customers: CustomerStat[]): BiggestVsBestCustomer | null {
  const paying = customers.filter((c) => c.netRevenueCents > 0);
  if (paying.length < 2) return null;

  const biggest = [...paying].sort((a, b) => b.netRevenueCents - a.netRevenueCents)[0];
  const best = [...paying].sort((a, b) => b.contributionProfitCents - a.contributionProfitCents)[0];

  if (biggest.id === best.id) return null;
  // "Most profitable" has to actually be profitable — in a period where every
  // customer cost more than they paid, the leader merely lost least.
  if (best.contributionProfitCents <= 0) return null;
  return { biggest, best };
}
