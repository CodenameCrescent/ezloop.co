import Decimal from "decimal.js";
import { addHours, isWeekend } from "./timesheet";

/**
 * "Roughly 80 hours a month" turned into days the ledger can cost.
 *
 * The case this exists for: an agency that has never filled a timesheet and
 * never will this month, but knows more or less where the time went. Without
 * this they get no profit figure at all for any client — and no figure is not
 * a safer answer than a rough one, it is just a less useful one. Rough but
 * HONESTLY LABELLED beats precise but absent, and in practice it is the on-ramp
 * to logging properly.
 *
 * Two things this must never do:
 *
 * 1. INVENT PRECISION. Every hour it writes is flagged `is_estimated`, and that
 *    flag has to survive all the way to the screen. An estimate that reads like
 *    a logged figure is worse than no estimate, because the owner would trust
 *    it exactly as much as a real one.
 *
 * 2. LOSE OR GAIN HOURS. The spread sums to the total EXACTLY. "About 80 hours"
 *    that stores 79.98 would make every downstream figure disagree with the
 *    number the owner typed, for no reason they could ever see.
 */

const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

/**
 * A day is a day; the database refuses more and so does this. Hours are stored
 * to the hundredth, which is also the smallest slice a day can be given.
 */
const MAX_DAY = "24";

/**
 * The working days in an inclusive range, as YYYY-MM-DD.
 *
 * Weekends are excluded deliberately. Spreading a month's hours over all 30
 * days puts work on Sundays nobody worked, and the incomplete-day warning and
 * the utilization figure both read the calendar — an estimate should not be the
 * one thing in the system claiming the team works weekends.
 */
export function workingDaysBetween(startIso: string, endIso: string): string[] {
  const days: string[] = [];
  const start = new Date(`${startIso}T00:00:00Z`);
  const end = new Date(`${endIso}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) return days;

  for (const d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    const iso = d.toISOString().slice(0, 10);
    if (!isWeekend(iso)) days.push(iso);
  }
  return days;
}

export interface Spread {
  /** One entry per day that gets hours, in order. Never contains a zero. */
  perDay: string[];
  /** How many days actually carry hours — may be fewer than offered. */
  dayCount: number;
  /** Exactly the total that was asked for. */
  total: string;
}

/**
 * Splits a total across days so the parts sum to the total EXACTLY.
 *
 * Even division almost never lands on a clean hundredth — 80 hours over 23 days
 * is 3.478…, and 23 × 3.48 is 80.04. So each day takes the total rounded DOWN,
 * and the leftover hundredths are handed out one at a time to the earliest
 * days. The parts then add up to the figure the owner typed, to the hundredth.
 *
 * When the total is too small to give every day a hundredth of an hour, it is
 * spread over fewer days rather than writing zero-hour entries. A zero-hour day
 * is not a thing: the database refuses it, and it would claim someone was on a
 * job for no time at all.
 */
export function spreadHours(total: string, offeredDays: number): Spread {
  const amount = new D(total || "0").toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  if (amount.lessThanOrEqualTo(0) || offeredDays <= 0) {
    return { perDay: [], dayCount: 0, total: "0" };
  }

  // In hundredths, so the whole split is integer arithmetic and cannot drift.
  const cents = amount.times(100);
  const dayCount = Math.min(offeredDays, cents.toNumber());
  const base = cents.dividedToIntegerBy(dayCount);
  const remainder = cents.minus(base.times(dayCount)).toNumber();

  const perDay = Array.from({ length: dayCount }, (_, i) => {
    // The earliest days absorb the leftover hundredths.
    const share = base.plus(i < remainder ? 1 : 0);
    return share.dividedBy(100).toDecimalPlaces(2).toString();
  });

  return { perDay, dayCount, total: addHours(...perDay) };
}

/** True when a total simply cannot be spread over a period sensibly. */
export function isSpreadable(total: string, offeredDays: number): boolean {
  const amount = new D(total || "0").toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  if (amount.lessThanOrEqualTo(0) || offeredDays <= 0) return false;
  // More than 24 hours a day for everyone involved is a typo, not a workload.
  return amount.dividedBy(offeredDays).lessThanOrEqualTo(MAX_DAY);
}

/**
 * Plain English for what an estimate will do, so the owner sees the shape of it
 * before it is written. The UI never composes its own version of this.
 */
export function estimateSentence(name: string, label: string, spread: Spread, days: number): string {
  if (spread.dayCount === 0) return `There is nothing to spread.`;
  const perDay = spread.perDay[0];
  const even = spread.perDay.every((h) => h === perDay);
  const rate = even ? `${perDay} hours` : `about ${perDay} hours`;
  const noun = spread.dayCount === 1 ? "working day" : "working days";
  const note =
    spread.dayCount < days
      ? ` That's too little to give all ${days} working days a share, so it sits on the first ${spread.dayCount}.`
      : "";
  return `${spread.total} hours for ${name} on ${label} — ${rate} a day across ${spread.dayCount} ${noun}.${note}`;
}

/** The marker every surface uses, so an estimate never reads as a logged figure. */
export const ESTIMATE_NOTE =
  "Estimated, not logged day by day. Treat the figures it feeds as roughly right, not exact.";
