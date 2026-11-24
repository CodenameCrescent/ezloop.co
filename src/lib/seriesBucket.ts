/**
 * How finely to slice the selected period for the trend lines on the dashboard.
 *
 * The lines beside the headline figures are drawn from `/reports/pnl-series`,
 * whose buckets sum exactly to the whole-period ladder — so the line and the
 * number beside it can never come from two different calculations. What this
 * picks is only the GRANULARITY, and the constraint is readability: a daily
 * slice of five years is 1,800 points in an 80-pixel box, which is noise, and a
 * yearly slice of one month is a single point, which is nothing.
 *
 * The thresholds are deliberately generous at the short end. A quarter drawn
 * daily is ~90 points and still reads, and dropping to weeks there would hide
 * the day-to-day movement that is the whole reason an owner picks a short
 * window.
 */

export type SeriesBucket = "day" | "week" | "month" | "year";

/** Fewer than this and there is no line to draw — two points make the shortest trend. */
export const MIN_TREND_POINTS = 2;

export function bucketForDays(days: number): SeriesBucket {
  if (days <= 92) return "day";
  if (days <= 400) return "week";
  if (days <= 1100) return "month";
  return "year";
}
