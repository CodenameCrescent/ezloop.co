import test from "node:test";
import assert from "node:assert/strict";
import { detectDelimiter, parseCsv, parseCsvTable, stableHash } from "./csv";

test("plain rows and cells", () => {
  assert.deepEqual(parseCsv("a,b,c\n1,2,3"), [
    ["a", "b", "c"],
    ["1", "2", "3"],
  ]);
});

test("a comma inside a quoted field is not a separator", () => {
  // The single most common way a naive split() ruins a timesheet import.
  assert.deepEqual(parseCsv('name,note\n"Acme, Ltd",hello'), [
    ["name", "note"],
    ["Acme, Ltd", "hello"],
  ]);
});

test("a doubled quote inside a quoted field is one literal quote", () => {
  assert.deepEqual(parseCsv('note\n"He said ""yes"" today"'), [["note"], ['He said "yes" today']]);
});

test("a newline inside a quoted field does not end the row", () => {
  const rows = parseCsv('name,note\n"Acme","line one\nline two"');
  assert.equal(rows.length, 2);
  assert.equal(rows[1][1], "line one\nline two");
});

test("CRLF line endings read as one break, not two", () => {
  // Windows exports are CRLF; treating \r as its own break would produce a
  // blank row between every real one.
  assert.deepEqual(parseCsv("a,b\r\n1,2\r\n3,4"), [
    ["a", "b"],
    ["1", "2"],
    ["3", "4"],
  ]);
});

test("a byte-order mark does not corrupt the first header", () => {
  // Excel writes one, and without stripping it the first column header becomes
  // "﻿User" and never matches a preset.
  const rows = parseCsv("﻿User,Duration\nSara,8");
  assert.equal(rows[0][0], "User");
});

test("blank lines are dropped rather than becoming empty rows", () => {
  // Exports usually end with a newline; an empty row would fail validation for
  // a reason the owner could do nothing about.
  assert.deepEqual(parseCsv("a,b\n1,2\n\n"), [
    ["a", "b"],
    ["1", "2"],
  ]);
});

test("cells are trimmed, because exports pad them inconsistently", () => {
  assert.deepEqual(parseCsv("a , b\n 1 , 2 "), [
    ["a", "b"],
    ["1", "2"],
  ]);
});

test("semicolon and tab delimited files are detected", () => {
  assert.equal(detectDelimiter("a;b;c\n1;2;3"), ";");
  assert.equal(detectDelimiter("a\tb\tc"), "\t");
  assert.equal(detectDelimiter("a,b,c"), ",");
  // A single column has no delimiter to find; comma is the safe default.
  assert.equal(detectDelimiter("onlycolumn"), ",");

  assert.deepEqual(parseCsv("a;b\n1;2"), [
    ["a", "b"],
    ["1", "2"],
  ]);
});

test("a header row plus rows is what an importer actually wants", () => {
  const { headers, rows } = parseCsvTable("User,Duration\nSara,8\nOmar,6");
  assert.deepEqual(headers, ["User", "Duration"]);
  assert.deepEqual(rows, [
    ["Sara", "8"],
    ["Omar", "6"],
  ]);
});

test("an empty file produces nothing rather than throwing", () => {
  assert.deepEqual(parseCsv(""), []);
  assert.deepEqual(parseCsvTable(""), { headers: [], rows: [] });
  assert.deepEqual(parseCsv("\n\n"), []);
});

test("a real Toggl-shaped export parses", () => {
  const csv = [
    "User,Email,Client,Project,Description,Start date,Duration",
    'Sara Khan,sara@x.com,"Acme, Ltd",Website,"Fixed the ""hero"" block",2026-07-27,04:30:00',
    "Omar Ali,omar@x.com,Beta Studio,App,Standup,2026-07-27,01:00:00",
  ].join("\r\n");

  const { headers, rows } = parseCsvTable(csv);
  assert.equal(headers.length, 7);
  assert.equal(rows.length, 2);
  assert.equal(rows[0][2], "Acme, Ltd");
  assert.equal(rows[0][4], 'Fixed the "hero" block');
  assert.equal(rows[0][6], "04:30:00");
});

test("the same content always hashes to the same id, and different content does not", () => {
  // This is what makes a re-import a no-op: identical rows produce identical
  // ids, and the database's unique index refuses the second write.
  assert.equal(stableHash("sara|acme|2026-07-27|8"), stableHash("sara|acme|2026-07-27|8"));
  assert.notEqual(stableHash("sara|acme|2026-07-27|8"), stableHash("sara|acme|2026-07-28|8"));
  assert.notEqual(stableHash("a"), stableHash("b"));
  // Non-empty and URL-safe, since it lands in an external_id column.
  assert.match(stableHash("anything"), /^[0-9a-z]+$/);
});

test("the hash is wide enough that realistic volumes do not collide", () => {
  // At 32 bits, 10,000 entries collide better than 1 time in 100 — and a
  // collision here is one day silently overwriting another.
  const seen = new Set<string>();
  for (let i = 0; i < 50_000; i += 1) seen.add(stableHash(`per_abc|client|c_${i}|2026-07-27|delivery|b`));
  assert.equal(seen.size, 50_000, "50,000 distinct cells, 50,000 distinct ids");
  assert.ok(stableHash("x").length >= 14, "64 bits, not 32");
});
