import { addCents, assertCents, type Cents } from "./money";

/**
 * A business compared against its OWN normal.
 *
 * Nearly every rule in the first catalogue wanted a threshold, and every fixed
 * threshold is wrong for half the businesses that meet it. A 4% refund rate is
 * a crisis for a consultancy and an ordinary Tuesday for a clothing shop. "Your
 * refund rate is 4%" is a number; "your refund rate is 4% and it is normally
 * 1.2%" is the insight.
 *
 * Two deliberate choices:
 *
 * **Median and MAD, not mean and standard deviation.** One catastrophic month
 * drags a mean far enough that the month after it looks fine, which is exactly
 * backwards. The median ignores the outlier, so the outlier stays visible.
 *
 * **A short history has NO normal, and says so.** With three months of data
 * there is no such thing as typical, and inventing one produces confident
 * warnings about nothing. `reason` carries why, and callers must handle it
 * rather than reading a zero — the same rule break-even follows.
 *
 * Everything here is integers: money in minor units, rates in basis points.
 * That keeps it inside the no-floats invariant and means a "normal" can be
 * compared to a current value with plain integer arithmetic.
 */

/** Below this there is no normal, only a short history. */
export const MIN_BASELINE_SAMPLES = 4;

/**
 * How far past normal counts as unusual, as a multiple of the deviation.
 *
 * 3 is deliberately conservative. This engine's failure mode is crying wolf: an
 * owner who is warned about noise once stops reading the warnings, and then the
 * real one arrives to an audience of nobody.
 */
export const DEFAULT_TOLERANCE = 3;

/**
 * The floor under the deviation band, in the unit being measured.
 *
 * Without it, a perfectly steady history gives a deviation of zero and then
 * EVERY movement is infinitely unusual — the steadier the business, the noisier
 * the app. Callers pass the smallest move they would want to hear about.
 */
export interface BaselineOptions {
  minSamples?: number;
  tolerance?: number;
  /** Smallest deviation worth reacting to, in the same unit as the samples. */
  floor?: number;
}

export type BaselineReason = "ok" | "too_few_periods" | "no_history";

export interface Baseline {
  /** The typical value: the median of the history. Null unless reason is "ok". */
  normal: number | null;
  /** Median absolute deviation, floored by `floor`. Null unless reason is "ok". */
  deviation: number | null;
  /** How many past periods this was built from. */
  sampleSize: number;
  reason: BaselineReason;
}

export interface Comparison {
  /** The value being judged. */
  value: number;
  baseline: Baseline;
  /** Is it further from normal than the tolerance allows? False when there is no normal. */
  isUnusual: boolean;
  /** "above" | "below" the normal, or null when there is no normal or no gap. */
  direction: "above" | "below" | null;
  /**
   * How far past the normal it is, in the sample unit. Null when there is no
   * normal. This is the number a rule turns into money — the EXCESS, not the
   * whole value, because normal refunds are not a leak.
   */
  excess: number | null;
}

/** Exact integer median. Even counts round half-up, so the result stays an integer. */
function medianOf(sorted: number[]): number {
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid];
  // Half-up on the midpoint, matching how the rest of the domain rounds.
  return Math.floor((sorted[mid - 1] + sorted[mid]) / 2 + 0.5);
}

/**
 * Build a normal from a history of past periods.
 *
 * `history` is PAST periods only — never include the period being judged, or
 * the value being tested helps decide what counts as typical and every reading
 * drifts toward "fine".
 */
export function computeBaseline(history: number[], options: BaselineOptions = {}): Baseline {
  const minSamples = options.minSamples ?? MIN_BASELINE_SAMPLES;
  const floor = options.floor ?? 0;

  if (history.length === 0) {
    return { normal: null, deviation: null, sampleSize: 0, reason: "no_history" };
  }
  if (history.length < minSamples) {
    return { normal: null, deviation: null, sampleSize: history.length, reason: "too_few_periods" };
  }

  const sorted = [...history].sort((a, b) => a - b);
  const normal = medianOf(sorted);

  // MAD: the median of how far each period sits from the median.
  const deviations = sorted.map((v) => Math.abs(v - normal)).sort((a, b) => a - b);
  const mad = medianOf(deviations);

  return {
    normal,
    deviation: Math.max(mad, floor),
    sampleSize: history.length,
    reason: "ok",
  };
}

/**
 * Judge a value against a normal.
 *
 * When there is no normal the answer is "not unusual" with a null excess — NOT
 * a guess. A rule reading this must fall back to a fixed threshold or stay
 * silent; it must never treat a missing normal as a normal of zero.
 */
export function compareToBaseline(
  value: number,
  baseline: Baseline,
  options: BaselineOptions = {},
): Comparison {
  const tolerance = options.tolerance ?? DEFAULT_TOLERANCE;

  if (baseline.reason !== "ok" || baseline.normal === null || baseline.deviation === null) {
    return { value, baseline, isUnusual: false, direction: null, excess: null };
  }

  const gap = value - baseline.normal;
  const allowed = baseline.deviation * tolerance;

  return {
    value,
    baseline,
    isUnusual: Math.abs(gap) > allowed,
    direction: gap === 0 ? null : gap > 0 ? "above" : "below",
    excess: gap,
  };
}

/**
 * The same comparison for money, with the cents guard applied.
 *
 * Separate from the general form so a caller cannot quietly hand fractional
 * cents to something that will later be rendered as money.
 */
export function compareCentsToBaseline(
  valueCents: Cents,
  history: Cents[],
  options: BaselineOptions = {},
): Comparison {
  assertCents(valueCents, "compareCentsToBaseline");
  for (const h of history) assertCents(h, "compareCentsToBaseline history");
  return compareToBaseline(valueCents, computeBaseline(history, options), options);
}

/**
 * How much of `value` sits ABOVE normal, as money. Zero when it is at or below
 * normal, or when there is no normal to speak of.
 *
 * This is what a leak rule reports: an owner whose refunds are normal is not
 * leaking money to refunds, they are running a shop. Only the excess is
 * recoverable, so only the excess belongs on a card.
 */
export function excessAboveNormalCents(comparison: Comparison): Cents {
  if (comparison.excess === null || comparison.excess <= 0) return 0;
  return addCents(comparison.excess);
}

/**
 * Plain-English half-sentence naming the normal, for a card's cause line.
 * Null when there is no normal — the caller then writes a sentence that does
 * not claim one, rather than pasting an empty clause.
 */
export function normalPhrase(baseline: Baseline, format: (value: number) => string): string | null {
  if (baseline.reason !== "ok" || baseline.normal === null) return null;
  // A normal of zero is real — a business that genuinely never refunded before
  // now has. But "normally Rs 0.00" reads like a broken template, so it gets
  // words instead of a figure.
  if (baseline.normal === 0) return "and you normally have none";
  return `normally ${format(baseline.normal)}`;
}
