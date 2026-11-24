import { cn } from "@/lib/utils";
import { toneFill, type ChartTone } from "@/lib/chartTone";
import { useChartFrameGuard } from "./ChartFrame";

/**
 * One value against a limit — a budget used, a score, a coverage percentage.
 *
 * Two shapes, one behaviour: a bar for a row, an arc for a badge.
 *
 * `tone="threshold"` is the important one. It applies the business-health ramp —
 * green above 65, grey between, red below 45 — and it exists so the two health
 * gauges in this app cannot disagree again. One of them drew its arc in the
 * brand orange unconditionally, which breaks the rule that orange is the mark
 * and never encodes data. Lifting the ramp in here makes that unrepresentable
 * rather than merely discouraged: there is no prop that produces an orange arc.
 */

export const HEALTH_THRESHOLDS = { good: 65, warn: 45 } as const;

function thresholdTone(pct: number): ChartTone {
  if (pct >= HEALTH_THRESHOLDS.good) return "gain";
  if (pct >= HEALTH_THRESHOLDS.warn) return "neutral";
  return "loss";
}

export function Meter({
  value,
  max = 100,
  target,
  tone = "neutral",
  thresholds,
  variant = "bar",
  size = 32,
  label,
  inline = false,
  className,
}: {
  value: number;
  max?: number;
  /** Draws a threshold tick on the track — the line this value has to clear. */
  target?: number;
  /** `threshold` picks gain/neutral/loss from the ramp. */
  tone?: ChartTone | "threshold";
  /** Overrides the health ramp when `tone="threshold"`. */
  thresholds?: { good: number; warn: number };
  variant?: "bar" | "arc";
  /** Arc only — the svg square. */
  size?: number;
  label?: React.ReactNode;
  /**
   * This meter is an INDICATOR inside something else — a table row, a nav
   * badge — not a chart in its own right. Its container already handles
   * loading and emptiness, so the frame requirement does not apply and the
   * development warning is suppressed.
   *
   * It is a narrow, named exemption rather than a general `skipGuard`, because
   * the moment the escape hatch is easier to reach for than the frame, the
   * frame stops being a rule.
   */
  inline?: boolean;
  className?: string;
}) {
  useChartFrameGuard("Meter", inline);

  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  const resolved: ChartTone =
    tone === "threshold"
      ? thresholds
        ? pct >= thresholds.good
          ? "gain"
          : pct >= thresholds.warn
            ? "neutral"
            : "loss"
        : thresholdTone(pct)
      : tone;
  const fill = toneFill(resolved);

  if (variant === "arc") {
    const stroke = 4;
    const radius = size / 2 - stroke / 2 - 1;
    const circumference = 2 * Math.PI * radius;
    const dash = (pct / 100) * circumference;
    const centre = size / 2;

    return (
      <div className={cn("relative shrink-0", className)}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={typeof label === "string" ? label : undefined}>
          <circle cx={centre} cy={centre} r={radius} stroke="var(--pl-chart-track)" strokeWidth={stroke} fill="none" />
          <circle
            cx={centre}
            cy={centre}
            r={radius}
            stroke={fill}
            strokeWidth={stroke}
            fill="none"
            strokeLinecap="round"
            strokeDasharray={`${dash} ${circumference}`}
            transform={`rotate(-90 ${centre} ${centre})`}
            style={{ transition: "stroke-dasharray var(--pl-dur-slow) var(--pl-ease-out)" }}
          />
        </svg>
        {label && (
          <span className="absolute inset-0 flex items-center justify-center">{label}</span>
        )}
      </div>
    );
  }

  const targetPct = target != null && max > 0 ? Math.max(0, Math.min(100, (target / max) * 100)) : null;

  return (
    <div className={cn("relative h-2 w-full rounded-full bg-[color:var(--pl-chart-track)]", className)}>
      <div className="h-full overflow-hidden rounded-full">
        <div
          className="pl-bar-x h-full rounded-full"
          style={{ width: `${pct}%`, background: fill }}
        />
      </div>
      {targetPct !== null && (
        /*
         * The line the value has to clear. A bare percentage cannot say
         * "you need 3.4× and you are getting 2.1×" — the target has to be ON
         * the same axis, or the reader is comparing two numbers in their head
         * again. Drawn taller than the track so it reads as a threshold rather
         * than as part of the fill.
         */
        <span
          aria-hidden
          className="absolute -top-1 h-4 w-0.5 -translate-x-1/2 rounded-full"
          style={{ left: `${targetPct}%`, background: "var(--pl-chart-baseline)" }}
          title={`Target: ${target}`}
        />
      )}
    </div>
  );
}
