import test from "node:test";
import assert from "node:assert/strict";
import { dueDatesUpTo, nextRunDate, recurrenceLabel } from "./recurrence";

const iso = (d: Date) => d.toISOString().slice(0, 10);

test("nextRunDate: daily and weekly", () => {
  assert.equal(iso(nextRunDate("2026-01-01", "daily", 1)), "2026-01-02");
  assert.equal(iso(nextRunDate("2026-01-01", "daily", 10)), "2026-01-11");
  assert.equal(iso(nextRunDate("2026-01-01", "weekly", 2)), "2026-01-15");
});

test("nextRunDate: anchor day is remembered, not degraded (Jan 31 → Feb 28/29 → Mar 31)", () => {
  // From Jan 31 with anchor 31: Feb has 28 days in 2026 → clamps to Feb 28.
  assert.equal(iso(nextRunDate("2026-01-31", "monthly", 1, 31)), "2026-02-28");
  // From Feb 28 the anchor (31) is reapplied against March → Mar 31, not Mar 28.
  assert.equal(iso(nextRunDate("2026-02-28", "monthly", 1, 31)), "2026-03-31");
  // Leap year: Feb 29.
  assert.equal(iso(nextRunDate("2028-01-31", "monthly", 1, 31)), "2028-02-29");
  assert.equal(iso(nextRunDate("2028-02-29", "monthly", 1, 31)), "2028-03-31");
});

test("nextRunDate: quarterly and yearly with clamps", () => {
  assert.equal(iso(nextRunDate("2026-01-15", "quarterly", 1, 15)), "2026-04-15");
  assert.equal(iso(nextRunDate("2026-01-31", "quarterly", 1, 31)), "2026-04-30"); // April has 30
  assert.equal(iso(nextRunDate("2028-02-29", "yearly", 1, 29)), "2029-02-28"); // non-leap clamp
});

test("dueDatesUpTo: catch-up posts every missed date, oldest first", () => {
  // Monthly on the 1st, next run Jan 1, job runs Apr 10 after being down.
  const r = dueDatesUpTo({ nextRunAt: "2026-01-01", today: "2026-04-10", interval: "monthly", anchorDay: 1 });
  assert.deepEqual(r.dates.map(iso), ["2026-01-01", "2026-02-01", "2026-03-01", "2026-04-01"]);
  assert.equal(iso(r.nextRunAt!), "2026-05-01");
  assert.equal(r.capped, false);
  assert.equal(r.completed, false);
});

test("dueDatesUpTo: cap of 12 clips a long backlog and flags capped", () => {
  // Daily since a year ago → hundreds due; cap at 12.
  const r = dueDatesUpTo({ nextRunAt: "2025-01-01", today: "2026-01-01", interval: "daily" });
  assert.equal(r.dates.length, 12);
  assert.equal(r.capped, true);
  assert.equal(iso(r.dates[0]), "2025-01-01");
  // next_run_at advances past the last capped date so we don't repost it.
  assert.equal(iso(r.nextRunAt!), "2025-01-13");
});

test("dueDatesUpTo: end_date and max_occurrences retire the schedule", () => {
  const byEnd = dueDatesUpTo({ nextRunAt: "2026-01-01", today: "2026-12-01", interval: "monthly", anchorDay: 1, endDate: "2026-03-01" });
  assert.deepEqual(byEnd.dates.map(iso), ["2026-01-01", "2026-02-01", "2026-03-01"]);
  assert.equal(byEnd.completed, true);
  assert.equal(byEnd.nextRunAt, null);

  const byMax = dueDatesUpTo({ nextRunAt: "2026-01-01", today: "2026-12-01", interval: "monthly", anchorDay: 1, maxOccurrences: 2, occurrencesPosted: 0 });
  assert.deepEqual(byMax.dates.map(iso), ["2026-01-01", "2026-02-01"]);
  assert.equal(byMax.completed, true);
});

test("dueDatesUpTo: nothing due when next_run_at is in the future", () => {
  const r = dueDatesUpTo({ nextRunAt: "2026-06-01", today: "2026-01-01", interval: "monthly", anchorDay: 1 });
  assert.deepEqual(r.dates, []);
  assert.equal(iso(r.nextRunAt!), "2026-06-01");
});

test("recurrenceLabel: singular for one, plural for many", () => {
  assert.equal(recurrenceLabel("monthly", 1), "every month");
  assert.equal(recurrenceLabel("monthly"), "every month");
  assert.equal(recurrenceLabel("weekly", 2), "every 2 weeks");
  assert.equal(recurrenceLabel("quarterly", 1), "every quarter");
  assert.equal(recurrenceLabel("daily", 3), "every 3 days");
  assert.equal(recurrenceLabel("yearly", 1), "every year");
});
