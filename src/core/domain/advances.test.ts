import test from "node:test";
import assert from "node:assert/strict";
import {
  advanceBalance,
  applicationsReconcile,
  applicableAmount,
  isFullySettled,
  type AdvanceApplication,
} from "./advances";
import { computeProfitLadder } from "./profit";
import type { ProfitTransaction } from "./types";

const apply = (amountCents: number): AdvanceApplication => ({ amountCents });

// ── What is left on an advance ──────────────────────────────────────────────

test("an untouched advance still has all of itself left", () => {
  assert.equal(advanceBalance(200_000, []), 200_000);
});

test("drawing on an advance twice leaves the remainder", () => {
  assert.equal(advanceBalance(200_000, [apply(50_000), apply(30_000)]), 120_000);
});

test("an advance used in full has nothing left, and never goes below nothing", () => {
  assert.equal(advanceBalance(200_000, [apply(200_000)]), 0);
  // Over-drawing is refused at the write path; if a row ever slipped through,
  // reporting a negative balance would read as the supplier owing money back.
  assert.equal(advanceBalance(200_000, [apply(250_000)]), 0);
});

// ── How much of a bill an advance may cover ─────────────────────────────────

test("an advance covers a bill up to the smaller of what is left and what is owed", () => {
  // Rs 200,000 advance against a Rs 500,000 bill: the whole advance goes.
  assert.equal(applicableAmount({ billCents: 500_000, alreadyAppliedCents: 0, advanceBalanceCents: 200_000 }), 200_000);
  // Rs 200,000 advance against a Rs 80,000 bill: only the bill's worth goes.
  assert.equal(applicableAmount({ billCents: 80_000, alreadyAppliedCents: 0, advanceBalanceCents: 200_000 }), 80_000);
});

test("what is already settled on a bill reduces what can still be applied", () => {
  assert.equal(
    applicableAmount({ billCents: 500_000, alreadyAppliedCents: 300_000, advanceBalanceCents: 400_000 }),
    200_000,
  );
});

test("nothing is applicable to a bill that is already covered", () => {
  assert.equal(
    applicableAmount({ billCents: 500_000, alreadyAppliedCents: 500_000, advanceBalanceCents: 400_000 }),
    0,
  );
});

test("a bill is fully settled only when the applications reach its whole amount", () => {
  assert.equal(isFullySettled(500_000, [apply(200_000)]), false);
  assert.equal(isFullySettled(500_000, [apply(200_000), apply(300_000)]), true);
  assert.equal(isFullySettled(500_000, [apply(600_000)]), true);
});

test("applications reconcile against what they were drawn from", () => {
  assert.equal(applicationsReconcile(200_000, [apply(120_000), apply(80_000)]), true);
  assert.equal(applicationsReconcile(200_000, [apply(120_000), apply(90_000)]), false);
});

// ── The ladder rule: cash now, cost later ───────────────────────────────────

const advancePaid: ProfitTransaction = {
  direction: "out",
  status: "completed",
  adjustmentType: null,
  orderDiscountCents: 0,
  shippingChargedCents: 0,
  taxCollectedCents: 0,
  taxPaidCents: 0,
  taxReclaimable: false,
  lines: [
    { direction: "out", qty: "1", unitPriceCents: 200_000, lineDiscountCents: 0, costSnapshot: null, isAdvance: true },
  ],
};

test("an advance PAID to a subcontractor is not a cost yet — accrual sees nothing", () => {
  // The whole point. The money has left the bank, but no work has happened, so
  // charging it to this month's profit reports a loss in a month that had none.
  const ladder = computeProfitLadder([advancePaid], "accrual");
  assert.equal(ladder.periodExpenses, 0);
  assert.equal(ladder.trueProfit, 0);
});

test("the same advance IS cash out, in full, on the day it was paid", () => {
  const ladder = computeProfitLadder([advancePaid], "cash");
  assert.equal(ladder.periodExpenses, 200_000);
  assert.equal(ladder.trueProfit, -200_000);
});

const depositTaken: ProfitTransaction = {
  direction: "in",
  status: "completed",
  adjustmentType: null,
  orderDiscountCents: 0,
  shippingChargedCents: 0,
  taxCollectedCents: 0,
  taxPaidCents: 0,
  taxReclaimable: false,
  lines: [
    { direction: "in", qty: "1", unitPriceCents: 300_000, lineDiscountCents: 0, costSnapshot: null, isAdvance: true },
  ],
};

test("a deposit TAKEN from a customer is not revenue yet — the mirror of the same rule", () => {
  // Counting it would let a business book a year of deposits as a record year
  // and then discover the work still has to be done.
  const accrual = computeProfitLadder([depositTaken], "accrual");
  assert.equal(accrual.grossRevenue, 0);
  assert.equal(accrual.netRevenue, 0);

  const cash = computeProfitLadder([depositTaken], "cash");
  assert.equal(cash.grossRevenue, 300_000);
});

test("an ordinary line beside an advance on the same transaction still counts", () => {
  // A bill that is part advance and part immediate cost is a real shape, and
  // the flag is per LINE precisely so the two can sit together.
  const mixed: ProfitTransaction = {
    ...advancePaid,
    lines: [
      { direction: "out", qty: "1", unitPriceCents: 200_000, lineDiscountCents: 0, costSnapshot: null, isAdvance: true },
      { direction: "out", qty: "1", unitPriceCents: 50_000, lineDiscountCents: 0, costSnapshot: null },
    ],
  };
  assert.equal(computeProfitLadder([mixed], "accrual").periodExpenses, 50_000);
  assert.equal(computeProfitLadder([mixed], "cash").periodExpenses, 250_000);
});

test("an advance is not a spread purchase — the two rules do not collide", () => {
  // Both defer under accrual, and they mean different things: a spread cost is
  // already incurred and belongs to later months, an advance is not yet
  // incurred at all. A line marked both defers once, not twice into nothing.
  const both: ProfitTransaction = {
    ...advancePaid,
    lines: [
      {
        direction: "out",
        qty: "1",
        unitPriceCents: 200_000,
        lineDiscountCents: 0,
        costSnapshot: null,
        isAdvance: true,
        spreadMonths: 12,
      },
    ],
  };
  assert.equal(computeProfitLadder([both], "accrual").periodExpenses, 0);
  assert.equal(computeProfitLadder([both], "cash").periodExpenses, 200_000);
});
