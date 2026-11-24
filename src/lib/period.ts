// ─── Period ─────────────────────────────────────────────────────────────────

export type PeriodPresetId =
  | "today"
  | "this-month"
  | "last-month"
  | "last-3-months"
  | "last-6-months"
  | "ytd"
  | "custom";

export type Period = "daily" | "weekly" | "monthly";

export interface PeriodRange {
  start: Date;
  end: Date;
  priorStart: Date;
  priorEnd: Date;
  /** Inclusive number of days in the window. */
  days: number;
  label: string;
}

// These date helpers intentionally use the seller's local calendar day.
// Orders entered via datetime-local are stored as UTC instants, so UTC day
// buckets can hide after-midnight local orders from "Today" dashboards.
export function startOfDayUtc(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
export function endOfDayUtc(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
}
export function addDaysUtc(d: Date, n: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

export function dateInputValueUtc(date: Date): string {
  const d = startOfDayUtc(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function dateInputToUtcStart(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return startOfDayUtc(new Date());
  return new Date(year, month - 1, day);
}

export function dateInputToUtcEnd(value: string): Date {
  return endOfDayUtc(dateInputToUtcStart(value));
}

// ─── The date-input boundary ────────────────────────────────────────────────
//
// One rule, shared by every date box in the app, because they had drifted
// apart: the filters read a picked date as a LOCAL calendar day (deliberately —
// see the note above) while Quick Add stored it as UTC midnight. West of UTC
// that puts a sale dated "today" on yesterday in every filter and every P&L.

/** Today on the seller's own calendar, in the format a date input speaks. */
export function todayInputValue(now: Date = new Date()): string {
  return dateInputValueUtc(now);
}

/**
 * Later than today? ISO dates compare correctly as plain strings, so this is
 * also what the `max` attribute enforces — this is the belt to its braces, for
 * the browsers that let a date be typed rather than picked.
 */
export function isFutureInputDate(value: string, now: Date = new Date()): boolean {
  return !!value && value > todayInputValue(now);
}

/** Pull a picked date back to today when it has run ahead of it. */
export function clampToToday(value: string, now: Date = new Date()): string {
  return isFutureInputDate(value, now) ? todayInputValue(now) : value;
}

/**
 * The instant to STORE for a date somebody picked.
 *
 * Read as a local calendar day, exactly as the period filters read it, so a
 * transaction always lands inside the day it was dated.
 *
 * A date picked as TODAY keeps the current time instead of snapping to
 * midnight: "record it now" should mean now, and two sales entered this
 * afternoon then sit in the order they happened. A backdated day has no time
 * worth inventing, so it takes the start of that day.
 */
export function dateInputToInstant(value: string, now: Date = new Date()): Date {
  const day = dateInputToUtcStart(value);
  return dateInputValueUtc(day) === dateInputValueUtc(now) ? now : day;
}

function makeRange(start: Date, end: Date, label: string): PeriodRange {
  const s = startOfDayUtc(start);
  const e = endOfDayUtc(end);
  const days = Math.max(
    1,
    Math.round((e.getTime() - s.getTime()) / 86400000),
  );
  const priorEnd = addDaysUtc(s, -1);
  const priorStart = addDaysUtc(priorEnd, -(days - 1));
  return {
    start: s,
    end: e,
    priorStart: startOfDayUtc(priorStart),
    priorEnd: endOfDayUtc(priorEnd),
    days,
    label,
  };
}

/** Build a period range from a preset and optional custom dates. */
export function buildPeriodRange(
  preset: PeriodPresetId,
  customStart?: Date,
  customEnd?: Date,
  now: Date = new Date(),
): PeriodRange {
  const y = now.getFullYear();
  const m = now.getMonth();
  const d = now.getDate();
  switch (preset) {
    case "today": {
      const today = new Date(y, m, d);
      return makeRange(today, today, "Today");
    }
    case "this-month": {
      const start = new Date(y, m, 1);
      const end = new Date(y, m, d);
      return makeRange(start, end, "Month");
    }
    case "last-month": {
      const start = new Date(y, m - 1, 1);
      const end = new Date(y, m, 0); // last day of prev month
      return makeRange(start, end, "Last month");
    }
    case "last-3-months": {
      const start = new Date(y, m - 2, 1);
      const end = new Date(y, m, d);
      return makeRange(start, end, "Last 3 months");
    }
    case "last-6-months": {
      const start = new Date(y, m - 5, 1);
      const end = new Date(y, m, d);
      return makeRange(start, end, "Last 6 months");
    }
    case "ytd": {
      const start = new Date(y, 0, 1);
      const end = new Date(y, m, d);
      return makeRange(start, end, "Year");
    }
    case "custom": {
      const s = customStart ?? new Date(y, m, 1);
      const e = customEnd ?? new Date(y, m, d);
      return makeRange(s, e, "Custom");
    }
  }
}

export function buildPeriodRangeFromDates(
  start: Date,
  end: Date,
  label = "Custom",
): PeriodRange {
  return makeRange(start, end, label);
}

export function inRange(d: Date, start: Date, end: Date): boolean {
  const t = d.getTime();
  return t >= start.getTime() && t <= end.getTime();
}

export function isDateInPeriodRange(input: string | Date, range: PeriodRange): boolean {
  const d = typeof input === "string" ? new Date(input) : input;
  return !Number.isNaN(d.getTime()) && inRange(d, range.start, range.end);
}
