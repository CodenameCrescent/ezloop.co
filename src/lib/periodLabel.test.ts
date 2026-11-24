import test from "node:test";
import assert from "node:assert/strict";
import { formatRangeLabel } from "./periodLabel";

test("a one-day window reads as a date, not as a range", () => {
  const day = new Date(2026, 8, 24);
  assert.equal(formatRangeLabel(day, new Date(2026, 8, 24, 23, 59, 59, 999)), "Sep 24, 2026");
});

test("a range inside one year says the year once, at the end", () => {
  assert.equal(
    formatRangeLabel(new Date(2026, 6, 1), new Date(2026, 8, 24)),
    "Jul 1 to Sep 24, 2026",
  );
});

test("a range crossing a year boundary says both years", () => {
  assert.equal(
    formatRangeLabel(new Date(2025, 11, 1), new Date(2026, 8, 24)),
    "Dec 1, 2025 to Sep 24, 2026",
  );
});

test("an unreadable date renders nothing rather than the words Invalid Date", () => {
  assert.equal(formatRangeLabel(new Date("nonsense"), new Date(2026, 8, 24)), null);
  assert.equal(formatRangeLabel(new Date(2026, 8, 24), new Date("nonsense")), null);
});
