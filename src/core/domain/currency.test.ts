import test from "node:test";
import assert from "node:assert/strict";
import { IDENTITY_FX_RATE, assertFxRate, isIdentityRate, isValidFxRate, toBaseCents } from "./currency";

test("a rate of 1 passes amounts through untouched", () => {
  assert.equal(isIdentityRate(IDENTITY_FX_RATE), true);
  assert.equal(toBaseCents(123_45, "1"), 123_45);
  assert.equal(toBaseCents(0, "1"), 0);
  // "1.000" is still one.
  assert.equal(isIdentityRate("1.000"), true);
});

test("converts at the frozen rate, half-up to whole minor units", () => {
  // $100.00 at 280.50 → Rs 28,050.00
  assert.equal(toBaseCents(100_00, "280.5"), 2_805_000);
  // A rate that does not divide evenly rounds half-up.
  assert.equal(toBaseCents(3, "1.5"), 5); // 4.5 → 5
  assert.equal(toBaseCents(1, "0.5"), 1); // 0.5 → 1
});

test("a refund converts to exactly the negation of the sale it reverses", () => {
  // Rounding must be symmetric about zero, or a full refund would leave a
  // stray cent behind and the ladder would never return to zero.
  for (const cents of [3, 7, 12_345, 99_999]) {
    for (const rate of ["1.5", "280.5", "0.337"]) {
      assert.equal(
        toBaseCents(-cents, rate),
        -toBaseCents(cents, rate),
        `${cents} at ${rate} must negate exactly`,
      );
    }
  }
});

test("rates must be positive decimal strings", () => {
  for (const bad of ["0", "-1", "", "abc", "1e5", 280.5, null, undefined, "1,5"]) {
    assert.equal(isValidFxRate(bad), false, `${String(bad)} is not a rate`);
  }
  for (const good of ["1", "0.5", "280.50", "12345.678"]) {
    assert.equal(isValidFxRate(good), true, `${good} is a rate`);
  }
  assert.throws(() => assertFxRate("0"), /positive decimal string/);
  assert.throws(() => toBaseCents(100, "-2"), /positive decimal string/);
});

test("money must still be integer minor units", () => {
  assert.throws(() => toBaseCents(10.5, "1"), /integer in minor units/);
});
