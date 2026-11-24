import { useId } from "react";
import { cn } from "@/lib/utils";
import { toneFill, type ChartTone } from "@/lib/chartTone";
import { sparkGeometry } from "./sparkGeometry";
import { useChartFrameGuard } from "./ChartFrame";

/**
 * One series, no axes, no labels — the shape of a figure's recent history,
 * beside the figure.
 *
 * It answers a question the number alone cannot: "is this where it has been?"
 * A profit of Rs 13,005 means one thing at the top of a climb and another at
 * the bottom of a slide, and the delta pill beside it only compares two points.
 *
 * ── What it deliberately does not do ───────────────────────────────────────
 *
 * No tick, no tooltip, no value labels. A sparkline is a SHAPE; the moment it
 * grows a readable value it is competing with the figure it sits next to, and
 * the figure is the one that is exact. Anything that needs reading goes in the
 * ChartFrame'd chart further down the page.
 *
 * It takes `number[]`, not an endpoint response — the rule every primitive in
 * this folder follows, and the reason there are seven of these instead of
 * nine hand-rolled ones (DESIGN.md §8).
 *
 * ── Colour, and the second channel ─────────────────────────────────────────
 *
 * A money mark is never colour alone. This one carries its second channel two
 * ways: when the series crosses zero it draws the zero rule, so the losing
 * stretch is literally below the line (position — the strongest channel, per
 * DESIGN.md §3a), and where it does not cross, the caller is a stat tile whose
 * delta pill beside it already carries the arrow. Pass the tone from the same
 * `moneyMark()` call that produced that arrow, never a tone picked separately,
 * or the two can disagree about what good news looks like.
 */

export type SparklineProps = {
  /** Plain values, oldest first. Fewer than two renders nothing. */
  values: number[];
  /**
   * `inverse` is the one exception to the palette: a mark drawn ON the brand
   * hero, where neither money green nor ink is legible and the surface itself
   * is the only colour. It is a surface, not a meaning.
   */
  tone?: ChartTone | "inverse";
  /** The internal coordinate box. The svg stretches to its container. */
  viewWidth?: number;
  viewHeight?: number;
  /** A dot on the most recent point — "you are here". */
  showEnd?: boolean;
  /** Shade beneath the line. Off for the dense tiles, on for the hero. */
  fill?: boolean;
  /** Stroke weight in screen pixels — unaffected by how far the box is stretched. */
  strokeWidth?: number;
  /**
   * This line is an INDICATOR inside something else — a stat tile, the hero —
   * whose container already owns loading and emptiness. Same narrow, named
   * exemption `Meter` carries, and for the same reason.
   */
  inline?: boolean;
  /** What the shape says, for a reader who cannot see it. */
  label?: string;
  className?: string;
};

export function Sparkline({
  values,
  tone = "neutral",
  viewWidth = 100,
  viewHeight = 32,
  showEnd = false,
  fill = false,
  strokeWidth = 2,
  inline = false,
  label,
  className,
}: SparklineProps) {
  useChartFrameGuard("Sparkline", inline);
  const gradientId = useId();

  const geometry = sparkGeometry(values, { width: viewWidth, height: viewHeight, inset: 3 });
  // Nothing to draw is drawn as nothing. A placeholder line here would be an
  // invented shape sitting beside a real figure, which is the one thing a
  // chart in this app may never be.
  if (!geometry) return null;

  const stroke = tone === "inverse" ? "var(--pl-on-hero)" : toneFill(tone);

  return (
    <svg
      viewBox={`0 0 ${viewWidth} ${viewHeight}`}
      preserveAspectRatio="none"
      className={cn("block h-full w-full overflow-visible", className)}
      role="img"
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
    >
      {fill && (
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={stroke} stopOpacity={tone === "inverse" ? 0.28 : 0.18} />
            <stop offset="100%" stopColor={stroke} stopOpacity={0} />
          </linearGradient>
        </defs>
      )}

      {fill && <path d={geometry.area} fill={`url(#${gradientId})`} stroke="none" />}

      {/* Drawn UNDER the line, so the data is never interrupted by its own
          reference. Solid, never dashed (DESIGN.md §8). */}
      {geometry.zeroY !== null && (
        <line
          x1={0}
          x2={viewWidth}
          y1={geometry.zeroY}
          y2={geometry.zeroY}
          stroke={tone === "inverse" ? "var(--pl-on-hero)" : "var(--pl-chart-baseline)"}
          strokeOpacity={tone === "inverse" ? 0.45 : 0.35}
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
        />
      )}

      <path
        d={geometry.line}
        fill="none"
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        /* The box is stretched to whatever width the card gives it, so without
           this the stroke stretches with it and a wide tile gets a fat line
           while a narrow one gets a hairline. */
        vectorEffect="non-scaling-stroke"
      />

      {showEnd && (
        /* A round cap on a hairline-length segment, NOT a <circle>: the box is
           stretched horizontally to fit its card, and a circle stretches with
           it into an ellipse. A cap is part of the stroke, so non-scaling-stroke
           keeps it round at every width. 8px across, the marker floor in
           DESIGN.md §8. */
        <line
          x1={geometry.end.x}
          y1={geometry.end.y}
          x2={geometry.end.x + 0.01}
          y2={geometry.end.y}
          stroke={stroke}
          strokeWidth={8}
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      )}
    </svg>
  );
}
