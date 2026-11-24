import test from "node:test";
import assert from "node:assert/strict";
import {
  computeProjectProfit,
  projectProfitReconciles,
  type ProjectProfitInput,
} from "./projectProfit";

function input(over: Partial<ProjectProfitInput> = {}): ProjectProfitInput {
  return {
    contractValueCents: 1_000_000,
    billedCents: 0,
    receivedCents: 0,
    directCostCents: 0,
    labourCostCents: 0,
    outputQty: null,
    ...over,
  };
}

test("contribution profit is what the project earned less what it consumed", () => {
  const result = computeProjectProfit(
    input({ billedCents: 800_000, directCostCents: 300_000, labourCostCents: 200_000 }),
  );
  assert.equal(result.costToDateCents, 500_000);
  assert.equal(result.contributionProfitCents, 300_000);
  assert.equal(result.marginPct, 37.5);
});

test("still owed is what was billed but not received", () => {
  const result = computeProjectProfit(input({ billedCents: 800_000, receivedCents: 500_000 }));
  assert.equal(result.stillOwedCents, 300_000);
});

test("still owed never goes negative, even when overpaid", () => {
  // An overpayment is a real thing (a deposit against future work). It is not
  // negative debt, and showing "-Rs 50,000 still owed" would read as the
  // business owing the client, which is a different claim entirely.
  const result = computeProjectProfit(input({ billedCents: 100_000, receivedCents: 150_000 }));
  assert.equal(result.stillOwedCents, 0);
});

test("a project that has cost more than it earned reports a loss, not a zero", () => {
  const result = computeProjectProfit(input({ billedCents: 100_000, directCostCents: 250_000 }));
  assert.equal(result.contributionProfitCents, -150_000);
  assert.equal(result.marginPct, -150);
});

test("margin is null when nothing has been billed — not zero", () => {
  // Zero percent is a measurement. A project that has not billed has no margin
  // to measure, and printing 0% about it is a claim the data cannot support.
  const result = computeProjectProfit(input({ billedCents: 0, directCostCents: 40_000 }));
  assert.equal(result.marginPct, null);
  assert.equal(result.contributionProfitCents, -40_000);
});

// ── Against the contract ────────────────────────────────────────────────────

test("what is left to bill is the contract less what has been billed", () => {
  const result = computeProjectProfit(input({ contractValueCents: 1_000_000, billedCents: 400_000 }));
  assert.equal(result.leftToBillCents, 600_000);
  assert.equal(result.billedPct, 40);
});

test("billing past the contract leaves nothing to bill, and says so rather than going negative", () => {
  const result = computeProjectProfit(input({ contractValueCents: 1_000_000, billedCents: 1_200_000 }));
  assert.equal(result.leftToBillCents, 0);
  assert.equal(result.billedPct, 120, "the overrun is visible in the percentage, not hidden");
});

test("with no contract value there is nothing to measure against, and every such figure is null", () => {
  const result = computeProjectProfit(input({ contractValueCents: null, billedCents: 400_000 }));
  assert.equal(result.leftToBillCents, null);
  assert.equal(result.billedPct, null);
  // The money that IS known still reports.
  assert.equal(result.contributionProfitCents, 400_000);
});

// ── Cost per unit made ──────────────────────────────────────────────────────

test("cost per unit made divides real cost by real output", () => {
  const result = computeProjectProfit(
    input({ directCostCents: 300_000, labourCostCents: 100_000, outputQty: "500" }),
  );
  assert.equal(result.costPerUnitCents, 800);
});

test("cost per unit is null without an output quantity, and null at zero output", () => {
  assert.equal(computeProjectProfit(input({ directCostCents: 1_000 })).costPerUnitCents, null);
  assert.equal(computeProjectProfit(input({ directCostCents: 1_000, outputQty: "0" })).costPerUnitCents, null);
});

test("cost per unit rounds to whole minor units and never invents fractions of a paisa", () => {
  const result = computeProjectProfit(input({ directCostCents: 100_000, outputQty: "3" }));
  assert.equal(result.costPerUnitCents, 33_333);
  assert.ok(Number.isSafeInteger(result.costPerUnitCents!));
});

// ── The invariant ───────────────────────────────────────────────────────────

test("the figures reconcile: earned minus consumed equals contribution profit", () => {
  const shapes: ProjectProfitInput[] = [
    input({ billedCents: 800_000, directCostCents: 300_000, labourCostCents: 200_000 }),
    input({ billedCents: 0, directCostCents: 90_000 }),
    input({ contractValueCents: null, billedCents: 55_555, labourCostCents: 12_345 }),
  ];
  for (const shape of shapes) {
    assert.ok(projectProfitReconciles(shape, computeProjectProfit(shape)), JSON.stringify(shape));
  }
});

test("integer minor units in, integer minor units out — no floats reach a figure", () => {
  const result = computeProjectProfit(
    input({ billedCents: 333_333, directCostCents: 111_111, labourCostCents: 22_222 }),
  );
  for (const value of [result.costToDateCents, result.contributionProfitCents, result.stillOwedCents]) {
    assert.ok(Number.isSafeInteger(value), `${value} must be an integer`);
  }
});

test("a non-integer amount is refused rather than quietly rounded", () => {
  assert.throws(() => computeProjectProfit(input({ billedCents: 100.5 })), TypeError);
});
