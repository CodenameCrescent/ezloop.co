import test from "node:test";
import assert from "node:assert/strict";
import {
  clampToToday,
  dateInputToInstant,
  dateInputToUtcEnd,
  dateInputToUtcStart,
  isFutureInputDate,
  todayInputValue,
} from "./period";

// ─── The date-input boundary ────────────────────────────────────────────────

test("a date that has not happened yet is refused, wherever it was typed", () => {
  const now = new Date(2026, 7, 5, 14, 30); // 5 Aug 2026, local afternoon
  assert.equal(todayInputValue(now), "2026-08-05");

  assert.equal(isFutureInputDate("2026-08-06", now), true);
  assert.equal(isFutureInputDate("2027-01-01", now), true);
  // Today itself is not the future, and neither is any day behind it.
  assert.equal(isFutureInputDate("2026-08-05", now), false);
  assert.equal(isFutureInputDate("2026-08-04", now), false);
  assert.equal(isFutureInputDate("2019-12-31", now), false);
  // An empty box is not a date at all — it must not read as "the future".
  assert.equal(isFutureInputDate("", now), false);

  // Clamping pulls a runaway date back to today and leaves good ones alone.
  assert.equal(clampToToday("2026-12-25", now), "2026-08-05");
  assert.equal(clampToToday("2026-08-05", now), "2026-08-05");
  assert.equal(clampToToday("2026-07-01", now), "2026-07-01");
});

test("a stored date lands inside the same day the filters look in", () => {
  // THE BUG: Quick Add stored `new Date("2026-08-05").toISOString()` — UTC
  // midnight — while every filter reads a picked date as a LOCAL day. West of
  // UTC those are different days, so a sale dated today vanished from "Today".
  const utcMidnight = new Date("2026-08-05");
  const localStart = dateInputToUtcStart("2026-08-05");
  const localEnd = dateInputToUtcEnd("2026-08-05");

  const inWindow = (d: Date) => d >= localStart && d <= localEnd;
  // Whatever the machine's zone, what we now store is inside its own day.
  assert.equal(inWindow(dateInputToInstant("2026-08-05", new Date(2026, 7, 5, 9, 0))), true);
  assert.equal(inWindow(dateInputToInstant("2026-08-05", new Date(2026, 7, 5, 23, 59))), true);
  // And the old behaviour is only safe by luck of the timezone.
  if (utcMidnight.getTime() !== localStart.getTime()) {
    assert.notEqual(utcMidnight.getTime(), localStart.getTime());
  }
});

test("recording something today keeps the time; backdating takes the start of that day", () => {
  const now = new Date(2026, 7, 5, 14, 30, 15);

  // Today → the actual moment, so two entries this afternoon keep their order.
  assert.equal(dateInputToInstant("2026-08-05", now).getTime(), now.getTime());

  // A past day has no time worth inventing.
  const backdated = dateInputToInstant("2026-07-20", now);
  assert.equal(backdated.getHours(), 0);
  assert.equal(backdated.getMinutes(), 0);
  assert.equal(backdated.getDate(), 20);
  assert.equal(backdated.getMonth(), 6);
});
