import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_RETENTION_PCT,
  buildRetentionSplit,
  describeRetention,
  retentionReconciles,
} from "./retention";

const money = (cents: number) => `Rs ${(cents / 100).toFixed(2)}`;

test("ten percent held back splits a million into nine hundred thousand and a hundred thousand", () => {
  const split = buildRetentionSplit(1_000_000, "10");
  assert.equal(split.nowCents, 900_000);
  assert.equal(split.heldBackCents, 100_000);
});

test("the two parts ALWAYS sum to the bill, whatever the percentage does", () => {
  // The rule that cannot bend. These are two real receivables written to the
  // ledger; a rounding gap between them is money invented or lost, in a place
  // where both rows look perfectly ordinary.
  for (const total of [1_000_000, 999_999, 1, 33_333, 7]) {
    for (const pct of ["10", "5", "12.5", "7.5", "33.33", "0.1"]) {
      const split = buildRetentionSplit(total, pct);
      assert.ok(retentionReconciles(total, split), `${total} at ${pct}%`);
    }
  }
});

test("an awkward percentage lands the odd paisa on the amount due now, not the held-back part", () => {
  // Deliberate: the retention is the figure both sides will check against the
  // contract later, so it gets the clean number and the immediate payment
  // absorbs the remainder.
  const split = buildRetentionSplit(1_000_001, "10");
  assert.equal(split.heldBackCents, 100_000);
  assert.equal(split.nowCents, 900_001);
});

test("zero percent is not a retention at all and is refused", () => {
  // Silently writing one row would be defensible; throwing is better, because
  // a zero here means the caller asked for something they did not mean.
  assert.throws(() => buildRetentionSplit(1_000_000, "0"), RangeError);
});

test("a retention of the whole bill, or more, is refused", () => {
  assert.throws(() => buildRetentionSplit(1_000_000, "100"), RangeError);
  assert.throws(() => buildRetentionSplit(1_000_000, "150"), RangeError);
});

test("a retention above the sane ceiling is refused", () => {
  assert.throws(() => buildRetentionSplit(1_000_000, String(MAX_RETENTION_PCT + 1)), RangeError);
});

test("nonsense percentages are refused rather than coerced", () => {
  assert.throws(() => buildRetentionSplit(1_000_000, "abc"), RangeError);
  assert.throws(() => buildRetentionSplit(1_000_000, "-5"), RangeError);
});

test("a bill of zero cannot carry a retention", () => {
  assert.throws(() => buildRetentionSplit(0, "10"), RangeError);
});

test("a non-integer bill is refused rather than quietly rounded", () => {
  assert.throws(() => buildRetentionSplit(100.5, "10"), TypeError);
});

test("the sentence names both amounts and the word the trade uses", () => {
  const split = buildRetentionSplit(1_000_000, "10");
  const sentence = describeRetention(split, money);
  assert.ok(sentence.includes(money(split.nowCents)), sentence);
  assert.ok(sentence.includes(money(split.heldBackCents)), sentence);
  assert.ok(sentence.toLowerCase().includes("held back"), sentence);
});
