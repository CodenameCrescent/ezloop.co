import test from "node:test";
import assert from "node:assert/strict";
import { buildCohortGrid, buildRetentionGrid, computeRepeatStats, type CohortCustomer } from "./cohorts";

const NOW = new Date("2026-04-15T00:00:00.000Z");

/**
 * Two Jan customers and one Feb customer, contribution profit in cents:
 *   Jan · Alice: Jan +1000, Feb +500, Mar +500
 *   Jan · Bob:   Jan +2000
 *   Feb · Chen:  Feb +800, Mar +400
 *
 * Jan cohort (size 2) cumulative-per-customer:
 *   m0 = (1000+2000)/2 = 1500
 *   m1 = (1000+2000+500)/2 = 1750   (Alice's Feb 500)
 *   m2 = (…+500)/2 = 2000           (Alice's Mar 500)
 *   m3 = 2000 (no April activity)
 * Feb cohort (size 1): m0 = 800, m1 = 1200, m2 = 1200
 */
test("cohort grid: cumulative contribution per customer, by first-purchase month", () => {
  const customers: CohortCustomer[] = [
    {
      id: "alice",
      firstTransactionAt: "2026-01-05T00:00:00.000Z",
      events: [
        { occurredAt: "2026-01-05T00:00:00.000Z", contributionProfitCents: 1000 },
        { occurredAt: "2026-02-05T00:00:00.000Z", contributionProfitCents: 500 },
        { occurredAt: "2026-03-05T00:00:00.000Z", contributionProfitCents: 500 },
      ],
    },
    {
      id: "bob",
      firstTransactionAt: "2026-01-20T00:00:00.000Z",
      events: [{ occurredAt: "2026-01-20T00:00:00.000Z", contributionProfitCents: 2000 }],
    },
    {
      id: "chen",
      firstTransactionAt: "2026-02-10T00:00:00.000Z",
      events: [
        { occurredAt: "2026-02-10T00:00:00.000Z", contributionProfitCents: 800 },
        { occurredAt: "2026-03-10T00:00:00.000Z", contributionProfitCents: 400 },
      ],
    },
  ];

  const grid = buildCohortGrid(customers, NOW);
  assert.equal(grid.cohorts.length, 2);

  const jan = grid.cohorts.find((c) => c.cohortMonth === "2026-01")!;
  assert.equal(jan.size, 2);
  assert.deepEqual(jan.cumulativeContributionPerCustomer, [1500, 1750, 2000, 2000]);

  const feb = grid.cohorts.find((c) => c.cohortMonth === "2026-02")!;
  assert.equal(feb.size, 1);
  assert.deepEqual(feb.cumulativeContributionPerCustomer, [800, 1200, 1200]);
});

test("cohort grid: customers with no first transaction are ignored", () => {
  const grid = buildCohortGrid([{ id: "ghost", firstTransactionAt: null, events: [] }], NOW);
  assert.equal(grid.cohorts.length, 0);
});

/**
 * Retention fixture — worked arithmetic (NOW = 2026-04-15):
 * Jan cohort: A (buys Jan, Feb) and B (buys Jan only).
 *   offset 0: both active → 100%; offset 1: only A → 50%; offsets 2-3: 0%.
 * Feb cohort: C (buys Feb, then twice in Apr).
 *   offset 0: 100%; offset 1: 0%; offset 2 (Apr): 100% — two events, ONE customer.
 */
test("retention grid: share of the cohort that came back, per month offset", () => {
  const NOW = new Date(Date.UTC(2026, 3, 15));
  const customers: CohortCustomer[] = [
    {
      id: "A",
      firstTransactionAt: "2026-01-05T00:00:00Z",
      events: [
        { occurredAt: "2026-01-05T00:00:00Z", contributionProfitCents: 100 },
        { occurredAt: "2026-02-20T00:00:00Z", contributionProfitCents: 100 },
      ],
    },
    { id: "B", firstTransactionAt: "2026-01-10T00:00:00Z", events: [{ occurredAt: "2026-01-10T00:00:00Z", contributionProfitCents: 100 }] },
    {
      id: "C",
      firstTransactionAt: "2026-02-08T00:00:00Z",
      events: [
        { occurredAt: "2026-02-08T00:00:00Z", contributionProfitCents: 100 },
        { occurredAt: "2026-04-01T00:00:00Z", contributionProfitCents: 100 },
        { occurredAt: "2026-04-09T00:00:00Z", contributionProfitCents: 100 },
      ],
    },
  ];

  const grid = buildRetentionGrid(customers, NOW);
  const jan = grid.cohorts.find((c) => c.cohortMonth === "2026-01")!;
  assert.equal(jan.size, 2);
  assert.deepEqual(jan.activePctByOffset, [100, 50, 0, 0]);

  const feb = grid.cohorts.find((c) => c.cohortMonth === "2026-02")!;
  assert.equal(feb.size, 1);
  assert.deepEqual(feb.activePctByOffset, [100, 0, 100]);
});

/**
 * Repeat stats fixture — worked arithmetic:
 * A repeats after 10 days, C after 52 days, B never → withPurchase 3,
 * repeat 2, rate 2/3 = 66.7%, median of [10, 52] = (10+52)/2 = 31 days.
 */
test("repeat stats: rate and median days to second purchase", () => {
  const customers: CohortCustomer[] = [
    {
      id: "A",
      firstTransactionAt: "2026-01-01T00:00:00Z",
      events: [
        { occurredAt: "2026-01-01T00:00:00Z", contributionProfitCents: 1 },
        { occurredAt: "2026-01-11T00:00:00Z", contributionProfitCents: 1 },
      ],
    },
    { id: "B", firstTransactionAt: "2026-01-02T00:00:00Z", events: [{ occurredAt: "2026-01-02T00:00:00Z", contributionProfitCents: 1 }] },
    {
      id: "C",
      firstTransactionAt: "2026-02-01T00:00:00Z",
      events: [
        { occurredAt: "2026-02-01T00:00:00Z", contributionProfitCents: 1 },
        { occurredAt: "2026-03-25T00:00:00Z", contributionProfitCents: 1 },
      ],
    },
  ];

  const stats = computeRepeatStats(customers);
  assert.equal(stats.customersWithPurchase, 3);
  assert.equal(stats.repeatCustomers, 2);
  assert.equal(stats.repeatRatePct, 66.7);
  assert.equal(stats.medianDaysToSecondPurchase, 31);
});

test("repeat stats: nobody repeated → null median, 0 rate on empty", () => {
  const none = computeRepeatStats([]);
  assert.equal(none.repeatRatePct, 0);
  assert.equal(none.medianDaysToSecondPurchase, null);
  const single = computeRepeatStats([
    { id: "S", firstTransactionAt: "2026-01-01T00:00:00Z", events: [{ occurredAt: "2026-01-01T00:00:00Z", contributionProfitCents: 1 }] },
  ]);
  assert.equal(single.repeatCustomers, 0);
  assert.equal(single.medianDaysToSecondPurchase, null);
});
