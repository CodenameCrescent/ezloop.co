import { addCents, type Cents } from "./money";

/**
 * Is my ad spend making money?
 *
 * **What this page can and cannot know, stated once.** Nothing links a sale to
 * the advert that caused it — `transaction_lines.attributed_campaign_id` exists
 * but is inert, and no connector fills it. So per-channel ROAS is not
 * computable, and any number claiming it would be invented.
 *
 * What IS computable is more useful than it sounds, and it rests on the one
 * thing this app has that ad tools do not: real margin, from frozen cost
 * snapshots.
 *
 * 1. **Break-even ROAS from YOUR margin, not a generic 3×.** If you keep 40p in
 *    the pound, every £1 of ads must bring in £2.50 of sales just to pay for
 *    itself. Almost no competitor computes this because they do not have
 *    reliable margin data. This needs no attribution at all.
 *
 * 2. **A one-sided test that is always true.** Compare ad spend against ALL the
 *    margin the business made. If the ads did not cover themselves even when
 *    credited with every last penny of margin the business earned, then they
 *    certainly did not cover themselves — no attribution required to know that.
 *    The reverse does not follow, and the copy never claims it does.
 *
 * Everything blended is LABELLED blended. "Came alongside" rather than
 * "returned", because correlation is all we have and pretending otherwise is
 * the invented-number failure wearing a marketing hat.
 */

export type MarketingState = "no_spend" | "no_revenue" | "no_margin" | "ok";

export interface MarketingInput {
  adSpendCents: Cents;
  byPlatform: Array<{ platform: string; amountCents: Cents }>;
  netRevenueCents: Cents;
  /** Margin after the cost of delivering, before fixed costs. */
  contributionProfitCents: Cents;
  /** After everything, including the ad spend itself. */
  trueProfitCents: Cents;
  /** People whose FIRST purchase landed in this period. */
  newCustomerCount: number;
  priorAdSpendCents: Cents;
  priorTrueProfitCents: Cents;
}

export interface Marketing {
  state: MarketingState;
  adSpendCents: Cents;
  byPlatform: Array<{ platform: string; amountCents: Cents; sharePct: number }>;

  /** What you keep from each sale, before fixed costs. Null with no revenue. */
  contributionMarginPct: number | null;

  /**
   * Sales each £1 of ads must bring in just to pay for itself, AT YOUR MARGIN.
   * Null when there is no margin to divide by.
   */
  breakEvenRoas: number | null;

  /**
   * Sales that came alongside each £1 of ad spend. NOT attributed — this is
   * every sale in the period over every pound of ads, and the copy says so.
   */
  blendedRoas: number | null;

  /**
   * Margin that came alongside each £1 of ad spend. Below 1 this is proof the
   * ads lost money; above 1 it proves nothing either way.
   */
  blendedMarginReturn: number | null;

  /** True when the ads did not cover themselves even credited with ALL margin. */
  definitelyLostMoney: boolean;

  profitBeforeAdsCents: Cents;
  profitAfterAdsCents: Cents;

  /** Ad spend ÷ new customers. Null when nobody new arrived. */
  costPerNewCustomerCents: Cents | null;
  newCustomerCount: number;

  /** Basis points, so it stays an integer. Null when there is no revenue. */
  shareOfRevenueBps: number | null;

  /** Spend rose and profit did not follow. */
  spendUpProfitDown: boolean;
}

const ratio = (numerator: Cents, denominator: Cents): number | null =>
  denominator > 0 ? numerator / denominator : null;

export function computeMarketing(input: MarketingInput): Marketing {
  const {
    adSpendCents,
    byPlatform,
    netRevenueCents,
    contributionProfitCents,
    trueProfitCents,
    newCustomerCount,
    priorAdSpendCents,
    priorTrueProfitCents,
  } = input;

  const contributionMarginPct =
    netRevenueCents > 0 ? (contributionProfitCents / netRevenueCents) * 100 : null;

  // Break-even ROAS is 1 ÷ margin rate: at a 40% margin you need 2.5× sales per
  // pound spent. Undefined when the margin is zero or negative — you cannot
  // advertise your way out of selling at a loss, and there is no multiple that
  // fixes it.
  const breakEvenRoas =
    contributionMarginPct !== null && contributionMarginPct > 0 ? 100 / contributionMarginPct : null;

  const blendedRoas = ratio(netRevenueCents, adSpendCents);
  const blendedMarginReturn = ratio(contributionProfitCents, adSpendCents);

  const state: MarketingState =
    adSpendCents <= 0
      ? "no_spend"
      : netRevenueCents <= 0
        ? "no_revenue"
        : contributionProfitCents <= 0
          ? "no_margin"
          : "ok";

  return {
    state,
    adSpendCents,
    byPlatform: byPlatform
      .map((p) => ({
        ...p,
        sharePct: adSpendCents > 0 ? (p.amountCents / adSpendCents) * 100 : 0,
      }))
      .sort((a, b) => b.amountCents - a.amountCents),
    contributionMarginPct,
    breakEvenRoas,
    blendedRoas,
    blendedMarginReturn,
    // The one-sided test. Only claimed when there IS spend to judge.
    definitelyLostMoney: adSpendCents > 0 && contributionProfitCents < adSpendCents,
    // True profit already has the ad spend taken out of it, so adding it back
    // gives the before figure rather than recomputing anything.
    profitBeforeAdsCents: addCents(trueProfitCents, adSpendCents),
    profitAfterAdsCents: trueProfitCents,
    // Null with no spend, not zero. "Rs 0.00 per new customer" reads as a
    // triumph when the truth is that you did not advertise — the field would
    // look meaningful and not be.
    costPerNewCustomerCents:
      newCustomerCount > 0 && adSpendCents > 0
        ? Math.round(adSpendCents / newCustomerCount)
        : null,
    newCustomerCount,
    shareOfRevenueBps:
      netRevenueCents > 0 ? Math.round((adSpendCents / netRevenueCents) * 10_000) : null,
    spendUpProfitDown:
      adSpendCents > priorAdSpendCents && trueProfitCents < priorTrueProfitCents,
  };
}

/**
 * The verdict above the page.
 *
 * Leads with the proof when there is one, because "your ads definitely lost
 * money" is the single most valuable sentence this page can produce, and it is
 * one of the few ad claims anybody can make honestly without attribution.
 */
export function marketingSentence(
  m: Marketing,
  money: (cents: Cents) => string,
  contributionProfitCents: Cents,
): string {
  if (m.state === "no_spend") {
    return "You have not logged any ad spend for this period, so there is nothing to judge yet.";
  }
  if (m.state === "no_revenue") {
    return `You spent ${money(m.adSpendCents)} on ads and no sales were recorded in this period.`;
  }
  if (m.state === "no_margin") {
    return `You spent ${money(m.adSpendCents)} on ads while your sales were not covering their own costs — advertising cannot fix that.`;
  }

  // The one-sided proof. Everything sold in the period left less margin than
  // the ads cost, so the ads cannot have paid for themselves however the sales
  // are eventually attributed.
  if (m.definitelyLostMoney) {
    return `You spent ${money(m.adSpendCents)} on ads, and everything you sold left only ${money(contributionProfitCents)} — the ads did not pay for themselves.`;
  }

  // A concrete pair of amounts, not a multiplier applied to a unit. "Every
  // Rs 1.00 of ads has to bring in 1.3 times that" made the reader do the
  // arithmetic the sentence exists to save them.
  const per = 100_00;
  return `At your margins, every ${money(per)} of ads has to bring in ${money(Math.round(per * m.breakEvenRoas!))} of sales just to pay for itself.`;
}

/**
 * The caveat that travels with every blended figure on this page.
 *
 * Stated as its own sentence rather than a footnote, because silently omitting
 * it is the thing that destroys trust fastest on an ad screen.
 */
export const BLENDED_CAVEAT =
  "Nothing yet records which sales came from which advert, so these compare your ad spend against ALL your sales, not just the ones ads brought in.";
