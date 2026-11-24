import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_BILLABLE_TARGET_HOURS,
  ENGAGEMENT_STATUSES,
  ENGAGEMENT_STATUS_LABELS,
  INTERNAL_TIME_CATEGORIES,
  MAX_HOURS_PER_ENTRY,
  TEAM_COST_TYPES,
  TEAM_COST_TYPE_LABELS,
  TIME_ENTRY_SOURCES,
  TIME_TARGET_LABELS,
  TIME_TARGET_TYPES,
  WORK_TYPES,
  WORK_TYPE_LABELS,
  isEngagementStatus,
  isTeamCostType,
  isTimeEntrySource,
  isTimeTargetType,
  isValidHours,
  isWorkType,
  isPartialHoursEntry,
  hoursForTotal,
  checkHoursTotal,
} from "./clientProfitability";
import { AGREED_PERIODS, AGREED_PERIOD_LABELS, isAgreedPeriod } from "./agreedPeriod";
import { addHours } from "./timesheet";

test("time can point at things that are not clients", () => {
  // The module's most important structural decision: an agency that writes a
  // book spends real labour on it. If time could only land on a client, that
  // labour would fall into Internal and the book would show revenue with no
  // labour cost — a fake margin.
  assert.ok(TIME_TARGET_TYPES.includes("revenue_item"));
  assert.ok(TIME_TARGET_TYPES.includes("client"));
  assert.ok(TIME_TARGET_TYPES.includes("internal"));
  // `project` is the same argument again, arrived at from the trades: hours on
  // a site that could only be booked to the client would leave every site
  // looking equally expensive.
  assert.ok(TIME_TARGET_TYPES.includes("project"));
  assert.equal(TIME_TARGET_TYPES.length, 4);

  // Every target type has words, so no picker can render a raw enum at someone.
  for (const type of TIME_TARGET_TYPES) {
    assert.ok(TIME_TARGET_LABELS[type]?.length > 0, `${type} needs a label`);
  }
});

test("rework and build/maintenance are their own work types, not folded into delivery", () => {
  // rework is the leading indicator of a bad client; build vs maintenance
  // separates investment from running cost. Both are invisible in a plain total.
  for (const needed of ["rework", "build", "maintenance", "delivery"] as const) {
    assert.ok(WORK_TYPES.includes(needed), `${needed} must be its own work type`);
  }
});

test("the billable target defaults to 130, not a full month", () => {
  // 160 assumes every hour is billable, which nobody achieves, and the
  // flattering hourly cost makes every client look better than they are.
  assert.equal(DEFAULT_BILLABLE_TARGET_HOURS, "130");
  // It is a decimal string, like every other quantity in this codebase.
  assert.equal(typeof DEFAULT_BILLABLE_TARGET_HOURS, "string");
});

test("engagement status is a lifecycle, not a pipeline", () => {
  // Three values, no stages, no workflow — this module is not a CRM.
  assert.deepEqual([...ENGAGEMENT_STATUSES], ["active", "completed", "churned"]);
  for (const status of ENGAGEMENT_STATUSES) assert.equal(isEngagementStatus(status), true);
});

test("every way an hour can arrive is in the list, in the order they rank", () => {
  // Typed hours outrank an import, an import outranks an estimate. `estimate`
  // was added to the database in Phase 8 and missed here, which left this list
  // rejecting a value the app was already writing.
  assert.deepEqual([...TIME_ENTRY_SOURCES], ["manual", "csv_import", "estimate"]);
  for (const source of TIME_ENTRY_SOURCES) assert.equal(isTimeEntrySource(source), true);
});

test("hours are validated as decimal strings, never floats", () => {
  for (const good of ["1", "0.5", "7.25", "24"]) {
    assert.equal(isValidHours(good), true, `${good} should be valid`);
  }
  // Zero and negatives are not time; above a full day is a typo, not a shift.
  for (const bad of ["0", "-1", "24.01", "25", "", "abc", "1e2", "1,5"]) {
    assert.equal(isValidHours(bad), false, `${bad} should be rejected`);
  }
  // A float is not a decimal string, however reasonable it looks.
  for (const notAString of [7.5, null, undefined, {}]) {
    assert.equal(isValidHours(notAString), false);
  }
  assert.equal(MAX_HOURS_PER_ENTRY, 24);
});

test("a half-typed number is not a mistake, but a currency symbol always is", () => {
  // Every state on the way to "7.25", plus the empty box that means "no hours".
  for (const midTyping of ["", "7", "7.", "7.2", "7.25", ".5", ".", "0", "24", "24."]) {
    assert.equal(isPartialHoursEntry(midTyping), true, `${JSON.stringify(midTyping)} is still on its way`);
  }
  // Text no further keystroke can rescue, and figures already past a full day.
  for (const hopeless of ["$", "5$", "abc", "-1", "1,5", "1.2.3", "1e3", " 2", "25", "24.01", "٣"]) {
    assert.equal(isPartialHoursEntry(hopeless), false, `${JSON.stringify(hopeless)} should warn`);
  }
});

test("nothing typed into an hours box can break the running total", () => {
  // The crash: these reached decimal.js during render and threw, blanking the
  // whole page. They must now count as nothing instead.
  for (const junk of ["$", "abc", "1.2.3", "-1", "1e3", " 2 ", "", ".", "NaN", "Infinity"]) {
    assert.equal(hoursForTotal(junk), "0", `${JSON.stringify(junk)} must not reach the arithmetic`);
  }
  // Real values pass through untouched, including the half-typed ones — a total
  // that dropped to zero between "1" and "1.5" would be its own kind of wrong.
  for (const real of ["1", "1.", "1.5", ".5", "0", "24"]) {
    assert.equal(hoursForTotal(real), real);
  }
  // The guarantee itself: whatever comes out is something decimal.js can add.
  for (const anything of ["$", "1.", "", "abc", ".5", "1.2.3"]) {
    assert.doesNotThrow(() => addHours(hoursForTotal(anything), "1"));
  }
});

test("internal categories split the bucket so the number is actionable", () => {
  // "We lost 73 hours" is useless; "we spent 40 hours pitching and won
  // nothing" is something an owner can do something about.
  assert.ok(INTERNAL_TIME_CATEGORIES.length >= 4);
  assert.ok(INTERNAL_TIME_CATEGORIES.some((c) => /pitch/i.test(c)));
  assert.ok(INTERNAL_TIME_CATEGORIES.some((c) => /rework/i.test(c)));
  // Names are unique — they become rows in the shared category tree.
  assert.equal(new Set(INTERNAL_TIME_CATEGORIES).size, INTERNAL_TIME_CATEGORIES.length);
});

test("guards reject junk across every vocabulary", () => {
  const guards = [isTimeTargetType, isWorkType, isTeamCostType, isEngagementStatus, isAgreedPeriod, isTimeEntrySource];
  for (const guard of guards) {
    for (const junk of [null, undefined, 42, "", "CLIENT", {}, []]) {
      assert.equal(guard(junk), false);
    }
  }
  assert.equal(isTimeTargetType("client"), true);
  assert.equal(isWorkType("rework"), true);
  assert.equal(isTeamCostType("contractor"), true);
  assert.equal(isAgreedPeriod("monthly"), true);
  assert.equal(isTimeEntrySource("csv_import"), true);
});

test("every value the owner can see has plain English behind it", () => {
  const pairs = [
    [TIME_TARGET_TYPES, TIME_TARGET_LABELS],
    [WORK_TYPES, WORK_TYPE_LABELS],
    [TEAM_COST_TYPES, TEAM_COST_TYPE_LABELS],
    [ENGAGEMENT_STATUSES, ENGAGEMENT_STATUS_LABELS],
    [AGREED_PERIODS, AGREED_PERIOD_LABELS],
  ] as const;

  for (const [values, labels] of pairs) {
    for (const value of values) {
      const label = (labels as Record<string, string>)[value];
      assert.ok(label, `${value} needs a label`);
      // The product promise: no backend vocabulary on screen.
      assert.ok(!label.includes("_"), `"${label}" leaks the enum key`);
    }
  }
});

test("a period total is judged differently from one day's cell", () => {
  // "Roughly 80 hours in July" is ordinary, and must not trip the 24-hour cap
  // that guards a single day's entry.
  assert.equal(checkHoursTotal("80"), null);
  assert.equal(isValidHours("80"), false, "the per-DAY rule still rejects it, correctly");
  for (const good of ["1", "7.5", "0.25", "160", "24"]) {
    assert.equal(checkHoursTotal(good), null, `${good} is a fine total`);
  }
  // An empty box is not yet a mistake.
  assert.equal(checkHoursTotal(""), null);
  assert.equal(checkHoursTotal("   "), null);
  // These are what used to grey the button out with no explanation.
  for (const junk of ["$", "abc", "1.2.3", "-5", ".", "1e3"]) {
    assert.equal(checkHoursTotal(junk), "not_a_number", `${junk} is not a number`);
  }
  assert.equal(checkHoursTotal("0"), "not_positive");
  assert.equal(checkHoursTotal("0.0"), "not_positive");
});
