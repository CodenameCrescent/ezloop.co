import test from "node:test";
import assert from "node:assert/strict";
import {
  aggregateImportRows,
  detectPreset,
  importExternalId,
  parseDuration,
  parseImportDate,
  parseTimeImport,
  suggestMapping,
  type ResolvedImportRow,
} from "./timeImport";

const TOGGL = [
  "User,Email,Client,Project,Description,Start date,Duration,Billable,Tags",
  "Sara Khan,sara@x.com,Acme Corp,Website,Hero block,2026-07-27,04:30:00,Yes,",
  "Sara Khan,sara@x.com,Acme Corp,Website,Fixing the brief again,2026-07-28,02:00:00,Yes,rework",
  "Omar Ali,omar@x.com,Beta Studio,App,Standup,2026-07-27,01:00:00,No,admin",
].join("\n");

const CLOCKIFY = [
  "Project,Client,Description,User,Start Date,Duration (decimal),Billable",
  "Website,Acme Corp,Hero block,Sara Khan,27/07/2026,4.5,Yes",
].join("\n");

test("a Toggl export is recognised and mapped without being told", () => {
  const result = parseTimeImport(TOGGL);
  assert.equal(result.preset, "toggl");
  assert.equal(result.mapping.person, "User");
  assert.equal(result.mapping.duration, "Duration");
  assert.equal(result.rows.length, 3);
  assert.deepEqual(result.problems, []);

  const [first] = result.rows;
  assert.equal(first.personName, "Sara Khan");
  assert.equal(first.targetName, "Acme Corp");
  assert.equal(first.entryDate, "2026-07-27");
  assert.equal(first.hours, "4.5"); // 04:30:00
  assert.equal(first.billable, true);
  assert.equal(first.workType, "delivery");
});

test("a Clockify export is recognised, including its decimal duration and DD/MM date", () => {
  const result = parseTimeImport(CLOCKIFY);
  assert.equal(result.preset, "clockify");
  assert.equal(result.mapping.duration, "Duration (decimal)");
  assert.equal(result.rows[0].hours, "4.5");
  assert.equal(result.rows[0].entryDate, "2026-07-27");
});

test("tags become work types, so rework survives the import", () => {
  // rework is the leading indicator of a bad client; losing it at the import
  // boundary would make the whole measure useless for anyone importing.
  const result = parseTimeImport(TOGGL);
  assert.equal(result.rows[1].workType, "rework");
  assert.equal(result.rows[2].workType, "admin");
  assert.equal(result.rows[2].billable, false);
});

test("durations parse from clock time or decimal, and refuse anything else", () => {
  assert.equal(parseDuration("07:30:00"), "7.5");
  assert.equal(parseDuration("01:15"), "1.25");
  assert.equal(parseDuration("7.5"), "7.5");
  assert.equal(parseDuration("7,5"), "7.5"); // European decimal comma
  assert.equal(parseDuration("0"), "0");
  for (const bad of ["", "abc", "7h30", "-2"]) {
    assert.equal(parseDuration(bad), null, `${bad} should not parse`);
  }
});

test("dates parse from ISO or DD/MM/YYYY, and refuse anything else", () => {
  assert.equal(parseImportDate("2026-07-27"), "2026-07-27");
  assert.equal(parseImportDate("2026-07-27 09:00:00"), "2026-07-27");
  assert.equal(parseImportDate("27/07/2026"), "2026-07-27");
  assert.equal(parseImportDate("7/7/2026"), "2026-07-07");
  for (const bad of ["", "27 July 2026", "not a date"]) {
    assert.equal(parseImportDate(bad), null);
  }
});

test("a bad row is reported with its line number and the good rows still import", () => {
  // One error must not cost the owner the whole file.
  const csv = [
    "User,Client,Start date,Duration",
    "Sara Khan,Acme Corp,2026-07-27,04:00:00",
    "Sara Khan,Acme Corp,not-a-date,04:00:00",
    ",Acme Corp,2026-07-28,04:00:00",
    "Omar Ali,,2026-07-28,04:00:00",
    "Omar Ali,Acme Corp,2026-07-29,banana",
    "Omar Ali,Acme Corp,2026-07-30,02:00:00",
  ].join("\n");

  const result = parseTimeImport(csv);
  assert.equal(result.rows.length, 2, "both good rows survive");
  assert.equal(result.problems.length, 4);
  assert.deepEqual(result.problems.map((p) => p.lineNumber), [3, 4, 5, 6]);
  assert.match(result.problems[0].reason, /date/i);
  assert.match(result.problems[1].reason, /person/i);
  assert.match(result.problems[2].reason, /client|project/i);
  assert.match(result.problems[3].reason, /duration/i);
});

test("a zero-length entry is skipped silently, not reported as broken", () => {
  // Exports are full of these and there is nothing for the owner to fix.
  const csv = ["User,Client,Start date,Duration", "Sara,Acme,2026-07-27,00:00:00"].join("\n");
  const result = parseTimeImport(csv);
  assert.equal(result.rows.length, 0);
  assert.deepEqual(result.problems, []);
});

test("an impossible day is reported rather than imported", () => {
  const csv = ["User,Client,Start date,Duration", "Sara,Acme,2026-07-27,30:00:00"].join("\n");
  const result = parseTimeImport(csv);
  assert.equal(result.rows.length, 0);
  assert.match(result.problems[0].reason, /not a possible day/i);
});

test("an unrecognised file asks which columns to use instead of guessing", () => {
  const csv = ["Who,What,When,HowLong", "Sara,Acme,2026-07-27,4"].join("\n");
  const result = parseTimeImport(csv);
  assert.equal(result.preset, "custom");
  assert.equal(result.rows.length, 0);
  assert.match(result.problems[0].reason, /which column/i);

  // And once told, the same file imports.
  const mapped = parseTimeImport(csv, { person: "Who", target: "What", date: "When", duration: "HowLong" });
  assert.equal(mapped.rows.length, 1);
  assert.equal(mapped.rows[0].hours, "4");
});

test("an empty file says so rather than importing nothing quietly", () => {
  const result = parseTimeImport("");
  assert.match(result.problems[0].reason, /empty/i);
});

/** A resolved row, as the server hands them to the aggregator. */
const resolved = (over: Partial<ResolvedImportRow> = {}): ResolvedImportRow => ({
  lineNumber: 2,
  personName: "Sara Khan",
  targetName: "Acme Corp",
  entryDate: "2026-07-27",
  hours: "2",
  billable: true,
  workType: "delivery",
  description: "",
  personId: "p_sara",
  targetType: "client",
  targetId: "c_acme",
  ...over,
});

test("several timer rows on one day become one cell, summed exactly", () => {
  // Toggl exports a row per started timer. Writing them all would show the grid
  // one figure and hand profitability another.
  const cells = aggregateImportRows([
    resolved({ lineNumber: 2, hours: "2" }),
    resolved({ lineNumber: 3, hours: "1.5" }),
    resolved({ lineNumber: 4, hours: "0.25" }),
  ]);

  assert.equal(cells.length, 1);
  assert.equal(cells[0].hours, "3.75");
  assert.deepEqual(cells[0].lineNumbers, [2, 3, 4]);
});

test("rework is not folded into the day's delivery total", () => {
  // The single most useful thing an import carries; averaging it away at the
  // boundary would destroy the measure Phase 6 is built on.
  const cells = aggregateImportRows([
    resolved({ hours: "6", workType: "delivery" }),
    resolved({ hours: "2", workType: "rework" }),
  ]);

  assert.equal(cells.length, 2);
  assert.equal(cells.find((c) => c.workType === "rework")!.hours, "2");
  assert.equal(cells.find((c) => c.workType === "delivery")!.hours, "6");
  assert.notEqual(cells[0].externalId, cells[1].externalId);
});

test("billable and non-billable hours on one day stay apart", () => {
  const cells = aggregateImportRows([resolved({ hours: "6" }), resolved({ hours: "1", billable: false })]);
  assert.equal(cells.length, 2);
});

test("different days, people and clients are different cells", () => {
  const cells = aggregateImportRows([
    resolved(),
    resolved({ entryDate: "2026-07-28" }),
    resolved({ personId: "p_omar" }),
    resolved({ targetId: "c_beta" }),
  ]);
  assert.equal(cells.length, 4);
  assert.equal(new Set(cells.map((c) => c.externalId)).size, 4);
});

test("descriptions are kept and de-duplicated, not multiplied", () => {
  const cells = aggregateImportRows([
    resolved({ description: "Hero block" }),
    resolved({ description: "Hero block" }),
    resolved({ description: "Nav bar" }),
  ]);
  assert.equal(cells[0].note, "Hero block; Nav bar");
});

test("the id identifies the CELL, so a corrected day updates instead of doubling", () => {
  // The trap this design exists to avoid: hash the row's content and a fixed
  // day hashes differently, lands beside the old one, and counts twice.
  const monday = aggregateImportRows([resolved({ hours: "4" })])[0];
  const mondayFixed = aggregateImportRows([resolved({ hours: "6", description: "and the rest" })])[0];
  assert.equal(monday.externalId, mondayFixed.externalId, "same cell, whatever the hours");

  const tuesday = aggregateImportRows([resolved({ entryDate: "2026-07-28" })])[0];
  assert.notEqual(monday.externalId, tuesday.externalId);
});

test("row order in the file does not change any id", () => {
  const forwards = aggregateImportRows([resolved({ hours: "2" }), resolved({ entryDate: "2026-07-28", hours: "3" })]);
  const backwards = aggregateImportRows([resolved({ entryDate: "2026-07-28", hours: "3" }), resolved({ hours: "2" })]);
  assert.deepEqual(forwards.map((c) => c.externalId).sort(), backwards.map((c) => c.externalId).sort());
});

test("importExternalId is stable across calls and non-empty", () => {
  const cell = {
    personId: "p_sara",
    targetType: "client" as const,
    targetId: "c_acme",
    entryDate: "2026-07-27",
    workType: "delivery" as const,
    billable: true,
  };
  assert.equal(importExternalId(cell), importExternalId(cell));
  assert.match(importExternalId(cell), /^csv_[0-9a-z]+$/);
});

test("nothing to aggregate produces nothing", () => {
  assert.deepEqual(aggregateImportRows([]), []);
});

test("preset detection and suggested mapping degrade to 'custom' rather than misfiring", () => {
  assert.equal(detectPreset([]), "custom");
  assert.equal(detectPreset(["Nope", "Nothing"]), "custom");
  assert.deepEqual(suggestMapping(["Nope"], "custom"), {});
  assert.equal(suggestMapping(["User", "Client", "Start date", "Duration"], "toggl").person, "User");
});
