/**
 * Following the curve.
 *
 * When two series are drawn as monotone curves and the region between them is
 * shaded, the shading has to walk the SAME curve the lines do. Shade over the
 * raw data points instead and you get straight chords under curved lines: between
 * two points the curve bows away from its chord, so under every peak the fill
 * visibly parts company with the line it is supposed to touch. That was a real,
 * visible defect on the dashboard chart.
 *
 * `monotoneTangents` reproduces d3-shape's `curveMonotoneX` tangent choice
 * (Fritsch–Carlson, endpoints included) exactly, which is what recharts renders
 * for `type="monotone"`. `sampleCurves` evaluates the resulting cubics densely
 * enough that the polygon sits under the drawn line to sub-pixel accuracy.
 *
 * Both series share identical x control points — curveMonotoneX derives them
 * from x alone — so one parameter walks both curves in lockstep, and the
 * crossing test finds where the CURVES cross rather than where the chords do.
 *
 * Extracted from LiquidRevenueExpenseChart verbatim. It is correct, it was
 * hard-won, and until now it had no test of its own.
 */

export type BandPoint = { x: number; ry: number; ey: number };

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** d3's Fritsch–Carlson tangents. Monotone in, monotone out — never overshoots. */
export function monotoneTangents(xs: number[], ys: number[]): number[] {
  const n = xs.length;
  const sign = (v: number) => (v < 0 ? -1 : 1);
  const m = new Array<number>(n).fill(0);
  if (n < 3) {
    const s = n === 2 ? (ys[1] - ys[0]) / (xs[1] - xs[0] || 1) : 0;
    return m.fill(s);
  }
  const slope3 = (i: number) => {
    const h0 = xs[i] - xs[i - 1];
    const h1 = xs[i + 1] - xs[i];
    const s0 = (ys[i] - ys[i - 1]) / (h0 || (h1 < 0 ? -0 : 0));
    const s1 = (ys[i + 1] - ys[i]) / (h1 || (h0 < 0 ? -0 : 0));
    const p = (s0 * h1 + s1 * h0) / (h0 + h1);
    return (sign(s0) + sign(s1)) * Math.min(Math.abs(s0), Math.abs(s1), 0.5 * Math.abs(p)) || 0;
  };
  const slope2 = (i0: number, i1: number, t: number) => {
    const h = xs[i1] - xs[i0];
    return h ? ((3 * (ys[i1] - ys[i0])) / h - t) / 2 : t;
  };
  for (let i = 1; i < n - 1; i += 1) m[i] = slope3(i);
  m[0] = slope2(0, 1, m[1]);
  m[n - 1] = slope2(n - 2, n - 1, m[n - 2]);
  return m;
}

export const CURVE_SAMPLES = 24;

/** Dense samples along both curves, sharing one x parameter. */
export function sampleCurves(xs: number[], revenueYs: number[], expenseYs: number[]): BandPoint[] {
  const n = xs.length;
  if (n < 3) {
    // Two points draw as a straight line (d3 does the same), so the chord IS
    // the curve and the raw points are already exact.
    return xs.map((x, i) => ({ x, ry: revenueYs[i], ey: expenseYs[i] }));
  }
  const mr = monotoneTangents(xs, revenueYs);
  const me = monotoneTangents(xs, expenseYs);
  const cubic = (p0: number, c1: number, c2: number, p1: number, t: number) => {
    const u = 1 - t;
    return u * u * u * p0 + 3 * u * u * t * c1 + 3 * u * t * t * c2 + t * t * t * p1;
  };
  const out: BandPoint[] = [];
  for (let i = 0; i < n - 1; i += 1) {
    const dx = (xs[i + 1] - xs[i]) / 3;
    const last = i === n - 2 ? CURVE_SAMPLES : CURVE_SAMPLES - 1;
    for (let j = 0; j <= last; j += 1) {
      const t = j / CURVE_SAMPLES;
      out.push({
        x: cubic(xs[i], xs[i] + dx, xs[i + 1] - dx, xs[i + 1], t),
        ry: cubic(revenueYs[i], revenueYs[i] + dx * mr[i], revenueYs[i + 1] - dx * mr[i + 1], revenueYs[i + 1], t),
        ey: cubic(expenseYs[i], expenseYs[i] + dx * me[i], expenseYs[i + 1] - dx * me[i + 1], expenseYs[i + 1], t),
      });
    }
  }
  return out;
}

/** Where the two curves swap places, or null if they do not cross in this step. */
export function findCross(p1: BandPoint, p2: BandPoint): BandPoint | null {
  const d1 = p1.ry - p1.ey;
  const d2 = p2.ry - p2.ey;
  if ((d1 >= 0) === (d2 >= 0)) return null;
  const t = d1 / (d1 - d2);
  if (t <= 0 || t >= 1) return null;
  const cx = lerp(p1.x, p2.x, t);
  const cy = lerp(p1.ry, p2.ry, t);
  return { x: cx, ry: cy, ey: cy };
}

/** Closed polygon: along one curve, back along the other. */
export function ptsToPolygon(points: BandPoint[], revenueOnTop: boolean): string {
  if (points.length < 2) return "";
  const top = points.map((point) => `${point.x.toFixed(1)},${(revenueOnTop ? point.ry : point.ey).toFixed(1)}`);
  const bottom = [...points]
    .reverse()
    .map((point) => `${point.x.toFixed(1)},${(revenueOnTop ? point.ey : point.ry).toFixed(1)}`);
  return [...top, ...bottom].join(" ");
}
