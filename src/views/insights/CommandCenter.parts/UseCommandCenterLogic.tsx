import { useMemo } from "react";
import Link from "next/link";
import { Sparkles, ArrowUpRight, ArrowDownRight, ArrowRight } from "lucide-react";
import { ResponsiveContainer, ComposedChart, Line, CartesianGrid, XAxis, YAxis, Tooltip, Area } from "recharts";
import { LiquidGlassCard } from "@/components/LiquidGlassCard";
import { Skeleton } from "@/components/ui/skeleton";
import { LINE, SERIES_STATIC, AreaGradient, GRID, X_AXIS, Y_AXIS, CURSOR, ChartTooltip, activeDot } from "@/components/charts/rechartsKit";
import { useInsightsPeriod } from "@/lib/insightsContext";
import { useFormatters } from "@/lib/store";
import { usePnl, useDrivers, useLeaks, useMomentum, useRetention, useInsights, usePnlSeries } from "@/api/hooks";
import { formatCentsSigned, formatCompactNumber } from "@/lib/money";
import { figureState, figureStateSentence } from "@/lib/figureState";
import { LADDER_LABELS } from "@workspace/domain";
import { cn } from "@/lib/utils";

/**
 * The Insights command center (Insights 2.0, slice I1). Pulse-first: a
 * plain-English verdict + true profit loads first and biggest; the four
 * question-blocks follow in the owner's priority order. Every number is
 * server-computed (usePnl / usePnlSeries) — this page only words them.
 */

/* Two series, so two identities: net revenue is money in and wears the gain
   mark; true profit takes a validated categorical slot — never a tag hue
   (DESIGN.md 3b). */
export const NET_COLOUR = "var(--pl-chart-gain)";
export const PROFIT_COLOUR = "var(--pl-cat-4)";

export function pctDelta(current: number, prior: number): number | null {
  if (prior === 0) return current === 0 ? 0 : null; // "new" — no meaningful %
  return ((current - prior) / Math.abs(prior)) * 100;
}

export function verdictSentence(trueProfit: number, delta: number | null, label: string): string {
  const period = label.toLowerCase() === "today" ? "today" : `this ${label.toLowerCase().replace("this ", "")}`;
  if (trueProfit < 0) return `You spent more than you made ${period} — the blocks below show where it went.`;
  if (delta === null) return `You made a profit ${period}, with nothing in the previous period to compare against.`;
  if (delta > 8) return `A strong run: true profit is up ${Math.abs(delta).toFixed(0)}% on the previous period.`;
  if (delta < -8) return `Heads up: true profit is down ${Math.abs(delta).toFixed(0)}% on the previous period.`;
  return `Steady: true profit is holding close to the previous period.`;
}

/** Auto bucket: fine enough to show shape, coarse enough to stay readable. */
export function bucketFor(days: number): "day" | "week" | "month" {
  if (days <= 31) return "day";
  if (days <= 130) return "week";
  return "month";
}

/** CommandCenter's state and handlers, kept out of its render so each file stays short. */
export function useCommandCenterLogic() {
  const ctx = useInsightsPeriod();
  const f = useFormatters();
  const range = ctx?.range;

  const apiRange = useMemo(
    () => (range ? { startDate: range.start.toISOString(), endDate: range.end.toISOString() } : null),
    [range],
  );
  const priorApiRange = useMemo(
    () => (range ? { startDate: range.priorStart.toISOString(), endDate: range.priorEnd.toISOString() } : null),
    [range],
  );

  const driversRange = useMemo(
    () =>
      range
        ? {
            startDate: range.start.toISOString(),
            endDate: range.end.toISOString(),
            priorStartDate: range.priorStart.toISOString(),
            priorEndDate: range.priorEnd.toISOString(),
          }
        : null,
    [range],
  );

  const current = usePnl(apiRange ?? {});
  const prior = usePnl(priorApiRange ?? {});
  const drivers = useDrivers(driversRange);
  const leaks = useLeaks(driversRange);
  const momentum = useMomentum(driversRange);
  const retention = useRetention();
  const insightFeed = useInsights(driversRange, range ? `${range.label} vs the period before` : undefined);
  const series = usePnlSeries(
    apiRange ?? { startDate: new Date().toISOString(), endDate: new Date().toISOString() },
    bucketFor(range?.days ?? 30),
  );


  const money = f.moneyCents;
  const ladder = current.data?.ladder;
  const priorLadder = prior.data?.ladder;
  /*
   * Four independent requests feed four blocks, so each keeps its own state —
   * the movers can fail while the leaks arrive, and the page should say which
   * one did rather than pulsing every skeleton at once.
   *
   * All four sat on `isLoading || !data`, which a failed or paused request
   * leaves false with nothing behind it, so each block promised an arrival
   * that was not coming. On this page that costs more than elsewhere: the
   * verdict strip is the 30-second read, and a permanent skeleton where the
   * profit figure goes reads as "still working" rather than "ask again".
   */
  const currentState = figureState(current, ladder != null);
  const driversState = figureState(drivers, drivers.data != null);
  const leaksState = figureState(leaks, leaks.data != null);
  const momentumState = figureState(momentum, momentum.data != null);

  const delta = ladder && priorLadder ? pctDelta(ladder.trueProfit, priorLadder.trueProfit) : null;
  const marginPct = ladder && ladder.netRevenue > 0 ? (ladder.trueProfit / ladder.netRevenue) * 100 : null;
  const chartData = (series.data?.buckets ?? []).map((b) => ({
    label: b.label,
    net: b.netRevenue / 100,
    profit: b.trueProfit / 100,
  }));

  return {
    range,
    f,
    current,
    prior,
    drivers,
    leaks,
    momentum,
    series,
    insightFeed,
    retention,
    money,
    ladder,
    priorLadder,
    currentState,
    driversState,
    leaksState,
    momentumState,
    delta,
    marginPct,
    chartData,
  };
}

export type CommandCenterState = ReturnType<typeof useCommandCenterLogic>;

export function VerdictStrip({ current, range, f, ladder, currentState, delta, marginPct, chartData }: Pick<CommandCenterState, "current" | "f" | "ladder" | "currentState" | "delta" | "marginPct" | "chartData"> & { range: NonNullable<CommandCenterState["range"]> }) {
  return (
    <LiquidGlassCard padding="lg">
        {!ladder ? (
          currentState === "loading" ? (
            <div className="space-y-3">
              <Skeleton className="h-7 w-40 rounded-full" />
              <Skeleton className="h-12 w-72" />
              <Skeleton className="h-5 w-full max-w-lg" />
            </div>
          ) : (
            <div>
              <p className="text-sm text-[color:var(--pl-amber)]">
                {figureStateSentence(currentState, "this period's profit")}
              </p>
              {currentState === "failed" && (
                <button
                  onClick={() => current.refetch()}
                  className="mt-3 rounded-lg border border-[color:var(--glass-border)] px-3 py-1.5 text-xs font-medium text-[color:var(--pl-ink-2)] transition hover:text-[color:var(--pl-ink)]"
                >
                  Try again
                </button>
              )}
            </div>
          )
        ) : (
          <div className="flex flex-wrap items-start justify-between gap-6">
            <div className="min-w-0 max-w-2xl">
              <div className="inline-flex items-center gap-2 rounded-full bg-[color:var(--pl-orange-tint)] px-3 py-1 text-xs font-semibold text-[color:var(--pl-orange-text)]">
                <Sparkles className="h-3.5 w-3.5" /> {range.label}
              </div>
              <div className="mt-4 flex flex-wrap items-baseline gap-3">
                <span
                  className={cn(
                    "text-4xl font-semibold tracking-tight sm:text-5xl",
                    ladder.trueProfit >= 0 ? "text-[color:var(--pl-green)]" : "text-[color:var(--pl-red)]",
                  )}
                >
                  {formatCentsSigned(ladder.trueProfit, f.symbol)}
                </span>
                <span className="text-sm font-medium text-[color:var(--pl-ink-2)]">{LADDER_LABELS.trueProfit.label}</span>
              </div>
              <div className="mt-3 flex flex-wrap gap-2 text-xs font-semibold">
                {delta !== null && (
                  <span
                    className={cn(
                      "inline-flex items-center gap-1 rounded-full px-3 py-1",
                      delta >= 0
                        ? "bg-[color:color-mix(in_srgb,var(--pl-green)_10%,transparent)] text-[color:var(--pl-green)]"
                        : "bg-[color:color-mix(in_srgb,var(--pl-red)_10%,transparent)] text-[color:var(--pl-red)]",
                    )}
                  >
                    {delta >= 0 ? <ArrowUpRight className="h-3.5 w-3.5" /> : <ArrowDownRight className="h-3.5 w-3.5" />}
                    {Math.abs(delta).toFixed(1)}% vs previous period
                  </span>
                )}
                {marginPct !== null && (
                  <span className="rounded-full bg-[color:color-mix(in_srgb,var(--pl-purple)_10%,transparent)] px-3 py-1 text-[color:var(--pl-purple)]">
                    {marginPct.toFixed(1)}% margin
                  </span>
                )}
              </div>
              <p className="mt-4 text-sm leading-6 text-[color:var(--pl-ink-2)]">
                {verdictSentence(ladder.trueProfit, delta, range.label)}
              </p>
            </div>
            <div className="h-24 w-full max-w-xs flex-1">
              {chartData.length > 1 && (
                <div className="pl-chart h-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
                      <Line type="monotone" dataKey="profit" stroke="var(--pl-chart-gain)" {...LINE} {...SERIES_STATIC} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          </div>
        )}

      </LiquidGlassCard>
  );
}

export function MadeMoneyBlock({ range, f, ladder, currentState, chartData, priorLadder, money }: Pick<CommandCenterState, "f" | "ladder" | "currentState" | "chartData" | "priorLadder" | "money"> & { range: NonNullable<CommandCenterState["range"]> }) {
  return (
    <LiquidGlassCard padding="lg">
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-[color:var(--pl-ink)]">Did I make money?</h2>
            <p className="mt-1 text-xs text-[color:var(--pl-ink-2)]">
              Net revenue and true profit over {range.label.toLowerCase()}, next to the previous period.
            </p>
          </div>
          <Link href="/money/profit-loss" className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-[color:var(--pl-orange-text)] hover:underline">
            Full profit ladder <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>

        {!ladder ? (
          currentState === "loading" ? (
            <Skeleton className="h-[260px] w-full rounded-xl" />
          ) : (
            /* The rung tiles below read `ladder[key]` directly, so this guard
               is load-bearing rather than cosmetic — there is no figure to
               print and no honest zero to print instead. */
            <p className="text-sm text-[color:var(--pl-amber)]">
              {figureStateSentence(currentState, "this period's figures")}
            </p>
          )
        ) : (
          <>
            <div className="pl-chart h-[260px]">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartData} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
                  <defs>
                    <AreaGradient id="cc-net" color={NET_COLOUR} />
                  </defs>
                  <CartesianGrid {...GRID} />
                  <XAxis dataKey="label" {...X_AXIS} />
                  <YAxis {...Y_AXIS} tickFormatter={(v: number) => formatCompactNumber(Math.round(v * 100))} />
                  <Tooltip
                    cursor={CURSOR}
                    content={<ChartTooltip format={f.money} names={{ net: "Net revenue", profit: "True profit" }} />}
                  />
                  <Area type="monotone" dataKey="net" fill="url(#cc-net)" stroke={NET_COLOUR} {...LINE} activeDot={activeDot(NET_COLOUR)} {...SERIES_STATIC} />
                  <Line type="monotone" dataKey="profit" stroke={PROFIT_COLOUR} {...LINE} activeDot={activeDot(PROFIT_COLOUR)} {...SERIES_STATIC} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-3 flex gap-4 t-micro text-[color:var(--pl-ink-2)]">
              <span className="inline-flex items-center gap-1.5"><span className="h-0.5 w-4 rounded-full" style={{ background: NET_COLOUR }} /> Net revenue</span>
              <span className="inline-flex items-center gap-1.5"><span className="h-0.5 w-4 rounded-full" style={{ background: PROFIT_COLOUR }} /> True profit</span>
            </div>

            {/* Current vs previous, rung by rung — the ONE ladder vocabulary. */}
            <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {([
                ["grossRevenue", LADDER_LABELS.grossRevenue.label],
                ["netRevenue", LADDER_LABELS.netRevenue.label],
                ["contributionProfit", LADDER_LABELS.contributionProfit.label],
                ["trueProfit", LADDER_LABELS.trueProfit.label],
              ] as const).map(([key, label]) => {
                const now = ladder[key];
                const before = priorLadder?.[key] ?? 0;
                const d = priorLadder ? pctDelta(now, before) : null;
                return (
                  <div key={key} className="rounded-lg bg-[color:var(--glass-bg-tinted)] p-3">
                    <div className="text-xs text-[color:var(--pl-ink-2)]">{label}</div>
                    <div className="mt-1 text-lg font-semibold tabular-nums text-[color:var(--pl-ink)]">{money(now)}</div>
                    <div className="mt-1 text-[11px] font-medium text-[color:var(--pl-mid-grey)]">
                      {d === null ? "no prior data" : `${d >= 0 ? "+" : "−"}${Math.abs(d).toFixed(1)}% · was ${money(before)}`}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </LiquidGlassCard>
  );
}
