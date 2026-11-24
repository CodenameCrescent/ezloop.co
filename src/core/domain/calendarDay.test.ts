import test from "node:test";
import assert from "node:assert/strict";
import { calendarDayIn, zonedDayEnd, zonedDayStart } from "./calendarDay";

/**
 * The defect these exist for: a spreadsheet date is a calendar day, and storing
 * it at UTC midnight put it on the wrong day for most of the world. West of
 * Greenwich it landed before "today" began and the ledger read empty; east of
 * Greenwich, converting the other way would push it into the previous day, and
 * possibly into a month already reported on.
 */

test("west of Greenwich: a day starts LATER than UTC midnight", () => {
  // America/Chicago in September is CDT, UTC-5.
  const start = zonedDayStart("2026-09-20", "America/Chicago");
  assert.equal(start.toISOString(), "2026-09-20T05:00:00.000Z");
  // And it still reads back as the day the file wrote.
  assert.equal(calendarDayIn(start, "America/Chicago"), "2026-09-20");
});

test("east of Greenwich: a day starts EARLIER, on the previous UTC date", () => {
  // Asia/Karachi is UTC+5 all year — the app's own demo currency.
  const start = zonedDayStart("2026-09-20", "Asia/Karachi");
  assert.equal(start.toISOString(), "2026-09-19T19:00:00.000Z");
  // The UTC date is the 19th, and reading it back in UTC would say so. This is
  // exactly why the duplicate fingerprint had to stop using UTC.
  assert.equal(start.toISOString().slice(0, 10), "2026-09-19");
  assert.equal(calendarDayIn(start, "Asia/Karachi"), "2026-09-20");
});

test("UTC is still UTC, so anything that omits a zone behaves as it always did", () => {
  assert.equal(zonedDayStart("2026-09-20", "UTC").toISOString(), "2026-09-20T00:00:00.000Z");
  assert.equal(zonedDayStart("2026-09-20").toISOString(), "2026-09-20T00:00:00.000Z");
  assert.equal(calendarDayIn(new Date("2026-09-20T00:00:00.000Z")), "2026-09-20");
});

test("a day ends one millisecond before the next one starts", () => {
  const end = zonedDayEnd("2026-09-20", "Asia/Karachi");
  const nextStart = zonedDayStart("2026-09-21", "Asia/Karachi");
  assert.equal(end.getTime(), nextStart.getTime() - 1);
  assert.equal(calendarDayIn(end, "Asia/Karachi"), "2026-09-20");
});

test("a spring-forward day is 23 hours long and the arithmetic knows it", () => {
  // America/Chicago moves to CDT at 02:00 local on 2026-03-08.
  const start = zonedDayStart("2026-03-08", "America/Chicago");
  const end = zonedDayEnd("2026-03-08", "America/Chicago");
  const hours = (end.getTime() + 1 - start.getTime()) / 3_600_000;
  assert.equal(hours, 23, "adding a flat 24 hours would run into the next day");
  assert.equal(calendarDayIn(start, "America/Chicago"), "2026-03-08");
});

test("an autumn fall-back day is 25 hours long", () => {
  const start = zonedDayStart("2026-11-01", "America/Chicago");
  const end = zonedDayEnd("2026-11-01", "America/Chicago");
  assert.equal((end.getTime() + 1 - start.getTime()) / 3_600_000, 25);
});

test("the day either side of a DST change still reads back as itself", () => {
  for (const day of ["2026-03-07", "2026-03-08", "2026-03-09", "2026-10-31", "2026-11-01", "2026-11-02"]) {
    assert.equal(
      calendarDayIn(zonedDayStart(day, "America/Chicago"), "America/Chicago"),
      day,
      `${day} did not survive the round trip`,
    );
  }
});

test("a zone the browser made up falls back to UTC rather than throwing", () => {
  // An import must not refuse a whole file over an unfamiliar zone name. Losing
  // the offset is recoverable; losing the rows is not.
  const start = zonedDayStart("2026-09-20", "Mars/Olympus_Mons");
  assert.equal(start.toISOString(), "2026-09-20T00:00:00.000Z");
  assert.equal(calendarDayIn(start, "Mars/Olympus_Mons"), "2026-09-20");
});

test("a malformed day is an Invalid Date, so existing NaN guards still catch it", () => {
  // `loadExistingKeys` checks exactly this before letting a bound reach the
  // database, and used to get it from `new Date("")`.
  assert.ok(Number.isNaN(zonedDayStart("", "Asia/Karachi").getTime()));
  assert.ok(Number.isNaN(zonedDayStart("not-a-day", "UTC").getTime()));
  assert.ok(Number.isNaN(zonedDayEnd("", "UTC").getTime()));
});

test("a far-eastern zone crossing the date line still round-trips", () => {
  // Pacific/Kiritimati is UTC+14 — the largest offset there is.
  const start = zonedDayStart("2026-09-20", "Pacific/Kiritimati");
  assert.equal(start.toISOString(), "2026-09-19T10:00:00.000Z");
  assert.equal(calendarDayIn(start, "Pacific/Kiritimati"), "2026-09-20");
});
