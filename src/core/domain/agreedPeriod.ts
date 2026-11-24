import Decimal from "decimal.js";
import type { Cents } from "./money";

/**
 * Whether an agreed figure means "for the whole job" or "every month".
 *
 * The app used to guess this from a "Working arrangement" field that drove
 * nothing else, and guessed wrong the moment anyone picked a date range longer
 * than a month: sixty hours a month compared against six months of logged time
 * reads as 500% over. So the owner now says it outright, once per figure.
 *
 * Two separate answers, one for the hours and one for the money, because the
 * combination is real: an agency quotes "forty hours a month" against a fixed
 * total contract value all the time. Forcing one answer onto both would make
 * the per-hour price wrong by the length of the contract.
 */

const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

export const AGREED_PERIODS = ["total", "monthly"] as const;
export type AgreedPeriod = (typeof AGREED_PERIODS)[number];

export function isAgreedPeriod(value: unknown): value is AgreedPeriod {
  return typeof value === "string" && (AGREED_PERIODS as readonly string[]).includes(value);
}

export const AGREED_PERIOD_LABELS: Record<AgreedPeriod, string> = {
  total: "In total",
  monthly: "Per month",
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
/** A hostile range must not spin the loop. A hundred years is past any real contract. */
const MAX_MONTHS = 1200;

function utc(iso: string): number {
  return Date.parse(`${iso}T00:00:00Z`);
}

function daysInMonth(year: number, month: number): number {
  // Day 0 of the next month is the last day of this one.
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

/**
 * How many months a date window is worth, counting part-months as fractions.
 *
 * Each calendar month the window touches contributes (its days inside the
 * window ÷ its own length). So any single whole calendar month is exactly 1
 * whatever its length, February in a leap year included, and 15 July to
 * 15 August is 17/31 + 15/31 ≈ 1.032.
 *
 * The alternative — dividing the window's days by an average month — makes a
 * plain calendar month come out at 1.0184 and every monthly figure look 2% over
 * for no reason the owner could ever see.
 *
 * Returns NULL rather than a number when either end is missing. "How many
 * months is all time" has no answer, and the callers turn that null into an
 * absent figure rather than inventing a multiplier of one.
 */
export function monthsInWindow(startIso?: string | null, endIso?: string | null): string | null {
  if (!startIso || !endIso || !ISO_DATE.test(startIso) || !ISO_DATE.test(endIso)) return null;

  const start = utc(startIso);
  const end = utc(endIso);
  if (Number.isNaN(start) || Number.isNaN(end) || start > end) return null;

  const startDate = new Date(start);
  const endDate = new Date(end);
  let year = startDate.getUTCFullYear();
  let month = startDate.getUTCMonth();
  const endYear = endDate.getUTCFullYear();
  const endMonth = endDate.getUTCMonth();

  let total = new D(0);
  let guard = 0;

  while (year < endYear || (year === endYear && month <= endMonth)) {
    guard += 1;
    if (guard > MAX_MONTHS) return null;

    const length = daysInMonth(year, month);
    const firstOfMonth = Date.UTC(year, month, 1);
    const lastOfMonth = Date.UTC(year, month, length);
    const from = Math.max(start, firstOfMonth);
    const to = Math.min(end, lastOfMonth);
    // Inclusive on both ends: 1 to 31 July is 31 days, not 30.
    const inside = (to - from) / 86_400_000 + 1;

    total = total.plus(new D(inside).div(length));

    month += 1;
    if (month > 11) {
      month = 0;
      year += 1;
    }
  }

  return total.toDecimalPlaces(6, Decimal.ROUND_HALF_UP).toString();
}

/**
 * The agreed hours restated for the window being looked at.
 *
 * A figure given "in total" is already the answer. A monthly figure has to be
 * multiplied up, and cannot be answered at all without a window — which is the
 * null case, not a multiplier of one.
 */
export function scaleAgreedHours(
  agreedHours: string | null,
  period: AgreedPeriod,
  windowMonths: string | null,
): string | null {
  if (!agreedHours || new D(agreedHours).lessThanOrEqualTo(0)) return null;
  if (period === "total") return agreedHours;
  if (!windowMonths) return null;
  return new D(agreedHours).times(windowMonths).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toString();
}

/** Why an hourly price could not be worked out. Never a zero standing in for these. */
export type AgreedRateReason = "ok" | "no_amount" | "no_hours" | "needs_dates";

export interface AgreedRate {
  cents: Cents | null;
  reason: AgreedRateReason;
}

/**
 * What the client believes they are paying per hour.
 *
 * This is a RATIO — the money divided by the hours — and that single fact
 * decides the whole design. When both figures share a basis the ratio is the
 * answer directly, whatever window is on screen: scaling both by the same
 * multiplier cancels, and doing it anyway would round the money and make the
 * price drift every time the date filter moved. So the matching case never
 * scales, and the price is the same in January as it is across the whole year.
 *
 * When the two figures DISAGREE — forty hours a month against a fixed total fee
 * — the ratio is meaningless until both sit on one basis, and putting them
 * there needs the length of the contract. If the engagement has no start and
 * end date, that length is unknowable and the honest answer is no answer.
 * Inventing a contract length here would quietly misprice the job by however
 * many months we guessed wrong.
 */
export function agreedHourlyRate(input: {
  agreedAmountCents: Cents | null;
  agreedHours: string | null;
  amountPeriod: AgreedPeriod;
  hoursPeriod: AgreedPeriod;
  /** Prorated months between the engagement's own start and end dates. */
  contractMonths: string | null;
}): AgreedRate {
  const { agreedAmountCents, agreedHours, amountPeriod, hoursPeriod, contractMonths } = input;

  if (agreedAmountCents === null || agreedAmountCents <= 0) return { cents: null, reason: "no_amount" };
  if (!agreedHours || new D(agreedHours).lessThanOrEqualTo(0)) return { cents: null, reason: "no_hours" };

  // Same basis on both: the multiplier cancels, so it is never applied.
  if (amountPeriod === hoursPeriod) {
    return {
      cents: Number(new D(agreedAmountCents).div(agreedHours).toDecimalPlaces(0, Decimal.ROUND_HALF_UP)),
      reason: "ok",
    };
  }

  if (!contractMonths) return { cents: null, reason: "needs_dates" };

  const amount = amountPeriod === "monthly" ? new D(agreedAmountCents).times(contractMonths) : new D(agreedAmountCents);
  const hours = hoursPeriod === "monthly" ? new D(agreedHours).times(contractMonths) : new D(agreedHours);
  if (hours.lessThanOrEqualTo(0)) return { cents: null, reason: "no_hours" };

  return { cents: Number(amount.div(hours).toDecimalPlaces(0, Decimal.ROUND_HALF_UP)), reason: "ok" };
}

/** Plain English for a price that could not be worked out. The UI never writes its own. */
export const AGREED_RATE_REASON_MESSAGE: Record<Exclude<AgreedRateReason, "ok">, string> = {
  no_amount: "No agreed amount, so there is no hourly price to compare against.",
  no_hours: "No agreed hours, so there is no hourly price to compare against.",
  needs_dates:
    "The hours and the fee are quoted on different bases, so working out an hourly price needs the start and end dates of the arrangement.",
};
