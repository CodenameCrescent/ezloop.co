import test from "node:test";
import assert from "node:assert/strict";
import {
  addCents,
  allocateProportionally,
  formatMoney,
  mulCentsQty,
  percentOfCents,
} from "./money";

test("addCents sums integers and rejects floats", () => {
  assert.equal(addCents(1, 2, 3), 6);
  assert.equal(addCents(), 0);
  assert.equal(addCents(-500, 500), 0);
  assert.throws(() => addCents(1.5), TypeError);
  assert.throws(() => addCents(1, Number.NaN), TypeError);
});

test("mulCentsQty multiplies by decimal-string quantities exactly", () => {
  assert.equal(mulCentsQty(1050, "2.5"), 2625);
  assert.equal(mulCentsQty(1000, "3"), 3000);
  // 333 × 0.5 = 166.5 → half-up → 167
  assert.equal(mulCentsQty(333, "0.5"), 167);
  // 105 × 1.005 = 105.525 → 106 (a float engine would see 105.52499…)
  assert.equal(mulCentsQty(105, "1.005"), 106);
  assert.equal(mulCentsQty(0, "99.99"), 0);
  assert.throws(() => mulCentsQty(10.5, "1"), TypeError);
});

test("percentOfCents applies percentage-point rates with half-up rounding", () => {
  assert.equal(percentOfCents(1000, "17.5"), 175);
  // 101 × 50% = 50.5 → half-up → 51
  assert.equal(percentOfCents(101, "50"), 51);
  assert.equal(percentOfCents(999, "3.333"), 33); // 33.29667 → 33
  assert.equal(percentOfCents(1000, "0"), 0);
  assert.equal(percentOfCents(-1000, "10"), -100);
});

test("formatMoney renders integer cents without float division", () => {
  assert.equal(formatMoney(123456), "1,234.56");
  assert.equal(formatMoney(5), "0.05");
  assert.equal(formatMoney(-50, { symbol: "$" }), "-$0.50");
  assert.equal(formatMoney(100000000, { symbol: "Rs " }), "Rs 1,000,000.00");
  assert.equal(formatMoney(1234, { minorUnitDigits: 0 }), "1,234");
  assert.throws(() => formatMoney(12.34), TypeError);
});

test("allocateProportionally: uneven 3-way split sums exactly to the total", () => {
  const parts = allocateProportionally(100, [1, 1, 1]);
  assert.deepEqual(parts, [34, 33, 33]);
  assert.equal(parts.reduce((a, b) => a + b, 0), 100);

  const weighted = allocateProportionally(101, [3, 2, 1]);
  // exact shares 50.5 / 33.67 / 16.83 — leftover cents go to largest remainders
  assert.deepEqual(weighted, [50, 34, 17]);
  assert.equal(weighted.reduce((a, b) => a + b, 0), 101);
});

test("allocateProportionally: zero weights get nothing; all-zero splits equally", () => {
  assert.deepEqual(allocateProportionally(100, [0, 1]), [0, 100]);
  assert.deepEqual(allocateProportionally(100, [0, 0]), [50, 50]);
  assert.deepEqual(allocateProportionally(101, [0, 0]), [51, 50]);
});

test("allocateProportionally: single line takes the whole total", () => {
  assert.deepEqual(allocateProportionally(999, [7]), [999]);
  assert.deepEqual(allocateProportionally(0, [0]), [0]);
});

test("allocateProportionally: rounding edges never lose or invent cents", () => {
  // 1 cent across 3 lines — exactly one line gets it
  assert.deepEqual(allocateProportionally(1, [1, 1, 1]), [1, 0, 0]);
  // repeating decimals (1/3) still sum exactly
  const thirds = allocateProportionally(200, [1, 1, 1]);
  assert.equal(thirds.reduce((a, b) => a + b, 0), 200);
  // large uneven weights
  const big = allocateProportionally(999999, [17, 5, 13, 41]);
  assert.equal(big.reduce((a, b) => a + b, 0), 999999);
});

test("allocateProportionally: negative totals allocate symmetrically", () => {
  const refund = allocateProportionally(-100, [1, 1, 1]);
  assert.deepEqual(refund, [-34, -33, -33]);
  assert.equal(refund.reduce((a, b) => a + b, 0), -100);
});

test("allocateProportionally: invalid input is rejected", () => {
  assert.throws(() => allocateProportionally(100.5, [1]), TypeError);
  assert.throws(() => allocateProportionally(100, [-1, 2]), RangeError);
  assert.throws(() => allocateProportionally(100, []), RangeError);
  assert.deepEqual(allocateProportionally(0, []), []);
});
