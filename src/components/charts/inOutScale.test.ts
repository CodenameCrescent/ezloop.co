import test from "node:test";
import assert from "node:assert/strict";
import { inOutFractions } from "./inOutScale";

/**
 * Both directions share ONE scale.
 *
 * Scaling each side to its own biggest value would draw a Rs 100 cost as tall
 * as a Rs 200 sale, and the graph would say the opposite of the truth.
 */

test("money in and money out are measured against the same tallest bar", () => {
  const { max, rows } = inOutFractions([
    { inCents: 200_00, outCents: 0 },
    { inCents: 0, outCents: 100_00 },
  ]);
  assert.equal(max, 200_00);
  assert.equal(rows[0].inFraction, 1);
  assert.equal(rows[0].outFraction, 0);
  assert.equal(rows[1].inFraction, 0);
  assert.equal(rows[1].outFraction, 0.5);
});

test("a period where nothing happened draws no bars, and does not divide by zero", () => {
  const { max, rows } = inOutFractions([{ inCents: 0, outCents: 0 }]);
  assert.equal(max, 0);
  assert.equal(rows[0].inFraction, 0);
  assert.equal(rows[0].outFraction, 0);
});

test("a bucket carrying both directions keeps them separate", () => {
  const { rows } = inOutFractions([{ inCents: 400_00, outCents: 100_00 }]);
  assert.equal(rows[0].inFraction, 1);
  assert.equal(rows[0].outFraction, 0.25);
});
