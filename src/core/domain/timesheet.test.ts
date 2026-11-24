import test from "node:test";
import assert from "node:assert/strict";
import {
  EXPECTED_DAILY_HOURS,
  addHours,
  checkDay,
  costOfHours,
  hoursToNumber,
  isWeekend,
  shortDaySentence,
  weekDays,
  weekStartOf,
} from "./timesheet";

test("weeks start on Monday, whatever day you open the grid on", () => {
  // Wed 5 Aug 2026 → Mon 3 Aug.
  assert.equal(weekStartOf(new Date("2026-08-05T12:00:00Z")).toISOString().slice(0, 10), "2026-08-03");
  // A Monday is its own week start.
  assert.equal(weekStartOf(new Date("2026-08-03T00:00:00Z")).toISOString().slice(0, 10), "2026-08-03");
  // Sunday belongs to the week that began the previous Monday, not the next.
  assert.equal(weekStartOf(new Date("2026-08-09T23:59:00Z")).toISOString().slice(0, 10), "2026-08-03");
});

test("a week is seven consecutive days, Monday first", () => {
  const days = weekDays(new Date("2026-08-05T00:00:00Z"));
  assert.deepEqual(days, [
    "2026-08-03", "2026-08-04", "2026-08-05", "2026-08-06", "2026-08-07", "2026-08-08", "2026-08-09",
  ]);
  assert.equal(isWeekend(days[0]), false); // Monday
  assert.equal(isWeekend(days[4]), false); // Friday
  assert.equal(isWeekend(days[5]), true); // Saturday
  assert.equal(isWeekend(days[6]), true); // Sunday
});

test("a short day is REPORTED, never blocked and never filled in", () => {
  // The acceptance case: 6 hours logged on an 8-hour day.
  const check = checkDay("6");
  assert.equal(check.isShort, true);
  assert.equal(check.missingHours, "2");
  // Nothing in this result can prevent a save or invent an entry — it is a
  // report, not a gate. Inventing the missing 2 hours as Admin would attribute
  // cost to work nobody did.
  assert.deepEqual(Object.keys(check).sort(), ["expectedHours", "isShort", "loggedHours", "missingHours"]);
  assert.match(shortDaySentence("Sara", check), /saved anyway/i);
});

test("an empty day is NOT short — a blank is not an incomplete day", () => {
  // Warning on every unfilled day would train the owner to ignore the warning.
  for (const empty of ["", "0", "0.00"]) {
    const check = checkDay(empty);
    assert.equal(check.isShort, false, `"${empty}" must not warn`);
    assert.equal(check.missingHours, "0");
  }
});

test("a full or long day is not short", () => {
  assert.equal(checkDay("8").isShort, false);
  assert.equal(checkDay("8.5").isShort, false);
  assert.equal(checkDay("12").isShort, false);
});

test("the expected day is a working day, not the billable target", () => {
  // 130 billable hours a month is about 6 a day. Using that would call a
  // complete 8-hour day an overrun and a genuine 6-hour day complete.
  assert.equal(EXPECTED_DAILY_HOURS, "8");
  // A custom expectation still works, for a part-timer.
  assert.equal(checkDay("4", "4").isShort, false);
  assert.equal(checkDay("3", "4").isShort, true);
  assert.equal(checkDay("3", "4").missingHours, "1");
});

test("hours add exactly, including the halves people actually log", () => {
  assert.equal(addHours("1.5", "2.25", "0.25"), "4");
  assert.equal(addHours("0.1", "0.2"), "0.3"); // a float would give 0.30000000000000004
  assert.equal(addHours(), "0");
  assert.equal(addHours("", "3"), "3");
});

test("cost is hours times the frozen rate, in whole cents", () => {
  // 7.5 hours at Rs 461.54 = Rs 3,461.55
  assert.equal(costOfHours("7.5", 461_54), 346_155);
  assert.equal(costOfHours("0", 461_54), 0);
  assert.equal(costOfHours("", 461_54), 0);
  // A third of an hour rounds half-up to whole cents, never drifts.
  assert.equal(costOfHours("0.33", 300_00), 9_900);
  assert.throws(() => costOfHours("1", 10.5), /integer minor units/);
});

test("hours convert to a number only at the display boundary", () => {
  assert.equal(hoursToNumber("7.5"), 7.5);
  assert.equal(hoursToNumber(""), 0);
  assert.equal(hoursToNumber("0.005"), 0.01);
});
