import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_SPREAD_MONTHS,
  MIN_SPREAD_MONTHS,
  buildSpread,
  describeSpread,
  isCapitalised,
  spreadReconciles,
} from "./spread";

const money = (c: number) =>
  `Rs ${new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Math.abs(c) / 100)}`;

const APRIL = new Date("2026-04-14T10:00:00.000Z");

test("a cost divides evenly when it can", () => {
  const slices = buildSpread(1_200_00, APRIL, 12);
  assert.equal(slices.length, 12);
  assert.ok(slices.every((s) => s.amountCents === 100_00));
  assert.equal(spreadReconciles(1_200_00, slices), true);
});

test("the slices sum EXACTLY to the original, even when it does not divide", () => {
  // The rule that cannot bend. 95,000_00 over 24 does not divide: no money may
  // be invented or lost rounding it.
  const total = 95_000_00;
  const slices = buildSpread(total, APRIL, 24);

  assert.equal(slices.length, 24);
  assert.equal(
    slices.reduce((sum, s) => sum + s.amountCents, 0),
    total,
    "to the cent, not to within a cent",
  );
  assert.equal(spreadReconciles(total, slices), true);

  // Every slice is within one cent of every other — nobody gets a strange month.
  const min = Math.min(...slices.map((s) => s.amountCents));
  const max = Math.max(...slices.map((s) => s.amountCents));
  assert.ok(max - min <= 1, `slices ranged ${min}..${max}`);
});

test("the remainder lands on the EARLIEST months, which is the conservative direction", () => {
  // 100 over 3 → 34, 33, 33. A business that abandons the thing early has
  // already recognised slightly more of it, rather than slightly less.
  const slices = buildSpread(100, APRIL, 3);
  assert.deepEqual(slices.map((s) => s.amountCents), [34, 33, 33]);
  assert.equal(spreadReconciles(100, slices), true);
});

test("a slice belongs to the first of its month, in UTC", () => {
  const slices = buildSpread(1_200_00, APRIL, 4);
  assert.deepEqual(
    slices.map((s) => s.occursAt.toISOString().slice(0, 10)),
    ["2026-04-01", "2026-05-01", "2026-06-01", "2026-07-01"],
    "so a slice never drifts across a month boundary on whatever timezone the server runs in",
  );
  assert.deepEqual(slices.map((s) => s.monthOffset), [0, 1, 2, 3]);
});

test("a spread rolls over the year end without losing a month", () => {
  const november = new Date("2025-11-20T10:00:00.000Z");
  const slices = buildSpread(600_00, november, 4);
  assert.deepEqual(
    slices.map((s) => s.occursAt.toISOString().slice(0, 7)),
    ["2025-11", "2025-12", "2026-01", "2026-02"],
  );
});

test("one month is not a spread, and neither is zero or a fraction", () => {
  for (const months of [1, 0, -3, 2.5]) {
    assert.throws(() => buildSpread(1_000_00, APRIL, months), RangeError, `months=${months}`);
  }
  assert.equal(MIN_SPREAD_MONTHS, 2);
  assert.doesNotThrow(() => buildSpread(1_000_00, APRIL, 2));
});

test("a typo cannot generate a thousand rows", () => {
  assert.doesNotThrow(() => buildSpread(1_000_00, APRIL, MAX_SPREAD_MONTHS));
  assert.throws(() => buildSpread(1_000_00, APRIL, MAX_SPREAD_MONTHS + 1), RangeError);
  assert.equal(MAX_SPREAD_MONTHS, 120);
});

test("fractional cents are refused at the door", () => {
  assert.throws(() => buildSpread(100.5, APRIL, 12), /buildSpread/);
});

test("a zero-cost spread is allowed and still reconciles", () => {
  const slices = buildSpread(0, APRIL, 6);
  assert.equal(slices.length, 6);
  assert.ok(slices.every((s) => s.amountCents === 0));
  assert.equal(spreadReconciles(0, slices), true);
});

test("only a real spread capitalises a line", () => {
  assert.equal(isCapitalised(24), true);
  assert.equal(isCapitalised(2), true);
  assert.equal(isCapitalised(1), false, "a single month is just an ordinary expense");
  assert.equal(isCapitalised(0), false);
  assert.equal(isCapitalised(null), false);
  assert.equal(isCapitalised(undefined), false);
});

test("the description gives the monthly figure, not the arithmetic", () => {
  assert.equal(describeSpread(95_000_00, 24, money), "Rs 3,958.33 a month for 24 months");
  assert.equal(describeSpread(1_200_00, 12, money), "Rs 100.00 a month for 12 months");
});
