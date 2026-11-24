import { addCents, type Cents } from "./money";

/**
 * What you sell, ranked and mapped.
 *
 * Two signature elements, both of which exist to make a forty-row table
 * unnecessary: a podium that makes your best offer physically the biggest thing
 * on the screen, and a quadrant map that tells you what to push, fix or kill in
 * one look.
 *
 * The load-bearing decision in here is what "high margin" and "high volume"
 * MEAN. There is no cross-vertical absolute — a 60% margin is ordinary for a
 * consultancy and extraordinary for a grocer, and "high volume" is four sales a
 * month for one business and four thousand for another. So both axes split on
 * the business's own MEDIAN offer. Every business gets a map that reads
 * correctly, and no benchmark is invented from data we do not have.
 */

export interface OfferStat {
  id: string;
  name: string;
  unitsSold: number;
  netRevenueCents: Cents;
  contributionProfitCents: Cents;
  /** Null when the offer sold nothing — no revenue means no margin, not 0%. */
  marginPct: number | null;
}

// ── Podium ───────────────────────────────────────────────────────────────────

export interface PodiumEntry {
  id: string;
  name: string;
  contributionProfitCents: Cents;
  netRevenueCents: Cents;
  /** Share of everything the business kept, 0–100. */
  sharePct: number;
}

export interface Podium {
  entries: PodiumEntry[];
  /** Total kept across every profitable offer — what the shares are of. */
  totalContributionCents: Cents;
  /**
   * A podium of two looks broken, so below three profitable offers there is no
   * podium and the page shows the map alone.
   */
  show: boolean;
}

export function buildPodium(items: OfferStat[], size = 3): Podium {
  const earning = items
    .filter((i) => i.contributionProfitCents > 0)
    .sort((a, b) => b.contributionProfitCents - a.contributionProfitCents);

  const total = earning.reduce((sum, i) => addCents(sum, i.contributionProfitCents), 0);

  return {
    entries: earning.slice(0, size).map((i) => ({
      id: i.id,
      name: i.name,
      contributionProfitCents: i.contributionProfitCents,
      netRevenueCents: i.netRevenueCents,
      sharePct: total > 0 ? (i.contributionProfitCents / total) * 100 : 0,
    })),
    totalContributionCents: total,
    show: earning.length >= size,
  };
}

// ── Quadrant map ─────────────────────────────────────────────────────────────

/**
 * Plain labels, because the point of the chart is that it needs no explaining.
 *
 * `traps` is the one that earns the whole map: high volume, low margin — busy
 * work that keeps a business exhausted and poor, and which every revenue-ranked
 * report on the market shows at the TOP.
 */
export type Quadrant = "winners" | "hidden-gems" | "traps" | "dead-weight";

export const QUADRANT_LABEL: Record<Quadrant, string> = {
  winners: "Winners",
  "hidden-gems": "Hidden gems",
  traps: "Traps",
  "dead-weight": "Dead weight",
};

export const QUADRANT_MEANING: Record<Quadrant, string> = {
  winners: "Brings in a lot and keeps you plenty. Push these.",
  "hidden-gems": "Keeps you plenty but brings in little. Worth pushing harder.",
  traps: "Brings in a lot and keeps you little. Busy work that does not pay.",
  "dead-weight": "Brings in little and keeps you little. Candidates to drop.",
};

export interface QuadrantDot {
  id: string;
  name: string;
  /**
   * The X axis: how much money this brings in — NOT units sold.
   *
   * Units were the obvious reading of "volume" and they are wrong for any
   * business with mixed price points. On the seed, a web build sold twice at
   * Rs 32,550 each was the single biggest earner in the company and landed in
   * "Dead weight" next to a podium calling it the best thing they sell. Two
   * mugs and two web builds are not the same amount of business, and the
   * quadrant names — Traps, Dead weight — are about CONTRIBUTION, not headcount.
   */
  revenueCents: Cents;
  /** Margin percentage — the Y axis. */
  marginPct: number;
  /** Units sold decides the dot's size. */
  unitsSold: number;
  netRevenueCents: Cents;
  contributionProfitCents: Cents;
  quadrant: Quadrant;
}

export interface QuadrantMap {
  dots: QuadrantDot[];
  /** The crosshair: this business's own median offer. */
  revenueMidpoint: number;
  marginMidpoint: number;
  /**
   * Nothing sold has a cost recorded against it, so every margin is 100% and
   * the map has no vertical information at all. The page must offer to fix that
   * rather than draw a chart where every dot is a winner.
   */
  missingCosts: boolean;
  /**
   * Offers left OFF the map because nothing has been costed against them.
   *
   * The partial case is the common one and the more damaging: an uncosted offer
   * reads as a flawless 100% margin, which both parks it in Winners on no
   * evidence AND drags the median up so genuinely healthy offers fall below the
   * line. Excluded and counted, so the page can ask for the missing costs.
   */
  uncostedCount: number;
  uncostedNames: string[];
  /** Below this there is no meaningful spread to map. */
  show: boolean;
}

/** Median of a numeric list. Empty → 0. */
function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Two dots cannot make four quadrants mean anything. */
export const MIN_OFFERS_FOR_MAP = 3;

/** An offer whose contribution equals its revenue has had nothing costed against it. */
const isUncosted = (i: OfferStat) => i.contributionProfitCents === i.netRevenueCents;

export function buildQuadrantMap(items: OfferStat[]): QuadrantMap {
  // Only offers that actually sold can be placed: an offer with no sales has no
  // volume AND no margin, so plotting it at the origin would invent a position
  // and drop it in Dead weight on no evidence.
  const sold = items.filter((i) => i.unitsSold > 0 && i.marginPct !== null);

  const uncosted = sold.filter(isUncosted);
  const costed = sold.filter((i) => !isUncosted(i));

  // Every margin identical to its revenue means nobody has costed anything.
  const missingCosts = sold.length > 0 && costed.length === 0;

  // The midpoints come from the COSTED offers only. Including a handful of
  // uncosted 100%-margin rows pulled the median up far enough that a healthy
  // 70% service fell below the line and was labelled a trap.
  const revenueMidpoint = median(costed.map((i) => i.netRevenueCents));
  const marginMidpoint = median(costed.map((i) => i.marginPct!));

  const dots: QuadrantDot[] = costed.map((i) => {
    const highRevenue = i.netRevenueCents >= revenueMidpoint;
    const highMargin = i.marginPct! >= marginMidpoint;
    const quadrant: Quadrant = highMargin
      ? highRevenue
        ? "winners"
        : "hidden-gems"
      : highRevenue
        ? "traps"
        : "dead-weight";

    return {
      id: i.id,
      name: i.name,
      revenueCents: i.netRevenueCents,
      marginPct: i.marginPct!,
      unitsSold: i.unitsSold,
      netRevenueCents: i.netRevenueCents,
      contributionProfitCents: i.contributionProfitCents,
      quadrant,
    };
  });

  return {
    dots,
    revenueMidpoint,
    marginMidpoint,
    missingCosts,
    uncostedCount: uncosted.length,
    uncostedNames: uncosted.map((i) => i.name),
    show: dots.length >= MIN_OFFERS_FOR_MAP && !missingCosts,
  };
}

// ── The surprise worth surfacing ─────────────────────────────────────────────

export interface RevenueVsProfitFlip {
  revenueLeader: OfferStat;
  profitLeader: OfferStat;
}

/**
 * When your best SELLER is not your best EARNER.
 *
 * The most eye-opening view in the app, and the reason "top offer by profit,
 * not revenue" is worth saying out loud: every other tool ranks by revenue, so
 * this is the fact their reports structurally cannot show you.
 */
export function revenueVsProfitFlip(items: OfferStat[]): RevenueVsProfitFlip | null {
  const withSales = items.filter((i) => i.unitsSold > 0 && i.netRevenueCents > 0);
  if (withSales.length < 2) return null;

  const revenueLeader = [...withSales].sort((a, b) => b.netRevenueCents - a.netRevenueCents)[0];
  const profitLeader = [...withSales].sort(
    (a, b) => b.contributionProfitCents - a.contributionProfitCents,
  )[0];

  if (revenueLeader.id === profitLeader.id) return null;
  // "Earns you the most" has to be true. In a period where everything lost
  // money the profit leader is only the one that lost LEAST, and calling that
  // your best earner is a plain falsehood — the page says the honest thing
  // instead.
  if (profitLeader.contributionProfitCents <= 0) return null;
  return { revenueLeader, profitLeader };
}

/**
 * The verdict sentence above the page.
 *
 * Leads with the flip when there is one, because that is the single most
 * useful thing this page can tell anybody.
 */
export function offersSentence(
  items: OfferStat[],
  podium: Podium,
  money: (cents: Cents) => string,
): string {
  const sold = items.filter((i) => i.unitsSold > 0);
  if (sold.length === 0) {
    return "Nothing sold in this period, so there is nothing to rank yet.";
  }

  const flip = revenueVsProfitFlip(items);
  if (flip) {
    return `${flip.revenueLeader.name} brings in the most money, but ${flip.profitLeader.name} earns you the most.`;
  }

  const top = podium.entries[0];
  if (!top) {
    return "Nothing you sold made a profit this period.";
  }
  if (podium.totalContributionCents <= 0) {
    return `${top.name} is your best, though nothing turned a profit overall this period.`;
  }
  return `${top.name} earns you the most — ${money(top.contributionProfitCents)}, ${top.sharePct.toFixed(0)}% of everything you kept.`;
}
