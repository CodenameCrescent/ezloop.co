import test from "node:test";
import assert from "node:assert/strict";
import {
  computeChurnRate,
  computeMrr,
  computeMrrMovement,
  computeNetRevenueRetention,
  normalizedMrrCents,
} from "./subscriptions";

test("normalizedMrrCents: intervals normalise to a month", () => {
  assert.equal(normalizedMrrCents(5000, "monthly"), 5000);
  assert.equal(normalizedMrrCents(60000, "yearly"), 5000); // 600/yr → 50/mo
  assert.equal(normalizedMrrCents(15000, "quarterly"), 5000); // 150/qtr → 50/mo
  assert.equal(normalizedMrrCents(1000, "weekly"), 4333); // 10×52/12 = 43.33
  assert.equal(normalizedMrrCents(10000, "monthly", 2), 5000); // every 2 months
});

test("computeMrr: sum across active subs", () => {
  // 50/mo + 50/mo (yearly 600) + 43.33/mo (weekly 10) = 14333
  assert.equal(
    computeMrr([
      { amountCents: 5000, interval: "monthly" },
      { amountCents: 60000, interval: "yearly" },
      { amountCents: 1000, interval: "weekly" },
    ]),
    5000 + 5000 + 4333,
  );
});

/**
 * Movement fixture (all monthly, MRR in cents):
 *   A: existing 5000 → 8000  (expansion +3000)
 *   B: existing 5000 → 3000  (contraction −2000)
 *   C: new this period, ends at 4000  (new +4000)
 *   D: canceled this period, was 6000  (churned −6000)
 *   E: existing 5000 → 5000  (flat, no movement)
 *   net = 4000 + 3000 − 2000 − 6000 = −1000
 */
test("computeMrrMovement: new / expansion / contraction / churned", () => {
  const m = computeMrrMovement([
    { mrrBeforeCents: 5000, mrrAfterCents: 8000, startedInPeriod: false, canceledInPeriod: false },
    { mrrBeforeCents: 5000, mrrAfterCents: 3000, startedInPeriod: false, canceledInPeriod: false },
    { mrrBeforeCents: 0, mrrAfterCents: 4000, startedInPeriod: true, canceledInPeriod: false },
    { mrrBeforeCents: 6000, mrrAfterCents: 0, startedInPeriod: false, canceledInPeriod: true },
    { mrrBeforeCents: 5000, mrrAfterCents: 5000, startedInPeriod: false, canceledInPeriod: false },
  ]);
  assert.equal(m.newMrrCents, 4000);
  assert.equal(m.expansionCents, 3000);
  assert.equal(m.contractionCents, -2000);
  assert.equal(m.churnedCents, -6000);
  assert.equal(m.netCents, -1000);
});

test("computeChurnRate: canceled ÷ active-at-start", () => {
  const c = computeChurnRate(50, 2);
  assert.equal(c.churnedCount, 2);
  assert.equal(c.ratePct, 4); // 2/50 = 4%
  assert.equal(computeChurnRate(0, 0).ratePct, 0);
});

test("computeNetRevenueRetention: starting cohort MRR evolution, excludes new", () => {
  // Start 20000; expansion +3000, contraction −2000, churned −6000 → retained 15000 → 75%.
  const nrr = computeNetRevenueRetention(20000, {
    newMrrCents: 4000,
    expansionCents: 3000,
    contractionCents: -2000,
    churnedCents: -6000,
    netCents: -1000,
  });
  assert.equal(nrr, 75);
});
