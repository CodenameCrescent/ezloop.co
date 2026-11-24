import test from "node:test";
import assert from "node:assert/strict";
import { bucketForDays } from "./seriesBucket";

test("short windows stay daily, so day-to-day movement is not smoothed away", () => {
  assert.equal(bucketForDays(1), "day");
  assert.equal(bucketForDays(31), "day");
  assert.equal(bucketForDays(92), "day");
});

test("a year is weekly — daily would be 365 points in an 80px box", () => {
  assert.equal(bucketForDays(93), "week");
  assert.equal(bucketForDays(365), "week");
  assert.equal(bucketForDays(400), "week");
});

test("multi-year windows step down to months, then years", () => {
  assert.equal(bucketForDays(401), "month");
  assert.equal(bucketForDays(1100), "month");
  assert.equal(bucketForDays(1101), "year");
  assert.equal(bucketForDays(5000), "year");
});
