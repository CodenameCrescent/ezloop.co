/**
 * The shape of a trend line, worked out as plain numbers.
 *
 * Separated from the component for the reason every other piece of chart maths
 * in here is: an SVG path is invisible to a test that renders it, and the parts
 * worth getting wrong — where zero sits, what a flat series looks like, whether
 * the last point is actually the last point — are all arithmetic.
 *
 * It reuses `monotoneTangents`, the same curve recharts draws for
 * `type="monotone"`, so a sparkline and the big chart under it bend the same
 * way. A trend line that curves differently from the chart it summarises is a
 * small lie about the same data.
 */
import { monotoneTangents } from "./monotoneBand";

export type SparkGeometry = {
  /** `d` for the stroked line. */
  line: string;
  /** `d` for the closed fill beneath it, floored at zero when zero is in view. */
  area: string;
  /** The final point — where the end marker goes. */
  end: { x: number; y: number };
  /**
   * The y of the zero rule, when the series actually crosses zero.
   *
   * This is the second channel a money line carries (DESIGN.md §3a): above the
   * rule is money made, below it is money lost, and that survives having the
   * colour taken away. Null when the whole series sits on one side of zero —
   * there is no crossing to mark, and drawing a rule at the floor would imply
   * one.
   */
  zeroY: number | null;
};

export type SparkGeometryOptions = {
  width: number;
  height: number;
  /** Breathing room on all four sides, so a 2px stroke is not half-clipped. */
  inset?: number;
};

/** Null when there is no line to draw. One point is a dot, not a trend. */
export function sparkGeometry(
  values: number[],
  { width, height, inset = 2 }: SparkGeometryOptions,
): SparkGeometry | null {
  const n = values.length;
  if (n < 2 || width <= 0 || height <= 0) return null;
  if (values.some((v) => !Number.isFinite(v))) return null;

  const left = inset;
  const right = width - inset;
  const top = inset;
  const bottom = height - inset;
  if (right <= left || bottom <= top) return null;

  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min;

  const xs = values.map((_, i) => left + (i / (n - 1)) * (right - left));
  // A flat series draws flat, down the middle. Stretching it to fill the box
  // would turn rounding noise into a dramatic climb — the single most common
  // way a sparkline lies.
  const scaleY = (v: number) => (span === 0 ? (top + bottom) / 2 : bottom - ((v - min) / span) * (bottom - top));
  const ys = values.map(scaleY);

  const zeroY = min < 0 && max > 0 ? scaleY(0) : null;
  // The fill hangs from the line down to zero when zero is on screen, and to
  // the floor otherwise. Hanging to the floor across a crossing would shade a
  // losing stretch as though it were a gain.
  const baseY = zeroY ?? bottom;

  const m = monotoneTangents(xs, ys);
  const parts = [`M ${fmt(xs[0])} ${fmt(ys[0])}`];
  for (let i = 0; i < n - 1; i += 1) {
    const dx = (xs[i + 1] - xs[i]) / 3;
    parts.push(
      `C ${fmt(xs[i] + dx)} ${fmt(ys[i] + dx * m[i])}` +
        ` ${fmt(xs[i + 1] - dx)} ${fmt(ys[i + 1] - dx * m[i + 1])}` +
        ` ${fmt(xs[i + 1])} ${fmt(ys[i + 1])}`,
    );
  }

  const line = parts.join(" ");
  return {
    line,
    area: `${line} L ${fmt(xs[n - 1])} ${fmt(baseY)} L ${fmt(xs[0])} ${fmt(baseY)} Z`,
    end: { x: xs[n - 1], y: ys[n - 1] },
    zeroY,
  };
}

function fmt(v: number): string {
  return Number(v.toFixed(2)).toString();
}
