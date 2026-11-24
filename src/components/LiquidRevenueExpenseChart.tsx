import { useEffect, useId, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { FigureSlot } from "./FigureSlot";
import type { FigureState } from "@/lib/figureState";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Customized,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { LiquidGlassCard } from "@/components/LiquidGlassCard";
import { formatCompactNumber } from "@/lib/money";
import { CURSOR, GRID, LINE, SERIES_STATIC, X_AXIS, Y_AXIS, activeDot } from "@/components/charts/rechartsKit";
import { REVENUE_COLOR, EXPENSE_COLOR, type RevenueExpensePoint, ProfitLossDefsLayer } from "./LiquidRevenueExpenseChart.parts/ProfitLossDefsLayer";
export type { RevenueExpensePoint } from "./LiquidRevenueExpenseChart.parts/ProfitLossDefsLayer";

type Period = "Daily" | "Monthly" | "Yearly";

export type LiquidRevenueExpenseChartProps = {
  title?: string;
  dailyData?: RevenueExpensePoint[];
  monthlyData?: RevenueExpensePoint[];
  yearlyData?: RevenueExpensePoint[];
  periodValues?: Partial<Record<Period, number>>;
  initialPeriod?: Period;
  currencyPrefix?: string;
  className?: string;
  height?: number;
  /**
   * Why there is no chart, when there is no chart.
   *
   * Required, for the reason `ChartFrame.state` is: this card prints a figure
   * and an instruction, and both are claims about the business that an empty
   * series cannot support. A caller who forgets it fails typecheck rather than
   * quietly defaulting back to the bug.
   */
  state: FigureState;
  emptyMessage?: string;
};


const FALLBACK_DATA: RevenueExpensePoint[] = [
  { label: "Mon", revenue: 0, expense: 0 },
  { label: "Tue", revenue: 0, expense: 0 },
  { label: "Wed", revenue: 0, expense: 0 },
  { label: "Thu", revenue: 0, expense: 0 },
  { label: "Fri", revenue: 0, expense: 0 },
  { label: "Sat", revenue: 0, expense: 0 },
  { label: "Sun", revenue: 0, expense: 0 },
];

function formatValue(value: number, prefix = "Rs. ") {
  const abs = Math.abs(value);
  return `${prefix}${Math.round(abs).toLocaleString()}/-`;
}

function formatSignedValue(value: number, prefix = "Rs. ") {
  return `${value < 0 ? "-" : ""}${formatValue(value, prefix)}`;
}

/* The shared compact formatter, which takes the absolute value BEFORE testing
   the magnitude. The version that used to live here tested `value >= 1_000_000`
   directly, so no negative matched any branch and a −5M tick printed in full as
   "-5000000" — on exactly the axis a loss-making period draws. This chart takes
   major units, so it converts to the cents the formatter expects. */
function formatAxisValue(value: number) {
  return formatCompactNumber(Math.round(value * 100));
}

function totalProfit(data: RevenueExpensePoint[]) {
  return data.reduce((sum, point) => sum + point.revenue - point.expense, 0);
}

function useAnimatedNumber(target: number, duration = 650) {
  const [display, setDisplay] = useState(target);
  const startRef = useRef(target);
  const startTimeRef = useRef<number | null>(null);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    const from = startRef.current;
    startTimeRef.current = null;
    const animate = (timestamp: number) => {
      if (startTimeRef.current === null) startTimeRef.current = timestamp;
      const elapsed = timestamp - startTimeRef.current;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(Math.round(from + (target - from) * eased));
      if (progress < 1) {
        rafRef.current = requestAnimationFrame(animate);
      } else {
        startRef.current = target;
      }
    };
    rafRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(rafRef.current);
  }, [target, duration]);

  return display;
}

function CustomTooltip({ active, payload, label }: { active?: boolean; payload?: any[]; label?: string }) {
  if (!active || !payload?.length) return null;
  const revenue = payload.find((item) => item.name === "revenue")?.value ?? 0;
  const expense = payload.find((item) => item.name === "expense")?.value ?? 0;
  const diff = revenue - expense;
  const isProfit = diff >= 0;

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.93, y: 6 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ duration: 0.14, ease: "easeOut" }}
      className="pl-chart-tooltip min-w-[168px] rounded-xl bg-[color:var(--pl-surface)] px-3 py-2.5 text-xs"
    >
      <div className="text-lg font-semibold" style={{ color: isProfit ? REVENUE_COLOR : EXPENSE_COLOR }}>
        {isProfit ? "+" : "-"}{formatValue(Math.abs(diff))}
      </div>
      <div className="mt-0.5 flex items-center gap-1 text-xs text-[color:var(--pl-mid-grey)]">
        {label}
        <span className="ml-0.5 inline-block h-2 w-2 rounded-sm" style={{ background: isProfit ? REVENUE_COLOR : EXPENSE_COLOR }} />
      </div>
      <div className="mt-2 space-y-1 border-t border-[color:var(--pl-hairline)] pt-2">
        <div className="flex justify-between gap-4">
          <span className="flex items-center gap-2 text-[color:var(--pl-ink-2)]"><span aria-hidden className="h-2 w-2 rounded-full" style={{ background: REVENUE_COLOR }} />Revenue</span>
          <span className="t-num font-semibold text-[color:var(--pl-ink)]">{formatValue(revenue)}</span>
        </div>
        <div className="flex justify-between gap-4">
          <span className="flex items-center gap-2 text-[color:var(--pl-ink-2)]"><span aria-hidden className="h-2 w-2 rounded-full" style={{ background: EXPENSE_COLOR }} />Expense</span>
          <span className="t-num font-semibold text-[color:var(--pl-ink)]">{formatValue(expense)}</span>
        </div>
      </div>
    </motion.div>
  );
}

function getAxisTicks(data: RevenueExpensePoint[]) {
  const values = data.flatMap((point) => [point.revenue, point.expense]);
  const max = Math.max(1, ...values);
  const base = Math.pow(10, Math.floor(Math.log10(max)));
  const step = Math.max(1, base / 2);
  const ticks: number[] = [];
  for (let value = 0; value <= max * 1.1; value += step) ticks.push(Math.round(value));
  return ticks.slice(0, 8);
}

export function LiquidRevenueExpenseChart({
  title = "Total Revenue",
  dailyData,
  monthlyData,
  yearlyData,
  periodValues,
  initialPeriod = "Daily",
  currencyPrefix = "Rs. ",
  className,
  height = 280,
  state,
  emptyMessage = "Add revenue and expenses to unlock this graph.",
}: LiquidRevenueExpenseChartProps) {
  const graphId = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const [period, setPeriod] = useState<Period>(initialPeriod);
  const [previousPeriod, setPreviousPeriod] = useState<Period>(initialPeriod);
  const periods: Period[] = ["Daily", "Monthly", "Yearly"];
  const resolved = useMemo<Record<Period, RevenueExpensePoint[]>>(
    () => ({
      Daily: dailyData?.length ? dailyData : FALLBACK_DATA,
      Monthly: monthlyData?.length ? monthlyData : dailyData?.length ? dailyData : FALLBACK_DATA,
      Yearly: yearlyData?.length ? yearlyData : monthlyData?.length ? monthlyData : dailyData?.length ? dailyData : FALLBACK_DATA,
    }),
    [dailyData, monthlyData, yearlyData],
  );
  const data = resolved[period];
  const currentPeriodProfit = periodValues?.[period] ?? totalProfit(data);
  const animatedProfit = useAnimatedNumber(currentPeriodProfit, 650);
  const direction = periods.indexOf(period) > periods.indexOf(previousPeriod) ? 1 : -1;
  const hasData = data.some((point) => point.revenue > 0 || point.expense > 0);
  const ticks = getAxisTicks(data);

  const handlePeriod = (next: Period) => {
    if (next === period) return;
    setPreviousPeriod(period);
    setPeriod(next);
  };

  return (
    <LiquidGlassCard className={className}>
      <div className="p-5 lg:p-6">
        <div className="mb-1 flex items-start justify-between gap-3">
          <h2 className="t-section text-[color:var(--pl-ink)]">{title}</h2>
          <div className="flex items-center gap-0.5 rounded-full bg-[color:var(--pl-recessed)] p-1">
            {periods.map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => handlePeriod(item)}
                className={`relative rounded-full px-3 py-1 text-xs transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:color-mix(in_srgb,var(--pl-orange)_35%,transparent)] ${period === item ? "font-medium text-[color:var(--pl-ink)]" : "font-medium text-[color:var(--pl-ink-2)] hover:text-[color:var(--pl-ink)]"}`}
              >
                {period === item && (
                  <motion.span
                    layoutId={`period-pill-${graphId}`}
                    className="absolute inset-0 rounded-full bg-[color:var(--pl-surface)]"
                    transition={{ type: "spring", stiffness: 400, damping: 30 }}
                  />
                )}
                <span className="relative z-[1]">{item}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Deliberately NOT a hero number. The screen already has one, and a
            second figure at 26px would mean neither is the important one
            (DESIGN.md). This is a caption for the bucket in view. */}
        <motion.p
          key={period}
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.28, ease: "easeOut" }}
          className="t-num mb-3 text-sm"
        >
          <span className="text-[color:var(--pl-ink-2)]">Latest {period.toLowerCase()} profit </span>
          {/* `currentPeriodProfit` falls back to `totalProfit(data)`, which is
              0 for an empty series — so this line printed a confident
              "Rs. 0/-" in money green whenever the data had not arrived. It is
              the one figure on the card, and green is the colour that means
              money was gained. */}
          <FigureSlot state={state}>
            <span
              className="font-semibold"
              style={{ color: animatedProfit >= 0 ? "var(--pl-green)" : "var(--pl-red)" }}
            >
              {formatSignedValue(animatedProfit, currencyPrefix)}
            </span>
          </FigureSlot>
        </motion.p>

        <div className="mb-3 flex flex-wrap gap-4">
          {[ 
            { color: REVENUE_COLOR, label: "Revenue", fill: false },
            { color: EXPENSE_COLOR, label: "Expenses", fill: false },
            { color: REVENUE_COLOR, label: "Profit", fill: true },
            { color: EXPENSE_COLOR, label: "Loss", fill: true },
          ].map(({ color, label, fill }) => (
            <div key={label} className="flex items-center gap-1.5">
              {fill ? (
                <div className="h-2 w-3 rounded-sm border" style={{ background: `color-mix(in srgb, ${color} 22%, transparent)`, borderColor: color }} />
              ) : (
                <div className="h-0.5 w-4 rounded-full" style={{ background: color }} />
              )}
              <span className="text-xs font-semibold text-[color:var(--pl-ink-2)]">{label}</span>
            </div>
          ))}
        </div>

        {hasData ? (
          <div className="pl-chart relative">
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={period}
                initial={{ opacity: 0, x: direction * 24 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -direction * 24 }}
                transition={{ duration: 0.28, ease: [0.4, 0, 0.2, 1] }}
              >
                <ResponsiveContainer width="100%" height={height}>
                  <ComposedChart data={data} margin={{ top: 8, right: 28, bottom: 0, left: 0 }}>
                    <Customized component={(props: any) => <ProfitLossDefsLayer {...props} chartData={data} graphId={graphId} />} />
                    {/* Tokens, not literal black: a 6%-black grid is invisible
                        on a near-black card, so dark mode lost its gridlines
                        entirely. --chart-grid is the hairline in light and a
                        faint white in dark. The 12px tick is the smallest step
                        on the scale — 11px was small print. */}
                    <CartesianGrid {...GRID} />
                    <XAxis dataKey="label" {...X_AXIS} />
                    <YAxis {...Y_AXIS} tickFormatter={formatAxisValue} ticks={ticks} width={44} />
                    <Tooltip content={<CustomTooltip />} cursor={CURSOR} />
                    <Area type="monotone" dataKey="revenue" name="revenue" fill={`url(#profitGrad-${graphId})`} stroke="none" strokeWidth={0} {...SERIES_STATIC} legendType="none" clipPath={`url(#profitClip-${graphId})`} activeDot={false} />
                    <Area type="monotone" dataKey="expense" name="expense" fill={`url(#lossGrad-${graphId})`} stroke="none" strokeWidth={0} {...SERIES_STATIC} legendType="none" clipPath={`url(#lossClip-${graphId})`} activeDot={false} />
                    <Line type="monotone" dataKey="revenue" name="revenue" stroke={REVENUE_COLOR} {...LINE} {...SERIES_STATIC} activeDot={activeDot(REVENUE_COLOR)} />
                    <Line type="monotone" dataKey="expense" name="expense" stroke={EXPENSE_COLOR} {...LINE} {...SERIES_STATIC} activeDot={activeDot(EXPENSE_COLOR)} />
                  </ComposedChart>
                </ResponsiveContainer>
              </motion.div>
            </AnimatePresence>
          </div>
        ) : (
          <div className="flex items-center justify-center rounded-lg bg-[color:var(--pl-recessed)]" style={{ height }}>
            <p className="px-4 text-center text-sm text-[color:var(--pl-ink-2)]">{emptyMessage}</p>
          </div>
        )}
      </div>
    </LiquidGlassCard>
  );
}

export default LiquidRevenueExpenseChart;
