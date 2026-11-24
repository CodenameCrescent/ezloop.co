import type { Baseline } from "./baseline";
import type { Cents } from "./money";

/**
 * The Profit Quality Score.
 *
 * PQS is a number we invented, so the whole design here answers one question:
 * "based on what?" Every pillar states the scale it is judged on, carries the
 * raw inputs that produced it, and can be re-derived by hand from the drawer.
 * Answer that completely once and the score is credible for the life of the
 * account; refuse and PQS reads as astrology.
 *
 * Three rules the implementation is built around:
 *
 * 1. **A pillar with no data is ABSENT, never zero.** A business with no sales
 *    does not have "margin health: 0" — it has no margin health, and scoring it
 *    zero would drag the headline number down for a fact about the data rather
 *    than the business. Absent pillars drop out and the remaining weights
 *    renormalise, which is what makes "based on 3 of 4 measures" honest rather
 *    than a disclaimer on a fudged figure.
 *
 * 2. **The score is never coloured, only the delta is.** Not enforced here (it
 *    is a rendering rule) but it is why `score` carries no severity: 68 is a
 *    fact, "down 4" is the feeling.
 *
 * 3. **No pillar invents a benchmark against other businesses.** Every scale is
 *    either an absolute the drawer states plainly, or the business's own
 *    history. Comparing an owner to other people's numbers is a trust minefield
 *    and we do not have the data for it.
 */

export type PillarId = "margin" | "concentration" | "trend" | "ads";

export type PillarReason = "ok" | "no_revenue" | "no_history" | "not_available_yet";

export interface PillarInput {
  label: string;
  value: string;
}

export interface Pillar {
  id: PillarId;
  label: string;
  /** 0–100, or null when the pillar is absent. */
  score: number | null;
  /** Share of the score this pillar carries, AFTER renormalising for absences. */
  weightPct: number;
  /** The scale it was judged on, in one plain sentence. */
  range: string;
  /** The raw figures that produced the score. */
  inputs: PillarInput[];
  reason: PillarReason;
  /** Which Insights page owns this concern. Tapping the row routes here. */
  href: string;
}

/**
 * Weights before any renormalisation.
 *
 * Margin leads because keeping enough of each sale is the thing every other
 * measure depends on. Trend is close behind because direction predicts next
 * month better than level does. Concentration is a risk measure — real, but it
 * describes a thing that has not happened yet.
 *
 * `ads` sits at 0 and absent: scoring ad efficiency needs to know which sales
 * came from ads, and the attribution engine does not exist. Logging ad spend
 * (which now works) is necessary but not sufficient, so the pillar stays out
 * rather than being faked from spend alone.
 */
export const PILLAR_WEIGHTS: Record<PillarId, number> = {
  margin: 40,
  trend: 35,
  concentration: 25,
  ads: 0,
};

/** Below this many days of activity a score is noise dressed as a verdict. */
export const MIN_DAYS_FOR_SCORE = 14;

/** Bar colouring, and the language the drawer uses. */
export const WEAK_BELOW = 40;
export const STRONG_ABOVE = 80;

/** The level "what would move it most" aims a weak pillar at. */
const TARGET_LEVEL = 75;

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/**
 * Margin health: how much of each sale you keep, after everything.
 *
 * Scale: 0% or less keeps nothing and scores 0; 30% or better scores 100;
 * straight line between. 30% is deliberately a stated absolute rather than an
 * industry benchmark — the app serves a freelancer at 60% and a shop at 12%,
 * and pretending to know the "right" margin for a business it has never seen
 * would be the invented-number failure in score form. The drawer prints this
 * sentence verbatim so the owner can disagree with it knowingly.
 */
export function scoreMargin(trueProfitCents: Cents, netRevenueCents: Cents): number | null {
  if (netRevenueCents <= 0) return null;
  const marginPct = (trueProfitCents / netRevenueCents) * 100;
  return Math.round(clamp(marginPct, 0, 30) / 30 * 100);
}

/**
 * Concentration: how much of the business rests on one name.
 *
 * Scored on the WORSE of customer concentration and offer concentration, which
 * is a deliberate departure from the original brief (it named customers only).
 * A shop with 500 customers has no customer concentration and would have scored
 * a permanent 100 on a pillar carrying no information for it — while possibly
 * having every rupee of profit in one product. Taking the worse of the two
 * makes the pillar mean something for both business types, and `topSubject`
 * records which one drove it so the row can route to the page that owns it.
 *
 * Scale: 20% or less of the total from one thing is a healthy spread and scores
 * 100; 60% or more scores 0.
 */
export function scoreConcentration(topSharePct: number | null): number | null {
  if (topSharePct === null) return null;
  const share = clamp(topSharePct, 0, 100);
  if (share <= 20) return 100;
  if (share >= 60) return 0;
  return Math.round((60 - share) / 40 * 100);
}

/**
 * Trend: is profit better or worse than normal FOR THIS BUSINESS?
 *
 * The one pillar with no absolute scale at all, because there is no such thing
 * as a universally good trend — it uses the baseline engine, so "normal" means
 * this business's own recent trading periods. At normal the score is 50; a
 * typical swing better is 75; two swings better is 100, and symmetrically down.
 *
 * Absent when there is no baseline. A business four months old has no normal,
 * and a trend score built on two data points is a coin flip with a decimal
 * point on it.
 */
export function scoreTrend(trueProfitCents: Cents, baseline: Baseline | undefined): number | null {
  if (!baseline || baseline.reason !== "ok" || baseline.normal === null || baseline.deviation === null) {
    return null;
  }
  if (baseline.deviation === 0) return trueProfitCents >= baseline.normal ? 100 : 0;
  const swings = clamp((trueProfitCents - baseline.normal) / baseline.deviation, -2, 2);
  return Math.round(50 + swings * 25);
}

export interface PqsInput {
  trueProfitCents: Cents;
  netRevenueCents: Cents;
  /** Largest single customer's share of revenue, 0–100. Null when unknowable. */
  topCustomerSharePct: number | null;
  topCustomerLabel: string | null;
  /** Largest single offer's share of contribution, 0–100. Null when unknowable. */
  topOfferSharePct: number | null;
  topOfferLabel: string | null;
  /** The business's own normal for true profit — the trend pillar's yardstick. */
  trueProfitBaseline: Baseline | undefined;
  /** Days of recorded activity. Under MIN_DAYS_FOR_SCORE there is no score. */
  daysOfActivity: number;
  money: (cents: Cents) => string;
}

export type PqsState = "ok" | "too_new" | "no_activity";

export interface Pqs {
  /** 0–100, or null when there is no score to give. */
  score: number | null;
  state: PqsState;
  pillars: Pillar[];
  /** Pillars that produced a score, out of all four. Drives "based on N of 4". */
  measuresUsed: number;
  measuresTotal: number;
  /** Days recorded, for the first-run progress line. */
  daysOfActivity: number;
  /**
   * True when profit is negative. The ONE condition allowed to put a band above
   * the score. Extending it to lesser conditions kills its meaning.
   */
  crisis: boolean;
}

const HREF = {
  margin: "/insights/profit",
  concentration: "/insights/customers",
  offers: "/setup/revenue",
  trend: "/insights/profit",
  ads: "/record/ad-spend",
} as const;

export function computePqs(input: PqsInput): Pqs {
  const {
    trueProfitCents,
    netRevenueCents,
    topCustomerSharePct,
    topCustomerLabel,
    topOfferSharePct,
    topOfferLabel,
    trueProfitBaseline,
    daysOfActivity,
    money,
  } = input;

  // Concentration takes the worse of the two, and remembers which.
  const customerShare = topCustomerSharePct;
  const offerShare = topOfferSharePct;
  const worstShare =
    customerShare === null && offerShare === null
      ? null
      : Math.max(customerShare ?? 0, offerShare ?? 0);
  const customerDrove = worstShare !== null && (customerShare ?? 0) >= (offerShare ?? 0);
  const topSubject = worstShare === null ? null : customerDrove ? topCustomerLabel : topOfferLabel;

  const marginScore = scoreMargin(trueProfitCents, netRevenueCents);
  const concentrationScore = scoreConcentration(worstShare);
  const trendScore = scoreTrend(trueProfitCents, trueProfitBaseline);

  const marginPct = netRevenueCents > 0 ? (trueProfitCents / netRevenueCents) * 100 : null;

  const raw: Array<Omit<Pillar, "weightPct"> & { baseWeight: number }> = [
    {
      id: "margin",
      label: "Margin health",
      score: marginScore,
      baseWeight: PILLAR_WEIGHTS.margin,
      range: "0% of each sale kept scores 0; 30% or more scores 100",
      reason: marginScore === null ? "no_revenue" : "ok",
      href: HREF.margin,
      inputs: [
        { label: "Sales", value: money(netRevenueCents) },
        { label: "True profit", value: money(trueProfitCents) },
        {
          label: "Kept from each sale",
          value: marginPct === null ? "—" : `${marginPct.toFixed(1)}%`,
        },
      ],
    },
    {
      id: "concentration",
      label: "Concentration",
      score: concentrationScore,
      baseWeight: PILLAR_WEIGHTS.concentration,
      range: "20% or less from one name scores 100; 60% or more scores 0",
      reason: concentrationScore === null ? "no_revenue" : "ok",
      href: customerDrove ? HREF.concentration : HREF.offers,
      inputs: [
        {
          label: customerDrove ? "Biggest customer" : "Biggest seller",
          value: topSubject ?? "—",
        },
        {
          label: "Their share",
          value: worstShare === null ? "—" : `${worstShare.toFixed(1)}%`,
        },
      ],
    },
    {
      id: "trend",
      label: "Trend",
      score: trendScore,
      baseWeight: PILLAR_WEIGHTS.trend,
      range: "Your own normal scores 50; a typical swing better scores 75",
      reason: trendScore === null ? "no_history" : "ok",
      href: HREF.trend,
      inputs: [
        { label: "Profit this period", value: money(trueProfitCents) },
        {
          label: "Your normal",
          value:
            trueProfitBaseline?.reason === "ok" && trueProfitBaseline.normal !== null
              ? money(trueProfitBaseline.normal)
              : "not enough history yet",
        },
        {
          label: "Built from",
          value: trueProfitBaseline?.reason === "ok"
            ? `${trueProfitBaseline.sampleSize} past periods`
            : "—",
        },
      ],
    },
    {
      id: "ads",
      label: "Ad efficiency",
      score: null,
      baseWeight: PILLAR_WEIGHTS.ads,
      range: "Needs to know which sales came from ads",
      reason: "not_available_yet",
      href: HREF.ads,
      inputs: [],
    },
  ];

  // Renormalise across the pillars that produced a score, so an absent measure
  // costs nothing rather than scoring zero.
  const present = raw.filter((p) => p.score !== null);
  const totalWeight = present.reduce((sum, p) => sum + p.baseWeight, 0);

  const pillars: Pillar[] = raw.map(({ baseWeight, ...p }) => ({
    ...p,
    weightPct: totalWeight > 0 && p.score !== null ? Math.round((baseWeight / totalWeight) * 100) : 0,
  }));

  const state: PqsState =
    netRevenueCents <= 0 && trueProfitCents === 0
      ? "no_activity"
      : daysOfActivity < MIN_DAYS_FOR_SCORE
        ? "too_new"
        : "ok";

  const score =
    state !== "ok" || totalWeight === 0
      ? null
      : Math.round(
          present.reduce((sum, p) => sum + p.score! * p.baseWeight, 0) / totalWeight,
        );

  return {
    score,
    state,
    pillars,
    measuresUsed: present.length,
    measuresTotal: raw.length,
    daysOfActivity,
    crisis: trueProfitCents < 0,
  };
}

/**
 * What single change would raise the score most.
 *
 * The highest-value line in the drawer, because it converts a diagnostic into a
 * goal. Aims the weakest useful pillar at 75 rather than 100 — a target nobody
 * can reach is not a goal, it is a scold.
 */
export interface ScoreLever {
  pillarId: PillarId;
  label: string;
  from: number;
  to: number;
  /** What the total would become. */
  wouldScore: number;
}

export function biggestLever(pqs: Pqs): ScoreLever | null {
  if (pqs.score === null) return null;

  const present = pqs.pillars.filter((p) => p.score !== null && p.weightPct > 0);
  const totalWeight = present.reduce((sum, p) => sum + p.weightPct, 0);
  if (totalWeight === 0) return null;

  let best: ScoreLever | null = null;
  for (const pillar of present) {
    if (pillar.score! >= TARGET_LEVEL) continue;
    const improved = present.reduce(
      (sum, p) => sum + (p.id === pillar.id ? TARGET_LEVEL : p.score!) * p.weightPct,
      0,
    );
    const wouldScore = Math.round(improved / totalWeight);
    if (wouldScore <= pqs.score) continue;
    if (!best || wouldScore > best.wouldScore) {
      best = {
        pillarId: pillar.id,
        label: pillar.label,
        from: pillar.score!,
        to: TARGET_LEVEL,
        wouldScore,
      };
    }
  }
  return best;
}

/**
 * The verdict sentence, in the shape the brief fixes: *[what held] but [what
 * slipped]*, or *[what improved]*.
 *
 * Rules pick WHICH two pillars matter; an LLM may later phrase them. Never let
 * a model choose what to say — only how to say it.
 */
export function verdictSentence(pqs: Pqs, delta: number | null): string {
  if (pqs.state === "no_activity") return "Record your first sale and your score starts building.";
  if (pqs.state === "too_new") {
    const left = Math.max(0, MIN_DAYS_FOR_SCORE - pqs.daysOfActivity);
    return `We need about ${left} more ${left === 1 ? "day" : "days"} of activity before your score means anything.`;
  }
  if (pqs.crisis) return "You spent more than you made, so the score is being carried by everything else.";

  const scored = pqs.pillars.filter((p) => p.score !== null);
  const strongest = [...scored].sort((a, b) => b.score! - a.score!)[0];
  const weakest = [...scored].sort((a, b) => a.score! - b.score!)[0];

  if (!strongest || !weakest) return "Your score is building as you record more.";

  const held = strongest.label.toLowerCase();
  const slipped = weakest.label.toLowerCase();

  // Only when there genuinely IS one measure. Comparing ids caught the case
  // where all three tie — a sort is stable, so strongest and weakest come back
  // as the same element — and told a business with three perfect pillars that
  // it had only one.
  if (scored.length === 1) {
    return delta !== null && delta > 0
      ? `Your ${held} is carrying the score, and it improved this period.`
      : `Your ${held} is the only measure with enough behind it so far.`;
  }
  if (weakest.score! >= STRONG_ABOVE) return `Every measure is strong — ${held} most of all.`;
  if (weakest.score! < WEAK_BELOW) return `Your ${held} held up, but ${slipped} is dragging the score down.`;
  return `Your ${held} is the strongest part; ${slipped} has the most room left.`;
}
