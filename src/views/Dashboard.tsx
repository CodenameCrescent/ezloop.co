import { Plus } from "lucide-react";
import { QuickAdd } from "@/components/QuickAdd";
import { PendingRecurringQueue } from "@/components/PendingRecurringQueue";
import { SignalBanner } from "@/components/SignalBanner";
import { LiquidRevenueExpenseChart } from "@/components/LiquidRevenueExpenseChart";
import { PageHeader } from "@/components/PageHeader";
import { Surface } from "@/components/Surface";
import { StatTile } from "@/components/StatTile";
import { Reveal, Stagger } from "@/components/Reveal";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { figureStateSentence } from "@/lib/figureState";
import { FigureSlot } from "@/components/FigureSlot";
import { formatRangeLabel } from "@/lib/periodLabel";
import { safeNumber, ProfitHero } from "./Dashboard.parts/ProfitHero";
import { ProfitSplit, RecentActivity, WhereMoneyWent } from "./Dashboard.parts/ProfitSplit";
import { NeedsAttention, HeroUnavailable, PeriodCompareCard, MoneyOwedCard } from "./Dashboard.parts/MoneyOwedCard";
import { PerformersCard, CashCard } from "./Dashboard.parts/PerformersCard";
import { useDashboardLogic } from "./Dashboard.parts/UseDashboardLogic";

/* Reserves the headline row at the size it is about to be, brand block and
   floating split together, so nothing moves under a reading eye when the
   figures land. */
function HeroSkeleton() {
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:items-center">
      <Surface padding="lg" className="min-h-[13.5rem] space-y-3">
        <Skeleton className="h-3 w-32" />
        <Skeleton className="h-14 w-56" />
        <Skeleton className="h-5 w-64" />
      </Surface>
      <div className="flex flex-wrap items-center gap-x-8 gap-y-6 lg:pl-2">
        <Skeleton className="h-[160px] w-[160px] shrink-0 rounded-full" />
        <div className="min-w-[12rem] flex-1 space-y-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-4 w-full" />
          ))}
        </div>
      </div>
    </div>
  );
}

/* ── The page ─────────────────────────────────────────────────────────────── */

export default function Dashboard() {
  const {
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
  } = useDashboardLogic();

  return (
    <div className="app-page-shell">
      <PageHeader
        title="Summary"
        /* The window the whole page covers, derived from the live filter. The
           preset name in the filter ("This Year") is not the same fact — it
           means different dates in January and in September. */
        meta={formatRangeLabel(range.start, range.end)}
        actions={
          <Button onClick={() => setQuickAddOpen(true)}>
            <Plus className="h-4 w-4" />
            Add transaction
          </Button>
        }
      />

      {/*
        The page arrives top-down, 50ms between blocks.

        That order is the reading order — the number, then what moved, then the
        shape of it, then the detail — so the stagger is doing the same job as
        the layout, one beat behind. It is over in under half a second and it
        runs once per visit, not on every data refresh.
      */}
      <Stagger className="space-y-6" step={0.05}>
        {/* The number comes first. Two tinted warning strips used to sit above
            it and filled the top third of the screen, so the first thing the
            dashboard said was "something is wrong" rather than what you made. */}
        <Reveal as="section">
          {!pnl ? (
            dashboardState === "loading" ? (
              <HeroSkeleton />
            ) : (
              <HeroUnavailable state={dashboardState} onRetry={() => pnlQuery.refetch()} />
            )
          ) : (
            /* The headline is TWO blocks, not one card: the brand block states
               the figure, and the ring beside it — floating straight on the
               page — breaks that figure into where the money went. Putting
               them in one card made the split look like a second headline. */
            <div className="grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:items-center">
              <ProfitHero
                trueProfit={serverSummary.trueProfit}
                marginPct={serverSummary.marginPct}
                delta={cashDelta}
                periodLabel={range.label}
                compareNoun={compareNoun}
                trend={trends.heroProfit}
                money={f.money}
              />
              <ProfitSplit
                netRevenue={serverSummary.netRevenue}
                directCosts={serverDirectCosts}
                expenses={serverUnifiedExpenses}
                trueProfit={serverSummary.trueProfit}
                marginPct={serverSummary.marginPct}
                money={f.money}
              />
            </div>
          )}
        </Reveal>

        <Reveal>
          <SignalBanner />
        </Reveal>

        {/* Four separate cards, each carrying its own trend line.
            It was one bordered strip with hairline divisions. The strip is the
            right form for figures read as a set; these four are read one at a
            time and each now has a shape beside it, which a shared cell cannot
            give room to. */}
        <Reveal as="section" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {!pnl
            ? [0, 1, 2, 3].map((i) => (
                <Surface key={i} padding="md" className="flex flex-col gap-2.5">
                  {dashboardState === "loading" ? (
                    <>
                      <Skeleton className="h-3 w-20" />
                      <Skeleton className="h-6 w-24" />
                      <Skeleton className="h-3 w-20" />
                    </>
                  ) : (
                    /* The four labels stay — they say what the row is FOR, and
                       keeping them means the block holds its height. Only the
                       figures are missing, and each says so in its own card
                       rather than the page apologising once at the top. */
                    <>
                      <div className="t-micro">{["Money in", "Money out", "Margin", "Net cash"][i]}</div>
                      <div className="text-lg font-semibold">
                        <FigureSlot state={dashboardState}>{null}</FigureSlot>
                      </div>
                    </>
                  )}
                </Surface>
              ))
            : (
              <>
                <StatTile
                  label="Money in"
                  value={f.money(serverSummary.netRevenue)}
                  delta={revenueDelta}
                  deltaLabel={compareNoun}
                  goodDirection="up-is-good"
                  trend={trends.moneyIn}
                />
                <StatTile
                  label="Money out"
                  value={f.money(serverUnifiedExpenses)}
                  delta={expenseDelta}
                  deltaLabel={compareNoun}
                  goodDirection="down-is-good"
                  trend={trends.moneyOut}
                />
                <StatTile
                  label="Margin"
                  value={`${serverSummary.marginPct.toFixed(1)}%`}
                  delta={marginDelta}
                  deltaLabel={compareNoun}
                  goodDirection="up-is-good"
                  trend={trends.margin}
                />
                <StatTile
                  label="Net cash"
                  value={f.moneySigned(serverSummary.trueProfit)}
                  delta={cashDelta}
                  deltaLabel={compareNoun}
                  goodDirection="up-is-good"
                  trend={trends.netCash}
                />
              </>
            )}
        </Reveal>

        <Reveal>
          {/*
            "Add revenue and expenses to unlock this graph." is an instruction,
            so it asserts there is nothing to graph. The three series fall back
            to the legacy store and the store falls back to empty arrays, so
            every one of the four sources can be missing at once and the chart
            would still tell a trading business to go and record something.
            Four states in, one out — offline explains all four together.
          */}
          <LiquidRevenueExpenseChart
            state={trendState}
            emptyMessage={
              trendState === "settled"
                ? undefined
                : trendState === "loading"
                  ? "Working it out…"
                  : figureStateSentence(trendState, "your trend")
            }
            title="Money in and out"
            dailyData={toChartPoints(trend)}
            monthlyData={toChartPoints(monthlyTrend)}
            yearlyData={toChartPoints(yearlyTrend)}
            periodValues={{
              Daily: safeNumber(trend.at(-1)?.trueProfit),
              Monthly: safeNumber(monthlyTrend.at(-1)?.trueProfit),
              Yearly: safeNumber(yearlyTrend.at(-1)?.trueProfit),
            }}
          />
        </Reveal>

        {/* The position cards: comparison, both directions of owed, what earns
            and loses, and how long the cash lasts. They sit AFTER the chart —
            the page answers "how am I doing" first, then "what should I do". */}
        <Reveal as="section" className="grid gap-4 xl:grid-cols-2">
          <PeriodCompareCard
            now={pnl}
            prior={priorPnl}
            periodLabel={range.label}
            money={f.money}
          />
          <PerformersCard data={offersQuery.data} state={offersState} money={f.money} />
          <MoneyOwedCard leaks={leaksQuery.data} state={leaksState} money={f.money} />
          <CashCard cashBuffer={safeNumber(settings.cashBuffer)} ladder={pnl} rangeDays={rangeDays} money={f.money} />
        </Reveal>

        <Reveal as="section" className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
          <RecentActivity items={recent} money={f.money} state={storeState} />
          {/* Both lists are built from the legacy STORE, not from `pnl`, so
              they take the store's own state rather than the ladder's. */}
          <WhereMoneyWent
            topRevenues={topRevenues}
            topExpenses={topExpenses}
            money={f.money}
            state={storeState}
          />
        </Reveal>

        {/* A to-do, so it sits with the other things needing a decision rather
            than above the headline. */}
        <Reveal>
          <PendingRecurringQueue compact />
        </Reveal>

        <Reveal>
          <NeedsAttention alerts={alerts} state={storeState} />
        </Reveal>
      </Stagger>

      <QuickAdd open={quickAddOpen} onOpenChange={setQuickAddOpen} />
      {/* The screen-reader summary obeys the same rule as the visible page.
          `health` is derived from the store's arrays, so an unreachable server
          produced a confident "Business health: Not Enough Data" — a verdict,
          announced to the one reader who cannot see the amber notices saying
          otherwise everywhere above it. */}
      <div className="sr-only">
        {storeState === "settled"
          ? `Business health: ${health.status}. ${health.actionLabel}`
          : figureStateSentence(storeState, "your business health")}
      </div>
    </div>
  );
}
