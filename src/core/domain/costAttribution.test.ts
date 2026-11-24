import test from "node:test";
import assert from "node:assert/strict";
import {
  attributionReconciles,
  classifyCostLine,
  isFullyAttributed,
  totalCostAttribution,
  type AttributionLine,
} from "./costAttribution";

const line = (over: Partial<AttributionLine & { spendCents: number }> = {}) => ({
  targeted: false,
  costNature: "variable" as const,
  spendCents: 1_000_00,
  ...over,
});

test("a cost that named someone is targeted, whatever its nature", () => {
  assert.equal(classifyCostLine(line({ targeted: true })), "targeted");
  assert.equal(classifyCostLine(line({ targeted: true, costNature: "fixed" })), "targeted");
});

test("variable and unclassified costs could have named someone", () => {
  assert.equal(classifyCostLine(line({ costNature: "variable" })), "splittable");
  // Unknown is NOT quietly filed under overhead — it is the state most worth
  // looking at, so it lands in the pool that is expected to reach zero.
  assert.equal(classifyCostLine(line({ costNature: null })), "splittable");
});

test("overheads and unpointable fees are never split, on purpose", () => {
  assert.equal(classifyCostLine(line({ costNature: "fixed" })), "never_split");
  // Semi-variable sits with fixed, exactly as break-even treats it.
  assert.equal(classifyCostLine(line({ costNature: "semi_variable" })), "never_split");
  // A chargeback fee is a real period expense that can never carry a target.
  assert.equal(classifyCostLine(line({ isAdjustmentFee: true })), "never_split");
  // A cost booked against a sale belongs to that job; the ledger refuses to
  // target it, so reporting it as "you forgot to" would be a lie.
  assert.equal(classifyCostLine(line({ insideSale: true })), "never_split");
});

test("the three buckets total the period", () => {
  const totals = totalCostAttribution([
    line({ targeted: true, spendCents: 30_000_00 }),
    line({ costNature: "variable", spendCents: 35_352_47 }),
    line({ costNature: "fixed", spendCents: 207_458_34 }),
    line({ isAdjustmentFee: true, spendCents: 2_500_00 }),
  ]);
  assert.equal(totals.targetedCents, 30_000_00);
  assert.equal(totals.untargetedSplittableCents, 35_352_47);
  assert.equal(totals.neverSplitCents, 207_458_34 + 2_500_00);
  assert.ok(attributionReconciles(totals, 30_000_00 + 35_352_47 + 207_458_34 + 2_500_00));
});

test("the gate ignores overheads entirely — otherwise it could never open", () => {
  // A real business carries rent and wages every month. If those counted, the
  // "fully attributed" state would be unreachable and the caveat would show
  // forever, which is the same as showing nothing.
  const totals = totalCostAttribution([
    line({ targeted: true, spendCents: 30_000_00 }),
    line({ costNature: "fixed", spendCents: 207_458_34 }),
    line({ isAdjustmentFee: true, spendCents: 2_500_00 }),
  ]);
  assert.ok(isFullyAttributed(totals), "rent and a chargeback fee do not make the page uncertain");
});

test("one splittable cost naming nobody closes the gate", () => {
  const totals = totalCostAttribution([
    line({ targeted: true, spendCents: 30_000_00 }),
    line({ costNature: "variable", spendCents: 1 }),
  ]);
  assert.equal(isFullyAttributed(totals), false, "a single paisa is still an unanswered question");
});

test("a period with no costs at all is fully attributed, not uncertain", () => {
  const totals = totalCostAttribution([]);
  assert.ok(isFullyAttributed(totals));
  assert.ok(attributionReconciles(totals, 0));
  // Nothing to attribute is the honest zero the whole gate exists to protect:
  // a client really did cost nothing beyond labour that period.
  assert.deepEqual(totals, { targetedCents: 0, untargetedSplittableCents: 0, neverSplitCents: 0 });
});

test("reconciliation catches a cost that fell out of every bucket", () => {
  const totals = totalCostAttribution([line({ targeted: true, spendCents: 30_000_00 })]);
  // The ladder saw a Rs 2,500 chargeback fee this bucketing missed — which is
  // exactly the bug this guard found when it was first written.
  assert.equal(attributionReconciles(totals, 30_000_00 + 2_500_00), false);
});

test("money must be integers here too", () => {
  assert.throws(() => totalCostAttribution([line({ spendCents: 100.5 })]), /minor units/);
});
