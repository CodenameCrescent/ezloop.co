import { useMemo, useState } from "react";
import { type RevenueExpensePoint } from "@/components/LiquidRevenueExpenseChart";
import { useStore, useFormatters } from "@/lib/store";
import { figureState, combineFigureStates } from "@/lib/figureState";
import { buildPeriodRangeFromDates, isDateInPeriodRange } from "@/lib/period";
import { bucketForDays } from "@/lib/seriesBucket";
import { getMonthBusinessSummary, getBusinessSummaryForRange, type DashboardTrendPoint, getLast7DaysBusinessTrend, getLast12MonthsBusinessTrend, getLast6YearsBusinessTrend, getDashboardHealthStatus, getDashboardAlerts, calculateUnifiedExpenses, type DashboardSummary } from "@/lib/finance";
import { useGlobalPeriod } from "@/lib/globalPeriod";
import { toApiRange, usePnl, useOffers, useLeaks, usePnlSeries } from "@/api/hooks";
import { buildTopRevenues } from "../dashboardMetrics";
import { percentDelta, buildTopExpenses, buildRecentTransactions } from "./ProfitHero";

/** Dashboard's state and handlers, kept out of its render so each file stays short. */
export function useDashboardLogic() {
  /* `dataState` rather than `isLoading`: three blocks on this page are built
     from the store's arrays, and those fall back to empty when a request fails
     or pauses just as they do when the business really is new. */
  const { orders, adSpend, expenses, products, settings, dataState: storeState } = useStore();
  const f = useFormatters();
  const now = useMemo(() => new Date(), []);
  const [quickAddOpen, setQuickAddOpen] = useState(false);

  const dashboardInput = useMemo(
    () => ({ orders, adSpend, expenses, products, openingCash: settings.cashBuffer, now }),
    [orders, adSpend, expenses, products, settings.cashBuffer, now],
  );

  const period = useGlobalPeriod();
  const range = period.range;
  const priorRange = useMemo(
    () => buildPeriodRangeFromDates(range.priorStart, range.priorEnd, "Previous period"),
    [range],
  );
  const compareNoun = range.label === "Today" ? "vs yesterday" : "vs previous period";

  // Headline money comes from the SERVER ladder (the same source as the Profit &
  // Loss page), so the Dashboard can never disagree with it.
  const apiRange = useMemo(() => toApiRange({ start: range.start, end: range.end }), [range]);
  const priorApiRange = useMemo(() => toApiRange({ start: range.priorStart, end: range.priorEnd }), [range]);
  const pnlQuery = usePnl(apiRange);
  const pnl = pnlQuery.data?.ladder;
  const priorPnl = usePnl(priorApiRange).data?.ladder;
  /*
   * Why the headline is missing, when it is missing.
   *
   * Everything on this page hung off `dashboardLoading = isLoading && !pnl`,
   * and a request that failed or stopped dead reports `isLoading: false`. So
   * the whole dashboard fell through to its "we have nothing" rendering and
   * presented it as fact: an hero built from the wrong source, "Rs 0" owed to
   * you over "Every sale is paid for.", "No income recorded in this period."
   * and "Nothing is flagged right now." None of those were things this page
   * knew. See `lib/figureState.ts`.
   */
  const dashboardState = figureState(pnlQuery, pnl != null);

  // What earns and what loses, over the SAME period the headline reads.
  // toApiRange can omit the bounds on an open range; offers requires both, so
  // an open range simply asks for nothing rather than inventing an epoch.
  const offersRange =
    apiRange.startDate && apiRange.endDate
      ? { startDate: apiRange.startDate, endDate: apiRange.endDate }
      : null;
  const offersQuery = useOffers(offersRange);

  // Money owed is a BALANCE, not a flow: an invoice from March is still owed
  // in August, so this deliberately ignores the period filter and reads the
  // whole ledger up to now. The prior window is a dead year — the endpoint
  // requires one, and this card reads nothing computed against it.
  const owedRange = useMemo(
    () => ({
      startDate: new Date(2000, 0, 1).toISOString(),
      endDate: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999).toISOString(),
      priorStartDate: new Date(1999, 0, 1).toISOString(),
      priorEndDate: new Date(1999, 11, 31).toISOString(),
    }),
    [now],
  );
  const leaksQuery = useLeaks(owedRange);

  /* Each position card reads its own request, so each keeps its own state —
     the offers card failing must not blank the owed card beside it. */
  const offersState = figureState(offersQuery, offersQuery.data != null);
  const leaksState = figureState(leaksQuery, leaksQuery.data != null);

  const rangeDays = useMemo(
    () => Math.max(1, Math.round((range.end.getTime() - range.start.getTime()) / 86_400_000)),
    [range],
  );

  const month = useMemo(() => getMonthBusinessSummary(dashboardInput), [dashboardInput]);
  const summary = useMemo(() => getBusinessSummaryForRange(dashboardInput, range), [dashboardInput, range]);
  const priorSummary = useMemo(
    () => getBusinessSummaryForRange(dashboardInput, priorRange),
    [dashboardInput, priorRange],
  );
  const rangedOrders = useMemo(
    () => orders.filter((order) => isDateInPeriodRange(order.date, range)),
    [orders, range],
  );
  const rangedExpenses = useMemo(
    () => expenses.filter((expense) => isDateInPeriodRange(expense.date, range)),
    [expenses, range],
  );
  const rangedAdSpend = useMemo(
    () => adSpend.filter((entry) => isDateInPeriodRange(entry.date, range)),
    [adSpend, range],
  );

  const seriesRanges = useMemo(() => {
    const end = new Date(now);
    end.setHours(23, 59, 59, 999);
    const d7 = new Date(end);
    d7.setDate(d7.getDate() - 6);
    d7.setHours(0, 0, 0, 0);
    return {
      day: { startDate: d7.toISOString(), endDate: end.toISOString() },
      month: { startDate: new Date(end.getFullYear(), end.getMonth() - 11, 1).toISOString(), endDate: end.toISOString() },
      year: { startDate: new Date(end.getFullYear() - 5, 0, 1).toISOString(), endDate: end.toISOString() },
    };
  }, [now]);
  const daySeries = usePnlSeries(seriesRanges.day, "day");
  const monthSeries = usePnlSeries(seriesRanges.month, "month");
  const yearSeries = usePnlSeries(seriesRanges.year, "year");

  /*
   * The trend lines beside the headline figures.
   *
   * This is the SELECTED period sliced up, not one of the three fixed windows
   * above — the whole point of a line next to a figure is that it is the same
   * period the figure covers. `/reports/pnl-series` guarantees the buckets sum
   * exactly to the whole-period ladder, so the line and the number beside it
   * come from one calculation and cannot drift apart.
   */
  const trendRange = useMemo(
    () => ({ startDate: range.start.toISOString(), endDate: range.end.toISOString() }),
    [range],
  );
  const periodSeries = usePnlSeries(trendRange, bucketForDays(range.days));
  const trends = useMemo(() => {
    const buckets = periodSeries.data?.buckets ?? [];
    let running = 0;
    return {
      // A RUNNING TOTAL, so the hero line ends on the hero figure. Per-bucket
      // profit would be a second, differently-shaped fact beside the number.
      heroProfit: buckets.map((b) => (running += b.trueProfit)),
      moneyIn: buckets.map((b) => b.netRevenue),
      moneyOut: buckets.map((b) => b.periodExpenses),
      // A bucket that took nothing in kept nothing: 0%, not a gap. Skipping it
      // would join the two buckets either side into a straight line across a
      // dead week, which reads as steadiness rather than as silence.
      margin: buckets.map((b) => (b.netRevenue > 0 ? (b.trueProfit / b.netRevenue) * 100 : 0)),
      netCash: buckets.map((b) => b.trueProfit),
    };
  }, [periodSeries.data]);
  const toTrendPoints = (
    data: typeof daySeries.data,
    fallback: DashboardTrendPoint[],
  ): DashboardTrendPoint[] =>
    data
      ? data.buckets.map((b) => ({
          date: b.start,
          label: b.label,
          netRevenue: b.netRevenue / 100,
          totalCosts: (b.netRevenue - b.trueProfit) / 100,
          trueProfit: b.trueProfit / 100,
          orders: b.transactionCount,
        }))
      : fallback;
  const legacyTrend = useMemo(() => getLast7DaysBusinessTrend(dashboardInput), [dashboardInput]);
  const legacyMonthlyTrend = useMemo(() => getLast12MonthsBusinessTrend(dashboardInput), [dashboardInput]);
  const legacyYearlyTrend = useMemo(() => getLast6YearsBusinessTrend(dashboardInput), [dashboardInput]);
  /* The chart reads whichever period is selected and falls back to the store,
     so its message is only honest if it accounts for all four sources. */
  const trendState = combineFigureStates([
    figureState(daySeries, daySeries.data != null),
    figureState(monthSeries, monthSeries.data != null),
    figureState(yearSeries, yearSeries.data != null),
    storeState,
  ]);
  const trend = useMemo(() => toTrendPoints(daySeries.data, legacyTrend), [daySeries.data, legacyTrend]);
  const monthlyTrend = useMemo(() => toTrendPoints(monthSeries.data, legacyMonthlyTrend), [monthSeries.data, legacyMonthlyTrend]);
  const yearlyTrend = useMemo(() => toTrendPoints(yearSeries.data, legacyYearlyTrend), [yearSeries.data, legacyYearlyTrend]);

  const health = useMemo(
    () => getDashboardHealthStatus({ today: summary, month, products, expenses }),
    [summary, month, products, expenses],
  );
  const alerts = useMemo(
    () => getDashboardAlerts({ today: summary, month, products, expenses }),
    [summary, month, products, expenses],
  );

  const unifiedExpenses = useMemo(
    () => calculateUnifiedExpenses(rangedExpenses, rangedAdSpend),
    [rangedExpenses, rangedAdSpend],
  );
  const priorUnifiedExpenses = useMemo(
    () => calculateUnifiedExpenses(expenses, adSpend, priorRange),
    [expenses, adSpend, priorRange],
  );

  const serverSummary = useMemo<DashboardSummary>(() => {
    if (!pnl) return summary;
    return {
      ...summary,
      netRevenue: pnl.netRevenue / 100,
      trueProfit: pnl.trueProfit / 100,
      totalCosts: (pnl.netRevenue - pnl.trueProfit) / 100,
      marginPct: pnl.netRevenue > 0 ? (pnl.trueProfit / pnl.netRevenue) * 100 : 0,
    };
  }, [pnl, summary]);
  const serverUnifiedExpenses = pnl ? pnl.periodExpenses / 100 : unifiedExpenses;
  // Read straight off the ladder — the server now names this rung, so the UI
  // never has to back it out of two other numbers. Falls back to zero rather
  // than a subtraction: with no ladder loaded we do not know it, and a guessed
  // figure in a money column is the thing DESIGN.md forbids.
  //
  // That fallback used to be defended with "the hero only renders past
  // `dashboardLoading`, so this path is not what the reader sees", and the
  // premise was false. `dashboardLoading` was `isLoading && !pnl`, which a
  // FAILED or PAUSED request leaves false — so the hero rendered anyway, with
  // direct costs of zero and the rest of its figures quietly falling back to
  // the client-side legacy summary. The page's biggest number, computed from
  // the wrong source with a rung missing. The hero now requires `pnl`.
  const serverDirectCosts = pnl ? pnl.directCosts / 100 : 0;
  const priorNetRevenue = priorPnl ? priorPnl.netRevenue / 100 : priorSummary.netRevenue;
  const priorTrueProfitValue = priorPnl ? priorPnl.trueProfit / 100 : priorSummary.trueProfit;
  const priorPeriodExpenses = priorPnl ? priorPnl.periodExpenses / 100 : priorUnifiedExpenses;
  const priorMarginPct =
    priorPnl && priorPnl.netRevenue > 0 ? (priorPnl.trueProfit / priorPnl.netRevenue) * 100 : priorSummary.marginPct;

  const topRevenues = useMemo(() => buildTopRevenues(rangedOrders), [rangedOrders]);
  const topExpenses = useMemo(() => buildTopExpenses(rangedExpenses, rangedAdSpend), [rangedExpenses, rangedAdSpend]);
  const recent = useMemo(() => buildRecentTransactions(rangedOrders, rangedExpenses), [rangedOrders, rangedExpenses]);

  const revenueDelta = percentDelta(serverSummary.netRevenue, priorNetRevenue);
  const expenseDelta = percentDelta(serverUnifiedExpenses, priorPeriodExpenses);
  const marginDelta = percentDelta(serverSummary.marginPct, priorMarginPct);
  const cashDelta = percentDelta(serverSummary.trueProfit, priorTrueProfitValue);

  const toChartPoints = (points: DashboardTrendPoint[]): RevenueExpensePoint[] =>
    points.map((point) => ({
      label: point.label,
      revenue: Math.max(0, point.netRevenue),
      expense: Math.max(0, point.totalCosts),
    }));

  return {
    range,
    setQuickAddOpen,
    pnl,
    dashboardState,
    pnlQuery,
    serverSummary,
    cashDelta,
    compareNoun,
    trends,
    f,
    serverDirectCosts,
    serverUnifiedExpenses,
    revenueDelta,
    expenseDelta,
    marginDelta,
    trendState,
    toChartPoints,
    trend,
    monthlyTrend,
    yearlyTrend,
    priorPnl,
    offersQuery,
    offersState,
    leaksQuery,
    leaksState,
    settings,
    rangeDays,
    recent,
    storeState,
    topRevenues,
    topExpenses,
    alerts,
    quickAddOpen,
    health,
  };
}
