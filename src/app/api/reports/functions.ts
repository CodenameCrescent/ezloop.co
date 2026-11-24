/**
 * Server code used only by `/api/reports`. Shared code stays in
 * `src/lib/api/functions`. Server-only: nothing in components, views or the
 * client helpers may import this file.
 */
import { and, eq, gte, lte, sql, isNotNull, isNull } from "drizzle-orm";
import { businessesTable, db, peopleTable, transactionsTable, transactionLinesTable } from "@workspace/db";
import { RULE_CATALOGUE, biggestLever, computeBaseline, computePqs, computeProfitLadder, evaluateRules, formatMoney, leaksOnly, rankInsights, totalLeakCents, buildWaterfall, waterfallSentence, buildPodium, buildQuadrantMap, offersSentence, revenueVsProfitFlip, biggestVsBest, buildConcentration, customerConcentrationSentence, findGoneQuiet, repeatRateIsMeaningful, revenuePerCustomer, BLENDED_CAVEAT, computeMarketing, marketingSentence, type CustomerStat, type OfferStat, verdictSentence, type Baseline, type BusinessType, type Cents, type HistoryFacts, type InsightFacts, type LadderFacts, type PaymentHabitFacts, detectPriceCostDrift, type SaleObservation, type Pqs, type RankedInsight, type ScoreLever, assetLife, isCapitalised, summariseWaste, type WasteLine } from "@workspace/domain";
import { listAdSpend, summariseAdSpend } from "@/lib/api/functions/services/adSpend";
import { buildCustomerRetention, computeLeaks, computePeopleMetrics } from "@/lib/api/functions/services/analytics";
import { currencySymbolOf } from "@/lib/api/functions/services/business";
import { listSources as catalogListSources } from "@/lib/api/functions/services/catalog";
import { computeBreakEvenReport, computePnl, loadPeriodTransactions, profitTransaction, listRevenueItemsWithStats, loadNameMaps } from "@/lib/api/functions/services/read";

// ── insights ─────────────────────────────────────────────────────

/**
 * The insight engine's server half: gather facts, hand them to the pure rules,
 * return ranked cards.
 *
 * The split is deliberate and load-bearing. Everything that decides WHAT to say
 * lives in `lib/domain/ruleCatalogue.ts`, where it is pure and unit-tested with
 * hand-written fixtures. This file only fetches. A rule cannot query the
 * database, so it cannot accidentally compute money the ladder has not already
 * computed, and the whole catalogue stays testable without a Postgres.
 */

/**
 * How many past periods to build a normal from.
 *
 * Six is a compromise: enough that a normal means something, short enough that
 * a business which genuinely changed six months ago is not judged against the
 * business it used to be.
 */
const HISTORY_PERIODS = 6;

/**
 * The smallest deviation each fact is allowed to have, in minor units.
 *
 * Without a floor a steady history produces a deviation of zero and then every
 * movement is infinitely unusual — the steadier the business, the noisier the
 * app. These are "the smallest swing worth a card".
 */
const BASELINE_FLOORS: Record<keyof HistoryFacts, Cents> = {
  trueProfitCents: 5_000,
  grossRevenueCents: 10_000,
  refundsCents: 2_000,
  discountsCents: 2_000,
  periodExpensesCents: 5_000,
  adSpendCents: 2_000,
};

type PeriodRange = { start?: Date; end?: Date };

function ladderFactsOf(ladder: LadderFacts): LadderFacts {
  return {
    grossRevenue: ladder.grossRevenue,
    discounts: ladder.discounts,
    refunds: ladder.refunds,
    netRevenue: ladder.netRevenue,
    contributionProfit: ladder.contributionProfit,
    periodExpenses: ladder.periodExpenses,
    trueProfit: ladder.trueProfit,
  };
}

const DAY_MS = 24 * 60 * 60 * 1000;

function daysBetween(start: Date, end: Date): number {
  return Math.max(1, Math.round((end.getTime() - start.getTime()) / DAY_MS));
}

/**
 * The same period, N times, walking backwards.
 *
 * Equal-length windows rather than calendar months, because the normal has to
 * be comparable to the thing being judged: a 90-day period compared against
 * monthly history would look three times worse than normal every single time.
 */
function priorWindows(start: Date, end: Date, count: number): Array<{ start: Date; end: Date }> {
  const span = end.getTime() - start.getTime();
  const windows: Array<{ start: Date; end: Date }> = [];
  for (let i = 1; i <= count; i++) {
    const wEnd = new Date(start.getTime() - (i - 1) * (span + 1) - 1);
    const wStart = new Date(wEnd.getTime() - span);
    windows.push({ start: wStart, end: wEnd });
  }
  return windows.reverse(); // oldest first
}

/**
 * Build the history in ONE database load.
 *
 * The naive version calls the ladder once per past period, which is six round
 * trips for a figure nobody sees directly. This loads the whole span once and
 * partitions it in memory — every transaction lands in exactly one window,
 * which is the same property `computePnlSeries` relies on.
 */
async function loadHistory(
  businessId: string,
  windows: Array<{ start: Date; end: Date }>,
  adSpendByWindow: Cents[],
): Promise<HistoryFacts> {
  const history: HistoryFacts = {
    trueProfitCents: [],
    grossRevenueCents: [],
    refundsCents: [],
    discountsCents: [],
    periodExpensesCents: [],
    adSpendCents: [],
  };
  if (windows.length === 0) return history;

  const span = { start: windows[0].start, end: windows[windows.length - 1].end };
  const txns = await loadPeriodTransactions(businessId, span);

  windows.forEach((window, i) => {
    const slice = txns.filter(
      ({ header }) => header.occurredAt >= window.start && header.occurredAt <= window.end,
    );
    const ladder = computeProfitLadder(slice.map(({ header, lines }) => profitTransaction(header, lines)));

    // A window from BEFORE the business was recording anything is not a period
    // where nothing happened — it is a period we know nothing about, and the
    // two are not the same. Counting them produced "your refunds are above
    // normal, normally Rs 0.00" for a business whose history simply had not
    // started yet, and fired a "discounts are taking a big bite" card over
    // Rs 80. Dead windows are dropped, so a normal is only ever built from
    // periods the business was actually trading in.
    const hadActivity = ladder.grossRevenue > 0 || ladder.periodExpenses > 0;
    if (!hadActivity) return;

    history.trueProfitCents.push(ladder.trueProfit);
    history.grossRevenueCents.push(ladder.grossRevenue);
    history.refundsCents.push(ladder.refunds);
    history.discountsCents.push(ladder.discounts);
    history.periodExpensesCents.push(ladder.periodExpenses);
    history.adSpendCents.push(adSpendByWindow[i] ?? 0);
  });

  return history;
}

function buildBaselines(history: HistoryFacts): Partial<Record<keyof HistoryFacts, Baseline>> {
  const out: Partial<Record<keyof HistoryFacts, Baseline>> = {};
  for (const key of Object.keys(BASELINE_FLOORS) as Array<keyof HistoryFacts>) {
    const samples = history[key];
    if (!samples || samples.length === 0) continue;
    const baseline = computeBaseline(samples, { floor: BASELINE_FLOORS[key] });
    // Only publish a normal that actually exists. A rule reading a
    // `too_few_periods` baseline must stay silent, and the cleanest way to
    // guarantee that is not to hand it one.
    if (baseline.reason === "ok") out[key] = baseline;
  }
  return out;
}


/**
 * How long money takes to arrive, and how long it takes to leave.
 *
 * Only transactions that have actually been PAID can be timed, so both figures
 * are optimistic by construction — the slowest payers are precisely the ones
 * still missing a `paid_at`. The rule's Explain states what it was measured on
 * rather than hiding that.
 *
 * Medians, not means: one customer who paid after 200 days must not become the
 * business's terms.
 */
function measurePaymentHabits(
  txns: Awaited<ReturnType<typeof loadPeriodTransactions>>,
): PaymentHabitFacts {
  const salesDays: number[] = [];
  const billDays: number[] = [];

  for (const { header } of txns) {
    if (!header.paidAt) continue;
    if (header.status === "void" || header.status === "pending") continue;
    // An adjustment's dates describe the refund, not the original trade.
    if (header.adjustmentType) continue;

    const days = Math.round((header.paidAt.getTime() - header.occurredAt.getTime()) / DAY_MS);
    // Negative means paid before the work happened — a deposit. Real, but it
    // describes prepayment rather than a payment habit, so it is left out.
    if (days < 0) continue;

    (header.direction === "in" ? salesDays : billDays).push(days);
  }

  const median = (values: number[]): number | null => {
    if (values.length === 0) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  };

  return {
    customerDaysToPay: median(salesDays),
    supplierDaysToPay: median(billDays),
    paidSalesCount: salesDays.length,
    paidBillsCount: billDays.length,
  };
}


/**
 * How far back to look for a price or cost change.
 *
 * A stale price is by definition an old one, so the reporting period is far too
 * short a window — an 18-month look-back is what makes "the price has not moved
 * in 14 months" sayable at all.
 */
const DRIFT_WINDOW_MONTHS = 18;

/**
 * Turn ledger lines into the price-and-cost history of each item.
 *
 * Nothing here reads the catalogue. `revenue_items.unit_price_cents` is a single
 * column with no history — edit it and the old price is gone — but every line
 * FROZE the price it sold at and the resolved cost snapshot beside it. So the
 * ledger is the history, and a better one: it records what customers actually
 * paid rather than what the price list said.
 */
function saleObservationsFrom(
  txns: Awaited<ReturnType<typeof loadPeriodTransactions>>,
  itemNames: Map<string, string>,
  sourceNames: Map<string, string>,
): SaleObservation[] {
  const out: SaleObservation[] = [];

  for (const { header, lines } of txns) {
    if (header.status === "void" || header.status === "pending") continue;
    // A refund line carries the ORIGINAL sale's price and recovered cost; it
    // describes an unwind, not a fresh price point.
    if (header.adjustmentType) continue;

    for (const line of lines) {
      if (!line.revenueItemId || line.direction !== "in") continue;
      const snapshot = line.costSnapshot as { total_per_unit_cents?: number } | null;
      // No snapshot means nothing was costed, so there is no cost to track.
      if (!snapshot || typeof snapshot.total_per_unit_cents !== "number") continue;

      const qty = Number(line.qty);
      if (!Number.isFinite(qty) || qty <= 0) continue;

      out.push({
        itemId: line.revenueItemId,
        itemName: itemNames.get(line.revenueItemId) ?? "Something you sell",
        // The channel matters: the same item on two sources has its own price
        // (via a price override) and its own cost (via source-scoped
        // components), so they are separate price histories.
        sourceId: header.sourceId,
        sourceName: sourceNames.get(header.sourceId) ?? "another channel",
        occurredAt: header.occurredAt.toISOString(),
        unitPriceCents: line.unitPriceCents,
        unitCostCents: snapshot.total_per_unit_cents,
        qty,
      });
    }
  }

  return out;
}

export interface InsightsReport {
  insights: RankedInsight[];
  leaks: RankedInsight[];
  totalLeakCents: Cents;
  /** How many past periods the normals were built from. 0 = no normals at all. */
  baselinePeriods: number;
  generatedAt: string;
}

export async function computeInsights(
  businessId: string,
  userId: string,
  current: PeriodRange,
  prior: PeriodRange,
  comparisonPeriod: string,
): Promise<InsightsReport> {
  const [business] = await db.select().from(businessesTable).where(eq(businessesTable.id, businessId));

  // The cards put money INSIDE their sentences, so unlike `/reports/signals`
  // — which stays currency-agnostic on purpose — this one has to know the
  // symbol. It reads THIS BUSINESS's setting rather than assuming a currency:
  // an owner whose studio bills in dollars and whose shop bills in rupees must
  // not read one business's insights priced in the other's money.
  const symbol = await currencySymbolOf(businessId);
  // A space after the symbol, matching the frontend's `formatCents`. These
  // strings sit directly beside UI-formatted figures on the same card, and
  // "Rs3,000.00" next to "Rs 3,000.00" reads as two different applications.
  const money = (cents: Cents) => formatMoney(cents, { symbol: `${symbol} ` });

  const [cur, prev, leaks, breakEven, retention, itemsReport, periodTxns, driftTxns, sources] = await Promise.all([
    computePnl(businessId, userId, current),
    computePnl(businessId, userId, prior),
    computeLeaks(businessId, userId, current, prior),
    computeBreakEvenReport(businessId, userId, current),
    buildCustomerRetention(businessId),
    listRevenueItemsWithStats(businessId, userId, current, "active"),
    // The payment habits are timed off the raw headers, which no read-model
    // exposes — `occurred_at` → `paid_at` is a shape nothing else needed.
    loadPeriodTransactions(businessId, { start: current.start, end: current.end }),
    // Price drift needs a MUCH longer window than the reporting period: a
    // stale price is by definition an old one, and "not moved in 14 months"
    // cannot be said from thirty days of lines.
    loadPeriodTransactions(businessId, {
      start: current.start
        ? new Date(
            new Date(current.start).setMonth(new Date(current.start).getMonth() - DRIFT_WINDOW_MONTHS),
          )
        : undefined,
      end: current.end,
    }),
    catalogListSources(businessId),
  ]);

  // History windows, and the ad spend that fell in each of them.
  const start = current.start;
  const end = current.end;
  const windows = start && end ? priorWindows(start, end, HISTORY_PERIODS) : [];

  const adEntriesCurrent = await listAdSpend(businessId, { startDate: start, endDate: end });
  const adReport = summariseAdSpend(adEntriesCurrent, cur.ladder.grossRevenue);

  let adSpendByWindow: Cents[] = new Array(windows.length).fill(0);
  if (windows.length > 0) {
    const allHistoryAds = await listAdSpend(businessId, {
      startDate: windows[0].start,
      endDate: windows[windows.length - 1].end,
    });
    adSpendByWindow = windows.map((w) =>
      allHistoryAds
        .filter((e) => {
          const at = new Date(e.spentOn);
          return at >= w.start && at <= w.end;
        })
        .reduce((sum, e) => sum + e.amountCents, 0),
    );
  }

  const history = await loadHistory(businessId, windows, adSpendByWindow);

  const topFee = leaks.fees[0] ?? null;
  const over30 = leaks.unpaidAging.buckets[2] ?? null;

  const facts: InsightFacts = {
    businessType: (business?.businessType ?? "ecommerce") as BusinessType,
    comparisonPeriod,
    periodDays: start && end ? daysBetween(start, end) : 30,
    current: ladderFactsOf(cur.ladder),
    prior: ladderFactsOf(prev.ladder),
    leaks: {
      refundsCents: leaks.refunds.totalCents,
      refundRatePct: leaks.refunds.ratePct,
      topRefundItem: leaks.refunds.byItem[0]
        ? { name: leaks.refunds.byItem[0].name, cents: leaks.refunds.byItem[0].cents }
        : null,
      discountsCents: leaks.discounts.totalCents,
      discountPctOfGross: leaks.discounts.pctOfGross,
      feesCents: leaks.fees.reduce((s, f) => s + f.currentCents, 0),
      topFee: topFee ? { name: topFee.name, currentCents: topFee.currentCents, priorCents: topFee.priorCents } : null,
      marginErosion: leaks.marginErosion,
      unpaidTotalCents: leaks.unpaidAging.totalCents,
      unpaidOver30Cents: over30?.cents ?? 0,
      unpaidOver30Count: over30?.count ?? 0,
    },
    breakEven: {
      reason: breakEven.reason,
      breakEvenRevenueCents: breakEven.breakEvenRevenueCents,
      surplusCents: breakEven.surplusCents,
      coveredPct: breakEven.coveredPct,
      fixedExpensesCents: breakEven.fixedExpensesCents,
      unclassifiedExpensesCents: breakEven.unclassifiedExpensesCents,
    },
    ads: {
      spendCents: adReport.totalCents,
      byPlatform: adReport.byPlatform.map((p) => ({ platform: p.platform, amountCents: p.amountCents })),
      shareOfRevenueBps: adReport.shareOfRevenueBps,
    },
    items: itemsReport.items.map((i) => ({
      id: i.id,
      name: i.name,
      netRevenueCents: i.stats.netRevenueCents,
      contributionProfitCents: i.stats.contributionProfitCents,
      marginPct: i.stats.marginPct,
      unitsSold: Number(i.stats.unitsSold ?? 0),
    })),
    retention: {
      customersWithPurchase: retention.repeat.customersWithPurchase,
      repeatCustomers: retention.repeat.repeatCustomers,
      repeatRatePct: retention.repeat.repeatRatePct,
    },
    paymentHabit: measurePaymentHabits(periodTxns),
    priceDrift: detectPriceCostDrift(
      saleObservationsFrom(
        driftTxns,
        new Map(itemsReport.items.map((i) => [i.id, i.name])),
        new Map(sources.map((s) => [s.id, s.name])),
      ),
    ),
    history,
    // Cash on hand needs an opening balance the app does not hold, so it is
    // absent rather than guessed. The runway rule stays dormant until it exists.
    cashOnHandCents: null,
    baselines: buildBaselines(history),
    money,
  };

  const fired = evaluateRules(RULE_CATALOGUE, facts);

  return {
    insights: rankInsights(fired),
    leaks: leaksOnly(fired),
    totalLeakCents: totalLeakCents(fired),
    // Trading periods, not windows looked at — a business three months old has
    // three, however far back the windows reach.
    baselinePeriods: history.trueProfitCents.length,
    generatedAt: new Date().toISOString(),
  };
}

// ── The Profit Quality Score ─────────────────────────────────────────────────

export interface PqsReport extends Pqs {
  delta: number | null;
  verdict: string;
  lever: ScoreLever | null;
  calculatedAt: string;
}

/**
 * Revenue per customer for a period, computed through the SAME ladder every
 * other figure uses.
 *
 * Grouping the period's transactions by person and running `computeProfitLadder`
 * over each group means a customer's revenue is netted for refunds and
 * discounts exactly as the P&L nets them — rather than a second, subtly
 * different definition of "revenue" living inside the score.
 */
function topShareOfRevenue(
  groups: Map<string | null, ProfitTransactionLike[]>,
  names: Map<string, string>,
): { sharePct: number | null; label: string | null } {
  let total = 0;
  let best = { cents: 0, id: null as string | null };

  for (const [personId, txns] of groups) {
    const { netRevenue } = computeProfitLadder(txns);
    if (netRevenue <= 0) continue;
    total += netRevenue;
    // Transactions with no customer attached are real revenue but cannot
    // concentrate on anybody, so they count toward the total and never toward
    // the top share.
    if (personId && netRevenue > best.cents) best = { cents: netRevenue, id: personId };
  }

  if (total <= 0 || !best.id) return { sharePct: null, label: null };
  return { sharePct: (best.cents / total) * 100, label: names.get(best.id) ?? "Your biggest customer" };
}

type ProfitTransactionLike = ReturnType<typeof profitTransaction>;

export async function computePqsReport(
  businessId: string,
  userId: string,
  current: { start: Date; end: Date },
  prior: { start: Date; end: Date },
): Promise<PqsReport> {
  const symbol = await currencySymbolOf(businessId);
  const money = (cents: Cents) => formatMoney(cents, { symbol: `${symbol} ` });

  const [cur, prev, itemsReport, people, firstEver] = await Promise.all([
    computePnl(businessId, userId, current),
    computePnl(businessId, userId, prior),
    listRevenueItemsWithStats(businessId, userId, current, "active"),
    db.select({ id: peopleTable.id, name: peopleTable.displayName }).from(peopleTable).where(eq(peopleTable.businessId, businessId)),
    db
      .select({ first: sql<Date | null>`min(${transactionsTable.occurredAt})` })
      .from(transactionsTable)
      .where(eq(transactionsTable.businessId, businessId)),
  ]);

  const names = new Map(people.map((p) => [p.id, p.name]));

  const groupByPerson = async (range: { start: Date; end: Date }) => {
    const txns = await loadPeriodTransactions(businessId, range);
    const groups = new Map<string | null, ProfitTransactionLike[]>();
    for (const { header, lines } of txns) {
      const key = header.personId ?? null;
      const list = groups.get(key) ?? [];
      list.push(profitTransaction(header, lines));
      groups.set(key, list);
    }
    return groups;
  };

  const [curGroups, priorGroups] = await Promise.all([groupByPerson(current), groupByPerson(prior)]);

  const offerShareOf = (items: Array<{ name: string; stats: { contributionProfitCents: number } }>) => {
    const positive = items.filter((i) => i.stats.contributionProfitCents > 0);
    const total = positive.reduce((s, i) => s + i.stats.contributionProfitCents, 0);
    if (total <= 0) return { sharePct: null as number | null, label: null as string | null };
    const best = [...positive].sort(
      (a, b) => b.stats.contributionProfitCents - a.stats.contributionProfitCents,
    )[0];
    return { sharePct: (best.stats.contributionProfitCents / total) * 100, label: best.name };
  };

  // The trend pillar's yardstick is the business's own normal, built by the
  // same machinery the baseline-driven rules use — so the score and the cards
  // can never disagree about what "normal" means.
  const windows = priorWindows(current.start, current.end, HISTORY_PERIODS);
  const history = await loadHistory(businessId, windows, new Array(windows.length).fill(0));
  const baselines = buildBaselines(history);

  const firstAt = firstEver[0]?.first ? new Date(firstEver[0].first) : null;
  const daysOfActivity = firstAt
    ? Math.max(0, Math.round((current.end.getTime() - firstAt.getTime()) / DAY_MS))
    : 0;

  const customer = topShareOfRevenue(curGroups, names);
  const offer = offerShareOf(itemsReport.items);

  const pqs = computePqs({
    trueProfitCents: cur.ladder.trueProfit,
    netRevenueCents: cur.ladder.netRevenue,
    topCustomerSharePct: customer.sharePct,
    topCustomerLabel: customer.label,
    topOfferSharePct: offer.sharePct,
    topOfferLabel: offer.label,
    trueProfitBaseline: baselines.trueProfitCents,
    daysOfActivity,
    money,
  });

  /**
   * The previous period's score, for the delta.
   *
   * Scored against the SAME normal as the current period rather than the normal
   * as it stood back then. The delta has to answer "did the business move?",
   * and re-deriving history for the earlier window would let the yardstick move
   * underneath it — the score could then fall on a period that improved.
   */
  const priorCustomer = topShareOfRevenue(priorGroups, names);
  const priorItems = await listRevenueItemsWithStats(businessId, userId, prior, "active");
  const priorOffer = offerShareOf(priorItems.items);

  const priorPqs = computePqs({
    trueProfitCents: prev.ladder.trueProfit,
    netRevenueCents: prev.ladder.netRevenue,
    topCustomerSharePct: priorCustomer.sharePct,
    topCustomerLabel: priorCustomer.label,
    topOfferSharePct: priorOffer.sharePct,
    topOfferLabel: priorOffer.label,
    trueProfitBaseline: baselines.trueProfitCents,
    daysOfActivity,
    money,
  });

  const delta = pqs.score !== null && priorPqs.score !== null ? pqs.score - priorPqs.score : null;

  return {
    ...pqs,
    delta,
    verdict: verdictSentence(pqs, delta),
    lever: biggestLever(pqs),
    calculatedAt: new Date().toISOString(),
  };
}

// ── The money waterfall ──────────────────────────────────────────────────────

/**
 * The Money page's hero, plus its four tiles.
 *
 * Everything is derived from the SAME `computePnl` the P&L page reads, on both
 * bases — so the waterfall, the tiles and `/money/profit-loss` can never
 * disagree about a single figure.
 */
export async function computeWaterfallReport(
  businessId: string,
  userId: string,
  current: { start: Date; end: Date },
  prior: { start: Date; end: Date },
) {
  const symbol = await currencySymbolOf(businessId);
  const money = (cents: Cents) => formatMoney(cents, { symbol: `${symbol} ` });

  const [cur, prev, curCash, priorCash] = await Promise.all([
    computePnl(businessId, userId, current),
    computePnl(businessId, userId, prior),
    computePnl(businessId, userId, current, "cash"),
    computePnl(businessId, userId, prior, "cash"),
  ]);

  const waterfall = buildWaterfall(cur.ladder, {
    costComponents: cur.costComponents,
    expenseGroups: cur.expenseGroups.map((g) => ({ key: g.key, label: g.label, amountCents: g.amountCents })),
  });

  /**
   * The reconciliation guard THROWS rather than serving a chart that disagrees
   * with itself — the same stance the client-profitability guards take. A
   * waterfall whose bars do not land on the profit printed beside them teaches
   * the reader that every figure on the screen is decorative.
   */
  if (!waterfall.reconciles) {
    throw new Error(
      `Waterfall does not reconcile for business ${businessId}: ` +
        `${waterfall.startCents} minus its deductions did not land on ${waterfall.endCents}`,
    );
  }

  const marginOf = (ladder: { trueProfit: number; netRevenue: number }) =>
    ladder.netRevenue > 0 ? Number(((ladder.trueProfit / ladder.netRevenue) * 100).toFixed(1)) : null;

  return {
    ...waterfall,
    verdict: waterfallSentence(cur.ladder, prev.ladder.grossRevenue > 0 ? prev.ladder.trueProfit : null, money),
    tiles: {
      revenueCents: cur.ladder.netRevenue,
      priorRevenueCents: prev.ladder.netRevenue,
      netMarginPct: marginOf(cur.ladder),
      priorNetMarginPct: marginOf(prev.ladder),
      trueProfitCents: cur.ladder.trueProfit,
      priorTrueProfitCents: prev.ladder.trueProfit,
      cashMovedCents: curCash.ladder.trueProfit,
      priorCashMovedCents: priorCash.ladder.trueProfit,
    },
  };
}

// ── Offers ───────────────────────────────────────────────────────────────────

/**
 * What you sell, ranked by profit and mapped. The ranking, the quadrant
 * thresholds and the sentence are all pure — this only fetches.
 */
export async function computeOffersReport(
  businessId: string,
  userId: string,
  range: { start: Date; end: Date },
) {
  const symbol = await currencySymbolOf(businessId);
  const money = (cents: Cents) => formatMoney(cents, { symbol: `${symbol} ` });

  const report = await listRevenueItemsWithStats(businessId, userId, range, "active");

  const offers: OfferStat[] = report.items.map((i) => ({
    id: i.id,
    name: i.name,
    unitsSold: Number(i.stats.unitsSold ?? 0),
    netRevenueCents: i.stats.netRevenueCents,
    contributionProfitCents: i.stats.contributionProfitCents,
    marginPct: i.stats.marginPct,
  }));

  const podium = buildPodium(offers);

  return {
    verdict: offersSentence(offers, podium, money),
    podium,
    quadrant: buildQuadrantMap(offers),
    flip: revenueVsProfitFlip(offers),
    // Ranked by profit, matching the page's whole argument.
    offers: [...offers].sort((a, b) => b.contributionProfitCents - a.contributionProfitCents),
  };
}

// ── People ───────────────────────────────────────────────────────────────────

const YEAR_MS = 365 * DAY_MS;

/**
 * Who pays you, and are they staying.
 *
 * Period revenue and contribution come from the SAME ladder every other screen
 * reads, grouped per person — so a customer's revenue is netted for refunds and
 * discounts exactly as the P&L nets them, rather than a second definition of
 * "revenue" living inside this page.
 */
export async function computePeopleReport(
  businessId: string,
  userId: string,
  range: { start: Date; end: Date },
) {
  const symbol = await currencySymbolOf(businessId);
  const money = (cents: Cents) => formatMoney(cents, { symbol: `${symbol} ` });

  const now = new Date();
  const yearAgo = new Date(now.getTime() - YEAR_MS);

  const [pnl, lifetime, people, retention, periodTxns, yearTxns] = await Promise.all([
    computePnl(businessId, userId, range),
    computePeopleMetrics(businessId),
    db
      .select({ id: peopleTable.id, name: peopleTable.displayName, kind: peopleTable.kind })
      .from(peopleTable)
      .where(eq(peopleTable.businessId, businessId)),
    buildCustomerRetention(businessId),
    loadPeriodTransactions(businessId, range),
    loadPeriodTransactions(businessId, { start: yearAgo, end: now }),
  ]);

  /** Group a loaded window by person and run the ONE ladder over each group. */
  const ladderByPerson = (txns: typeof periodTxns) => {
    const groups = new Map<string | null, ProfitTransactionLike[]>();
    for (const { header, lines } of txns) {
      const key = header.personId ?? null;
      const list = groups.get(key) ?? [];
      list.push(profitTransaction(header, lines));
      groups.set(key, list);
    }
    const out = new Map<string | null, { netRevenue: Cents; contribution: Cents }>();
    for (const [id, group] of groups) {
      const ladder = computeProfitLadder(group);
      out.set(id, { netRevenue: ladder.netRevenue, contribution: ladder.contributionProfit });
    }
    return out;
  };

  const periodByPerson = ladderByPerson(periodTxns);
  const yearByPerson = ladderByPerson(yearTxns);

  const customers: CustomerStat[] = people
    .filter((p) => p.kind === "customer")
    .map((p) => {
      const period = periodByPerson.get(p.id);
      const life = lifetime.get(p.id);
      return {
        id: p.id,
        name: p.name,
        netRevenueCents: period?.netRevenue ?? 0,
        contributionProfitCents: period?.contribution ?? 0,
        lifetimeOrderCount: life?.orderCount ?? 0,
        firstPurchaseAt: life?.firstActivityAt ?? null,
        lastPurchaseAt: life?.lastActivityAt ?? null,
        trailingYearContributionCents: yearByPerson.get(p.id)?.contribution ?? 0,
      };
    });

  // Sales with nobody attached are real revenue that cannot concentrate on
  // anybody. Named separately rather than dropped or pooled into "everyone
  // else", which would overstate how spread the customer base is.
  const unattributed = Math.max(0, periodByPerson.get(null)?.netRevenue ?? 0);

  const concentration = buildConcentration(customers, pnl.ladder.trueProfit, unattributed);
  const quiet = findGoneQuiet(customers, now);
  const payingCount = customers.filter((c) => c.netRevenueCents > 0).length;

  return {
    verdict: customerConcentrationSentence(concentration, money),
    concentration,
    tiles: {
      // A repeat rate on twelve customers moves violently on one person's
      // behaviour, and the reader has no way to know that. Absent, not shown.
      repeatRatePct: repeatRateIsMeaningful(retention.repeat.customersWithPurchase)
        ? retention.repeat.repeatRatePct
        : null,
      customerCount: retention.repeat.customersWithPurchase,
      revenuePerCustomerCents: revenuePerCustomer(customers),
      goneQuietCount: quiet.customers.length,
      goneQuietValueCents: quiet.totalAtRiskCents,
    },
    goneQuiet: quiet.customers,
    biggestVsBest: biggestVsBest(customers),
    customers: [...customers]
      .filter((c) => c.netRevenueCents > 0)
      .sort((a, b) => b.netRevenueCents - a.netRevenueCents),
    _payingCount: payingCount,
  };
}

// ── Marketing ────────────────────────────────────────────────────────────────

/**
 * Is the ad spend making money.
 *
 * Every figure is blended and says so. The page's value comes from the
 * break-even multiple — which needs the real margin this app has and ad tools
 * do not — plus a one-sided proof that requires no attribution.
 */
export async function computeMarketingReport(
  businessId: string,
  userId: string,
  current: { start: Date; end: Date },
  prior: { start: Date; end: Date },
) {
  const symbol = await currencySymbolOf(businessId);
  const money = (cents: Cents) => formatMoney(cents, { symbol: `${symbol} ` });

  const [cur, prev, curAds, priorAds, newCustomers] = await Promise.all([
    computePnl(businessId, userId, current),
    computePnl(businessId, userId, prior),
    listAdSpend(businessId, { startDate: current.start, endDate: current.end }),
    listAdSpend(businessId, { startDate: prior.start, endDate: prior.end }),
    // A "new customer" is one whose FIRST EVER purchase landed in this window.
    // `first_transaction_at` is maintained by the person service, so this needs
    // no attribution and no guessing.
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(peopleTable)
      .where(
        and(
          eq(peopleTable.businessId, businessId),
          eq(peopleTable.kind, "customer"),
          gte(peopleTable.firstTransactionAt, current.start),
          lte(peopleTable.firstTransactionAt, current.end),
        ),
      ),
  ]);

  const curReport = summariseAdSpend(curAds, cur.ladder.grossRevenue);
  const priorTotal = priorAds.reduce((sum, e) => sum + e.amountCents, 0);

  const marketing = computeMarketing({
    adSpendCents: curReport.totalCents,
    byPlatform: curReport.byPlatform.map((p) => ({ platform: p.platform, amountCents: p.amountCents })),
    netRevenueCents: cur.ladder.netRevenue,
    contributionProfitCents: cur.ladder.contributionProfit,
    trueProfitCents: cur.ladder.trueProfit,
    newCustomerCount: newCustomers[0]?.count ?? 0,
    priorAdSpendCents: priorTotal,
    priorTrueProfitCents: prev.ladder.trueProfit,
  });

  return {
    ...marketing,
    verdict: marketingSentence(marketing, money, cur.ladder.contributionProfit),
    blendedCaveat: BLENDED_CAVEAT,
    priorAdSpendCents: priorTotal,
    contributionProfitCents: cur.ladder.contributionProfit,
  };
}

// ── trade ────────────────────────────────────────────────────────

/**
 * The trade reports: waste and assets.
 *
 * Both READ money the ledger already holds. The arithmetic is
 * `lib/domain/waste.ts` and `lib/domain/assets.ts`; nothing here decides
 * anything, and nothing here adds to a total.
 */

export async function computeWasteReport(
  businessId: string,
  userId: string,
  range: { start?: Date; end?: Date },
) {
  const [txns, maps] = await Promise.all([
    loadPeriodTransactions(businessId, range),
    loadNameMaps(businessId, userId),
  ]);

  const lines: WasteLine[] = [];
  for (const { header, lines: rows } of txns) {
    if (header.status === "void" || header.status === "pending" || header.adjustmentType) continue;
    for (const row of rows) {
      // Only things bought can be wasted, and only a purchase carries a price
      // per unit that a wasted quantity can be valued at.
      if (row.direction !== "out") continue;
      lines.push({
        name:
          (row.expenseItemId ? maps.expenseItems.get(row.expenseItemId)?.name : null) ??
          row.label ??
          "Unnamed",
        qty: row.qty,
        wastedQty: row.wastedQty,
        unitPriceCents: row.unitPriceCents,
      });
    }
  }

  return summariseWaste(lines);
}

/**
 * What the business owns, from purchases spread over months.
 *
 * The query is the definition: a line with `spread_months` set, on a
 * transaction that is not itself a slice. Slices carry `parent_transaction_id`
 * and are the CONSEQUENCE of the purchase, not another asset.
 */
export async function computeAssetsReport(
  businessId: string,
  userId: string,
  options: { includeFullyUsed?: boolean } = {},
) {
  const [rows, maps] = await Promise.all([
    db
      .select({ header: transactionsTable, line: transactionLinesTable })
      .from(transactionLinesTable)
      .innerJoin(transactionsTable, eq(transactionLinesTable.transactionId, transactionsTable.id))
      .where(
        and(
          eq(transactionsTable.businessId, businessId),
          isNotNull(transactionLinesTable.spreadMonths),
          isNull(transactionsTable.parentTransactionId),
          sql`${transactionsTable.status} <> 'void'`,
        ),
      ),
    loadNameMaps(businessId, userId),
  ]);

  const asOf = new Date();
  const items = rows
    .filter(({ line }) => isCapitalised(line.spreadMonths))
    .map(({ header, line }) => {
      const purchaseCents = Math.round(Number(line.qty) * line.unitPriceCents) - line.lineDiscountCents;
      const life = assetLife({
        purchaseCents,
        spreadMonths: line.spreadMonths!,
        purchasedAt: header.occurredAt,
        asOf,
      });
      return {
        transactionId: header.id,
        // The LABEL first here, unlike the waste report above. An asset is one
        // specific thing — "Concrete mixer", "Site pickup" — and three rows all
        // reading "Plant purchase" tell an owner nothing about what they own.
        // Waste is the opposite: it groups by material, so it wants the item
        // name or "Cement — raft" and "Cement — plaster" become separate rows.
        name:
          line.label ??
          (line.expenseItemId ? maps.expenseItems.get(line.expenseItemId)?.name : null) ??
          "Purchase",
        purchasedAt: header.occurredAt.toISOString(),
        purchaseCents,
        spreadMonths: line.spreadMonths!,
        ...life,
      };
    })
    .filter((item) => options.includeFullyUsed || !item.fullyUsed)
    // Most valuable first: what is left is the figure an owner is looking for.
    .sort((a, b) => b.remainingCents - a.remainingCents);

  return {
    items,
    totalPurchaseCents: items.reduce((sum, item) => sum + item.purchaseCents, 0),
    totalRemainingCents: items.reduce((sum, item) => sum + item.remainingCents, 0),
  };
}
