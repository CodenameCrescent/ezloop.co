import test from "node:test";
import assert from "node:assert/strict";
import { breakEvenReconciles, computeBreakEven, revenueForTargetProfit, type BreakEvenInput } from "./breakeven";
import { computeProfitLadder } from "./profit";
import type { ProfitTransaction } from "./types";

/** A period that clears its costs: Rs 100,000 sold, Rs 40,000 of it margin. */
const healthy: BreakEvenInput = {
  netRevenueCents: 10_000_000,
  contributionProfitCents: 4_000_000,
  variableExpensesCents: 1_000_000,
  fixedExpensesCents: 2_000_000,
};

test("break-even revenue is fixed costs divided by the margin left after variable costs", () => {
  const result = computeBreakEven(healthy);
  // Margin after the costs that scale: 40,000 − 10,000 = 30,000 of 100,000 = 30%.
  assert.equal(result.contributionAfterVariableCents, 3_000_000);
  assert.equal(result.contributionMarginPct, 30);
  // 20,000 of fixed costs ÷ 0.30 = 66,666.67.
  assert.equal(result.breakEvenRevenueCents, 6_666_667);
  assert.equal(result.reason, "ok");
});

test("at exactly the break-even revenue the ladder's true profit is zero", () => {
  // The reconciliation contract: this module and lib/domain/profit.ts must agree
  // about what "covering your costs" means, or the number on screen is a guess.
  const result = computeBreakEven(healthy);
  assert.ok(breakEvenReconciles(healthy, result));

  const ratio = result.contributionAfterVariableCents / healthy.netRevenueCents;
  const trueProfitAtTarget = Math.round(result.breakEvenRevenueCents! * ratio) - healthy.fixedExpensesCents;
  assert.ok(Math.abs(trueProfitAtTarget) <= 1, `expected ~0, got ${trueProfitAtTarget}`);
});

test("variable period expenses lower the margin instead of raising the target", () => {
  // Same total spend, split differently. Treating ads as fixed (the naive
  // reading) would give 30,000 ÷ 0.40 = 75,000 — a target that is too high
  // because it never admits ad spend falls when sales fall.
  const allFixed = computeBreakEven({ ...healthy, fixedExpensesCents: 3_000_000, variableExpensesCents: 0 });
  assert.equal(allFixed.breakEvenRevenueCents, 7_500_000);

  const split = computeBreakEven(healthy);
  assert.ok(
    split.breakEvenRevenueCents! < allFixed.breakEvenRevenueCents!,
    "classifying spend as variable must lower the target, not raise it",
  );
});

test("the period's own surplus and coverage are reported against the target", () => {
  const result = computeBreakEven(healthy);
  assert.equal(result.surplusCents, 10_000_000 - 6_666_667);
  assert.ok(result.surplusCents! > 0, "this period cleared its costs");
  assert.equal(result.coveredPct, 150);
});

test("a period that fell short reports a negative surplus and under 100% covered", () => {
  const result = computeBreakEven({ ...healthy, netRevenueCents: 4_000_000, contributionProfitCents: 1_600_000 });
  assert.equal(result.reason, "ok");
  assert.ok(result.surplusCents! < 0);
  assert.ok(result.coveredPct! < 100);
});

test("volume answers ride the period's own average sale size, rounded up", () => {
  const result = computeBreakEven(healthy, { revenueTransactionCount: 50, unitsSold: "125", unitLabel: "unit" });
  // 100,000 over 50 sales = 2,000 each; 66,666.67 ÷ 2,000 = 33.33 → 34.
  assert.equal(result.breakEvenTransactions, 34);
  // 100,000 over 125 units = 800 each; 66,666.67 ÷ 800 = 83.33 → 84.
  assert.equal(result.breakEvenUnits, 84);
  assert.equal(result.breakEvenUnitLabel, "unit");
});

test("fractional quantities stay exact — units are decimal strings, never floats", () => {
  const result = computeBreakEven(healthy, { revenueTransactionCount: 3, unitsSold: "7.5", unitLabel: "hour" });
  assert.equal(result.breakEvenTransactions, 2);
  assert.equal(result.breakEvenUnits, 5);
});

test("no sales in the period means no answer, not a zero", () => {
  // The bug this phase exists to kill was a confident Rs 0 on screen.
  const result = computeBreakEven({ ...healthy, netRevenueCents: 0, contributionProfitCents: 0 });
  assert.equal(result.reason, "no_sales");
  assert.equal(result.breakEvenRevenueCents, null);
  assert.equal(result.contributionMarginPct, null);
});

test("losing money on every sale yields no target, even with no fixed costs", () => {
  const losing = { ...healthy, contributionProfitCents: 500_000, variableExpensesCents: 1_000_000 };
  assert.equal(computeBreakEven(losing).reason, "no_margin");
  assert.equal(computeBreakEven(losing).breakEvenRevenueCents, null);

  // With zero fixed costs the arithmetic would answer "break even at zero
  // revenue" — technically true, useless as advice, so it must not be shown.
  const losingNoFixed = computeBreakEven({ ...losing, fixedExpensesCents: 0 });
  assert.equal(losingNoFixed.reason, "no_margin");
  assert.equal(losingNoFixed.breakEvenRevenueCents, null);
});

test("no fixed costs means covered from the first sale", () => {
  const result = computeBreakEven({ ...healthy, fixedExpensesCents: 0 });
  assert.equal(result.reason, "no_fixed_costs");
  assert.equal(result.breakEvenRevenueCents, 0);
  assert.equal(result.coveredPct, 100);
});

test("the target is rounded up, so it always genuinely clears the fixed costs", () => {
  // A ratio that does not divide evenly: 1/3 margin against Rs 100 fixed.
  const input: BreakEvenInput = {
    netRevenueCents: 30_000,
    contributionProfitCents: 10_000,
    variableExpensesCents: 0,
    fixedExpensesCents: 10_000,
  };
  const result = computeBreakEven(input);
  assert.equal(result.breakEvenRevenueCents, 30_000);
  assert.ok(breakEvenReconciles(input, result));
});

test("a profit target is covered like one more fixed cost", () => {
  // 20,000 fixed + 10,000 wanted = 30,000 ÷ 0.30 = 100,000.
  assert.equal(revenueForTargetProfit(healthy, 1_000_000), 10_000_000);
  // Wanting nothing extra is plain break-even.
  assert.equal(revenueForTargetProfit(healthy, 0), computeBreakEven(healthy).breakEvenRevenueCents);
});

test("money inputs must be integer minor units", () => {
  assert.throws(() => computeBreakEven({ ...healthy, fixedExpensesCents: 12.5 }), /integer minor units/);
});

test("fed from a real ladder, the target lands where true profit turns positive", () => {
  // One sale and two standalone expenses — a rent bill (fixed) and ads (variable).
  const sale: ProfitTransaction = {
    status: "completed",
    direction: "in",
    adjustmentType: null,
    shippingChargedCents: 0,
    orderDiscountCents: 0,
    taxCollectedCents: 0,
    lines: [
      {
        direction: "in",
        unitPriceCents: 100_000,
        qty: "10",
        lineDiscountCents: 0,
        refundedLineId: null,
        costSnapshot: { version: 1, total_per_unit_cents: 60_000, components: [] },
      },
    ],
  };
  const rent: ProfitTransaction = {
    status: "completed",
    direction: "out",
    adjustmentType: null,
    shippingChargedCents: 0,
    orderDiscountCents: 0,
    taxCollectedCents: 0,
    lines: [{ direction: "out", unitPriceCents: 250_000, qty: "1", lineDiscountCents: 0, refundedLineId: null, costSnapshot: null }],
  };
  const ads: ProfitTransaction = {
    status: "completed",
    direction: "out",
    adjustmentType: null,
    shippingChargedCents: 0,
    orderDiscountCents: 0,
    taxCollectedCents: 0,
    lines: [{ direction: "out", unitPriceCents: 100_000, qty: "1", lineDiscountCents: 0, refundedLineId: null, costSnapshot: null }],
  };

  const ladder = computeProfitLadder([sale, rent, ads]);
  assert.equal(ladder.netRevenue, 1_000_000);
  assert.equal(ladder.contributionProfit, 400_000);
  assert.equal(ladder.periodExpenses, 350_000);
  assert.equal(ladder.trueProfit, 50_000);

  const input: BreakEvenInput = {
    netRevenueCents: ladder.netRevenue,
    contributionProfitCents: ladder.contributionProfit,
    fixedExpensesCents: 250_000,
    variableExpensesCents: 100_000,
  };
  // The split must account for every period expense the ladder counted.
  assert.equal(input.fixedExpensesCents + input.variableExpensesCents, ladder.periodExpenses);

  const result = computeBreakEven(input);
  assert.ok(breakEvenReconciles(input, result));
  // Margin after ads is 30%; 2,500 of rent needs 8,333.34 of sales.
  assert.equal(result.breakEvenRevenueCents, 833_334);
  // This period made a profit, so it must read as past its target.
  assert.ok(ladder.trueProfit > 0 && result.surplusCents! > 0);
});

test("a period that mixed units gets no unit count, because it could not be read", () => {
  // 148 mugs + 92 hours + 26 months summed to "7 units needed" — seven of
  // nothing. The revenue target needs no unit and is always still there.
  const mixed = computeBreakEven(healthy, { revenueTransactionCount: 50, unitsSold: "266", unitLabel: null });
  assert.equal(mixed.breakEvenUnits, null);
  assert.equal(mixed.breakEvenUnitLabel, null);
  assert.ok(mixed.breakEvenRevenueCents! > 0, "the revenue target still answers the question");
  assert.equal(mixed.breakEvenTransactions, 34, "a count of SALES needs no unit and stays");

  // One unit across the period and the count comes back, named.
  const single = computeBreakEven(healthy, { revenueTransactionCount: 50, unitsSold: "266", unitLabel: "hour" });
  assert.ok(single.breakEvenUnits! > 0);
  assert.equal(single.breakEvenUnitLabel, "hour");
});
