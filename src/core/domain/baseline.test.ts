import test from "node:test";
import assert from "node:assert/strict";
import {
  MIN_BASELINE_SAMPLES,
  compareCentsToBaseline,
  compareToBaseline,
  computeBaseline,
  excessAboveNormalCents,
  normalPhrase,
} from "./baseline";

test("a short history has no normal, and says which kind of short", () => {
  assert.deepEqual(computeBaseline([]), {
    normal: null,
    deviation: null,
    sampleSize: 0,
    reason: "no_history",
  });

  const three = computeBaseline([100, 120, 110]);
  assert.equal(three.reason, "too_few_periods");
  assert.equal(three.normal, null, "no normal is invented from three periods");
  assert.equal(three.sampleSize, 3);

  assert.equal(MIN_BASELINE_SAMPLES, 4);
});

test("normal is the median, and deviation is the median distance from it", () => {
  // Sorted: 100 110 120 130 140 → median 120.
  // Distances: 20 10 0 10 20 → sorted 0 10 10 20 20 → median 10.
  const b = computeBaseline([130, 100, 140, 110, 120]);
  assert.equal(b.reason, "ok");
  assert.equal(b.normal, 120);
  assert.equal(b.deviation, 10);
  assert.equal(b.sampleSize, 5);
});

test("an even history takes the midpoint, rounded half-up so it stays an integer", () => {
  // Sorted: 100 101 → midpoint 100.5 → 101.
  const b = computeBaseline([100, 101, 100, 101]);
  assert.equal(b.normal, 101);
  assert.ok(Number.isInteger(b.normal!), "a normal is never fractional");
});

test("one catastrophic period does not become the new normal", () => {
  // The whole reason for median over mean: a single disaster must stay visible
  // as a disaster, not raise the bar so the next one reads as fine.
  const steady = [100, 105, 95, 100, 102];
  const withDisaster = [...steady, 5_000];

  const a = computeBaseline(steady);
  const b = computeBaseline(withDisaster);

  assert.equal(a.normal, 100);
  assert.equal(b.normal, 101, "the median barely moves");

  const mean = withDisaster.reduce((s, v) => s + v, 0) / withDisaster.length;
  assert.ok(mean > 900, "a mean would have been dragged to ~900 and hidden the next spike");
});

test("a perfectly steady history does not make every wobble unusual", () => {
  // Deviation would be 0 here, and without a floor everything is infinitely
  // far from normal — the steadier the business, the noisier the app.
  const flat = [100, 100, 100, 100, 100];

  const noFloor = compareToBaseline(101, computeBaseline(flat));
  assert.equal(noFloor.isUnusual, true, "with no floor even +1 fires");

  const floored = compareToBaseline(101, computeBaseline(flat, { floor: 20 }), { floor: 20 });
  assert.equal(floored.isUnusual, false, "a floor absorbs movement too small to care about");

  const real = compareToBaseline(200, computeBaseline(flat, { floor: 20 }), { floor: 20 });
  assert.equal(real.isUnusual, true, "and still lets a real jump through");
});

test("tolerance is a multiple of the deviation, and defaults to conservative", () => {
  const history = [100, 110, 120, 130, 140]; // normal 120, deviation 10
  const baseline = computeBaseline(history);

  // Default tolerance 3 → allowed band is ±30.
  assert.equal(compareToBaseline(149, baseline).isUnusual, false, "29 past normal is inside the band");
  assert.equal(compareToBaseline(151, baseline).isUnusual, true, "31 past normal is outside it");

  // A caller who wants to hear more can say so.
  assert.equal(compareToBaseline(135, baseline, { tolerance: 1 }).isUnusual, true);
});

test("direction and excess describe the gap, and excess is the gap not the value", () => {
  const baseline = computeBaseline([100, 100, 100, 100], { floor: 5 });

  const high = compareToBaseline(180, baseline, { floor: 5 });
  assert.equal(high.direction, "above");
  assert.equal(high.excess, 80, "the excess is 80 past normal, not the whole 180");

  const low = compareToBaseline(40, baseline, { floor: 5 });
  assert.equal(low.direction, "below");
  assert.equal(low.excess, -60);

  const exact = compareToBaseline(100, baseline, { floor: 5 });
  assert.equal(exact.direction, null);
  assert.equal(exact.excess, 0);
});

test("no normal means not unusual and a NULL excess — never a zero to mistake for one", () => {
  const c = compareToBaseline(9_999, computeBaseline([100, 200]));
  assert.equal(c.baseline.reason, "too_few_periods");
  assert.equal(c.isUnusual, false, "a huge value cannot be judged without a normal");
  assert.equal(c.excess, null, "null, so a rule cannot read it as 'nothing above normal'");
  assert.equal(c.direction, null);
});

test("only the amount ABOVE normal is treated as recoverable", () => {
  const baseline = computeBaseline([1_000_00, 1_000_00, 1_000_00, 1_000_00], { floor: 10_00 });

  // Refunds of 1,500 against a normal of 1,000: the leak is 500, not 1,500.
  const over = compareToBaseline(1_500_00, baseline, { floor: 10_00 });
  assert.equal(excessAboveNormalCents(over), 500_00);

  // Refunds at normal are not a leak, they are running a shop.
  const at = compareToBaseline(1_000_00, baseline, { floor: 10_00 });
  assert.equal(excessAboveNormalCents(at), 0);

  const under = compareToBaseline(400_00, baseline, { floor: 10_00 });
  assert.equal(excessAboveNormalCents(under), 0);

  // And with no normal there is nothing to call excess.
  const unknown = compareToBaseline(9_999_00, computeBaseline([1_00]));
  assert.equal(excessAboveNormalCents(unknown), 0);
});

test("the money form rejects fractional cents on the value and on the history", () => {
  assert.throws(() => compareCentsToBaseline(10.5, [100, 100, 100, 100]), /compareCentsToBaseline/);
  assert.throws(() => compareCentsToBaseline(100, [100, 100.25, 100, 100]), /history/);

  const ok = compareCentsToBaseline(300_00, [100_00, 100_00, 100_00, 100_00], { floor: 5_00 });
  assert.equal(ok.baseline.normal, 100_00);
  assert.equal(ok.isUnusual, true);
});

test("the normal only speaks when there is one", () => {
  const fmt = (v: number) => `Rs ${(v / 100).toFixed(0)}`;

  assert.equal(normalPhrase(computeBaseline([100_00, 100_00, 100_00, 100_00]), fmt), "normally Rs 100");
  assert.equal(
    normalPhrase(computeBaseline([100_00]), fmt),
    null,
    "so the caller writes a sentence that doesn't claim a normal, rather than an empty clause",
  );

  // A normal of zero is real, but "normally Rs 0" reads like a broken template.
  assert.equal(normalPhrase(computeBaseline([0, 0, 0, 0]), fmt), "and you normally have none");
});
