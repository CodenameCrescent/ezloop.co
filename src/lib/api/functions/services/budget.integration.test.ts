/**
 * Budgets against a real ledger.
 *
 * The matching rules and the arithmetic are unit-tested beside
 * `lib/domain/budget.ts`. What only a database can prove is that the ACTUALS
 * gathered here are the same money the profit ladder sees — and that nothing
 * falls out of the comparison on the way, which is exactly what the screen this
 * replaces did.
 */
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import path from "node:path";
import pg from "pg";
import { assertLocalTestDatabases } from "@/core/db/target";

const TEST_DB_NAME = "profit_loop_test";
const ADMIN_URL = process.env.TEST_ADMIN_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/postgres";
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? `postgres://postgres:postgres@localhost:5432/${TEST_DB_NAME}`;

// Never anything but a Postgres on this machine: these suites create, migrate and wipe.
assertLocalTestDatabases(ADMIN_URL, process.env.DATABASE_URL);

const dbModule = await import("@workspace/db");
const { db, pool } = dbModule;
const { migrate } = await import("drizzle-orm/node-postgres/migrator");
const { ensureBusiness, getManualSource, wipeBusinessData } = await import("./business");
const catalog = await import("./catalog");
const ledger = await import("./ledger");
const budgets = await import("./budget");
const projects = await import("./project");

const MIGRATIONS = path.join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..", "..", "drizzle", "migrations");
const USER = "budget-test-user";
const day = (iso: string) => new Date(`${iso}T09:00:00Z`);

let businessId = "";
let sourceId = "";
let cementId = "";
let fuelId = "";
let buildId = "";

before(async () => {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  const exists = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [TEST_DB_NAME]);
  if (exists.rowCount === 0) await admin.query(`CREATE DATABASE ${TEST_DB_NAME}`);
  await admin.end();
  await migrate(db, { migrationsFolder: MIGRATIONS });

  await wipeBusinessData(USER);
  businessId = (await ensureBusiness(USER)).id;
  sourceId = (await getManualSource(businessId))!.id;
  cementId = (await catalog.createExpenseItem(businessId, { name: "Cement", type: "cogs" })).id;
  fuelId = (await catalog.createExpenseItem(businessId, { name: "Fuel", type: "operational" })).id;
  buildId = (
    await catalog.createRevenueItem(businessId, {
      name: "Building work",
      type: "service",
      pricingModel: "fixed",
      unitPriceCents: 500_000,
    })
  ).id;
});

after(async () => {
  await pool.end();
});

async function cost(expenseItemId: string, cents: number, when: string) {
  return ledger.createTransaction(businessId, {
    direction: "out",
    occurredAt: day(when),
    sourceId,
    lines: [{ expenseItemId, qty: "1", unitPriceCents: cents }],
  });
}

async function labelledCost(label: string, cents: number, when: string) {
  return ledger.createTransaction(businessId, {
    direction: "out",
    occurredAt: day(when),
    sourceId,
    lines: [{ label, qty: "1", unitPriceCents: cents }],
  });
}

test("a budget compares plan against what the ledger actually holds", async () => {
  const budget = await budgets.createBudget(businessId, {
    name: "August",
    periodStart: "2026-08-01",
    periodEnd: "2026-08-31",
    lines: [
      { side: "out", expenseItemId: cementId, amountCents: 100_000 },
      { side: "out", expenseItemId: fuelId, amountCents: 50_000 },
      { side: "in", revenueItemId: buildId, amountCents: 900_000 },
    ],
  });

  await cost(cementId, 40_000, "2026-08-05");
  await cost(cementId, 35_000, "2026-08-19");
  await cost(fuelId, 62_000, "2026-08-11");
  await ledger.createTransaction(businessId, {
    direction: "in",
    occurredAt: day("2026-08-20"),
    sourceId,
    lines: [{ revenueItemId: buildId, qty: "1", unitPriceCents: 800_000 }],
  });

  const detail = await budgets.computeBudgetDetail(businessId, USER, budget.id);
  const cement = detail.lines.find((line) => line.expenseItemId === cementId)!;
  const fuel = detail.lines.find((line) => line.expenseItemId === fuelId)!;
  const sales = detail.lines.find((line) => line.revenueItemId === buildId)!;

  assert.equal(cement.actualCents, 75_000);
  assert.equal(cement.over, false);
  assert.equal(fuel.actualCents, 62_000);
  assert.equal(fuel.over, true);
  assert.equal(fuel.overByCents, 12_000);
  assert.equal(sales.actualCents, 800_000);
  assert.equal(sales.name, "Building work", "the line resolves its own name");
});

test("spending outside the period does not reach the budget", async () => {
  await cost(cementId, 999_000, "2026-07-15");
  const [budget] = await budgets.listBudgets(businessId);
  const detail = await budgets.computeBudgetDetail(businessId, USER, budget.id);
  const cement = detail.lines.find((line) => line.expenseItemId === cementId)!;
  assert.equal(cement.actualCents, 75_000, "July's spending stayed in July");
});

test("money no budget line claims is SHOWN, not dropped", async () => {
  // The defect that motivated the rewrite: the old screen searched expense
  // names for words, and anything it failed to match vanished — so a business
  // could be far over its real spending while every line read under.
  await labelledCost("Skip hire", 18_000, "2026-08-22");
  await labelledCost("Site tea", 2_000, "2026-08-23");

  const [budget] = await budgets.listBudgets(businessId);
  const detail = await budgets.computeBudgetDetail(businessId, USER, budget.id);

  assert.equal(detail.unbudgeted.outCents, 20_000);
  assert.equal(detail.unbudgeted.count, 2);
  // And it counts toward the headline, or the total would understate exactly
  // as the old one did.
  assert.equal(detail.totals.out.actualCents, 75_000 + 62_000 + 20_000);
});

test("an exact label match claims its own cost and nothing near it", async () => {
  const budget = await budgets.createBudget(businessId, {
    name: "Label matching",
    periodStart: "2026-08-01",
    periodEnd: "2026-08-31",
    lines: [{ side: "out", label: "Skip hire", amountCents: 20_000 }],
  });
  await labelledCost("Skip hire deposit", 5_000, "2026-08-24");

  const detail = await budgets.computeBudgetDetail(businessId, USER, budget.id);
  const skip = detail.lines[0];
  assert.equal(skip.actualCents, 18_000, "'Skip hire' did not swallow 'Skip hire deposit'");
  assert.equal(detail.unbudgeted.count > 0, true, "the deposit is unbudgeted, not silently absorbed");
});

test("a capitalised purchase is budgeted the way the ladder counts it — by its slices", async () => {
  const budget = await budgets.createBudget(businessId, {
    name: "Spread year",
    periodStart: "2026-01-01",
    periodEnd: "2026-12-31",
    lines: [{ side: "out", expenseItemId: fuelId, amountCents: 100_000, basis: "per_month" }],
  });
  assert.equal(
    (await budgets.computeBudgetDetail(businessId, USER, budget.id)).lines[0].budgetedCents,
    1_200_000,
    "a per-month budget spans the year",
  );

  await ledger.createTransaction(businessId, {
    direction: "out",
    occurredAt: day("2026-01-10"),
    sourceId,
    lines: [{ expenseItemId: fuelId, qty: "1", unitPriceCents: 240_000, spreadMonths: 12 }],
  });

  const detail = await budgets.computeBudgetDetail(businessId, USER, budget.id);
  const fuel = detail.lines[0];
  // The purchase itself is capitalised and spends nothing; twelve slices carry
  // it. Anything else would disagree with the P&L on the same screen.
  assert.equal(fuel.actualCents, 240_000 + 62_000, "the machine plus August's ordinary fuel");
});

test("a project budget counts only money booked to that project", async () => {
  const site = await projects.createProject(businessId, { name: "Budgeted site" });
  const other = await projects.createProject(businessId, { name: "Other site" });

  await ledger.createTransaction(businessId, {
    direction: "out",
    occurredAt: day("2026-08-06"),
    sourceId,
    lines: [
      { expenseItemId: cementId, qty: "1", unitPriceCents: 30_000, targetType: "project", targetId: site.id },
    ],
  });
  await ledger.createTransaction(businessId, {
    direction: "out",
    occurredAt: day("2026-08-06"),
    sourceId,
    lines: [
      { expenseItemId: cementId, qty: "1", unitPriceCents: 90_000, targetType: "project", targetId: other.id },
    ],
  });

  const budget = await budgets.createBudget(businessId, {
    name: "Site budget",
    scope: "project",
    projectId: site.id,
    periodStart: "2026-08-01",
    periodEnd: "2026-08-31",
    lines: [{ side: "out", expenseItemId: cementId, amountCents: 50_000 }],
  });

  const detail = await budgets.computeBudgetDetail(businessId, USER, budget.id);
  assert.equal(detail.lines[0].actualCents, 30_000, "the other site's cement stayed out");
  assert.equal(detail.budget.projectName, "Budgeted site");
});

test("a project budget must name its project", async () => {
  await assert.rejects(
    budgets.createBudget(businessId, {
      name: "Nameless",
      scope: "project",
      periodStart: "2026-08-01",
      periodEnd: "2026-08-31",
    }),
    /which project/i,
  );
});

test("a budget line has to name exactly one thing", async () => {
  await assert.rejects(
    budgets.createBudget(businessId, {
      name: "Ambiguous",
      periodStart: "2026-08-01",
      periodEnd: "2026-08-31",
      lines: [{ side: "out", expenseItemId: cementId, label: "Cement", amountCents: 1_000 }],
    }),
    /exactly one thing/i,
  );
  await assert.rejects(
    budgets.createBudget(businessId, {
      name: "Empty",
      periodStart: "2026-08-01",
      periodEnd: "2026-08-31",
      lines: [{ side: "out", amountCents: 1_000 }],
    }),
    /exactly one thing/i,
  );
});

test("editing a budget REPLACES its lines rather than merging them", async () => {
  const budget = await budgets.createBudget(businessId, {
    name: "Replaceable",
    periodStart: "2026-08-01",
    periodEnd: "2026-08-31",
    lines: [
      { side: "out", expenseItemId: cementId, amountCents: 10_000 },
      { side: "out", expenseItemId: fuelId, amountCents: 20_000 },
    ],
  });
  await budgets.updateBudget(businessId, budget.id, {
    lines: [{ side: "out", expenseItemId: cementId, amountCents: 15_000 }],
  });

  const detail = await budgets.computeBudgetDetail(businessId, USER, budget.id);
  assert.equal(detail.lines.length, 1, "the removed line is gone, not left claiming money");
  assert.equal(detail.lines[0].budgetedCents, 15_000);
});

test("a profit goal produces a pace, and no goal produces no pace at all", async () => {
  const withGoal = await budgets.createBudget(businessId, {
    name: "Goal year",
    periodStart: "2026-01-01",
    periodEnd: "2026-12-31",
    targetProfitCents: 1_200_000,
  });
  const paced = await budgets.computeBudgetDetail(businessId, USER, withGoal.id);
  assert.ok(paced.pace);
  assert.equal(paced.pace.targetProfitCents, 1_200_000);
  assert.equal(paced.pace.monthsTotal, 12);

  const noGoal = await budgets.createBudget(businessId, {
    name: "Caps only",
    periodStart: "2026-01-01",
    periodEnd: "2026-12-31",
  });
  const unpaced = await budgets.computeBudgetDetail(businessId, USER, noGoal.id);
  // Capping spending without saying what you want left over is a real and
  // common way to use a budget, and it must not invent a target.
  assert.equal(unpaced.pace, null);
});

test("the suggestion reads real history and proposes a typical month", async () => {
  const suggestion = await budgets.suggestBudget(businessId, USER, 12);
  assert.ok(suggestion.lines.length > 0, "there is history to learn from");
  for (const line of suggestion.lines) {
    assert.ok(line.name.length > 0, "every suggestion names itself");
    assert.ok(line.medianMonthCents >= 0);
    assert.ok(Number.isSafeInteger(line.medianMonthCents));
    assert.ok(line.expenseItemId !== null || line.revenueItemId !== null, "catalogue items only");
  }
});

test("a category budget line counts costs entered by picking an item in that category", async () => {
  // The bug this catches: `loadActuals` read only the LINE's own category, and
  // a line that names a catalogue item carries none — the ITEM does. So every
  // category budget line read Rs 0 while the money was really being spent,
  // which is the exact failure the whole budget rewrite existed to remove, in
  // a new disguise. `read.ts` had the fallback right; this did not.
  const overheads = await catalog.createCategory(businessId, { name: "Overheads", appliesTo: "expense" });
  const insurance = await catalog.createExpenseItem(businessId, {
    name: "Site insurance",
    type: "operational",
    categoryId: overheads.id,
  });

  const budget = await budgets.createBudget(businessId, {
    name: "Overheads plan",
    periodStart: "2027-05-01",
    periodEnd: "2027-05-31",
    lines: [{ side: "out", categoryId: overheads.id, amountCents: 90_000 }],
  });

  // Entered the way the app enters it: pick the item, name no category.
  await cost(insurance.id, 55_000, "2027-05-07");

  const detail = await budgets.computeBudgetDetail(businessId, USER, budget.id);
  assert.equal(detail.lines[0].actualCents, 55_000, "the item's category is the line's category");
  assert.equal(detail.unbudgeted.outCents, 0, "and it is not left sitting in the unmatched bucket");
});
