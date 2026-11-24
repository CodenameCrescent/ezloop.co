import { cn } from "@/lib/utils";
import { slotFor, toneFill, type ChartTone } from "@/lib/chartTone";
import { useChartFrameGuard } from "./ChartFrame";

/**
 * Part-to-whole: one stacked bar, or a column of rows.
 *
 * Eight places in this app drew this by hand — customer concentration, spend by
 * platform, revenue leaders, work types, onboarding progress — each with its own
 * height, its own gap and its own idea of when a label fits. This is that shape,
 * once.
 *
 * Segments arrive in the order they should be read (largest first, normally).
 * Tone is assigned by POSITION unless a segment names its own, so the colour
 * follows the entity rather than its rank — filtering a list must not repaint
 * the survivors.
 */

export type ShareSegment = {
  id: string;
  label: string;
  /** Magnitude. Shares are computed against `total` (or the sum). */
  value: number;
  /** Overrides the positional slot — for a segment that MEANS something. */
  tone?: ChartTone;
  /** Sends the segment to the background: a tail, an "everyone else" pool. */
  muted?: boolean;
};

export function ShareBar({
  segments,
  layout = "stacked",
  total,
  format,
  size = "md",
  labelInside = true,
  className,
}: {
  segments: ShareSegment[];
  /** `stacked` = one bar. `rows` = one bar per segment, for long names. */
  layout?: "stacked" | "rows";
  /** The whole, when it is bigger than the segments shown (a top-5 of 40). */
  total?: number;
  format: (value: number) => string;
  size?: "sm" | "md";
  /** Only ever honoured where the text actually fits — never clipped. */
  labelInside?: boolean;
  className?: string;
}) {
  useChartFrameGuard("ShareBar");

  const sum = total ?? segments.reduce((acc, s) => acc + Math.abs(s.value), 0);
  if (segments.length === 0 || sum <= 0) return null;

  const share = (value: number) => (Math.abs(value) / sum) * 100;
  const fillFor = (segment: ShareSegment, index: number) =>
    toneFill(segment.tone ?? slotFor(index));

  if (layout === "rows") {
    return (
      <div className={cn("flex flex-col gap-3", className)}>
        {segments.map((segment, index) => (
          <div key={segment.id} className="flex flex-col gap-1.5">
            <div className="flex items-baseline justify-between gap-4">
              <span className="t-body min-w-0 truncate text-[color:var(--pl-ink)]">
                {segment.label}
              </span>
              <span className="t-num shrink-0 text-[color:var(--pl-ink-2)]">
                {format(segment.value)}
              </span>
            </div>
            <div
              className={cn(
                "w-full overflow-hidden rounded-full bg-[color:var(--pl-chart-track)]",
                size === "sm" ? "h-1.5" : "h-2",
              )}
            >
              {/* Width is the true share. An empty bar stays empty — flooring it
                  to a visible minimum is the chart telling a small lie. */}
              <div
                className="pl-bar-x h-full rounded-full"
                style={{
                  width: `${share(segment.value)}%`,
                  background: fillFor(segment, index),
                  opacity: segment.muted ? 0.45 : 1,
                }}
              />
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className={className}>
      {/* The 2px gap is the surface doing the separating. A stroke around each
          segment would add ink that is not data. */}
      <div
        className={cn(
          "flex w-full gap-0.5 overflow-hidden rounded-lg",
          size === "sm" ? "h-2.5" : "h-10",
        )}
      >
        {segments.map((segment, index) => {
          const pct = share(segment.value);
          return (
            <div
              key={segment.id}
              title={`${segment.label}: ${format(segment.value)} (${pct.toFixed(1)}%)`}
              className="flex min-w-0 items-center justify-center transition-[width,opacity] duration-[var(--pl-dur-slow)] ease-[var(--pl-ease-out)] first:rounded-l-lg last:rounded-r-lg"
              style={{
                width: `${pct}%`,
                background: fillFor(segment, index),
                opacity: segment.muted ? 0.45 : 1,
              }}
            >
              {/* 12% is where a two-character percentage stops fitting with
                  padding. Below it the label goes to the legend and the
                  tooltip rather than being clipped. */}
              {labelInside && size === "md" && pct >= 12 && (
                <span className="truncate px-2 text-xs font-medium text-[color:var(--pl-on-fill)]">
                  {pct.toFixed(0)}%
                </span>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5">
        {segments.map((segment, index) => (
          <span key={`key-${segment.id}`} className="flex items-center gap-1.5">
            <span
              aria-hidden
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ background: fillFor(segment, index), opacity: segment.muted ? 0.45 : 1 }}
            />
            <span className="t-secondary">
              {segment.label} · {format(segment.value)}
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}
