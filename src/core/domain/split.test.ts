import test from "node:test";
import assert from "node:assert/strict";
import {
  buildSplit,
  describeSplit,
  MAX_SPLIT_PARTS,
  splitReconciles,
  splitTargetKey,
  type SplitPart,
} from "./split";

const part = (id: string, weight: string): SplitPart => ({ targetType: "client", targetId: id, weight });

test("an even split of an even amount is boring, and must stay boring", () => {
  const shares = buildSplit(30_000_00, [part("acme", "50"), part("belmont", "50")]);
  assert.deepEqual(shares.map((s) => s.amountCents), [15_000_00, 15_000_00]);
  assert.ok(splitReconciles(30_000_00, shares));
});

test("percentages that are not equal land where they were asked to", () => {
  const shares = buildSplit(30_000_00, [
    part("acme", "50"),
    part("belmont", "30"),
    part("internal", "20"),
  ]);
  assert.deepEqual(shares.map((s) => s.amountCents), [15_000_00, 9_000_00, 6_000_00]);
  assert.ok(splitReconciles(30_000_00, shares));
});

test("a third each — the split that has no exact answer — still adds back to the bill", () => {
  // 10,000 / 3 = 3,333.33... There is no way to give three people an equal
  // third of Rs 100.00 in whole paisa. The point is not that each part is
  // right; it is that no paisa is invented or lost.
  const shares = buildSplit(100_00, [part("a", "1"), part("b", "1"), part("c", "1")]);
  assert.equal(shares.reduce((sum, s) => sum + s.amountCents, 0), 100_00);
  assert.ok(splitReconciles(100_00, shares));
  // The odd paisa go to the earliest parts, so the list reads high-to-low
  // rather than ending on a stray extra.
  assert.deepEqual(shares.map((s) => s.amountCents), [3334, 3333, 3333]);
});

test("weights are relative, so 50/30/20 and 5/3/2 mean the same thing", () => {
  const percent = buildSplit(30_000_00, [part("a", "50"), part("b", "30"), part("c", "20")]);
  const ratio = buildSplit(30_000_00, [part("a", "5"), part("b", "3"), part("c", "2")]);
  assert.deepEqual(
    percent.map((s) => s.amountCents),
    ratio.map((s) => s.amountCents),
  );
});

test("weights that do not add to 100 are honoured as a ratio, not rejected", () => {
  // Someone types 33.33 three times. Insisting on exactly 100 would refuse a
  // perfectly clear instruction over a rounding artefact of the owner's own
  // arithmetic.
  const shares = buildSplit(90_000_00, [part("a", "33.33"), part("b", "33.33"), part("c", "33.33")]);
  assert.equal(shares.reduce((sum, s) => sum + s.amountCents, 0), 90_000_00);
  assert.deepEqual(shares.map((s) => s.amountCents), [30_000_00, 30_000_00, 30_000_00]);
});

test("fractional weights keep the precision they were typed at", () => {
  // 60/40 expressed awkwardly. If weights were rounded to whole numbers before
  // allocating, "0.6"/"0.4" would both become 1 and this would split evenly.
  const shares = buildSplit(1_000_00, [part("a", "0.6"), part("b", "0.4")]);
  assert.deepEqual(shares.map((s) => s.amountCents), [60_000, 40_000]);
});

test("an amount that cannot divide cleanly by weight still reconciles", () => {
  for (const total of [1, 7, 99, 100_01, 33_333_33, 9_999_999]) {
    const shares = buildSplit(total, [part("a", "7"), part("b", "11"), part("c", "13")]);
    assert.ok(splitReconciles(total, shares), `Rs ${total / 100} did not reconcile`);
  }
});

test("a refund of a split bill splits the same way, negatives included", () => {
  const shares = buildSplit(-30_000_00, [part("acme", "50"), part("belmont", "30"), part("c", "20")]);
  assert.deepEqual(shares.map((s) => s.amountCents), [-15_000_00, -9_000_00, -6_000_00]);
  assert.ok(splitReconciles(-30_000_00, shares));
});

test("the parts carry their own targets through untouched", () => {
  const shares = buildSplit(10_000_00, [
    { targetType: "client", targetId: "acme", weight: "1" },
    { targetType: "revenue_item", targetId: "mug", weight: "1" },
  ]);
  assert.equal(shares[0].targetType, "client");
  assert.equal(shares[1].targetType, "revenue_item");
  assert.equal(splitTargetKey(shares[1]), "revenue_item:mug");
});

test("what a split refuses to be", () => {
  // One part is not a split — target the line instead.
  assert.throws(() => buildSplit(100_00, [part("a", "100")]), RangeError);
  assert.throws(() => buildSplit(100_00, []), RangeError);

  // The same client twice hides a mis-pick rather than expressing anything.
  assert.throws(() => buildSplit(100_00, [part("a", "50"), part("a", "50")]), /twice/);

  // A zero or negative share is not a share.
  assert.throws(() => buildSplit(100_00, [part("a", "0"), part("b", "100")]), /greater than zero/);
  assert.throws(() => buildSplit(100_00, [part("a", "-10"), part("b", "100")]), /greater than zero/);

  // Nonsense weights, and a missing target.
  assert.throws(() => buildSplit(100_00, [part("a", "half"), part("b", "50")]), /not a number/);
  assert.throws(() => buildSplit(100_00, [part("", "50"), part("b", "50")]), /needs a target/);

  // A cap, so a paste accident cannot write hundreds of lines.
  const many = Array.from({ length: MAX_SPLIT_PARTS + 1 }, (_, i) => part(`c${i}`, "1"));
  assert.throws(() => buildSplit(100_00, many), RangeError);

  // Money is integers. A rupee figure that slipped through unconverted must
  // not be quietly split into fractional paisa.
  assert.throws(() => buildSplit(100.5, [part("a", "1"), part("b", "1")]), /minor units/);
});

test("the description says it in money, because months and percentages are not what was spent", () => {
  const shares = buildSplit(30_000_00, [part("acme", "50"), part("belmont", "50")]);
  const names: Record<string, string> = { acme: "Acme", belmont: "Belmont & Co" };
  const sentence = describeSplit(
    30_000_00,
    shares,
    (p) => names[p.targetId],
    (c) => `Rs ${(c / 100).toFixed(2)}`,
  );
  assert.equal(sentence, "Rs 30000.00 split 2 ways — Acme Rs 15000.00, Belmont & Co Rs 15000.00.");
});
