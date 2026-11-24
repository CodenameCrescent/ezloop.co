import { compareToBaseline, excessAboveNormalCents, normalPhrase } from "./baseline";
import { addCents, percentOfCents, type Cents } from "./money";
import { MIN_COST_RISE_PCT, describeAge } from "./priceDrift";
import { defineRule, type Insight, type InsightFacts, type Rule } from "./rules";

/**
 * The rule catalogue.
 *
 * Every rule here obeys the same four laws:
 *
 *   1. **It carries a money figure**, or it is not a card. A condition that
 *      cannot be priced is a log entry. This is why there is no
 *      "some expenses are unclassified" card: the amount is real spending, not
 *      money lost, and booking it as either a gain or a loss would corrupt the
 *      leak total that the Summary toggle advertises. It belongs in a data-
 *      quality strip, which is a different piece of furniture.
 *   2. **It compares the business to its own normal wherever a normal exists.**
 *      A 4% refund rate is a crisis for a consultancy and a Tuesday for a
 *      clothing shop. Fixed thresholds survive only as a floor for businesses
 *      too young to have a history.
 *   3. **Its cause line contains real numbers and only one of them.**
 *   4. **Its Explain shows the actual arithmetic** — the inputs, the threshold
 *      that fired, the period compared. The first reaction to a surprising card
 *      is disbelief, and nothing else answers it.
 *
 * Money is computed with `addCents` / `percentOfCents` throughout. A percentage
 * of money is never taken with `*` — the rate goes in as a decimal string so
 * decimal.js rounds it half-up, exactly as the ladder does.
 */

const MONEY_PAGE = "/insights/profit";
const LEAKS_PAGE = "/insights/leaks";
const CUSTOMERS_PAGE = "/insights/customers";

/** A percentage as a decimal string, for exact `percentOfCents` arithmetic. */
const rate = (pct: number) => pct.toFixed(4);

const pct = (n: number) => `${n.toFixed(1)}%`;

/** Margin as a percentage of net revenue, or null when there is no revenue to divide by. */
function marginPctOf(trueProfit: Cents, netRevenue: Cents): number | null {
  if (netRevenue <= 0) return null;
  return (trueProfit / netRevenue) * 100;
}

// ── Money ────────────────────────────────────────────────────────────────────

/**
 * Running at a loss.
 *
 * Urgent rather than merely large: an owner losing money needs to see it above
 * a bigger number that is only a leak.
 */
const runningAtALoss = defineRule({
  id: "running-at-a-loss",
  page: "money",
  evaluate: (f) => {
    if (f.current.netRevenue <= 0 || f.current.trueProfit >= 0) return null;
    return {
      id: "running-at-a-loss",
      impactCents: f.current.trueProfit,
      headline: "You are losing money this period",
      cause: `You brought in ${f.money(f.current.netRevenue)} and spent more than that.`,
      action: { label: "See where it went", href: LEAKS_PAGE },
      explain: {
        threshold: "Fires when true profit is below zero",
        comparisonPeriod: f.comparisonPeriod,
        inputs: [
          { label: "Money in", value: f.money(f.current.netRevenue) },
          { label: "Cost of what you sold", value: f.money(f.current.netRevenue - f.current.contributionProfit) },
          { label: "Running costs", value: f.money(f.current.periodExpenses) },
          { label: "True profit", value: f.money(f.current.trueProfit) },
        ],
      },
      severity: "critical",
      subject: "profit",
      page: "money",
      urgent: true,
    } satisfies Insight;
  },
});

/**
 * Revenue grew but profit didn't — the classic trap, and the moment the app
 * proves it is worth more than a sales report.
 */
const revenueUpProfitDown = defineRule({
  id: "revenue-up-profit-down",
  page: "money",
  evaluate: (f) => {
    const revenueGrew = f.current.grossRevenue > f.prior.grossRevenue;
    const profitFell = f.current.trueProfit < f.prior.trueProfit;
    if (!revenueGrew || !profitFell || f.prior.grossRevenue <= 0) return null;

    const profitDrop = addCents(f.current.trueProfit, -f.prior.trueProfit);
    const revenueGain = addCents(f.current.grossRevenue, -f.prior.grossRevenue);

    return {
      id: "revenue-up-profit-down",
      impactCents: profitDrop,
      headline: "You sold more and kept less",
      cause: `Sales rose ${f.money(revenueGain)} but profit fell ${f.money(Math.abs(profitDrop))}.`,
      action: { label: "See what changed", href: MONEY_PAGE },
      explain: {
        threshold: "Fires when sales rise and true profit falls in the same period",
        comparisonPeriod: f.comparisonPeriod,
        inputs: [
          { label: "Sales before", value: f.money(f.prior.grossRevenue) },
          { label: "Sales now", value: f.money(f.current.grossRevenue) },
          { label: "Profit before", value: f.money(f.prior.trueProfit) },
          { label: "Profit now", value: f.money(f.current.trueProfit) },
        ],
      },
      severity: "critical",
      subject: "profit",
      page: "money",
    } satisfies Insight;
  },
});

/**
 * Margin slipped by enough points to matter.
 *
 * The impact is what the OLD margin would have earned on today's sales, minus
 * what was actually earned — the money the slip cost, not the slip itself.
 */
const marginSlipping = defineRule({
  id: "margin-slipping",
  page: "money",
  evaluate: (f) => {
    const now = marginPctOf(f.current.trueProfit, f.current.netRevenue);
    const before = marginPctOf(f.prior.trueProfit, f.prior.netRevenue);
    if (now === null || before === null || before <= 0) return null;

    const dropPts = before - now;
    if (dropPts < 3) return null;

    const wouldHaveEarned = percentOfCents(f.current.netRevenue, rate(before));
    const cost = addCents(f.current.trueProfit, -wouldHaveEarned);

    return {
      id: "margin-slipping",
      impactCents: cost,
      headline: "You keep less of every sale now",
      cause: `You kept ${pct(before)} of each sale before and ${pct(now)} now.`,
      action: { label: "See what changed", href: MONEY_PAGE },
      explain: {
        threshold: "Fires when the share of each sale you keep drops 3 points or more",
        comparisonPeriod: f.comparisonPeriod,
        inputs: [
          { label: "Kept before", value: pct(before) },
          { label: "Kept now", value: pct(now) },
          { label: "Sales this period", value: f.money(f.current.netRevenue) },
          { label: "At the old rate you'd have kept", value: f.money(wouldHaveEarned) },
        ],
      },
      severity: "normal",
      subject: "margin",
      page: "money",
    } satisfies Insight;
  },
});

/** Sales did not cover the fixed costs of the period. */
const belowBreakEven = defineRule({
  id: "below-break-even",
  page: "money",
  evaluate: (f) => {
    const { breakEven } = f;
    if (breakEven.reason !== "ok") return null;
    if (breakEven.surplusCents === null || breakEven.surplusCents >= 0) return null;
    if (breakEven.breakEvenRevenueCents === null) return null;

    return {
      id: "below-break-even",
      impactCents: breakEven.surplusCents,
      headline: "Sales did not cover your fixed costs",
      cause: `You needed ${f.money(breakEven.breakEvenRevenueCents)} of sales and made ${f.money(f.current.netRevenue)}.`,
      action: { label: "See your fixed costs", href: "/money/budget" },
      explain: {
        threshold: "Fires when sales fall short of the break-even point",
        comparisonPeriod: f.comparisonPeriod,
        inputs: [
          { label: "Fixed costs", value: f.money(breakEven.fixedExpensesCents) },
          { label: "Sales needed", value: f.money(breakEven.breakEvenRevenueCents) },
          { label: "Sales made", value: f.money(f.current.netRevenue) },
          { label: "Short by", value: f.money(Math.abs(breakEven.surplusCents)) },
        ],
      },
      severity: "critical",
      subject: "break-even",
      page: "money",
    } satisfies Insight;
  },
});

/**
 * Refunds above this business's own normal.
 *
 * Only the EXCESS is the leak. A shop whose refunds are exactly typical is not
 * leaking money to refunds, it is running a shop — and telling it otherwise is
 * how an app teaches people to ignore it.
 */
const refundsAboveNormal = defineRule({
  id: "refunds-above-normal",
  page: "money",
  evaluate: (f) => {
    const baseline = f.baselines.refundsCents;
    if (!baseline) return null;

    const comparison = compareToBaseline(f.leaks.refundsCents, baseline);
    if (!comparison.isUnusual || comparison.direction !== "above") return null;

    const excess = excessAboveNormalCents(comparison);
    if (excess <= 0) return null;

    const normal = normalPhrase(baseline, f.money);
    const leader = f.leaks.topRefundItem ? ` ${f.leaks.topRefundItem.name} leads them.` : "";

    return {
      id: "refunds-above-normal",
      impactCents: -excess,
      headline: "Refunds are running above your normal",
      cause: `You refunded ${f.money(f.leaks.refundsCents)} this period, ${normal ?? "well above your usual"}.${leader}`,
      action: { label: "See the refunds", href: LEAKS_PAGE },
      explain: {
        threshold: `Fires when refunds sit more than 3× the usual swing above your normal of ${f.money(baseline.normal ?? 0)}`,
        comparisonPeriod: `Your last ${baseline.sampleSize} periods`,
        inputs: [
          { label: "Refunded this period", value: f.money(f.leaks.refundsCents) },
          { label: "Your normal", value: f.money(baseline.normal ?? 0) },
          { label: "Usual swing", value: f.money(baseline.deviation ?? 0) },
          { label: "Above normal by", value: f.money(excess) },
        ],
      },
      severity: "normal",
      subject: "refunds",
      page: "money",
    } satisfies Insight;
  },
});

/**
 * Discounting is eating an unusual share of sales.
 *
 * Falls back to a fixed 15%-of-sales line for a business too young to have a
 * normal — a young business still deserves the warning, it just gets a blunter
 * one, and the Explain says which test fired.
 */
const discountDrain = defineRule({
  id: "discount-drain",
  page: "money",
  evaluate: (f) => {
    if (f.leaks.discountsCents <= 0 || f.current.grossRevenue <= 0) return null;

    const baseline = f.baselines.discountsCents;
    const comparison = baseline ? compareToBaseline(f.leaks.discountsCents, baseline) : null;

    const unusual = comparison?.isUnusual === true && comparison.direction === "above";
    const overFixedLine = f.leaks.discountPctOfGross >= 15;
    if (!unusual && !overFixedLine) return null;

    // A card headlined "taking a big bite" whose own cause line reads "0.0% of
    // your sales" contradicts itself, and a reader who catches the app in one
    // contradiction stops believing the numbers beside it. Unusual-for-you is
    // necessary but not sufficient: it has to be a real share of the money too.
    if (f.leaks.discountPctOfGross < 5) return null;

    // Against a normal, the leak is the excess. Without one, the honest figure
    // is the discount itself — we cannot say what part of it was unusual.
    const excess = comparison ? excessAboveNormalCents(comparison) : 0;
    const impact = unusual && excess > 0 ? excess : f.leaks.discountsCents;

    return {
      id: "discount-drain",
      impactCents: -impact,
      headline: "Discounts are taking a big bite",
      cause: `You gave away ${f.money(f.leaks.discountsCents)} — ${pct(f.leaks.discountPctOfGross)} of your sales.`,
      action: { label: "See the discounts", href: LEAKS_PAGE },
      explain: {
        threshold: unusual
          ? "Fires when discounting runs well above your own normal"
          : "Fires when discounts pass 15% of sales",
        comparisonPeriod: unusual ? `Your last ${baseline!.sampleSize} periods` : f.comparisonPeriod,
        inputs: [
          { label: "Given away", value: f.money(f.leaks.discountsCents) },
          { label: "Share of sales", value: pct(f.leaks.discountPctOfGross) },
          ...(unusual ? [{ label: "Your normal", value: f.money(baseline!.normal ?? 0) }] : []),
        ],
      },
      severity: "normal",
      subject: "discounts",
      page: "money",
    } satisfies Insight;
  },
});

/**
 * Money earned, invoiced, and still not in the bank after 30 days.
 *
 * Shown as a loss because it behaves like one from where the owner sits: it is
 * counted in profit and absent from the account. The action is to chase it, not
 * to write it off, and the copy says so.
 */
const unpaidOver30 = defineRule({
  id: "unpaid-over-30",
  page: "money",
  evaluate: (f) => {
    if (f.leaks.unpaidOver30Count === 0 || f.leaks.unpaidOver30Cents <= 0) return null;
    const n = f.leaks.unpaidOver30Count;

    return {
      id: "unpaid-over-30",
      impactCents: -f.leaks.unpaidOver30Cents,
      headline: "Money you earned is still unpaid",
      cause: `${n} sale${n === 1 ? "" : "s"} worth ${f.money(f.leaks.unpaidOver30Cents)} passed 30 days unpaid.`,
      action: { label: "See who owes you", href: LEAKS_PAGE },
      explain: {
        threshold: "Fires when any sale has gone unpaid for more than 30 days",
        comparisonPeriod: f.comparisonPeriod,
        inputs: [
          { label: "Unpaid over 30 days", value: f.money(f.leaks.unpaidOver30Cents) },
          { label: "How many sales", value: String(n) },
          { label: "Unpaid in total", value: f.money(f.leaks.unpaidTotalCents) },
        ],
      },
      severity: "normal",
      subject: "unpaid",
      page: "money",
    } satisfies Insight;
  },
});

/**
 * You pay out before you get paid.
 *
 * ★ Almost nothing else on the market can say this, because almost nothing else
 * stores both dates. Every transaction here carries `occurred_at` (when it
 * happened) and `paid_at` (when the cash moved), so the two habits can simply
 * be measured and subtracted.
 *
 * The money figure is the working capital the gap ties up: at your rate of
 * selling, roughly this much of your money is out of your hands at any moment.
 * It is marked `exposure` because it has NOT been lost — counting delayed cash
 * in "you're leaking Rs X" would inflate the most persuasive number in the
 * product with money that is merely late.
 */
const MIN_PAID_SAMPLE = 5;
const MIN_GAP_DAYS = 7;

const paymentHabitGap = defineRule({
  id: "payment-habit-gap",
  page: "money",
  evaluate: (f) => {
    const { customerDaysToPay, supplierDaysToPay, paidSalesCount, paidBillsCount } = f.paymentHabit;

    // Both habits have to be real measurements. One side alone is a fact about
    // the business, not a gap between two of them.
    if (customerDaysToPay === null || supplierDaysToPay === null) return null;
    if (paidSalesCount < MIN_PAID_SAMPLE || paidBillsCount < MIN_PAID_SAMPLE) return null;

    const gapDays = Math.round(customerDaysToPay - supplierDaysToPay);
    // A gap the wrong way round is good news — you are being paid before you
    // pay out — and it is not this rule's job to report it.
    if (gapDays < MIN_GAP_DAYS) return null;
    if (f.current.netRevenue <= 0 || f.periodDays <= 0) return null;

    // Daily selling rate × the gap = money out on loan to customers at any
    // moment. Rounded to whole cents; this is an estimate of a standing
    // position, and the copy says "roughly".
    const perDay = Math.round(f.current.netRevenue / f.periodDays);
    const tiedUp = perDay * gapDays;
    if (tiedUp <= 0) return null;

    return {
      id: "payment-habit-gap",
      impactCents: -tiedUp,
      exposure: true,
      // The figure renders red like any negative, which is right for a drag on
      // cash but wrong if read as money gone. The suffix says which it is on
      // the card itself, where the reader is, rather than only in the docs.
      impactSuffix: " tied up",
      headline: "You pay out before you get paid",
      cause: `Customers take ${Math.round(customerDaysToPay)} days to pay you and you pay your bills in ${Math.round(supplierDaysToPay)}.`,
      action: { label: "See who owes you", href: LEAKS_PAGE },
      explain: {
        threshold: `Fires when customers take at least ${MIN_GAP_DAYS} days longer than you do, measured on ${MIN_PAID_SAMPLE}+ paid transactions each way`,
        comparisonPeriod: f.comparisonPeriod,
        inputs: [
          { label: "Customers take", value: `${Math.round(customerDaysToPay)} days` },
          { label: "You take", value: `${Math.round(supplierDaysToPay)} days` },
          { label: "The gap", value: `${gapDays} days` },
          { label: "You sell about", value: `${f.money(perDay)} a day` },
          { label: "So roughly this is tied up", value: f.money(tiedUp) },
          // Stated rather than hidden: only paid transactions can be timed, so
          // the slowest payers — the ones still unpaid — are missing from the
          // customer figure, which makes it optimistic.
          {
            label: "Measured on",
            value: `${paidSalesCount} paid sales and ${paidBillsCount} paid bills`,
          },
        ],
      },
      severity: "normal",
      subject: "payment-timing",
      page: "money",
    } satisfies Insight;
  },
});

/** A processing or platform fee that grew against the period before. */
const feeCreep = defineRule({
  id: "fee-creep",
  page: "money",
  evaluate: (f) => {
    const fee = f.leaks.topFee;
    if (!fee || fee.priorCents <= 0) return null;

    const growth = addCents(fee.currentCents, -fee.priorCents);
    if (growth <= 0) return null;
    // A fee that grew because sales grew is not creep. Only flag it when it
    // outgrew sales — otherwise every good month produces a fee warning.
    const revenueGrowth = addCents(f.current.grossRevenue, -f.prior.grossRevenue);
    const feeOutranSales =
      f.prior.grossRevenue > 0 &&
      growth / fee.priorCents > Math.max(0, revenueGrowth) / f.prior.grossRevenue + 0.1;
    if (!feeOutranSales) return null;

    return {
      id: "fee-creep",
      impactCents: -growth,
      headline: `${fee.name} is costing more`,
      cause: `It went from ${f.money(fee.priorCents)} to ${f.money(fee.currentCents)}, faster than your sales grew.`,
      action: { label: "See your fees", href: LEAKS_PAGE },
      explain: {
        threshold: "Fires when a fee grows more than 10 points faster than sales",
        comparisonPeriod: f.comparisonPeriod,
        inputs: [
          { label: "Fee before", value: f.money(fee.priorCents) },
          { label: "Fee now", value: f.money(fee.currentCents) },
          { label: "Sales before", value: f.money(f.prior.grossRevenue) },
          { label: "Sales now", value: f.money(f.current.grossRevenue) },
        ],
      },
      severity: "normal",
      subject: `fee:${fee.name}`,
      page: "money",
    } satisfies Insight;
  },
});

// ── Offers ───────────────────────────────────────────────────────────────────

/** Something you sell costs more to deliver than it earns. */
const offerLosingMoney = defineRule({
  id: "offer-losing-money",
  page: "offers",
  evaluate: (f) => {
    const worst = f.items
      .filter((i) => i.unitsSold > 0 && i.contributionProfitCents < 0)
      .sort((a, b) => a.contributionProfitCents - b.contributionProfitCents)[0];
    if (!worst) return null;

    return {
      id: "offer-losing-money",
      impactCents: worst.contributionProfitCents,
      headline: `${worst.name} loses money on every sale`,
      cause: `It brought in ${f.money(worst.netRevenueCents)} and cost more than that to deliver.`,
      action: { label: "Check its costs", href: "/setup/revenue" },
      explain: {
        threshold: "Fires when what you sell earns less than it costs to deliver, before any fixed costs",
        comparisonPeriod: f.comparisonPeriod,
        inputs: [
          { label: "Sold", value: `${worst.unitsSold}` },
          { label: "Brought in", value: f.money(worst.netRevenueCents) },
          { label: "Left after delivery costs", value: f.money(worst.contributionProfitCents) },
        ],
      },
      severity: "critical",
      subject: `offer:${worst.name}`,
      page: "offers",
    } satisfies Insight;
  },
});

/**
 * ★ Your cost went up and your price never followed.
 *
 * The insight only this schema can produce. `revenue_items.unit_price_cents` is
 * a single column with no history — edit it and the old price is gone — but
 * every transaction line FREEZES the price it sold at and the resolved cost
 * snapshot beside it. So the ledger is the price-and-cost history, and a better
 * one than a catalogue audit trail: it records what customers actually paid.
 *
 * Nobody else surfaces this, and it is money left on the table rather than
 * money going out of the door, which makes it one of the few cards on the feed
 * with a genuinely easy fix.
 */
const priceStaleness = defineRule({
  id: "price-staleness",
  page: "offers",
  evaluate: (f) => {
    const worst = f.priceDrift[0];
    if (!worst) return null;

    return {
      id: "price-staleness",
      impactCents: -worst.marginLostCents,
      headline: `${worst.itemName} costs more than it did`,
      cause:
        `Making it went up ${worst.costRisePct.toFixed(0)}%` +
        (worst.sourceName ? ` on ${worst.sourceName}` : "") +
        ` and the price has not moved in ${describeAge(worst.daysSincePriceChange)}.`,
      action: { label: "Review its price", href: "/setup/revenue" },
      explain: {
        threshold: `Fires when the cost of making something rises ${MIN_COST_RISE_PCT}% or more and the price has not changed since`,
        comparisonPeriod: "Every sale on record for this item",
        inputs: [
          { label: "Used to cost you", value: f.money(worst.costBeforeCents) },
          { label: "Now costs you", value: f.money(worst.costAfterCents) },
          { label: "Still sells for", value: f.money(worst.currentPriceCents) },
          { label: "Sold since the rise", value: `${worst.unitsSinceRise}` },
          { label: "Which has cost you", value: f.money(worst.marginLostCents) },
          {
            label: "Price last changed",
            value: worst.priceLastChangedAt
              ? new Date(worst.priceLastChangedAt).toLocaleDateString("en-GB", {
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                })
              : "not since your records begin",
          },
        ],
      },
      severity: "normal",
      subject: `offer:${worst.itemName}`,
      page: "offers",
    } satisfies Insight;
  },
});

/** An offer whose margin dropped hard against the period before. */
const offerMarginErosion = defineRule({
  id: "offer-margin-erosion",
  page: "offers",
  evaluate: (f) => {
    const worst = f.leaks.marginErosion.filter((m) => m.deltaPts <= -3)[0];
    if (!worst) return null;

    const item = f.items.find((i) => i.name === worst.name);
    if (!item || item.netRevenueCents <= 0) return null;

    const wouldHaveEarned = percentOfCents(item.netRevenueCents, rate(worst.marginPriorPct));
    const cost = addCents(item.contributionProfitCents, -wouldHaveEarned);
    if (cost >= 0) return null;

    return {
      id: "offer-margin-erosion",
      impactCents: cost,
      headline: `${worst.name} earns less than it did`,
      cause: `You kept ${pct(worst.marginPriorPct)} of its price before and ${pct(worst.marginNowPct)} now.`,
      action: { label: "Check its costs", href: "/setup/revenue" },
      explain: {
        threshold: "Fires when what you keep from an item drops 3 points or more",
        comparisonPeriod: f.comparisonPeriod,
        inputs: [
          { label: "Kept before", value: pct(worst.marginPriorPct) },
          { label: "Kept now", value: pct(worst.marginNowPct) },
          { label: "Sold this period", value: f.money(item.netRevenueCents) },
          { label: "At the old rate you'd have kept", value: f.money(wouldHaveEarned) },
        ],
      },
      severity: "normal",
      subject: `offer:${worst.name}`,
      page: "offers",
    } satisfies Insight;
  },
});

// ── Marketing ────────────────────────────────────────────────────────────────

/**
 * Ad spend rose and profit did not follow.
 *
 * Deliberately NOT a ROAS rule: attributing revenue to a channel needs the
 * attribution engine, which does not exist. This compares two numbers we own
 * outright — what went out to platforms, and what came back as profit.
 */
const adsNotPayingOff = defineRule({
  id: "ads-not-paying-off",
  page: "marketing",
  evaluate: (f) => {
    if (f.ads.spendCents <= 0) return null;

    const baseline = f.baselines.adSpendCents;
    const comparison = baseline ? compareToBaseline(f.ads.spendCents, baseline) : null;
    const spendRose = comparison?.isUnusual === true && comparison.direction === "above";
    if (!spendRose) return null;

    const profitMoved = addCents(f.current.trueProfit, -f.prior.trueProfit);
    if (profitMoved > 0) return null; // spend rose and so did profit — that's it working

    const excess = excessAboveNormalCents(comparison!);
    if (excess <= 0) return null;

    const top = f.ads.byPlatform[0];

    return {
      id: "ads-not-paying-off",
      impactCents: -excess,
      headline: "You spent more on ads, not more profit",
      cause: `Ad spend rose to ${f.money(f.ads.spendCents)}${top ? `, mostly ${top.platform}` : ""}, and profit did not follow.`,
      action: { label: "See your ad spend", href: "/record/ad-spend" },
      explain: {
        threshold: "Fires when ad spend runs well above your normal and profit does not rise with it",
        comparisonPeriod: `Your last ${baseline!.sampleSize} periods`,
        inputs: [
          { label: "Ad spend now", value: f.money(f.ads.spendCents) },
          { label: "Your normal", value: f.money(baseline!.normal ?? 0) },
          { label: "Profit before", value: f.money(f.prior.trueProfit) },
          { label: "Profit now", value: f.money(f.current.trueProfit) },
        ],
      },
      severity: "normal",
      subject: "ads",
      page: "marketing",
    } satisfies Insight;
  },
});

// ── People ───────────────────────────────────────────────────────────────────

/**
 * Almost nobody buys twice.
 *
 * Priced as what a normal repeat rate would have added: the customers who
 * bought once, at the rate they already spend. Honest arithmetic on numbers we
 * hold, not a forecast — and it only fires with enough customers for the rate
 * to mean anything.
 */
const fewCustomersReturn = defineRule({
  id: "few-customers-return",
  page: "people",
  businessTypes: ["ecommerce"],
  evaluate: (f) => {
    const { customersWithPurchase, repeatCustomers, repeatRatePct } = f.retention;
    // Under ~20 customers a repeat rate is noise, and a card built on noise
    // costs more trust than the insight is worth.
    if (customersWithPurchase < 20 || repeatRatePct >= 20) return null;
    if (f.current.netRevenue <= 0) return null;

    const perCustomer = Math.round(f.current.netRevenue / customersWithPurchase);
    const oneMoreIn5 = Math.round(customersWithPurchase * 0.2) - repeatCustomers;
    if (oneMoreIn5 <= 0) return null;
    const worth = oneMoreIn5 * perCustomer;

    return {
      id: "few-customers-return",
      impactCents: worth,
      headline: "Almost nobody buys from you twice",
      cause: `Only ${pct(repeatRatePct)} of your ${customersWithPurchase} customers came back.`,
      action: { label: "See your customers", href: CUSTOMERS_PAGE },
      explain: {
        threshold: "Fires when under 20% of customers buy again, and you have at least 20 customers",
        comparisonPeriod: f.comparisonPeriod,
        inputs: [
          { label: "Customers", value: String(customersWithPurchase) },
          { label: "Bought again", value: String(repeatCustomers) },
          { label: "Average spend each", value: f.money(perCustomer) },
          { label: "Getting 1 in 5 back is worth", value: f.money(worth) },
        ],
      },
      severity: "normal",
      subject: "repeat-customers",
      page: "people",
    } satisfies Insight;
  },
});

// ── Wins ─────────────────────────────────────────────────────────────────────
//
// A screen that only scolds gets closed and not reopened. These exist so a good
// month has something true to say, and so slot 5 has a win to promote into.

const profitGrowing = defineRule({
  id: "profit-growing",
  page: "money",
  evaluate: (f) => {
    if (f.prior.trueProfit <= 0 || f.current.trueProfit <= f.prior.trueProfit) return null;
    const gain = addCents(f.current.trueProfit, -f.prior.trueProfit);
    // A rounding-error improvement is not news.
    if (gain < percentOfCents(f.prior.trueProfit, "10")) return null;

    return {
      id: "profit-growing",
      impactCents: gain,
      headline: "Your profit is growing",
      cause: `You kept ${f.money(f.current.trueProfit)}, up ${f.money(gain)} on the period before.`,
      action: { label: "See what drove it", href: MONEY_PAGE },
      explain: {
        threshold: "Fires when true profit rises more than 10% on the period before",
        comparisonPeriod: f.comparisonPeriod,
        inputs: [
          { label: "Profit before", value: f.money(f.prior.trueProfit) },
          { label: "Profit now", value: f.money(f.current.trueProfit) },
          { label: "Up by", value: f.money(gain) },
        ],
      },
      severity: "normal",
      subject: "profit",
      page: "money",
    } satisfies Insight;
  },
});

const bestOffer = defineRule({
  id: "best-offer",
  page: "offers",
  evaluate: (f) => {
    const best = [...f.items]
      .filter((i) => i.contributionProfitCents > 0)
      .sort((a, b) => b.contributionProfitCents - a.contributionProfitCents)[0];
    if (!best) return null;

    const totalContribution = f.items.reduce(
      (sum, i) => sum + Math.max(0, i.contributionProfitCents),
      0,
    );
    if (totalContribution <= 0) return null;
    const share = (best.contributionProfitCents / totalContribution) * 100;
    // Only worth saying when one thing genuinely carries the period.
    if (share < 30) return null;

    return {
      id: "best-offer",
      impactCents: best.contributionProfitCents,
      headline: `${best.name} earns you the most`,
      cause: `It made you ${f.money(best.contributionProfitCents)} — ${pct(share)} of everything you kept.`,
      action: { label: "See what you sell", href: "/setup/revenue" },
      explain: {
        threshold: "Fires when one thing you sell earns 30% or more of your total",
        comparisonPeriod: f.comparisonPeriod,
        inputs: [
          { label: "Sold", value: String(best.unitsSold) },
          { label: "Brought in", value: f.money(best.netRevenueCents) },
          { label: "You kept", value: f.money(best.contributionProfitCents) },
          { label: "Share of everything you kept", value: pct(share) },
        ],
      },
      severity: "normal",
      subject: `offer:${best.name}`,
      page: "offers",
    } satisfies Insight;
  },
});

const coveredFixedCosts = defineRule({
  id: "covered-fixed-costs",
  page: "money",
  evaluate: (f) => {
    const { breakEven } = f;
    if (breakEven.reason !== "ok") return null;
    if (breakEven.surplusCents === null || breakEven.surplusCents <= 0) return null;
    if (breakEven.breakEvenRevenueCents === null) return null;

    return {
      id: "covered-fixed-costs",
      impactCents: breakEven.surplusCents,
      headline: "You cleared your fixed costs",
      cause: `Sales passed the ${f.money(breakEven.breakEvenRevenueCents)} you needed, by ${f.money(breakEven.surplusCents)}.`,
      action: { label: "See your break-even", href: "/money/budget" },
      explain: {
        threshold: "Fires when sales pass the break-even point",
        comparisonPeriod: f.comparisonPeriod,
        inputs: [
          { label: "Sales needed", value: f.money(breakEven.breakEvenRevenueCents) },
          { label: "Sales made", value: f.money(f.current.netRevenue) },
          { label: "Clear by", value: f.money(breakEven.surplusCents) },
        ],
      },
      severity: "normal",
      subject: "break-even",
      page: "money",
    } satisfies Insight;
  },
});

/**
 * The registry, in catalogue order.
 *
 * Order here does NOT decide what the owner sees — `rankInsights` sorts by
 * money and applies the overrides. This order only decides evaluation, which
 * keeps the tests readable.
 */
export const RULE_CATALOGUE: readonly Rule[] = [
  runningAtALoss,
  revenueUpProfitDown,
  marginSlipping,
  belowBreakEven,
  refundsAboveNormal,
  discountDrain,
  unpaidOver30,
  paymentHabitGap,
  feeCreep,
  offerLosingMoney,
  priceStaleness,
  offerMarginErosion,
  adsNotPayingOff,
  fewCustomersReturn,
  profitGrowing,
  bestOffer,
  coveredFixedCosts,
];

export function ruleById(id: string): Rule | undefined {
  return RULE_CATALOGUE.find((r) => r.id === id);
}
