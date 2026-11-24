import { useMemo, useState } from "react";
import { Area, Bar, CartesianGrid, ComposedChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { LiquidGlassCard } from "@/components/LiquidGlassCard";
import { Skeleton } from "@/components/ui/skeleton";
import { ChartFrame } from "@/components/charts/ChartFrame";
import { DivergingBar } from "@/components/charts/DivergingBar";
import {
  AreaGradient,
  BAR_CURSOR,
  ChartTooltip,
  GRID,
  LINE,
  SERIES_STATIC,
  X_AXIS,
  Y_AXIS,
  activeDot,
} from "@/components/charts/rechartsKit";
import { useInsightsPeriod } from "@/lib/insightsContext";
import { useFormatters } from "@/lib/store";
import { useDrivers, usePnlSeries } from "@/api/hooks";
import { figureState, figureStateSentence } from "@/lib/figureState";
import { formatCents, formatCompactNumber } from "@/lib/money";
import { cn } from "@/lib/utils";

type Bucket = "day" | "week" | "month";

/* Costs are ordinary spending, so neutral grey — red is for money that went
   backwards. True profit takes a validated categorical slot, never a tag hue
   (DESIGN.md 3b). */
const SERIES = {
  net: { label: "Net revenue", colour: "var(--pl-chart-gain)" },
  costs: { label: "Costs", colour: "var(--pl-chart-neutral)" },
  profit: { label: "True profit", colour: "var(--pl-cat-4)" },
} as const;
type Axis = "items" | "sources" | "categories" | "expenseTypes";
const AXIS_LABEL: Record<Axis, string> = { items: "By item", sources: "By source", categories: "By category", expenseTypes: "By expense type" };

/**
 * The profit deep page (Insights 2.0 → "Explore profit"). Two tools on the ONE
 * server profit series + the reconciling driver decomposition: a
 * bucket-switchable trend, and a full mover breakdown across every axis.
 */
export default function ProfitInsights() {
  const ctx = useInsightsPeriod();
  const f = useFormatters();
  const range = ctx?.range;
  const [bucket, setBucket] = useState<Bucket>("week");
  const [axis, setAxis] = useState<Axis>("items");

  const seriesRange = useMemo(
    () => (range ? { startDate: range.start.toISOString(), endDate: range.end.toISOString() } : null),
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

  const series = usePnlSeries(seriesRange ?? { startDate: new Date().toISOString(), endDate: new Date().toISOString() }, bucket);
  const drivers = useDrivers(driversRange);

  if (!range) return null;
  const money = f.moneyCents;
  const chartData = (series.data?.buckets ?? []).map((b) => ({
    label: b.label,
    net: b.netRevenue / 100,
    costs: (b.netRevenue - b.trueProfit) / 100,
    profit: b.trueProfit / 100,
  }));
  const rows = (drivers.data?.[axis] ?? []).filter((r) => r.deltaCents !== 0 || r.currentCents !== 0);
  const maxAbs = Math.max(1, ...rows.map((r) => Math.abs(r.deltaCents)));
  /*
   * Two independent requests, so two states — the trend and the movers fail
   * separately and the page should say which one did. Both blocks used to sit
   * on `isLoading || !data` and pulse a skeleton for ever when the request had
   * actually stopped; the movers block then fell through to "No activity on
   * this axis in the selected period", which is a claim about the business.
   */
  const seriesState = figureState(series, series.data != null);
  const driversState = figureState(drivers, drivers.data != null);

  return (
    <div className="mx-auto max-w-[1500px] space-y-5 px-4 py-5 sm:px-6 lg:px-8">
      <LiquidGlassCard padding="lg">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-[color:var(--pl-ink)]">Profit over time</h2>
            <p className="mt-1 text-xs text-[color:var(--pl-ink-2)]">Net revenue, costs, and true profit per {bucket}.</p>
          </div>
          <div className="inline-flex rounded-lg border border-[color:var(--glass-border)] p-0.5 text-xs">
            {(["day", "week", "month"] as Bucket[]).map((b) => (
              <button
                key={b}
                onClick={() => setBucket(b)}
                className={cn(
                  "rounded-md px-3 py-1.5 capitalize transition",
                  bucket === b ? "bg-[color:var(--pl-orange-fill)] font-semibold text-white" : "text-[color:var(--pl-ink-2)] hover:text-[color:var(--pl-ink)]",
                )}
              >
                {b}
              </button>
            ))}
          </div>
        </div>
        {!series.data ? (
          seriesState === "loading" ? (
            <Skeleton className="h-[300px] w-full rounded-xl" />
          ) : (
            <div className="grid h-[300px] place-items-center rounded-xl bg-[color:var(--pl-chart-track)] px-6 text-center">
              <p className="text-sm text-[color:var(--pl-amber)]">
                {figureStateSentence(seriesState, "your profit over time")}
              </p>
            </div>
          )
        ) : (
          <>
            <div className="pl-chart h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartData} margin={{ top: 8, right: 16, bottom: 0, left: 0 }} barCategoryGap="28%">
                  <defs>
                    <AreaGradient id="pi-net" color={SERIES.net.colour} strength={0.14} />
                    <AreaGradient id="pi-profit" color={SERIES.profit.colour} strength={0.14} />
                  </defs>
                  <CartesianGrid {...GRID} />
                  <XAxis dataKey="label" {...X_AXIS} />
                  <YAxis {...Y_AXIS} tickFormatter={(v: number) => formatCompactNumber(Math.round(v * 100))} />
                  <Tooltip
                    cursor={BAR_CURSOR}
                    content={
                      <ChartTooltip
                        format={f.money}
                        names={{ net: SERIES.net.label, costs: SERIES.costs.label, profit: SERIES.profit.label }}
                      />
                    }
                  />
                  <Bar dataKey="costs" name={SERIES.costs.label} fill={SERIES.costs.colour} fillOpacity={0.55} radius={[4, 4, 0, 0]} maxBarSize={24} {...SERIES_STATIC} />
                  <Area type="monotone" dataKey="net" name={SERIES.net.label} fill="url(#pi-net)" stroke={SERIES.net.colour} {...LINE} activeDot={activeDot(SERIES.net.colour)} {...SERIES_STATIC} />
                  <Area type="monotone" dataKey="profit" name={SERIES.profit.label} fill="url(#pi-profit)" stroke={SERIES.profit.colour} {...LINE} activeDot={activeDot(SERIES.profit.colour)} {...SERIES_STATIC} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-3 flex flex-wrap gap-4 t-micro text-[color:var(--pl-ink-2)]">
              {(["net", "costs", "profit"] as const).map((key) => (
                <span key={key} className="inline-flex items-center gap-1.5">
                  <span
                    aria-hidden
                    className={key === "costs" ? "h-2.5 w-2.5 rounded-[3px]" : "h-0.5 w-4 rounded-full"}
                    style={{ background: SERIES[key].colour, opacity: key === "costs" ? 0.55 : 1 }}
                  />
                  {SERIES[key].label}
                </span>
              ))}
            </div>
          </>
        )}
      </LiquidGlassCard>

      <LiquidGlassCard padding="lg">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-[color:var(--pl-ink)]">What moved profit</h2>
            <p className="mt-1 text-xs text-[color:var(--pl-ink-2)]">Contribution change vs the previous period. Together these explain the whole swing.</p>
          </div>
          <div className="inline-flex flex-wrap rounded-lg border border-[color:var(--glass-border)] p-0.5 text-xs">
            {(Object.keys(AXIS_LABEL) as Axis[]).map((a) => (
              <button
                key={a}
                onClick={() => setAxis(a)}
                className={cn(
                  "rounded-md px-3 py-1.5 transition",
                  axis === a ? "bg-[color:var(--pl-orange-fill)] font-semibold text-white" : "text-[color:var(--pl-ink-2)] hover:text-[color:var(--pl-ink)]",
                )}
              >
                {AXIS_LABEL[a]}
              </button>
            ))}
          </div>
        </div>
        {!drivers.data ? (
          driversState === "loading" ? (
            <div className="space-y-3">{[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-10 w-full rounded-lg" />)}</div>
          ) : (
            <p className="text-sm text-[color:var(--pl-amber)]">
              {figureStateSentence(driversState, "what moved profit")}
            </p>
          )
        ) : rows.length === 0 ? (
          <p className="text-sm text-[color:var(--pl-ink-2)]">No activity on this axis in the selected period.</p>
        ) : (
          <ChartFrame height={Math.max(140, Math.min(rows.length, 12) * 50)} state="settled" surface={false}>
            <DivergingBar
              rows={rows
                .slice(0, 12)
                .sort((a, b) => b.deltaCents - a.deltaCents)
                .map((r) => ({
                  id: r.key,
                  label: r.label,
                  sub: `now ${money(r.currentCents)} · was ${money(r.priorCents)}`,
                  value: r.deltaCents,
                }))}
              max={maxAbs}
              format={money}
              zeroLine="centre"
            />
          </ChartFrame>
        )}
      </LiquidGlassCard>
    </div>
  );
}
