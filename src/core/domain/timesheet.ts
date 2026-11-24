import Decimal from "decimal.js";
import type { Cents } from "./money";

/**
 * The weekly grid's arithmetic: weeks, day totals, and what a short day means.
 *
 * Hours are decimal STRINGS throughout, computed with decimal.js — they end up
 * multiplied by money, and a float that drifts by a hundredth of an hour drifts
 * the cost of every client it touches.
 */

const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

/** Weeks start on Monday: a working week reads Mon–Sun on every timesheet. */
export function weekStartOf(date: Date): Date {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  // getUTCDay: 0 = Sunday. Shift so Monday is 0.
  const offset = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - offset);
  return d;
}

/** The seven dates of the week containing `weekStart`, as YYYY-MM-DD. */
export function weekDays(weekStart: Date): string[] {
  const start = weekStartOf(weekStart);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setUTCDate(start.getUTCDate() + i);
    return d.toISOString().slice(0, 10);
  });
}

/** Monday..Sunday. Saturday and Sunday are shown but never warned about. */
export function isWeekend(isoDate: string): boolean {
  const day = new Date(`${isoDate}T00:00:00Z`).getUTCDay();
  return day === 0 || day === 6;
}

/**
 * A normal working day, used only to spot a day that looks half-filled.
 *
 * Deliberately NOT derived from the billable target: that target is what you
 * can bill, which is less than what people work — using it would call a
 * perfectly complete 8-hour day an overrun.
 */
export const EXPECTED_DAILY_HOURS = "8";

export function addHours(...values: string[]): string {
  let total = new D(0);
  for (const value of values) total = total.plus(value || "0");
  // Trailing zeros off, so "8.00" reads as "8".
  return total.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toString();
}

export function hoursToNumber(hours: string): number {
  return Number(new D(hours || "0").toDecimalPlaces(2, Decimal.ROUND_HALF_UP));
}

/** What a day's logged hours cost: hours × the rate frozen on that entry. */
export function costOfHours(hours: string, rateCents: Cents): Cents {
  if (!Number.isSafeInteger(rateCents)) {
    throw new TypeError(`costOfHours: rate must be integer minor units, got ${rateCents}`);
  }
  return Number(new D(hours || "0").times(rateCents).toDecimalPlaces(0, Decimal.ROUND_HALF_UP));
}

export interface DayCheck {
  /** True when the day has hours on it but fewer than a normal day. */
  isShort: boolean;
  loggedHours: string;
  expectedHours: string;
  /** How many hours are unaccounted for. "0" when not short. */
  missingHours: string;
}

/**
 * Looks at one person's day and says whether it looks half-filled.
 *
 * Two rules that matter more than the arithmetic:
 *
 * 1. An EMPTY day is never short. Nothing logged means "not entered yet" or
 *    "didn't work", not "incomplete" — warning on every blank would train the
 *    owner to ignore the warning entirely.
 * 2. This only ever REPORTS. It does not block a save and it does not invent
 *    the missing hours as Admin. Hours nobody entered would produce cost
 *    attribution that is fiction, and fiction is worse than a gap because it
 *    looks like data.
 */
export function checkDay(loggedHours: string, expectedHours: string = EXPECTED_DAILY_HOURS): DayCheck {
  const logged = new D(loggedHours || "0");
  const expected = new D(expectedHours || EXPECTED_DAILY_HOURS);

  if (logged.lessThanOrEqualTo(0) || logged.greaterThanOrEqualTo(expected)) {
    return {
      isShort: false,
      loggedHours: logged.toString(),
      expectedHours: expected.toString(),
      missingHours: "0",
    };
  }
  return {
    isShort: true,
    loggedHours: logged.toString(),
    expectedHours: expected.toString(),
    missingHours: expected.minus(logged).toDecimalPlaces(2).toString(),
  };
}

/** Plain English for a short day. The UI never writes its own version. */
export function shortDaySentence(name: string, check: DayCheck): string {
  return `${name} has ${check.loggedHours} of about ${check.expectedHours} hours logged. Saved anyway — nothing was filled in for you.`;
}
