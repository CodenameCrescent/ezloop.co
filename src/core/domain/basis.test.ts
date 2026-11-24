import test from "node:test";
import assert from "node:assert/strict";
import {
  ACCOUNTING_BASES,
  BASIS_LABELS,
  PAYMENT_STATE_LABELS,
  basisDateOf,
  countsInBasis,
  isAccountingBasis,
  isUnpaid,
  paymentStateOf,
  type DatedTransaction,
} from "./basis";

const JULY = new Date("2026-07-15T00:00:00Z");
const AUGUST = new Date("2026-08-20T00:00:00Z");

/** The case the phase exists for: a July bill settled in August. */
const julyBillPaidInAugust: DatedTransaction = {
  occurredAt: JULY,
  paidAt: AUGUST,
  status: "completed",
};

test("a July bill paid in August is July profit and August cash at the same time", () => {
  assert.equal(countsInBasis("accrual", julyBillPaidInAugust), true);
  assert.equal(basisDateOf("accrual", julyBillPaidInAugust), JULY);

  assert.equal(countsInBasis("cash", julyBillPaidInAugust), true);
  assert.equal(basisDateOf("cash", julyBillPaidInAugust), AUGUST);
});

test("an unpaid bill is profit now and cash never — until it is paid", () => {
  const unpaid: DatedTransaction = { occurredAt: JULY, paidAt: null, status: "completed" };

  // It happened, so it counts toward profit on the day it happened.
  assert.equal(countsInBasis("accrual", unpaid), true);
  assert.equal(basisDateOf("accrual", unpaid), JULY);

  // No cash moved, so cash cannot place it at all. Note this is NOT "zero on
  // the July cash line" — it is absent, which is a different claim.
  assert.equal(countsInBasis("cash", unpaid), false);
  assert.equal(basisDateOf("cash", unpaid), null);

  assert.equal(isUnpaid(unpaid), true);
  assert.equal(paymentStateOf(unpaid), "unpaid");
});

test("'pending' now means unconfirmed only, and counts under neither basis", () => {
  // The old conflation: pending meant both "unpaid" and "the owner has not
  // confirmed this recurring post happened". Only the second survives, and it
  // must stay out of profit — nobody has agreed it happened.
  const unconfirmed: DatedTransaction = { occurredAt: JULY, paidAt: null, status: "pending" };
  assert.equal(countsInBasis("accrual", unconfirmed), false);
  assert.equal(countsInBasis("cash", unconfirmed), false);
  assert.equal(paymentStateOf(unconfirmed), "not_confirmed");
  // And it is not "unpaid" either — that would put it on a chase-the-money list.
  assert.equal(isUnpaid(unconfirmed), false);
});

test("void is excluded from both bases even if it carries a paid date", () => {
  const voided: DatedTransaction = { occurredAt: JULY, paidAt: JULY, status: "void" };
  for (const basis of ACCOUNTING_BASES) assert.equal(countsInBasis(basis, voided), false);
});

test("refunded and disputed money is still real money", () => {
  for (const status of ["refunded", "partially_refunded", "disputed"] as const) {
    const txn: DatedTransaction = { occurredAt: JULY, paidAt: JULY, status };
    assert.equal(countsInBasis("accrual", txn), true, `${status} should count on accrual`);
    assert.equal(countsInBasis("cash", txn), true, `${status} should count on cash`);
  }
});

test("guards and labels", () => {
  for (const junk of [null, undefined, "ACCRUAL", "invoice", 1]) {
    assert.equal(isAccountingBasis(junk), false);
  }
  for (const basis of ACCOUNTING_BASES) {
    assert.ok(isAccountingBasis(basis));
    assert.ok(BASIS_LABELS[basis].label && BASIS_LABELS[basis].help);
    // The product promise: no backend vocabulary on screen.
    assert.ok(!/accrual|cash basis/i.test(BASIS_LABELS[basis].label), `${basis} label leaks jargon`);
  }
  for (const state of ["paid", "unpaid", "not_confirmed"] as const) {
    assert.ok(PAYMENT_STATE_LABELS[state]);
    assert.ok(!PAYMENT_STATE_LABELS[state].includes("_"));
  }
});
