import test from "node:test";
import assert from "node:assert/strict";
import {
  GLOBAL_PERIOD_PRESETS,
  globalPeriodLabel,
  parseStoredPeriod,
  serializeStoredPeriod,
  type StoredPeriod,
} from "./globalPeriodState";

test("stored period survives a serialize/parse round-trip", () => {
  const value: StoredPeriod = { preset: "custom", fromDate: "2026-01-01", toDate: "2026-03-31" };
  assert.deepEqual(parseStoredPeriod(serializeStoredPeriod(value)), value);
});

test("corrupt or invalid stored values fall back to null (provider then defaults to Today)", () => {
  assert.equal(parseStoredPeriod(null), null);
  assert.equal(parseStoredPeriod(""), null);
  assert.equal(parseStoredPeriod("not json"), null);
  assert.equal(parseStoredPeriod("{}"), null);
  // Unknown preset (e.g. a since-removed option) is rejected rather than trusted.
  assert.equal(parseStoredPeriod(JSON.stringify({ preset: "last-3-months", fromDate: "2026-01-01", toDate: "2026-01-31" })), null);
  // Malformed dates and inverted ranges are rejected.
  assert.equal(parseStoredPeriod(JSON.stringify({ preset: "custom", fromDate: "01/01/2026", toDate: "2026-01-31" })), null);
  assert.equal(parseStoredPeriod(JSON.stringify({ preset: "custom", fromDate: "2026-02-01", toDate: "2026-01-01" })), null);
});

test("preset labels use human wording, including This Year for ytd", () => {
  const labels = new Map(GLOBAL_PERIOD_PRESETS.map((item) => [item.value, item.label]));
  assert.equal(labels.get("today"), "Today");
  assert.equal(labels.get("this-month"), "This Month");
  assert.equal(labels.get("last-month"), "Last Month");
  assert.equal(labels.get("ytd"), "This Year");
  assert.equal(labels.get("custom"), "Custom");
  assert.equal(globalPeriodLabel("ytd"), "This Year");
  assert.equal(GLOBAL_PERIOD_PRESETS[0].value, "today");
});
