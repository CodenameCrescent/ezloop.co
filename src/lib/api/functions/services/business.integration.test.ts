/**
 * Wiping a business, and the bug that has now happened four times.
 *
 * `wipeBusinessById` deletes children before parents by hand, in an order
 * written out longhand. Every time a new table gained a foreign key — projects,
 * payment applications, budgets — the wipe was not told about it, and the
 * failure landed somewhere far away: a seed script that crashed, or a test file
 * whose `before` hook died on data the PREVIOUS run left behind. Budgets were
 * the fourth, and they made `pnpm db:demo` unrunnable for anyone who had made a
 * budget in the app.
 *
 * So the check here does not name tables. It ASKS THE DATABASE which tables
 * carry a `business_id`, and asserts every one of them is empty afterwards. A
 * table added next month is covered the day it is created, by nobody
 * remembering anything.
 */
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import path from "node:path";
import pg from "pg";
import { eq } from "drizzle-orm";
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
const { createBusiness, getManualSource, wipeBusinessById, wipeBusinessData } = await import("./business");
const { expenseItemsTable, importBatchesTable, integrationsTable, peopleTable, revenueItemsTable, transactionsTable } =
  dbModule;
const { uid } = await import("../lib/uid");
const shopify = await import("../integrations/shopify");
const catalog = await import("./catalog");
const ledger = await import("./ledger");
const budgets = await import("./budget");
const projects = await import("./project");
const advances = await import("./advances");
const { findOrCreatePerson } = await import("./person");

const MIGRATIONS = path.join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..", "..", "drizzle", "migrations");
const USER = "wipe-test-user";
const day = (iso: string) => new Date(`${iso}T09:00:00Z`);

before(async () => {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  const exists = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [TEST_DB_NAME]);
  if (exists.rowCount === 0) await admin.query(`CREATE DATABASE ${TEST_DB_NAME}`);
  await admin.end();
  await migrate(db, { migrationsFolder: MIGRATIONS });
});

after(async () => {
  await pool.end();
});

/** Every table the schema scopes by business, straight from the catalog. */
async function businessScopedTables(): Promise<string[]> {
  const { rows } = await pool.query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.columns
      WHERE table_schema = 'public' AND column_name = 'business_id'
      ORDER BY table_name`,
  );
  return rows.map((row) => row.table_name);
}

/**
 * A business with one of everything that has ever tripped the wipe, plus the
 * ordinary money it all hangs off. Written as a single fixture rather than one
 * per test because the thing being checked is the ORDER of deletes, which only
 * breaks when the whole graph is present at once.
 */
async function buildFullBusiness() {
  const business = await createBusiness(USER, { name: "Everything Ltd", businessType: "construction" });
  const businessId = business.id;
  const sourceId = (await getManualSource(businessId))!.id;

  // A connected account, with the channel it posts through. This one is the
  // reason the fixture has to be exhaustive rather than representative: the
  // enumerating query below finds a FORGOTTEN table, but a wrong DELETE ORDER
  // only breaks when the row actually exists.
  const [integration] = await db
    .insert(integrationsTable)
    .values({
      id: uid("int"),
      userId: USER,
      businessId,
      kind: "shopify",
      displayName: "Shopify",
      externalAccount: "wipe-test.myshopify.com",
    })
    .returning();
  await shopify.ensureIntegrationSource(integration);

  const customer = await findOrCreatePerson(businessId, { name: "Askari Housing", kind: "customer" });
  const category = await catalog.createCategory(businessId, { name: "Site costs", appliesTo: "expense" });
  const cement = await catalog.createExpenseItem(businessId, {
    name: "Cement",
    type: "cogs",
    unitLabel: "bag",
  });
  const work = await catalog.createRevenueItem(businessId, {
    name: "Building work",
    type: "service",
    pricingModel: "fixed",
    unitPriceCents: 500_000,
  });
  await catalog.addCostComponent(businessId, work.id, {
    name: "Crew",
    calcType: "fixed_per_unit",
    valueCents: 100_000,
    effectiveFrom: day("2026-01-01"),
  });

  const project = await projects.createProject(businessId, {
    name: "Boundary wall",
    personId: customer.id,
    contractValueCents: 2_000_000,
  });

  // A purchase with a unit, waste and a project target, spread over months —
  // the shape that touches the most columns at once.
  const purchase = await ledger.createTransaction(businessId, {
    direction: "out",
    occurredAt: day("2026-02-01"),
    paidAt: day("2026-02-01"),
    sourceId,
    lines: [
      {
        expenseItemId: cement.id,
        qty: "200",
        unitPriceCents: 115_000,
        wastedQty: "12",
        targetType: "project",
        targetId: project.id,
      },
      { label: "Mixer", qty: "1", unitPriceCents: 2_400_000, spreadMonths: 24 },
    ],
  });

  // A sale, refunded — so adjustment rows exist too.
  const sale = await ledger.createTransaction(businessId, {
    direction: "in",
    occurredAt: day("2026-02-05"),
    paidAt: day("2026-02-05"),
    sourceId,
    personId: customer.id,
    lines: [{ revenueItemId: work.id, qty: "1" }],
  });
  await ledger.createRefund(businessId, {
    transactionId: sale.transaction.id,
    requests: sale.lines.map((line) => ({
      lineId: line.id,
      qtyRefunded: "1",
      amountRefundedCents: line.unitPriceCents,
      restocked: false,
    })),
    occurredAt: day("2026-02-10"),
  });

  // An advance, drawn down against a bill — payment_applications, tripped once.
  const advance = await ledger.createTransaction(businessId, {
    direction: "out",
    occurredAt: day("2026-02-02"),
    paidAt: day("2026-02-02"),
    sourceId,
    lines: [{ label: "Advance to mason", qty: "1", unitPriceCents: 300_000, isAdvance: true }],
  });
  const bill = await ledger.createTransaction(businessId, {
    direction: "out",
    occurredAt: day("2026-03-01"),
    paidAt: null,
    dueDate: "2026-03-31",
    sourceId,
    lines: [{ label: "Mason final", qty: "1", unitPriceCents: 800_000 }],
  });
  await advances.settleFromAdvance(businessId, {
    transactionId: bill.transaction.id,
    advanceTransactionId: advance.transaction.id,
  });

  // Both budget scopes: a period plan and one tied to the project.
  await budgets.createBudget(businessId, {
    name: "This year",
    periodStart: "2026-01-01",
    periodEnd: "2026-12-31",
    targetProfitCents: 1_000_000,
    lines: [
      { side: "out", expenseItemId: cement.id, amountCents: 5_000_000 },
      { side: "out", categoryId: category.id, amountCents: 1_000_000 },
      { side: "out", label: "Skip hire", amountCents: 200_000 },
      { side: "in", revenueItemId: work.id, amountCents: 9_000_000 },
    ],
  });
  await budgets.createBudget(businessId, {
    name: "Boundary wall plan",
    scope: "project",
    projectId: project.id,
    periodStart: "2026-01-01",
    periodEnd: "2026-06-30",
    lines: [{ side: "out", expenseItemId: cement.id, amountCents: 1_400_000 }],
  });

  // Retention: two receivables from one bill.
  await projects.billProject(businessId, project.id, {
    amountCents: 1_000_000,
    occurredAt: day("2026-03-05"),
    label: "Stage 1",
    dueDate: "2026-04-05",
    retentionPct: "5",
    retentionDueDate: "2026-09-05",
  });

  // An import batch, plus rows pointing at it. A batch that nothing references
  // would let a wrong DELETE order pass — which is exactly how this broke
  // before. It is stamped onto one row in each of the four tables that carry
  // `import_batch_id`, so moving the batch delete above ANY of them raises.
  const batchId = uid("imp");
  await db.insert(importBatchesTable).values({
    id: batchId,
    businessId,
    kind: "transactions",
    filename: "statement.csv",
    sourceId,
  });
  await db
    .update(transactionsTable)
    .set({ importBatchId: batchId })
    .where(eq(transactionsTable.id, purchase.transaction.id));
  await db.update(revenueItemsTable).set({ importBatchId: batchId }).where(eq(revenueItemsTable.id, work.id));
  await db.update(expenseItemsTable).set({ importBatchId: batchId }).where(eq(expenseItemsTable.id, cement.id));
  await db.update(peopleTable).set({ importBatchId: batchId }).where(eq(peopleTable.id, customer.id));

  return { businessId, purchaseId: purchase.transaction.id };
}

test("a business holding one of everything can still be wiped", async () => {
  await wipeBusinessData(USER);
  const { businessId } = await buildFullBusiness();

  // The assertion is that this does not throw. Every previous instance of this
  // bug was a foreign key raised from inside here, three tables deep.
  await wipeBusinessById(businessId);

  const { rows } = await pool.query<{ n: string }>(
    "SELECT count(*)::text AS n FROM businesses WHERE id = $1",
    [businessId],
  );
  assert.equal(rows[0].n, "0", "the business row itself should be gone");
});

test("every table scoped by business is empty afterwards", async () => {
  await wipeBusinessData(USER);
  const { businessId } = await buildFullBusiness();

  // Proof the fixture is worth anything: at least most of these hold rows now.
  const tables = await businessScopedTables();
  assert.ok(tables.length > 10, "expected the schema to scope many tables by business");

  const populated: string[] = [];
  for (const table of tables) {
    const { rows } = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM "${table}" WHERE business_id = $1`,
      [businessId],
    );
    if (rows[0].n !== "0") populated.push(table);
  }
  assert.ok(
    populated.length >= 8,
    `fixture is too thin to prove anything — only filled ${populated.join(", ")}`,
  );

  await wipeBusinessById(businessId);

  const leftover: string[] = [];
  for (const table of tables) {
    const { rows } = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM "${table}" WHERE business_id = $1`,
      [businessId],
    );
    if (rows[0].n !== "0") leftover.push(`${table} (${rows[0].n})`);
  }
  assert.deepEqual(leftover, [], `wipeBusinessById forgot: ${leftover.join(", ")}`);
});

test("a reset keeps the business open for entry", async () => {
  await wipeBusinessData(USER);
  const { businessId } = await buildFullBusiness();

  await wipeBusinessById(businessId, { keepBusiness: true });

  // Zero setup entry is a product requirement, so the channel has to come back.
  const manual = await getManualSource(businessId);
  assert.ok(manual, "a reset business should still have its Manual source");

  const tables = await businessScopedTables();
  for (const table of tables) {
    // The three a reset keeps on purpose: the business itself, its Manual
    // channel (zero-setup entry is a product requirement), its settings — and
    // the connected account, because emptying the books is not unplugging the
    // shop.
    if (table === "businesses" || table === "sources" || table === "business_settings") continue;
    if (table === "integrations") continue;
    const { rows } = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM "${table}" WHERE business_id = $1`,
      [businessId],
    );
    assert.equal(rows[0].n, "0", `${table} should be empty after a reset`);
  }

  await wipeBusinessData(USER);
});
