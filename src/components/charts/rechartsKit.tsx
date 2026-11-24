/**
 * The one look every recharts chart in the app wears.
 *
 * Before this file each chart spelled out its own axis ticks, grid, cursor and
 * tooltip, and they had drifted: two tooltips were glass, one was a flat card,
 * one cursor was dashed (a dash reads as "threshold"), tick sizes were 11 and 12.
 * Now a chart spreads these props and gets the same furniture as its neighbours.
 *
 * ── Motion ────────────────────────────────────────────────────────────────
 *
 * Recharts' own `isAnimationActive` sweep is driven by requestAnimationFrame and
 * stops wherever the frames stopped (DESIGN.md §8), so every series here sets
 * `isAnimationActive={false}` via `SERIES_STATIC`, and there is no CSS entrance
 * either (see `.pl-chart` in index.css): a draw-in starts from half a line and
 * only reaches the true one if frames keep coming. The chart simply appears,
 * whole, and only the hover furniture moves.
 */
import type { ReactNode } from "react";

/** Axis text is a text token, never a series colour. 12px is the floor. */
export const AXIS_TICK = { fill: "var(--pl-ink-2)", fontSize: 12 } as const;

export const X_AXIS = {
  axisLine: false,
  tickLine: false,
  tick: AXIS_TICK,
  dy: 8,
  minTickGap: 12,
} as const;

export const Y_AXIS = {
  axisLine: false,
  tickLine: false,
  tick: AXIS_TICK,
  width: 56,
  tickCount: 4,
} as const;

/** Hairline, solid, horizontal only — recessive furniture. */
export const GRID = { vertical: false, stroke: "var(--chart-grid)" } as const;

/** The hover rule. Solid, and a step quieter than the data. */
export const CURSOR = { stroke: "var(--pl-ink-3)", strokeOpacity: 0.45, strokeWidth: 1 } as const;

/** Bars get a soft column wash instead of a rule. */
export const BAR_CURSOR = { fill: "var(--pl-recessed)", opacity: 0.7 } as const;

/** Series never run recharts' rAF sweep — see the header. */
export const SERIES_STATIC = { isAnimationActive: false } as const;

/** 2px line, round join and cap. */
export const LINE = { strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", dot: false } as const;

/** The marker that rides the cursor: r≥4 with a 2px surface ring. */
export function activeDot(color: string) {
  return { r: 4.5, fill: color, stroke: "var(--pl-surface)", strokeWidth: 2 };
}

/**
 * A vertical wash under a line: the series hue fading to nothing. Put it inside
 * a `<defs>` and reference it as `url(#id)`.
 */
export function AreaGradient({ id, color, strength = 0.16 }: { id: string; color: string; strength?: number }) {
  return (
    <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stopColor={color} stopOpacity={strength} />
      <stop offset="70%" stopColor={color} stopOpacity={strength * 0.25} />
      <stop offset="100%" stopColor={color} stopOpacity={0} />
    </linearGradient>
  );
}

type TooltipItem = {
  name?: string | number;
  value?: number | string;
  color?: string;
  stroke?: string;
  fill?: string;
  dataKey?: string | number;
};

/**
 * The hover card. Label on top, then one row per series: a short key in the
 * series colour beside a name and a value in text ink — the text itself never
 * wears the data colour.
 */
export function ChartTooltip({
  active,
  payload,
  label,
  format,
  names,
  footer,
}: {
  active?: boolean;
  payload?: TooltipItem[];
  label?: string | number;
  format: (value: number) => string;
  /** dataKey → human name. Falls back to the series' own name. */
  names?: Record<string, string>;
  /** An extra line under the rows, e.g. the difference between two series. */
  footer?: (payload: TooltipItem[]) => ReactNode;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="pl-chart-tooltip min-w-[168px] rounded-xl bg-[color:var(--pl-surface)] px-3 py-2.5 text-xs">
      {label !== undefined && label !== "" && (
        <div className="mb-1.5 font-medium text-[color:var(--pl-ink-2)]">{label}</div>
      )}
      <div className="space-y-1">
        {payload.map((item) => {
          const key = String(item.dataKey ?? item.name ?? "");
          const colour = item.stroke && item.stroke !== "none" ? item.stroke : item.color ?? item.fill;
          return (
            <div key={key} className="flex items-center justify-between gap-4">
              <span className="flex items-center gap-2 text-[color:var(--pl-ink-2)]">
                <span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ background: colour }} />
                {names?.[key] ?? item.name}
              </span>
              <span className="t-num font-semibold text-[color:var(--pl-ink)]">
                {format(Number(item.value ?? 0))}
              </span>
            </div>
          );
        })}
      </div>
      {footer && <div className="mt-2 border-t border-[color:var(--pl-hairline)] pt-2">{footer(payload)}</div>}
    </div>
  );
}
