import test from "node:test";
import assert from "node:assert/strict";
import {
  budgetPace,
  budgetReconciles,
  computeBudget,
  matchBudgetLine,
  monthlySchedule,
  monthsInSpan,
  type BudgetInput,
  type BudgetLineInput,
  type LedgerAmount,
} from "./budget";

const line = (over: Partial<BudgetLineInput> & Pick<BudgetLineInput, "id" | "match">): BudgetLineInput => ({
  side: "out",
  amountCents: 100_000,
  basis: "total",
  ...over,
});

const spend = (over: Partial<LedgerAmount> = {}): LedgerAmount => ({
  side: "out",
  amountCents: 10_000,
  expenseItemId: null,
  revenueItemId: null,
  categoryId: null,
  label: null,
  ...over,
});

// ── Matching: by key, never by name ─────────────────────────────────────────

test("a cost matches the budget line that names its expense item", () => {
  const lines = [line({ id: "b1", match: { kind: "expense_item", value: "ei_cement" } })];
  assert.equal(matchBudgetLine(spend({ expenseItemId: "ei_cement" }), lines), "b1");
});

test("an item beats a category, and a category beats a label", () => {
  // Most specific wins. Without an order, a cost that is both "Cement" and
  // "Materials" would land in whichever line happened to be first, and the
  // owner's most precise statement would lose to their vaguest one.
  const lines = [
    line({ id: "label", match: { kind: "label", value: "Cement" } }),
    line({ id: "category", match: { kind: "category", value: "cat_materials" } }),
    line({ id: "item", match: { kind: "expense_item", value: "ei_cement" } }),
  ];
  const cost = spend({ expenseItemId: "ei_cement", categoryId: "cat_materials", label: "Cement" });
  assert.equal(matchBudgetLine(cost, lines), "item");

  const noItem = spend({ categoryId: "cat_materials", label: "Cement" });
  assert.equal(matchBudgetLine(noItem, lines), "category");

  const labelOnly = spend({ label: "Cement" });
  assert.equal(matchBudgetLine(labelOnly, lines), "label");
});

test("a label match is exact — 'Cement' does not claim 'Cement mixer hire'", () => {
  // The bug the whole rewrite exists to kill: the old budget searched expense
  // NAMES for words, so "Rent" quietly swallowed "Equipment rental".
  const lines = [line({ id: "b1", match: { kind: "label", value: "Cement" } })];
  assert.equal(matchBudgetLine(spend({ label: "Cement mixer hire" }), lines), null);
  assert.equal(matchBudgetLine(spend({ label: "Cement" }), lines), "b1");
});

test("a cost never matches a revenue budget line, or the other way round", () => {
  const lines = [line({ id: "b1", side: "in", match: { kind: "revenue_item", value: "ri_build" } })];
  assert.equal(matchBudgetLine(spend({ side: "out", revenueItemId: "ri_build" }), lines), null);
  assert.equal(matchBudgetLine(spend({ side: "in", revenueItemId: "ri_build" }), lines), "b1");
});

test("two budget lines claiming the same thing is refused, not silently resolved", () => {
  // Both would claim the same money. Counting it twice overstates spending;
  // picking one silently means the other reads Rs 0 for no visible reason.
  assert.throws(
    () =>
      computeBudget({
        months: 1,
        lines: [
          line({ id: "a", match: { kind: "expense_item", value: "ei_cement" } }),
          line({ id: "b", match: { kind: "expense_item", value: "ei_cement" } }),
        ],
        actuals: [],
      }),
    RangeError,
  );
});

// ── The span ────────────────────────────────────────────────────────────────

test("months in a span count calendar months, inclusive of both ends", () => {
  assert.equal(monthsInSpan("2026-01-01", "2026-01-31"), 1);
  assert.equal(monthsInSpan("2026-01-01", "2026-12-31"), 12);
  assert.equal(monthsInSpan("2026-01-15", "2026-03-02"), 3);
});

test("a per-month budget multiplies across the span; a total does not", () => {
  const perMonth = computeBudget({
    months: 12,
    lines: [line({ id: "b1", match: { kind: "label", value: "Rent" }, amountCents: 50_000, basis: "per_month" })],
    actuals: [],
  });
  assert.equal(perMonth.rows[0].budgetedCents, 600_000);

  const total = computeBudget({
    months: 12,
    lines: [line({ id: "b1", match: { kind: "label", value: "Rent" }, amountCents: 600_000, basis: "total" })],
    actuals: [],
  });
  assert.equal(total.rows[0].budgetedCents, 600_000);
});

test("a yearly total splits into twelve months that add back to it exactly", () => {
  // 100_000 over 3 is 33_333.33 — the case where a naive division loses a
  // paisa, and the owner's twelve caps stop summing to the figure they typed.
  const schedule = monthlySchedule(100_000, 3);
  assert.equal(schedule.length, 3);
  assert.equal(
    schedule.reduce((sum, month) => sum + month, 0),
    100_000,
  );
  for (const month of schedule) assert.ok(Number.isSafeInteger(month));
});

// ── The comparison ──────────────────────────────────────────────────────────

test("actual spend is summed per budget line, and over-budget is flagged", () => {
  const result = computeBudget({
    months: 1,
    lines: [
      line({ id: "cement", match: { kind: "expense_item", value: "ei_cement" }, amountCents: 100_000 }),
      line({ id: "fuel", match: { kind: "expense_item", value: "ei_fuel" }, amountCents: 50_000 }),
    ],
    actuals: [
      spend({ expenseItemId: "ei_cement", amountCents: 40_000 }),
      spend({ expenseItemId: "ei_cement", amountCents: 35_000 }),
      spend({ expenseItemId: "ei_fuel", amountCents: 62_000 }),
    ],
  });

  const cement = result.rows.find((row) => row.id === "cement")!;
  assert.equal(cement.actualCents, 75_000);
  assert.equal(cement.remainingCents, 25_000);
  assert.equal(cement.pctUsed, 75);
  assert.equal(cement.over, false);

  const fuel = result.rows.find((row) => row.id === "fuel")!;
  assert.equal(fuel.actualCents, 62_000);
  assert.equal(fuel.remainingCents, 0, "you cannot have less than none of a budget left");
  assert.equal(fuel.pctUsed, 124);
  assert.equal(fuel.over, true);
  assert.equal(fuel.overByCents, 12_000);
});

test("a budget of zero is not divided by — its percentage is null, not infinite", () => {
  const result = computeBudget({
    months: 1,
    lines: [line({ id: "b1", match: { kind: "label", value: "Sundries" }, amountCents: 0 })],
    actuals: [spend({ label: "Sundries", amountCents: 5_000 })],
  });
  assert.equal(result.rows[0].pctUsed, null);
  assert.equal(result.rows[0].over, true, "anything spent against nothing budgeted is over");
});

// ── The bucket that stops money disappearing ────────────────────────────────

test("spending that matches no budget line is SHOWN, never dropped", () => {
  // The failure this prevents is silent: money that matched nothing simply
  // vanished from the comparison, so a business could be far over its real
  // spending while every line on the page read comfortably under.
  const result = computeBudget({
    months: 1,
    lines: [line({ id: "cement", match: { kind: "expense_item", value: "ei_cement" }, amountCents: 100_000 })],
    actuals: [
      spend({ expenseItemId: "ei_cement", amountCents: 30_000 }),
      spend({ label: "Skip hire", amountCents: 18_000 }),
      spend({ label: "Site tea", amountCents: 2_000 }),
    ],
  });

  assert.equal(result.unbudgetedCents.out, 20_000);
  assert.equal(result.unbudgetedCount, 2);
});

test("every rupee of actual spend is either on a line or in the unbudgeted bucket", () => {
  const input: BudgetInput = {
    months: 1,
    lines: [
      line({ id: "a", match: { kind: "expense_item", value: "ei_a" } }),
      line({ id: "b", match: { kind: "category", value: "cat_b" } }),
      line({ id: "c", side: "in", match: { kind: "revenue_item", value: "ri_c" } }),
    ],
    actuals: [
      spend({ expenseItemId: "ei_a", amountCents: 11_111 }),
      spend({ categoryId: "cat_b", amountCents: 22_222 }),
      spend({ label: "nothing claims me", amountCents: 33_333 }),
      spend({ side: "in", revenueItemId: "ri_c", amountCents: 44_444 }),
      spend({ side: "in", label: "unbudgeted income", amountCents: 55_555 }),
    ],
  };
  const result = computeBudget(input);

  // THE guard. A gap here means money is missing from the comparison, and
  // nothing on the screen would show it.
  assert.ok(budgetReconciles(input, result));
  assert.equal(result.totals.out.actualCents, 11_111 + 22_222 + 33_333);
  assert.equal(result.totals.in.actualCents, 44_444 + 55_555);
});

test("revenue and costs are totalled separately — they are not one number", () => {
  const result = computeBudget({
    months: 1,
    lines: [
      line({ id: "cost", match: { kind: "label", value: "Materials" }, amountCents: 100_000 }),
      line({ id: "sales", side: "in", match: { kind: "label", value: "Building work" }, amountCents: 500_000 }),
    ],
    actuals: [
      spend({ label: "Materials", amountCents: 90_000 }),
      spend({ side: "in", label: "Building work", amountCents: 400_000 }),
    ],
  });
  assert.equal(result.totals.out.budgetedCents, 100_000);
  assert.equal(result.totals.out.actualCents, 90_000);
  assert.equal(result.totals.in.budgetedCents, 500_000);
  assert.equal(result.totals.in.actualCents, 400_000);
});

// ── Chasing the goal ────────────────────────────────────────────────────────

test("pace says how far through the period you are and whether you are keeping up", () => {
  // Half the year gone, half the target made: exactly on pace.
  const pace = budgetPace({
    targetProfitCents: 1_200_000,
    profitSoFarCents: 600_000,
    periodStart: "2026-01-01",
    periodEnd: "2026-12-31",
    asOf: "2026-07-01",
  });
  assert.equal(pace.monthsElapsed, 6);
  assert.equal(pace.monthsRemaining, 6);
  assert.equal(pace.expectedByNowCents, 600_000);
  assert.equal(pace.aheadByCents, 0);
  assert.equal(pace.onTrack, true);
  assert.equal(pace.neededPerRemainingMonthCents, 100_000);
});

test("behind pace is reported as a shortfall, and the monthly ask goes up", () => {
  const pace = budgetPace({
    targetProfitCents: 1_200_000,
    profitSoFarCents: 300_000,
    periodStart: "2026-01-01",
    periodEnd: "2026-12-31",
    asOf: "2026-07-01",
  });
  assert.equal(pace.aheadByCents, -300_000);
  assert.equal(pace.onTrack, false);
  // Rs 900,000 left across six months, not the Rs 100,000 the original plan implied.
  assert.equal(pace.neededPerRemainingMonthCents, 150_000);
});

test("once the target is met, nothing more is needed — never a negative ask", () => {
  const pace = budgetPace({
    targetProfitCents: 1_000_000,
    profitSoFarCents: 1_400_000,
    periodStart: "2026-01-01",
    periodEnd: "2026-12-31",
    asOf: "2026-07-01",
  });
  assert.equal(pace.onTrack, true);
  assert.equal(pace.neededPerRemainingMonthCents, 0);
  assert.equal(pace.aheadByCents, 900_000);
});

test("after the period ends there are no months left, and the ask is null rather than a division by zero", () => {
  const pace = budgetPace({
    targetProfitCents: 1_000_000,
    profitSoFarCents: 800_000,
    periodStart: "2026-01-01",
    periodEnd: "2026-12-31",
    asOf: "2027-03-01",
  });
  assert.equal(pace.monthsRemaining, 0);
  assert.equal(pace.neededPerRemainingMonthCents, null);
  assert.equal(pace.onTrack, false, "the period closed short of the target");
});

test("before the period starts, nothing is expected yet", () => {
  const pace = budgetPace({
    targetProfitCents: 1_000_000,
    profitSoFarCents: 0,
    periodStart: "2026-01-01",
    periodEnd: "2026-12-31",
    asOf: "2025-11-01",
  });
  assert.equal(pace.monthsElapsed, 0);
  assert.equal(pace.expectedByNowCents, 0);
  assert.equal(pace.onTrack, true);
});
