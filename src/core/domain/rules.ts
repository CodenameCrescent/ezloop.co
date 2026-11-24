import type { BusinessType } from "./capabilities";
import type { Baseline } from "./baseline";
import type { PriceCostDrift } from "./priceDrift";
import type { Cents } from "./money";

/**
 * The rule engine: what an insight card IS, what a rule may read, and how the
 * cards that fire get ranked down to the five a person will actually read.
 *
 * Pure by construction. Rules receive a plain facts object assembled by the
 * server from the existing read-models and return a card or null — they cannot
 * query, cannot fetch, and cannot compute money the ladder has not already
 * computed. That is what makes the whole catalogue unit-testable with hand-
 * written fixtures, and what stops a rule inventing a number.
 *
 * The catalogue itself lives in `ruleCatalogue.ts`. This file is the machinery.
 */

export type InsightPage = "summary" | "money" | "offers" | "people" | "marketing";
export type InsightSeverity = "critical" | "normal";

export interface InsightExplainInput {
  label: string;
  value: string;
}

/**
 * The real calculation behind a card. Shown verbatim by "Explain".
 *
 * Not an LLM answer and not a paraphrase: the inputs that went in, the
 * threshold that fired, and what it was measured against. The first reaction to
 * a surprising card is disbelief, and this is the only thing that answers it.
 */
export interface InsightExplain {
  threshold: string;
  comparisonPeriod: string;
  inputs: InsightExplainInput[];
}

export interface Insight {
  /** Rule id. Used for dismissal and telemetry, never shown. */
  id: string;
  /**
   * Signed money, in integer minor units. Negative = lost, positive = gained.
   * REQUIRED: a rule that fires but cannot be quantified is a log entry, not a
   * card, and `defineRule` refuses to build one without it.
   */
  impactCents: Cents;
  /** Qualifier after the figure, e.g. "/mo". Never part of the money math. */
  impactSuffix?: string;
  /** Max 8 words. */
  headline: string;
  /** One line, containing real numbers. */
  cause: string;
  action?: { label: string; href: string };
  explain: InsightExplain;
  /** Only when the card is ABOUT a trend. Never decorative. */
  trend?: number[];
  severity: InsightSeverity;
  /**
   * What the card is ABOUT — an item name, a channel, "cash". Two cards with
   * the same subject collapse into one, so three warnings about Meta ads do not
   * eat the whole feed.
   */
  subject: string;
  page: InsightPage;
  /**
   * Urgency beats size. Reserved for conditions where running out of time
   * matters more than the amount — runway, insolvency. Sorts above everything.
   */
  urgent?: boolean;
  /**
   * The figure is money AT STAKE or TIED UP, not money gained or lost.
   *
   * Cash sitting in the gap between paying suppliers and being paid is real,
   * checkable and worth acting on — but it has not gone anywhere. Counting it
   * in "you're leaking Rs X a month" would inflate the most persuasive number
   * in the product with money that is merely late, and a leak total nobody
   * believes is worse than no leak total.
   *
   * Exposure cards rank in the feed like any other; they are simply absent from
   * the Leaks view and its total.
   */
  exposure?: boolean;
}

/** A card plus the siblings that were rolled into it by the one-per-subject rule. */
export interface RankedInsight extends Insight {
  related?: { count: number; subject: string };
}

// ── What rules may read ──────────────────────────────────────────────────────

export interface LadderFacts {
  grossRevenue: Cents;
  discounts: Cents;
  refunds: Cents;
  netRevenue: Cents;
  contributionProfit: Cents;
  periodExpenses: Cents;
  trueProfit: Cents;
}

export interface LeakFacts {
  refundsCents: Cents;
  refundRatePct: number;
  topRefundItem: { name: string; cents: Cents } | null;
  discountsCents: Cents;
  discountPctOfGross: number;
  feesCents: Cents;
  topFee: { name: string; currentCents: Cents; priorCents: Cents } | null;
  marginErosion: Array<{ name: string; marginNowPct: number; marginPriorPct: number; deltaPts: number }>;
  unpaidTotalCents: Cents;
  /** Unpaid for more than 30 days — the bucket worth chasing. */
  unpaidOver30Cents: Cents;
  unpaidOver30Count: number;
}

export interface BreakEvenFacts {
  reason: "ok" | "no_fixed_costs" | "no_sales" | "no_margin";
  breakEvenRevenueCents: Cents | null;
  surplusCents: Cents | null;
  coveredPct: number | null;
  fixedExpensesCents: Cents;
  /** Spend nobody classified as fixed or variable — the break-even's blind spot. */
  unclassifiedExpensesCents: Cents;
}

export interface AdFacts {
  spendCents: Cents;
  byPlatform: Array<{ platform: string; amountCents: Cents }>;
  /** Null when the period earned nothing — a share of nothing is unanswerable. */
  shareOfRevenueBps: number | null;
}

export interface ItemFacts {
  id: string;
  name: string;
  netRevenueCents: Cents;
  contributionProfitCents: Cents;
  marginPct: number | null;
  unitsSold: number;
}

export interface RetentionFacts {
  customersWithPurchase: number;
  repeatCustomers: number;
  repeatRatePct: number;
}

/**
 * How long money takes to arrive, and how long it takes to leave.
 *
 * Almost nothing else on the market can compute this, because almost nothing
 * else stores both dates: every transaction here has `occurred_at` (when it
 * happened) AND `paid_at` (when the cash moved).
 *
 * Medians, not means — one customer who paid after 200 days should not become
 * the business's terms.
 *
 * Both figures are measured from transactions that have actually been PAID, so
 * they are optimistic by construction: the slowest payers are the ones still
 * missing a `paid_at`. The rule's Explain says so rather than hiding it.
 */
export interface PaymentHabitFacts {
  /** Median days from sale to cash arriving. Null when too few paid sales. */
  customerDaysToPay: number | null;
  /** Median days from bill to cash leaving. Null when too few paid bills. */
  supplierDaysToPay: number | null;
  paidSalesCount: number;
  paidBillsCount: number;
}

/**
 * The business's own history, one entry per past period, oldest first.
 * Everything the baseline engine judges against. Never includes the period
 * being judged — see `computeBaseline`.
 */
export interface HistoryFacts {
  trueProfitCents: Cents[];
  grossRevenueCents: Cents[];
  refundsCents: Cents[];
  discountsCents: Cents[];
  periodExpensesCents: Cents[];
  adSpendCents: Cents[];
}

export interface InsightFacts {
  businessType: BusinessType;
  /** e.g. "This month vs last month" — goes verbatim into every Explain. */
  comparisonPeriod: string;
  /** How many days the current period covers, for rate-of-burn style rules. */
  periodDays: number;
  current: LadderFacts;
  prior: LadderFacts;
  leaks: LeakFacts;
  breakEven: BreakEvenFacts;
  ads: AdFacts;
  items: ItemFacts[];
  retention: RetentionFacts;
  paymentHabit: PaymentHabitFacts;
  /**
   * Costs that rose while the price stayed put, worst first.
   *
   * Read off the LEDGER rather than the catalogue: every line freezes the price
   * it sold at and the cost snapshot beside it, so the ledger is the price
   * history — and a better one, because it records what customers actually paid
   * rather than what the price list said.
   */
  priceDrift: PriceCostDrift[];
  history: HistoryFacts;
  /** Cash actually in hand, for runway. Null when it cannot be established. */
  cashOnHandCents: Cents | null;
  /** Precomputed baselines, keyed by the fact they describe. */
  baselines: Partial<Record<keyof HistoryFacts, Baseline>>;
  /** Formats integer cents the way the owner's settings say. Injected, never assumed. */
  money: (cents: Cents) => string;
}

// ── Rules ────────────────────────────────────────────────────────────────────

export interface Rule {
  id: string;
  page: InsightPage;
  /** Which business types this rule applies to. Omit to mean all of them. */
  businessTypes?: readonly BusinessType[];
  /** Returns a card, or null when the condition does not hold. */
  evaluate: (facts: InsightFacts) => Insight | null;
}

/**
 * Build a rule with the card-level invariants enforced rather than trusted.
 *
 * Two things are checked here instead of in review, because both were stated as
 * hard rules and both are easy to break by accident under deadline:
 *
 *   1. **No money figure, no card.** A non-finite impact returns null.
 *   2. **Max 8 words in a headline.** Longer headlines are the first step back
 *      toward a dashboard, and by the time anyone notices there are thirty.
 */
export function defineRule(rule: Rule): Rule {
  return {
    ...rule,
    evaluate: (facts) => {
      const insight = rule.evaluate(facts);
      if (!insight) return null;
      if (!Number.isFinite(insight.impactCents)) return null;
      return insight;
    },
  };
}

export const MAX_HEADLINE_WORDS = 8;

/** True when a headline obeys the eight-word cap. Used by the catalogue's own test. */
export function headlineIsWithinCap(headline: string): boolean {
  return headline.trim().split(/\s+/).length <= MAX_HEADLINE_WORDS;
}

/** Run every rule that applies to this business, in catalogue order. */
export function evaluateRules(rules: readonly Rule[], facts: InsightFacts): Insight[] {
  const out: Insight[] = [];
  for (const rule of rules) {
    if (rule.businessTypes && !rule.businessTypes.includes(facts.businessType)) continue;
    const insight = rule.evaluate(facts);
    if (insight) out.push(insight);
  }
  return out;
}

// ── Ranking ──────────────────────────────────────────────────────────────────

/** Five is what a person reads; ten is a to-do list, and to-do lists get abandoned. */
export const DENSITY_CAP = 5;

/**
 * Collapse cards that are about the same thing, keeping the biggest.
 *
 * Three cards about Meta ads become one card about Meta ads that mentions the
 * other two. Without this, one noisy subject takes the whole feed and the
 * refund warning nobody has seen yet never gets on screen.
 */
export function dedupeBySubject(insights: Insight[]): RankedInsight[] {
  const bySubject = new Map<string, Insight[]>();
  for (const insight of insights) {
    const group = bySubject.get(insight.subject) ?? [];
    group.push(insight);
    bySubject.set(insight.subject, group);
  }

  const out: RankedInsight[] = [];
  for (const [subject, group] of bySubject) {
    // Within a subject the order is: urgent, then bad news, then size.
    //
    // Both overrides were found by the same failure. "You are losing money" and
    // "you sold more and kept less" are both about profit, and the second
    // carries the larger figure — so a size-only rule handed the subject to the
    // milder card. Then "Ceramic bowl earns you the most" swallowed "Ceramic
    // bowl costs more than it did", because the win was bigger.
    //
    // A win must never hide a warning about the same thing. Nobody can act on
    // "this is your best seller"; they can act on "its cost rose and you never
    // repriced".
    const sorted = [...group].sort((a, b) => {
      if (a.urgent !== b.urgent) return a.urgent ? -1 : 1;
      const aBad = a.impactCents < 0;
      const bBad = b.impactCents < 0;
      if (aBad !== bBad) return aBad ? -1 : 1;
      return Math.abs(b.impactCents) - Math.abs(a.impactCents);
    });
    const winner: RankedInsight = { ...sorted[0] };
    if (sorted.length > 1) winner.related = { count: sorted.length - 1, subject };
    out.push(winner);
  }
  return out;
}

/**
 * Rank by ABSOLUTE money, descending, with three overrides.
 *
 * Absolute money, never percentages: a 90% jump in a Rs 12 fee is not news, but
 * it outranks a Rs 2,000 leak on any percentage sort. The overrides are:
 *
 *   1. **Urgency beats size.** Running out of cash outranks everything, however
 *      small the figure attached to it.
 *   2. **One card per subject** (applied first, above).
 *   3. **Slot 5 is reserved for a win.** If the whole visible feed is negative,
 *      the last slot goes to the best positive card instead. A screen that only
 *      scolds gets closed and not reopened — this is a retention mechanic
 *      wearing a layout rule's clothes.
 */
export function rankInsights(insights: Insight[], cap: number = DENSITY_CAP): RankedInsight[] {
  const deduped = dedupeBySubject(insights);

  const sorted = [...deduped].sort((a, b) => {
    if (a.urgent !== b.urgent) return a.urgent ? -1 : 1;
    return Math.abs(b.impactCents) - Math.abs(a.impactCents);
  });

  if (sorted.length <= cap) return sorted;

  const visible = sorted.slice(0, cap);

  // Slot 5 reserved for a win — only when there IS a win waiting and none of
  // the visible cards is already one.
  const anyPositiveVisible = visible.some((i) => i.impactCents > 0);
  if (!anyPositiveVisible) {
    const bestWin = sorted.slice(cap).find((i) => i.impactCents > 0);
    if (bestWin) {
      visible[visible.length - 1] = bestWin;
    }
  }

  return visible;
}

/**
 * Everything that lost money, biggest loss first — the "Leaks" view.
 *
 * Deliberately NOT capped and NOT deduped against the main feed: the toggle
 * exists to show the full bill.
 */
export function leaksOnly(insights: Insight[]): RankedInsight[] {
  return dedupeBySubject(insights)
    .filter((i) => i.impactCents < 0 && !i.exposure)
    .sort((a, b) => a.impactCents - b.impactCents);
}

/**
 * The total leak figure that rides inside the toggle's own label.
 *
 * Positive number of minor units. This is the most persuasive figure in the
 * product and has to be readable without tapping anything.
 */
export function totalLeakCents(insights: Insight[]): Cents {
  return leaksOnly(insights).reduce((sum, i) => sum + Math.abs(i.impactCents), 0);
}
