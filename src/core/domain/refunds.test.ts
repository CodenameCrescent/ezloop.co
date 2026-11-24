import test from "node:test";
import assert from "node:assert/strict";
import { buildRefund, type RefundableLine, type RefundableTransaction } from "./refunds";
import { computeProfitLadder } from "./profit";
import type { CostSnapshot, ProfitTransaction } from "./types";

// Original line LA: qty 2 × 1000, snapshot per unit = Materials(cost) 300 + Fee(fee) 200 = 500.
const laSnapshot: CostSnapshot = {
  version: 1,
  components: [
    { name: "Materials", calc: "fixed_per_unit", input: "300", per_unit_cents: 300, kind: "cost" },
    { name: "Platform fee", calc: "percent_of_price", input: "20", per_unit_cents: 200, kind: "fee" },
  ],
  total_per_unit_cents: 500,
};

const originalTx: RefundableTransaction = {
  id: "txn_orig",
  direction: "in",
  sourceId: "src_manual",
  currency: "PKR",
  orderDiscountCents: 0,
};

const originalLines: RefundableLine[] = [
  { id: "line_a", label: "Handmade lamp", qty: "2", unitPriceCents: 1000, lineDiscountCents: 0, costSnapshot: laSnapshot },
  { id: "line_b", label: "Gift wrap", qty: "1", unitPriceCents: 500, lineDiscountCents: 0, costSnapshot: null },
];

test("refund profit impact: plain vs restocked vs fees recovered", () => {
  // Not restocked, no fees back: impact = −1000.
  const plain = buildRefund(originalTx, originalLines, [
    { lineId: "line_a", qtyRefunded: "1", amountRefundedCents: 1000 },
  ]);
  assert.equal(plain.profitImpactCents, -1000);
  // Nothing recovered, but the snapshot still records the refunded qty basis.
  assert.deepEqual(plain.lines[0].costSnapshot, { version: 1, components: [], total_per_unit_cents: 0, qty_basis: "1" });

  // Restocked: cost components come back → −1000 + 300 = −700.
  const restocked = buildRefund(originalTx, originalLines, [
    { lineId: "line_a", qtyRefunded: "1", amountRefundedCents: 1000, restocked: true },
  ]);
  assert.equal(restocked.profitImpactCents, -700);
  assert.equal(restocked.lines[0].costSnapshot?.total_per_unit_cents, 300);
  assert.equal(restocked.lines[0].costSnapshot?.qty_basis, "1");

  // Fees recovered only: −1000 + 200 = −800.
  const feesBack = buildRefund(originalTx, originalLines, [
    { lineId: "line_a", qtyRefunded: "1", amountRefundedCents: 1000, feesRecovered: true },
  ]);
  assert.equal(feesBack.profitImpactCents, -800);

  // Both: −1000 + 300 + 200 = −500; recovered snapshot scales with qty (2 units → 600 + 400).
  const both = buildRefund(originalTx, originalLines, [
    { lineId: "line_a", qtyRefunded: "2", amountRefundedCents: 2000, restocked: true, feesRecovered: true },
  ]);
  assert.equal(both.profitImpactCents, -2000 + 600 + 400);
  assert.equal(both.lines[0].costSnapshot?.total_per_unit_cents, 1000);
});

test("refund transaction shape: direction flipped, parent set, exact amount lines", () => {
  const built = buildRefund(originalTx, originalLines, [
    { lineId: "line_a", qtyRefunded: "1", amountRefundedCents: 999 },
  ]);
  assert.equal(built.transaction.direction, "out");
  assert.equal(built.transaction.parentTransactionId, "txn_orig");
  assert.equal(built.transaction.adjustmentType, "refund");
  assert.equal(built.lines[0].qty, "1");
  assert.equal(built.lines[0].unitPriceCents, 999); // amount is exact, never split per unit
  assert.equal(built.lines[0].refundedLineId, "line_a");
  assert.equal(built.parentStatus, "partially_refunded");
});

test("cumulative over-refund throws: quantity and amount", () => {
  const prior = [{ refundedLineId: "line_a", qtyRefunded: "1", amountRefundedCents: 1000 }];
  // qty: 1 prior + 1.5 requested > 2 original
  assert.throws(
    () =>
      buildRefund(originalTx, originalLines, [{ lineId: "line_a", qtyRefunded: "1.5", amountRefundedCents: 500 }], {
        priorRefunds: prior,
      }),
    RangeError,
  );
  // amount: 1000 prior + 1100 requested > 2000 refundable
  assert.throws(
    () =>
      buildRefund(originalTx, originalLines, [{ lineId: "line_a", qtyRefunded: "1", amountRefundedCents: 1100 }], {
        priorRefunds: prior,
      }),
    RangeError,
  );
  // unknown line id
  assert.throws(
    () => buildRefund(originalTx, originalLines, [{ lineId: "nope", qtyRefunded: "1", amountRefundedCents: 1 }]),
    RangeError,
  );
});

test("parent status flips to refunded when everything is given back", () => {
  const full = buildRefund(originalTx, originalLines, [
    { lineId: "line_a", qtyRefunded: "2", amountRefundedCents: 2000 },
    { lineId: "line_b", qtyRefunded: "1", amountRefundedCents: 500 },
  ]);
  assert.equal(full.parentStatus, "refunded");

  // Two-step: partial first, remainder later with prior refunds passed in.
  const second = buildRefund(
    originalTx,
    originalLines,
    [
      { lineId: "line_a", qtyRefunded: "1", amountRefundedCents: 1000 },
      { lineId: "line_b", qtyRefunded: "1", amountRefundedCents: 500 },
    ],
    { priorRefunds: [{ refundedLineId: "line_a", qtyRefunded: "1", amountRefundedCents: 1000 }] },
  );
  assert.equal(second.parentStatus, "refunded");
});

test("chargeback: same construction plus an unlinked fee line", () => {
  const chargeback = buildRefund(
    originalTx,
    originalLines,
    [{ lineId: "line_a", qtyRefunded: "1", amountRefundedCents: 1000 }],
    { adjustmentType: "chargeback", chargebackFeeCents: 150 },
  );
  assert.equal(chargeback.transaction.adjustmentType, "chargeback");
  const feeLine = chargeback.lines.find((l) => l.refundedLineId === null);
  assert.ok(feeLine);
  assert.equal(feeLine.label, "Chargeback fee");
  assert.equal(feeLine.unitPriceCents, 150);
  assert.equal(chargeback.profitImpactCents, -1000 - 150);
});

/**
 * End-to-end: multi-line order with an order-level discount, then a partial
 * refund — the ladder delta must equal the refund's computed profit impact.
 *
 * Sale: L1 2×1000 (snapshot 500/u = 300 cost + 200 fee) | L2 1×500 disc 100 (cost 100/u)
 *       | L3 3×200 (no snapshot)
 *       order discount 150 → shares [100, 20, 30] | shipping 250 | tax 130 excluded
 *   gross = 2000 + 500 + 600 + 250 = 3350, discounts = 250
 *   direct costs = 500×2 + 100×1 = 1100
 *   before refund: net 3100, contribution 3100 − 1100 = 2000
 *
 * Refund L2: refundable = 500 − 100 − 20 = 380; restocked → recovers 100.
 *   refund impact = −380 + 100 = −280
 *   after: net 2720, direct costs 1000, contribution 1720 (= 2000 − 280 ✓)
 */
test("order discount + partial refund end-to-end through the ladder", () => {
  const l2Snapshot: CostSnapshot = {
    version: 1,
    components: [{ name: "Packaging", calc: "fixed_per_unit", input: "100", per_unit_cents: 100, kind: "cost" }],
    total_per_unit_cents: 100,
  };
  const saleTx: RefundableTransaction = { id: "txn_sale", direction: "in", sourceId: "src_manual", currency: "PKR", orderDiscountCents: 150 };
  const saleLines: RefundableLine[] = [
    { id: "L1", qty: "2", unitPriceCents: 1000, lineDiscountCents: 0, costSnapshot: laSnapshot },
    { id: "L2", qty: "1", unitPriceCents: 500, lineDiscountCents: 100, costSnapshot: l2Snapshot },
    { id: "L3", qty: "3", unitPriceCents: 200, lineDiscountCents: 0, costSnapshot: null },
  ];

  const built = buildRefund(saleTx, saleLines, [
    { lineId: "L2", qtyRefunded: "1", amountRefundedCents: 380, restocked: true },
  ]);
  assert.equal(built.profitImpactCents, -280);
  assert.equal(built.parentStatus, "partially_refunded");

  const sale: ProfitTransaction = {
    direction: "in",
    status: "partially_refunded",
    adjustmentType: null,
    orderDiscountCents: 150,
    shippingChargedCents: 250,
    taxCollectedCents: 130,
    lines: saleLines.map((l) => ({ qty: l.qty, unitPriceCents: l.unitPriceCents, lineDiscountCents: l.lineDiscountCents, costSnapshot: l.costSnapshot })),
  };
  const refundTx: ProfitTransaction = {
    direction: "out",
    status: "completed",
    adjustmentType: "refund",
    orderDiscountCents: 0,
    shippingChargedCents: 0,
    taxCollectedCents: 0,
    lines: built.lines.map((l) => ({
      qty: l.qty,
      unitPriceCents: l.unitPriceCents,
      lineDiscountCents: l.lineDiscountCents,
      costSnapshot: l.costSnapshot,
      refundedLineId: l.refundedLineId,
    })),
  };

  const before = computeProfitLadder([sale]);
  assert.equal(before.contributionProfit, 2000);

  const after = computeProfitLadder([sale, refundTx]);
  assert.deepEqual(after, {
    grossRevenue: 3350,
    discounts: 250,
    refunds: 380,
    netRevenue: 2720,
    directCosts: 1000,
    contributionProfit: 1720,
    periodExpenses: 0,
    trueProfit: 1720,
  });
  assert.equal(after.contributionProfit - before.contributionProfit, built.profitImpactCents);
});
