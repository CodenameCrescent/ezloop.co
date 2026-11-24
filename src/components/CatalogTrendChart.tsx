import { useMemo } from "react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Surface } from "./Surface";
import { SectionHeading } from "./SectionHeading";
import { useGlobalPeriod } from "@/lib/globalPeriod";
import { useFormatters } from "@/lib/store";
import { usePnlSeries } from "@/api/hooks";
import { formatCompactNumber } from "@/lib/money";
import {
  AreaGradient,
  ChartTooltip,
  CURSOR,
  GRID,
  LINE,
  SERIES_STATIC,
  X_AXIS,
  Y_AXIS,
  activeDot,
} from "./charts/rechartsKit";
import { figureState, FIGURE_STATE_COPY } from "@/lib/figureState";
import { FigureSlot } from "./FigureSlot";

/**
 * The chart that sits above the Revenue and Expense catalogs.
 *
 * One component, two metrics: the pages are meant to be twins, so the graph
 * they share is literally the same code rather than two that drift apart.
 *
 * It follows the global period filter — change the range in the header and the
 * shape below it changes with it, which is the whole point of the filter
 * living in one fixed place.
 */
export function CatalogTrendChart({ metric }: { metric: "revenue" | "expense" }) {
  const period = useGlobalPeriod();
  const f = useFormatters();
  const range = period.range;

  // Bucket follows the length of the window: days for a month or less, months
  // for up to a year, years beyond that. A year of daily bars is unreadable.
  const spanDays = Math.max(
    1,
    Math.round((range.end.getTime() - range.start.getTime()) / 86_400_000),
  );
  const bucket = spanDays <= 31 ? "day" : spanDays <= 366 ? "month" : "year";

  const apiRange = useMemo(
    () => ({ startDate: range.start.toISOString(), endDate: range.end.toISOString() }),
    [range],
  );
  const series = usePnlSeries(apiRange, bucket);

  const data = useMemo(
    () =>
      (series.data?.buckets ?? []).map((b) => ({
        label: b.label,
        value: (metric === "revenue" ? b.netRevenue : b.periodExpenses) / 100,
      })),
    [series.data, metric],
  );

  const total = data.reduce((sum, point) => sum + point.value, 0);
  const hasData = data.some((point) => point.value !== 0);
  const money = (value: number) => f.moneyCents(Math.round(value * 100));

  /*
   * Why there is no shape, when there is no shape.
   *
   * Both branches below used to be reachable from a request that never
   * arrived: the total printed Rs 0 off the `?? []` above, and the placeholder
   * told the owner to "record a sale" — which is the exact sentence DESIGN.md
   * §8 says ChartFrame was built to stop a chart saying while it had no idea
   * what it was looking at. `isLoading` alone could not tell them apart,
   * because a failed and a paused request both report it false.
   */
  const state = figureState(series, series.data != null);

  // Revenue is money gained, spending is neutral-grey — red is reserved for
  // money actually LOST (a refund, a loss), not for ordinary cost.
  const stroke = metric === "revenue" ? "var(--pl-green-solid)" : "var(--pl-ink-3)";
  const gradientId = `catalog-trend-${metric}`;

  return (
    <Surface padding="md">
      <SectionHeading
        hint={`${range.label} · bucketed by ${bucket}`}
        action={
          <span className="text-[13px] font-semibold">
            <FigureSlot state={state} loading={null}>
              <span className="t-num text-[color:var(--pl-ink)]">{money(total)}</span>
            </FigureSlot>
          </span>
        }
      >
        {metric === "revenue" ? "Money in over time" : "Money out over time"}
      </SectionHeading>

      {state !== "settled" && state !== "loading" ? (
        <div className="flex h-48 items-center justify-center rounded-lg bg-[color:var(--pl-recessed)]">
          <p className="t-secondary max-w-xs px-4 text-center text-[color:var(--pl-amber)]">
            {FIGURE_STATE_COPY[state].why}
          </p>
        </div>
      ) : state === "loading" ? (
        <div className="flex h-48 items-center justify-center rounded-lg bg-[color:var(--pl-recessed)]">
          <p className="t-secondary">Working it out…</p>
        </div>
      ) : hasData ? (
        <div className="pl-chart h-48">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: -8 }}>
              <defs>
                <AreaGradient id={gradientId} color={stroke} strength={0.2} />
              </defs>
              <CartesianGrid {...GRID} />
              <XAxis dataKey="label" {...X_AXIS} />
              <YAxis {...Y_AXIS} tickFormatter={(value: number) => formatCompactNumber(Math.round(value * 100))} />
              <Tooltip
                cursor={CURSOR}
                content={
                  <ChartTooltip
                    format={money}
                    names={{ value: metric === "revenue" ? "Money in" : "Money out" }}
                  />
                }
              />
              <Area
                type="monotone"
                dataKey="value"
                stroke={stroke}
                {...LINE}
                fill={`url(#${gradientId})`}
                activeDot={activeDot(stroke)}
                {...SERIES_STATIC}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      ) : (
        /* An instruction, not an apology. */
        <div className="flex h-48 items-center justify-center rounded-lg bg-[color:var(--pl-recessed)]">
          <p className="t-secondary max-w-xs px-4 text-center">
            {metric === "revenue"
              ? "Record a sale and this will show how your income moves over time."
              : "Record what you spend and this will show how your costs move over time."}
          </p>
        </div>
      )}
    </Surface>
  );
}
