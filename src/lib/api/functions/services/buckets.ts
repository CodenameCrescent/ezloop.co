/**
 * Time buckets — the one place a date becomes a bar on a chart.
 *
 * Two charts now partition a period this way: the P&L series (`analytics.ts`)
 * and the graph above the ledger (`read.ts`). They must agree about where a
 * week starts and what a bucket is called, or the same sale appears under two
 * different labels on two screens. `read.ts` cannot import `analytics.ts` —
 * analytics imports read — so the shared rule lives here, below both.
 *
 * Boundaries use SERVER-LOCAL time, matching how the frontend builds its period
 * ranges (local midnight → ISO). In the local-first deployment the server and
 * owner share a timezone; revisit when hosting moves off-box.
 */

export type SeriesBucket = "day" | "week" | "month" | "year";

/** Guard against pathological ranges (e.g. day-bucketing a decade). */
export const MAX_BUCKETS = 400;

export function bucketStartOf(date: Date, bucket: SeriesBucket): Date {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  if (bucket === "week") {
    const dow = (d.getDay() + 6) % 7; // Monday-start weeks
    d.setDate(d.getDate() - dow);
    return d;
  }
  if (bucket === "month") return new Date(d.getFullYear(), d.getMonth(), 1);
  if (bucket === "year") return new Date(d.getFullYear(), 0, 1);
  return d;
}

export function nextBucketStart(start: Date, bucket: SeriesBucket): Date {
  const d = new Date(start);
  if (bucket === "day") d.setDate(d.getDate() + 1);
  else if (bucket === "week") d.setDate(d.getDate() + 7);
  else if (bucket === "month") d.setMonth(d.getMonth() + 1);
  else d.setFullYear(d.getFullYear() + 1);
  return d;
}

export function bucketLabel(start: Date, bucket: SeriesBucket): string {
  if (bucket === "day" || bucket === "week") {
    return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(start);
  }
  if (bucket === "month") {
    return new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric" }).format(start);
  }
  return String(start.getFullYear());
}

/**
 * How wide a bar should be for a window of this length.
 *
 * Aimed at roughly 12–31 bars, which is what a small graph can carry without
 * either becoming a smear or collapsing into three columns: a month draws
 * days, a quarter draws weeks, a year draws months.
 */
export function chooseBucket(start: Date, end: Date): SeriesBucket {
  const spanDays = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86_400_000));
  if (spanDays <= 31) return "day";
  if (spanDays <= 92) return "week";
  if (spanDays <= 366) return "month";
  return "year";
}

/**
 * Every bucket start in the range, including the ones with nothing in them —
 * a quiet day is a fact about the period, not a row to omit.
 */
export function bucketBoundaries(start: Date, end: Date, bucket: SeriesBucket): Date[] {
  const boundaries: Date[] = [];
  let cursor = bucketStartOf(start, bucket);
  while (cursor <= end && boundaries.length < MAX_BUCKETS) {
    boundaries.push(cursor);
    cursor = nextBucketStart(cursor, bucket);
  }
  if (boundaries.length === 0) boundaries.push(bucketStartOf(start, bucket));
  return boundaries;
}
