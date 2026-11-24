import test from "node:test";
import assert from "node:assert/strict";
import {
  LADDER_LABELS,
  computeProfitLadder,
  contributionProfitForLine,
  netLineRevenue,
  orderDiscountShares,
} from "./profit";
import { buildSpread } from "./spread";
import type { CostSnapshot, ProfitLine, ProfitTransaction } from "./types";

function snap(totalPerUnit: number): CostSnapshot {
  return {
    version: 1,
    components: [{ name: "Cost", calc: "fixed_per_unit", input: String(totalPerUnit), per_unit_cents: totalPerUnit, kind: "cost" }],
    total_per_unit_cents: totalPerUnit,
  };
}

function line(patch: Partial<ProfitLine>): ProfitLine {
  return { qty: "1", unitPriceCents: 0, lineDiscountCents: 0, costSnapshot: null, ...patch };
}

test("order-discount allocation: exact sum across 3 uneven lines", () => {
  const lines = [
    line({ qty: "2", unitPriceCents: 1000 }), // subtotal 2000
    line({ qty: "1", unitPriceCents: 500, lineDiscountCents: 100 }), // subtotal 400
    line({ qty: "3", unitPriceCents: 200 }), // subtotal 600
  ];
  // 100 × 2000/3000 = 66.67 → 66 (rem .67); ×400/3000 = 13.33 → 13 (rem .33);
  // ×600/3000 = 20 exactly. Leftover 1 cent → largest remainder (line 1).
  assert.deepEqual(orderDiscountShares(100, lines), [67, 13, 20]);
  // Uneven divisor: always sums exactly.
  const shares = orderDiscountShares(101, [line({ unitPriceCents: 999 }), line({ unitPriceCents: 333 }), line({ unitPriceCents: 100 })]);
  assert.equal(shares.reduce((a, b) => a + b, 0), 101);
});

test("line helpers: net revenue and contribution profit", () => {
  const l = line({ qty: "2", unitPriceCents: 1000, lineDiscountCents: 50, costSnapshot: snap(300) });
  // gross 2000 − line discount 50 − order share 100 = 1850
  assert.equal(netLineRevenue(l, 100), 1850);
  // cost 300 × 2 = 600 → contribution 1250
  assert.equal(contributionProfitForLine(l, 100), 1250);
});

/**
 * Ladder fixture — worked arithmetic:
 *
 * Sale T1 (in, completed), shipping 250, tax collected 130 (EXCLUDED), order discount 150:
 *   L1 qty 2 × 1000, cost/unit 300  → gross 2000, cost 600
 *   L2 qty 1 × 500, line disc 100, cost/unit 100 → gross 500, cost 100
 *   L3 qty 3 × 200, no snapshot     → gross 600
 *   Gross revenue = 2000 + 500 + 600 + shipping 250            = 3350
 *   Discounts    = line (0+100+0) + order 150                  = 250
 *   Direct costs = 600 + 100                                   = 700
 *
 * Expense T2 (out, completed): 1 × 800                          → periodExpenses 800
 *
 * Refund T3 (adjustment, out, occurs in period): refunds L1 qty 1 for 900,
 * restocked → its line snapshot carries recovered cost 300:
 *   refunds     += 900
 *   direct costs −= 300  → 400
 *
 * T4 void (in, 99999) and T5 pending (in, 55555): EXCLUDED everywhere.
 *
 *   Net revenue          = 3350 − 250 − 900        = 2200
 *   Contribution profit  = 2200 − 400              = 1800
 *   True profit          = 1800 − 800              = 1000
 */
test("profit ladder on the hand-computed fixture", () => {
  const sale: ProfitTransaction = {
    direction: "in",
    status: "partially_refunded",
    adjustmentType: null,
    orderDiscountCents: 150,
    shippingChargedCents: 250,
    taxCollectedCents: 130,
    lines: [
      line({ qty: "2", unitPriceCents: 1000, costSnapshot: snap(300) }),
      line({ qty: "1", unitPriceCents: 500, lineDiscountCents: 100, costSnapshot: snap(100) }),
      line({ qty: "3", unitPriceCents: 200 }),
    ],
  };
  const expense: ProfitTransaction = {
    direction: "out",
    status: "completed",
    adjustmentType: null,
    orderDiscountCents: 0,
    shippingChargedCents: 0,
    taxCollectedCents: 0,
    lines: [line({ unitPriceCents: 800 })],
  };
  const refund: ProfitTransaction = {
    direction: "out",
    status: "completed",
    adjustmentType: "refund",
    orderDiscountCents: 0,
    shippingChargedCents: 0,
    taxCollectedCents: 0,
    lines: [line({ unitPriceCents: 900, costSnapshot: snap(300), refundedLineId: "L1" })],
  };
  const voided: ProfitTransaction = {
    direction: "in",
    status: "void",
    adjustmentType: null,
    orderDiscountCents: 0,
    shippingChargedCents: 0,
    taxCollectedCents: 0,
    lines: [line({ unitPriceCents: 99999 })],
  };
  const pending: ProfitTransaction = {
    direction: "in",
    status: "pending",
    adjustmentType: null,
    orderDiscountCents: 0,
    shippingChargedCents: 0,
    taxCollectedCents: 0,
    lines: [line({ unitPriceCents: 55555 })],
  };

  const ladder = computeProfitLadder([sale, expense, refund, voided, pending]);
  assert.deepEqual(ladder, {
    grossRevenue: 3350,
    discounts: 250,
    refunds: 900,
    netRevenue: 2200,
    directCosts: 400,
    contributionProfit: 1800,
    periodExpenses: 800,
    trueProfit: 1000,
  });
});

test("fee lines on adjustment transactions (chargeback fee) count as period expenses", () => {
  const chargeback: ProfitTransaction = {
    direction: "out",
    status: "completed",
    adjustmentType: "chargeback",
    orderDiscountCents: 0,
    shippingChargedCents: 0,
    taxCollectedCents: 0,
    lines: [
      line({ unitPriceCents: 1000, refundedLineId: "L1" }), // the reversed sale amount
      line({ unitPriceCents: 150 }), // the processor's chargeback fee (unlinked)
    ],
  };
  const ladder = computeProfitLadder([chargeback]);
  assert.equal(ladder.refunds, 1000);
  assert.equal(ladder.periodExpenses, 150);
  assert.equal(ladder.trueProfit, -1150);
});

test("mixed transaction: an expense line inside a sale is a cost of THAT job (contribution level)", () => {
  // A job you're paid Rs 1000 for and buy Rs 300 of materials for, recorded as
  // ONE transaction. Contribution = 1000 − 300 = 700; the materials are NOT a
  // period expense.
  const job: ProfitTransaction = {
    direction: "in",
    status: "completed",
    adjustmentType: null,
    orderDiscountCents: 0,
    shippingChargedCents: 0,
    taxCollectedCents: 0,
    lines: [
      line({ direction: "in", qty: "1", unitPriceCents: 1000 }),
      line({ direction: "out", qty: "1", unitPriceCents: 300 }),
    ],
  };
  const ladder = computeProfitLadder([job]);
  assert.equal(ladder.grossRevenue, 1000);
  assert.equal(ladder.netRevenue, 1000);
  assert.equal(ladder.contributionProfit, 700);
  assert.equal(ladder.periodExpenses, 0);
  assert.equal(ladder.trueProfit, 700);
});

test("a standalone expense stays a period expense (True-profit level), unchanged by mixed support", () => {
  const rent: ProfitTransaction = {
    direction: "out",
    status: "completed",
    adjustmentType: null,
    orderDiscountCents: 0,
    shippingChargedCents: 0,
    taxCollectedCents: 0,
    lines: [line({ direction: "out", unitPriceCents: 300 })],
  };
  const ladder = computeProfitLadder([rent]);
  assert.equal(ladder.contributionProfit, 0);
  assert.equal(ladder.periodExpenses, 300);
  assert.equal(ladder.trueProfit, -300);
});

test("ladder vocabulary is the four exact UI strings", () => {
  assert.equal(LADDER_LABELS.grossRevenue.label, "Gross revenue");
  assert.equal(LADDER_LABELS.netRevenue.label, "Net revenue");
  assert.equal(LADDER_LABELS.contributionProfit.label, "Contribution profit");
  assert.equal(LADDER_LABELS.trueProfit.label, "True profit");
  for (const entry of Object.values(LADDER_LABELS)) {
    assert.ok(entry.tooltip.length > 20, "every rung carries a plain-English tooltip");
  }
});

test("reclaimable input tax leaves the cost; non-reclaimable tax stays in it", () => {
  // Rs 1,180 of materials, of which Rs 180 is input tax.
  const bill = (taxReclaimable: boolean): ProfitTransaction => ({
    direction: "out",
    status: "completed",
    adjustmentType: null,
    orderDiscountCents: 0,
    shippingChargedCents: 0,
    taxCollectedCents: 0,
    taxPaidCents: 180_00,
    taxReclaimable,
    lines: [
      { direction: "out", qty: "1", unitPriceCents: 1_180_00, lineDiscountCents: 0, costSnapshot: null },
    ],
  });

  // Registered to reclaim: the Rs 180 is being held for the tax authority, not
  // spent, so the real cost is Rs 1,000.
  assert.equal(computeProfitLadder([bill(true)]).periodExpenses, 1_000_00);
  // Not registered: the tax really was money out, so the cost is the full bill.
  assert.equal(computeProfitLadder([bill(false)]).periodExpenses, 1_180_00);
});

test("reclaimable tax on a job's materials lifts that job's contribution, not period expenses", () => {
  // One money event: a job paid Rs 3,000 with Rs 1,180 of materials bought for
  // it, Rs 180 of that reclaimable.
  const job: ProfitTransaction = {
    direction: "in",
    status: "completed",
    adjustmentType: null,
    orderDiscountCents: 0,
    shippingChargedCents: 0,
    taxCollectedCents: 0,
    taxPaidCents: 180_00,
    taxReclaimable: true,
    lines: [
      { direction: "in", qty: "1", unitPriceCents: 3_000_00, lineDiscountCents: 0, costSnapshot: null },
      { direction: "out", qty: "1", unitPriceCents: 1_180_00, lineDiscountCents: 0, costSnapshot: null },
    ],
  };

  const ladder = computeProfitLadder([job]);
  assert.equal(ladder.netRevenue, 3_000_00);
  // Materials net of reclaimable tax: 1,180 − 180 = 1,000.
  assert.equal(ladder.contributionProfit, 2_000_00);
  // It must NOT leak into period expenses — that would double-count the relief.
  assert.equal(ladder.periodExpenses, 0);
  assert.equal(ladder.trueProfit, 2_000_00);
});

test("input tax is ignored unless it is marked reclaimable", () => {
  const noFlag: ProfitTransaction = {
    direction: "out",
    status: "completed",
    adjustmentType: null,
    orderDiscountCents: 0,
    shippingChargedCents: 0,
    taxCollectedCents: 0,
    taxPaidCents: 500_00,
    lines: [{ direction: "out", qty: "1", unitPriceCents: 1_000_00, lineDiscountCents: 0, costSnapshot: null }],
  };
  assert.equal(computeProfitLadder([noFlag]).periodExpenses, 1_000_00);
});

// ── Capitalised lines (spread over months) ───────────────────────────────────

test("a spread expense line contributes NOTHING to the month it was bought in", () => {
  // The kiln problem. Recorded whole, a Rs 95,000 purchase crushes one month's
  // profit and the app reports "you sold more and kept less" — true to the
  // cent, and completely misleading. Capitalised, it costs this month nothing.
  const bought: ProfitTransaction = {
    direction: "out",
    status: "completed",
    orderDiscountCents: 0,
    shippingChargedCents: 0,
    taxCollectedCents: 0,
    taxPaidCents: 0,
    taxReclaimable: false,
    adjustmentType: null,
    lines: [
      {
        direction: "out",
        qty: "1",
        unitPriceCents: 95_000_00,
        lineDiscountCents: 0,
        costSnapshot: null,
        spreadMonths: 24,
      },
    ],
  };

  const ladder = computeProfitLadder([bought]);
  assert.equal(ladder.periodExpenses, 0, "the cost belongs to the months it covers, not this one");
  assert.equal(ladder.trueProfit, 0);
});

test("the same line WITHOUT a spread still lands whole — nothing changed by accident", () => {
  const bought: ProfitTransaction = {
    direction: "out",
    status: "completed",
    orderDiscountCents: 0,
    shippingChargedCents: 0,
    taxCollectedCents: 0,
    taxPaidCents: 0,
    taxReclaimable: false,
    adjustmentType: null,
    lines: [
      { direction: "out", qty: "1", unitPriceCents: 95_000_00, lineDiscountCents: 0, costSnapshot: null },
    ],
  };

  assert.equal(computeProfitLadder([bought]).periodExpenses, 95_000_00);

  // And a spread of one month is not a spread.
  const single = { ...bought, lines: [{ ...bought.lines[0], spreadMonths: 1 }] };
  assert.equal(computeProfitLadder([single]).periodExpenses, 95_000_00);
});

test("the slices carry exactly what the purchase gave up — no money lost or invented", () => {
  const total = 95_000_00;
  const slices = buildSpread(total, new Date("2026-04-14T00:00:00.000Z"), 24);

  // Each slice posts as an ordinary expense transaction of its own.
  const asTransactions: ProfitTransaction[] = slices.map((s) => ({
    direction: "out",
    status: "completed",
    orderDiscountCents: 0,
    shippingChargedCents: 0,
    taxCollectedCents: 0,
    taxPaidCents: 0,
    taxReclaimable: false,
    adjustmentType: null,
    lines: [
      { direction: "out", qty: "1", unitPriceCents: s.amountCents, lineDiscountCents: 0, costSnapshot: null },
    ],
  }));

  assert.equal(
    computeProfitLadder(asTransactions).periodExpenses,
    total,
    "over the whole life, the spread costs exactly what was spent",
  );
});

test("a capitalised line inside a SALE is still the cost of that job", () => {
  // Spreading is about period expenses. A cost booked against a sale is that
  // job's cost and belongs at contribution level whatever else is true of it.
  const job: ProfitTransaction = {
    direction: "in",
    status: "completed",
    orderDiscountCents: 0,
    shippingChargedCents: 0,
    taxCollectedCents: 0,
    taxPaidCents: 0,
    taxReclaimable: false,
    adjustmentType: null,
    lines: [
      { direction: "in", qty: "1", unitPriceCents: 10_000_00, lineDiscountCents: 0, costSnapshot: null },
      {
        direction: "out",
        qty: "1",
        unitPriceCents: 2_000_00,
        lineDiscountCents: 0,
        costSnapshot: null,
        spreadMonths: 12,
      },
    ],
  };

  const ladder = computeProfitLadder([job]);
  assert.equal(ladder.contributionProfit, 8_000_00, "the job's own cost, not deferred");
  assert.equal(ladder.periodExpenses, 0);
});
