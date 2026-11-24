/**
 * The trade pack against a real ledger: units, waste and assets.
 *
 * The arithmetic is unit-tested beside `lib/domain/waste.ts` and
 * `lib/domain/assets.ts`. What only a database can prove is that recording
 * waste changes NO money figure anywhere, and that the assets list is the
 * ledger's own spread purchases rather than a second copy of them.
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
const { createBusiness, getManualSource, wipeBusinessData } = await import("./business");
const { expenseItemsTable } = dbModule;
const { eq } = await import("drizzle-orm");
const catalog = await import("./catalog");
const ledger = await import("./ledger");
const trade = await import("@/app/api/reports/functions");
const read = await import("./read");

const MIGRATIONS = path.join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..", "..", "drizzle", "migrations");
const USER = "trade-test-user";
const day = (iso: string) => new Date(`${iso}T09:00:00Z`);
const ALL_TIME = { start: undefined, end: undefined };

let businessId = "";
let sourceId = "";
let cementId = "";

before(async () => {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  const exists = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [TEST_DB_NAME]);
  if (exists.rowCount === 0) await admin.query(`CREATE DATABASE ${TEST_DB_NAME}`);
  await admin.end();
  await migrate(db, { migrationsFolder: MIGRATIONS });

  await wipeBusinessData(USER);
  businessId = (await createBusiness(USER, { name: "Trade test", businessType: "construction" })).id;
  sourceId = (await getManualSource(businessId))!.id;
  cementId = (
    await catalog.createExpenseItem(businessId, {
      name: "Cement",
      type: "cogs",
      unitLabel: "bag",
      defaultAmountCents: 25_000,
    })
  ).id;
});

after(async () => {
  await pool.end();
});

// ── Units and rates ─────────────────────────────────────────────────────────

test("a construction business starts with units on the things that are counted", async () => {
  const items = await db.select().from(expenseItemsTable).where(eq(expenseItemsTable.businessId, businessId));
  const materials = items.find((item) => item.name === "Materials");
  const rent = items.find((item) => item.name === "Rent");
  assert.equal(materials?.unitLabel, "unit");
  // Rent is an amount, not a quantity. Inventing a unit for it would ask the
  // owner a question with no sensible answer.
  assert.equal(rent?.unitLabel, null);
});

test("an item's rate and unit prefill a purchase, so only the quantity is typed", async () => {
  const purchase = await ledger.createTransaction(businessId, {
    direction: "out",
    occurredAt: day("2026-08-01"),
    sourceId,
    // No unit price: it comes from the item's rate.
    lines: [{ expenseItemId: cementId, qty: "200" }],
  });
  assert.equal(purchase.lines[0].unitPriceCents, 25_000);
  assert.equal(purchase.lines[0].unitLabel, "bag", "the unit is frozen onto the line");

  const pnl = await read.computePnl(businessId, USER, ALL_TIME);
  assert.equal(pnl.ladder.periodExpenses, 5_000_000, "200 bags at Rs 250");
});

test("renaming the unit does not restate what past purchases were counted in", async () => {
  await catalog.updateExpenseItem(businessId, cementId, { unitLabel: "sack" });
  const [line] = await db
    .select()
    .from(dbModule.transactionLinesTable)
    .where(eq(dbModule.transactionLinesTable.expenseItemId, cementId));
  assert.equal(line.unitLabel, "bag", "frozen at write time, like a cost snapshot");
  await catalog.updateExpenseItem(businessId, cementId, { unitLabel: "bag" });
});

// ── Waste ───────────────────────────────────────────────────────────────────

test("recording waste changes NO money figure anywhere", async () => {
  // THE rule. You already paid for the bags; the ruined ones are a slice of a
  // cost the ledger holds, not an extra one. If this ever fails, every wasted
  // rupee is being counted twice.
  const before = await read.computePnl(businessId, USER, ALL_TIME);

  await ledger.createTransaction(businessId, {
    direction: "out",
    occurredAt: day("2026-08-10"),
    sourceId,
    lines: [{ expenseItemId: cementId, qty: "100", unitPriceCents: 25_000, wastedQty: "12" }],
  });

  const after = await read.computePnl(businessId, USER, ALL_TIME);
  assert.equal(
    after.ladder.periodExpenses,
    before.ladder.periodExpenses + 2_500_000,
    "the purchase counts once, and the waste adds nothing on top",
  );
});

test("the waste report values what was wasted at what it cost", async () => {
  const report = await trade.computeWasteReport(businessId, USER, ALL_TIME);
  assert.equal(report.totalWastedCents, 300_000, "12 bags at Rs 250");
  const cement = report.rows.find((row) => row.name === "Cement");
  assert.ok(cement);
  assert.equal(cement.wastedCents, 300_000);
  /**
   * 12 of the 100 bags on the purchase where waste WAS recorded — not 12 of the
   * 300 bought in total.
   *
   * The earlier 200-bag purchase had no waste figure at all, which is not the
   * same as a recorded zero. Averaging it in would assume nothing was wasted on
   * a delivery nobody checked, and would quietly flatter every rate on the
   * report. "Of the cement you tracked, 12% went to waste" is a claim the data
   * actually supports.
   */
  assert.equal(cement.ratePct, 12);
  assert.equal(cement.boughtCents, 2_500_000, "the tracked purchase, not every purchase");
});

test("wasting more than was bought is refused", async () => {
  await assert.rejects(
    ledger.createTransaction(businessId, {
      direction: "out",
      occurredAt: day("2026-08-11"),
      sourceId,
      lines: [{ expenseItemId: cementId, qty: "10", unitPriceCents: 25_000, wastedQty: "15" }],
    }),
    /waste more than you bought/i,
  );
});

test("a sale cannot be wasted — only something you bought", async () => {
  await assert.rejects(
    ledger.createTransaction(businessId, {
      direction: "in",
      occurredAt: day("2026-08-12"),
      sourceId,
      lines: [{ label: "A sale", qty: "1", unitPriceCents: 10_000, wastedQty: "1" }],
    }),
    /something you bought/i,
  );
});

// ── Assets ──────────────────────────────────────────────────────────────────

test("a purchase spread over months IS the asset record — no second table", async () => {
  await ledger.createTransaction(businessId, {
    direction: "out",
    occurredAt: day("2026-01-01"),
    sourceId,
    lines: [{ label: "Excavator", qty: "1", unitPriceCents: 2_400_000, spreadMonths: 24 }],
  });

  const report = await trade.computeAssetsReport(businessId, USER);
  const excavator = report.items.find((item) => item.name === "Excavator");
  assert.ok(excavator);
  assert.equal(excavator.purchaseCents, 2_400_000);
  assert.equal(excavator.spreadMonths, 24);
  // What has been charged plus what is still to come is always the purchase.
  assert.equal(excavator.usedCents + excavator.remainingCents, 2_400_000);
});

test("the assets list holds the purchase, never its monthly slices", async () => {
  // A spread purchase writes 24 child transactions. Counting them would list
  // the same excavator twenty-five times.
  const report = await trade.computeAssetsReport(businessId, USER, { includeFullyUsed: true });
  assert.equal(report.items.filter((item) => item.name === "Excavator").length, 1);
});

test("ordinary purchases are not assets", async () => {
  const report = await trade.computeAssetsReport(businessId, USER, { includeFullyUsed: true });
  assert.equal(report.items.some((item) => item.name === "Cement"), false);
});

test("a used-up asset is hidden unless asked for", async () => {
  await ledger.createTransaction(businessId, {
    direction: "out",
    occurredAt: day("2020-01-01"),
    sourceId,
    lines: [{ label: "Old mixer", qty: "1", unitPriceCents: 500_000, spreadMonths: 24 }],
  });

  const open = await trade.computeAssetsReport(businessId, USER);
  const all = await trade.computeAssetsReport(businessId, USER, { includeFullyUsed: true });
  assert.equal(open.items.some((item) => item.name === "Old mixer"), false);
  const old = all.items.find((item) => item.name === "Old mixer");
  assert.ok(old);
  assert.equal(old.remainingCents, 0);
  assert.equal(old.fullyUsed, true);
});

test("the totals are the sum of what is listed", async () => {
  const report = await trade.computeAssetsReport(businessId, USER);
  assert.equal(
    report.totalRemainingCents,
    report.items.reduce((sum, item) => sum + item.remainingCents, 0),
  );
  assert.equal(
    report.totalPurchaseCents,
    report.items.reduce((sum, item) => sum + item.purchaseCents, 0),
  );
});

test("an asset is named by its label, not by the bucket it was filed under", async () => {
  // Three machines bought against one "Plant purchase" expense item is the
  // ordinary way a builder files them. Named by the item, the screen shows
  // three identical rows and tells the owner nothing about what they own.
  const plant = await catalog.createExpenseItem(businessId, {
    name: "Plant purchase",
    type: "operational",
    behavior: "one_time",
  });
  for (const [label, cents] of [["Concrete mixer", 4_800_000], ["Scaffolding set", 2_600_000]] as const) {
    await ledger.createTransaction(businessId, {
      direction: "out",
      occurredAt: day("2026-02-01"),
      sourceId,
      lines: [{ expenseItemId: plant.id, label, qty: "1", unitPriceCents: cents, spreadMonths: 24 }],
    });
  }

  const report = await trade.computeAssetsReport(businessId, USER, { includeFullyUsed: true });
  const names = report.items.map((item) => item.name);
  assert.ok(names.includes("Concrete mixer"), `expected the label, got ${names.join(", ")}`);
  assert.ok(names.includes("Scaffolding set"));
  assert.equal(names.includes("Plant purchase"), false, "the bucket name is the fallback, not the answer");
});
