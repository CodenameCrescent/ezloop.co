/**
 * Pure date math for the recurring engine. Dates are treated as UTC calendar
 * days (the DB stores them in `date` columns). The anchor day is REMEMBERED,
 * never degraded: a Jan-31 monthly schedule posts Jan 31 → Feb 28/29 → Mar 31,
 * because each step clamps the fixed anchor to the target month rather than
 * walking forward from the previous clamped day.
 */

export type RecurInterval = "daily" | "weekly" | "monthly" | "quarterly" | "yearly";

const INTERVAL_NOUNS: Record<RecurInterval, string> = {
  daily: "day",
  weekly: "week",
  monthly: "month",
  quarterly: "quarter",
  yearly: "year",
};

/**
 * How often a schedule posts, in words: "every month", "every 2 weeks".
 *
 * Here rather than on a screen because more than one screen says it — the
 * Recurring list and the warning shown before archiving someone who has a live
 * schedule — and two copies of a noun map is one copy too many.
 */
export function recurrenceLabel(interval: RecurInterval, intervalCount = 1): string {
  const noun = INTERVAL_NOUNS[interval];
  return intervalCount > 1 ? `every ${intervalCount} ${noun}s` : `every ${noun}`;
}

/** Months advanced per unit for the month-based intervals. */
const MONTHS_PER_UNIT: Partial<Record<RecurInterval, number>> = {
  monthly: 1,
  quarterly: 3,
  yearly: 12,
};

function utcDay(date: Date | string): Date {
  const d = date instanceof Date ? date : new Date(date);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function daysInMonth(year: number, monthIndex0: number): number {
  return new Date(Date.UTC(year, monthIndex0 + 1, 0)).getUTCDate();
}

/** Same UTC calendar day? */
export function sameDay(a: Date, b: Date): boolean {
  return utcDay(a).getTime() === utcDay(b).getTime();
}

export function isOnOrBefore(a: Date, b: Date): boolean {
  return utcDay(a).getTime() <= utcDay(b).getTime();
}

/**
 * The scheduled date that follows `from` by one interval step. `anchorDay`
 * (1–31) is the remembered day-of-month for month-based intervals; when absent
 * the day of `from` is used.
 */
export function nextRunDate(from: Date | string, interval: RecurInterval, intervalCount = 1, anchorDay?: number | null): Date {
  const base = utcDay(from);
  const count = Math.max(1, intervalCount);

  if (interval === "daily") {
    return new Date(base.getTime() + count * 86_400_000);
  }
  if (interval === "weekly") {
    return new Date(base.getTime() + count * 7 * 86_400_000);
  }

  const monthsPerUnit = MONTHS_PER_UNIT[interval]!;
  const stepMonths = count * monthsPerUnit;
  const targetMonthIndex = base.getUTCFullYear() * 12 + base.getUTCMonth() + stepMonths;
  const year = Math.floor(targetMonthIndex / 12);
  const month = targetMonthIndex % 12;
  const anchor = anchorDay ?? base.getUTCDate();
  const day = Math.min(anchor, daysInMonth(year, month));
  return new Date(Date.UTC(year, month, day));
}

export interface DueDatesInput {
  nextRunAt: Date | string;
  today: Date | string;
  interval: RecurInterval;
  intervalCount?: number;
  anchorDay?: number | null;
  endDate?: Date | string | null;
  maxOccurrences?: number | null;
  occurrencesPosted?: number;
  /** Catch-up safety cap (CLAUDE.md/R4: default 12, UI warns when hit). */
  cap?: number;
}

export interface DueDatesResult {
  /** Scheduled dates to post now, oldest first (occurred_at uses each of these). */
  dates: Date[];
  /** True when the cap clipped the backlog — surfaced as a UI warning. */
  capped: boolean;
  /** next_run_at after posting these (null when the schedule is exhausted). */
  nextRunAt: Date | null;
  /** True when end_date/max_occurrences retired the schedule. */
  completed: boolean;
}

/**
 * Every scheduled date ≤ today that hasn't been posted yet, advancing by the
 * interval and honouring end_date / max_occurrences, capped at `cap` to bound
 * catch-up after downtime. Also returns the next_run_at to persist.
 */
export function dueDatesUpTo(input: DueDatesInput): DueDatesResult {
  const { interval, intervalCount = 1, anchorDay = null, cap = 12 } = input;
  const today = utcDay(input.today);
  const endDate = input.endDate ? utcDay(input.endDate) : null;
  const maxOccurrences = input.maxOccurrences ?? null;
  let posted = input.occurrencesPosted ?? 0;

  const dates: Date[] = [];
  let cursor = utcDay(input.nextRunAt);
  let capped = false;
  let completed = false;

  while (isOnOrBefore(cursor, today)) {
    if (endDate && cursor.getTime() > endDate.getTime()) {
      completed = true;
      break;
    }
    if (maxOccurrences !== null && posted >= maxOccurrences) {
      completed = true;
      break;
    }
    dates.push(cursor);
    posted += 1;
    if (maxOccurrences !== null && posted >= maxOccurrences) {
      completed = true;
      cursor = nextRunDate(cursor, interval, intervalCount, anchorDay);
      break;
    }
    if (dates.length >= cap) {
      capped = true;
      cursor = nextRunDate(cursor, interval, intervalCount, anchorDay);
      break;
    }
    cursor = nextRunDate(cursor, interval, intervalCount, anchorDay);
  }

  // If we stopped because cursor passed today (not exhausted), check whether the
  // NEXT date would exceed end_date → then the schedule is done after this run.
  if (!completed && endDate && cursor.getTime() > endDate.getTime()) {
    completed = true;
  }

  return { dates, capped, nextRunAt: completed ? null : cursor, completed };
}
