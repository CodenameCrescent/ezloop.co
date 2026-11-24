import test from "node:test";
import assert from "node:assert/strict";
import { formatCents, formatCentsSigned, formatCompactCents, formatCompactNumber } from "./money";

/*
 * The compact formatters exist for axis ticks and hero figures, and they carry
 * one bug fix worth pinning down: the formatter they replace tested
 * `value >= 1_000_000` without taking the absolute value first, so no negative
 * ever matched a branch and a −5M tick printed in full. A loss-making period is
 * exactly when that axis is drawn, so the untested path was the one that
 * mattered.
 */

test("formatCompactNumber: magnitude only, no symbol", () => {
  assert.equal(formatCompactNumber(0), "0");
  assert.equal(formatCompactNumber(50_00), "50");
  assert.equal(formatCompactNumber(999_00), "999");
  assert.equal(formatCompactNumber(1_000_00), "1k");
  assert.equal(formatCompactNumber(45_900_00), "46k");
  assert.equal(formatCompactNumber(8_629_000_00), "8.6M");
});

test("formatCompactNumber: negatives compact too — the bug this replaces", () => {
  assert.equal(formatCompactNumber(-5_000_000_00), "-5M");
  assert.equal(formatCompactNumber(-45_900_00), "-46k");
  assert.equal(formatCompactNumber(-50_00), "-50");
  // The old formatAxisValue returned "-500000000" here, straight through the
  // `>=` tests, because it never took Math.abs.
  assert.notEqual(formatCompactNumber(-5_000_000_00), "-500000000");
});

test("formatCompactNumber: a trailing .0 is noise at axis size", () => {
  assert.equal(formatCompactNumber(8_000_000_00), "8M");
  assert.equal(formatCompactNumber(8_100_000_00), "8.1M");
});

test("formatCompactCents: symbol outside the sign", () => {
  assert.equal(formatCompactCents(8_629_000_00, "Rs"), "Rs 8.6M");
  assert.equal(formatCompactCents(-412_000_00, "Rs"), "-Rs 412k");
  assert.equal(formatCompactCents(1_500_00, "$"), "$ 2k");
});

/*
 * Currency is a LABEL, not a conversion — the settings currency changes the
 * glyph and nothing else, because the server already returns cents in the
 * business's base currency. These two pin that: same number, different symbol.
 */
test("the symbol never changes the number", () => {
  assert.equal(formatCents(500_000_00, "Rs"), "Rs 500,000.00");
  assert.equal(formatCents(500_000_00, "$"), "$ 500,000.00");
  assert.equal(formatCompactNumber(500_000_00), "500k");
});

test("formatCents / formatCentsSigned keep exact cents", () => {
  assert.equal(formatCents(24_654_50, "Rs"), "Rs 24,654.50");
  assert.equal(formatCents(-8_850_00, "Rs"), "-Rs 8,850.00");
  assert.equal(formatCentsSigned(24_654_00, "Rs"), "+Rs 24,654.00");
  assert.equal(formatCentsSigned(-8_850_00, "Rs"), "-Rs 8,850.00");
  assert.equal(formatCentsSigned(0, "Rs"), "Rs 0.00");
});
