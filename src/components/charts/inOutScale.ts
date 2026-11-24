/**
 * Bar heights for the in/out columns.
 *
 * Both directions are measured against ONE tallest bar. Giving each side its
 * own scale would draw the biggest cost exactly as tall as the biggest sale,
 * which is the one thing this chart exists to tell apart.
 *
 * Fractions rather than pixels, so the caller owns the geometry and this stays
 * a pure rule that can be checked without rendering anything.
 */

export type InOutBucket = { inCents: number; outCents: number };

export function inOutFractions(buckets: InOutBucket[]): {
  max: number;
  rows: Array<{ inFraction: number; outFraction: number }>;
} {
  const max = buckets.reduce((m, b) => Math.max(m, b.inCents, b.outCents), 0);
  // A period where nothing happened has no tallest bar; every fraction is zero
  // and the baseline is drawn on its own.
  const fraction = (cents: number) => (max === 0 ? 0 : cents / max);
  return {
    max,
    rows: buckets.map((b) => ({ inFraction: fraction(b.inCents), outFraction: fraction(b.outCents) })),
  };
}
