import { REAL_STATUSES, isUnpaid, type DatedTransaction } from "./basis";

/**
 * Money owed — in both directions.
 *
 * THE ONE PLACE this is decided, the way the profit ladder lives in profit.ts
 * and break-even in breakeven.ts. The aging buckets used to be computed inline
 * inside the leaks report, which meant the Dashboard's "still owed" tile and any
 * future owed screen would each have had their own idea of what "31+ days"
 * meant.
 *
 * ── The distinction this module exists to protect ───────────────────────────
 *
 * OWED and OVERDUE are not the same thing, and conflating them is the obvious
 * mistake here. Age an invoice from the day it was raised, call anything older
 * than thirty days late, and the screen invents an agreement nobody made — every
 * unpaid sale turns red the moment it is entered, and the owner learns to ignore
 * the colour.
 *
 * So: without a due date, a transaction is `no_due_date`. It is still owed, it
 * still ages, and it still appears on the list — it simply cannot be late,
 * because nothing was agreed for it to be late against. Lateness requires a
 * date somebody chose.
 *
 * ── Calendar days, not elapsed hours ────────────────────────────────────────
 *
 * Everything below compares whole UTC days. A bill due yesterday is one day
 * late at 00:05 and at 23:55 alike; subtracting timestamps would call it zero
 * days late for most of the day it became late.
 */

/** Where an owed transaction stands against its due date. */
export type OwedState =
  /** Due later. */
  | "not_due"
  /** Due within the next week. */
  | "due_soon"
  /** The due date has passed. */
  | "overdue"
  /** No date was agreed, so it cannot be late — only outstanding. */
  | "no_due_date";

/** Plain English, so no two screens describe the same state differently. */
export const OWED_STATE_LABELS: Record<OwedState, string> = {
  not_due: "Not due yet",
  due_soon: "Due soon",
  overdue: "Overdue",
  no_due_date: "No due date",
};

/** How near counts as "due soon". A week: long enough to act, short enough to mean it. */
export const DUE_SOON_WITHIN_DAYS = 7;

/** The two dates every money event carries, plus the date somebody agreed. */
export interface OwedInput extends DatedTransaction {
  /** Null when no date was agreed — which is not the same as "due now". */
  dueDate: Date | null;
}

const MS_PER_DAY = 86_400_000;

/** Midnight UTC on the day this instant falls in. */
function startOfUtcDay(date: Date): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

/** Whole calendar days from `from` to `to`; negative when `to` is earlier. */
function daysBetween(from: Date, to: Date): number {
  return Math.round((startOfUtcDay(to) - startOfUtcDay(from)) / MS_PER_DAY);
}

/**
 * How late, in whole days. Zero on the due date itself — the day is not over —
 * and zero for anything with no agreed date.
 */
export function daysOverdue(txn: OwedInput, now: Date): number {
  if (!txn.dueDate) return 0;
  return Math.max(0, daysBetween(txn.dueDate, now));
}

/**
 * How long it has been owed, counted from when it HAPPENED. A different
 * question from lateness: a bill on ninety-day terms can be sixty days
 * outstanding and perfectly on time.
 *
 * Never negative. A transaction dated in the future has not started waiting.
 */
export function daysOutstanding(txn: OwedInput, now: Date): number {
  return Math.max(0, daysBetween(txn.occurredAt, now));
}

export function owedStateOf(txn: OwedInput, now: Date, dueSoonWithinDays = DUE_SOON_WITHIN_DAYS): OwedState {
  if (!txn.dueDate) return "no_due_date";
  const daysUntil = daysBetween(now, txn.dueDate);
  if (daysUntil < 0) return "overdue";
  return daysUntil <= dueSoonWithinDays ? "due_soon" : "not_due";
}

/** The aging bands, in order. `max` is inclusive; the last band is open-ended. */
export const AGING_BUCKETS = [
  { label: "0–7 days", max: 7 },
  { label: "8–30 days", max: 30 },
  { label: "31+ days", max: Infinity },
] as const;

export type AgingBucketLabel = (typeof AGING_BUCKETS)[number]["label"];

/**
 * Which band a number of days falls in. Total by construction: the last band is
 * unbounded, so every non-negative number lands somewhere and no row can fall
 * through a gap and quietly shrink the total the owner is chasing.
 */
export function agingBucketOf(days: number): AgingBucketLabel {
  return (AGING_BUCKETS.find((bucket) => days <= bucket.max) ?? AGING_BUCKETS[AGING_BUCKETS.length - 1]).label;
}

export interface AgingRow {
  days: number;
  amountCents: number;
}

export interface AgingSummary {
  totalCents: number;
  count: number;
  buckets: { label: AgingBucketLabel; count: number; cents: number }[];
}

/** Totals plus the same list partitioned by age. Every bucket appears, empty or not. */
export function summariseAging(rows: AgingRow[]): AgingSummary {
  const buckets = AGING_BUCKETS.map((bucket) => ({ label: bucket.label, count: 0, cents: 0 }));
  let totalCents = 0;
  for (const row of rows) {
    totalCents += row.amountCents;
    const bucket = buckets.find((candidate) => candidate.label === agingBucketOf(row.days))!;
    bucket.count += 1;
    bucket.cents += row.amountCents;
  }
  return { totalCents, count: rows.length, buckets };
}

export interface OwedRow {
  state: OwedState;
  daysOverdue: number;
  daysOutstanding: number;
}

/**
 * The single gate for "is this owed, and how does it stand".
 *
 * Returns null for anything that is not owed at all — already paid, voided, or
 * merely unconfirmed — so a caller cannot accidentally chase money that is not
 * outstanding. `REAL_STATUSES` is imported rather than re-listed: `pending`
 * means "the owner has not confirmed this happened", and a row nobody has
 * confirmed must never appear on a chase-the-money list.
 */
export function owedRow(txn: OwedInput, now: Date): OwedRow | null {
  if (!REAL_STATUSES.has(txn.status) || !isUnpaid(txn)) return null;
  return {
    state: owedStateOf(txn, now),
    daysOverdue: daysOverdue(txn, now),
    daysOutstanding: daysOutstanding(txn, now),
  };
}
