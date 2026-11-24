/**
 * Money owed, against a real Postgres ledger.
 *
 * The domain module owns what "overdue" means and is unit-tested beside itself.
 * What this file proves is the part only a database can: that the right ROWS
 * reach each list, with the right amounts, and that the ones which must never
 * appear — spread slices, refunds, unconfirmed posts — stay off it.
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
const { db, pool, transactionsTable } = dbModule;
const { migrate } = await import("drizzle-orm/node-postgres/migrator");
const { eq } = await import("drizzle-orm");
const { ensureBusiness, getManualSource, wipeBusinessData } = await import("./business");
const catalog = await import("./catalog");
const ledger = await import("./ledger");
const { computeOwed } = await import("./owed");

const MIGRATIONS = path.join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..", "..", "drizzle", "migrations");
const USER = "owed-test-user";

const NOW = new Date("2026-09-03T11:30:00Z");
const day = (iso: string) => new Date(`${iso}T09:00:00Z`);

let businessId = "";
let sourceId = "";
let revenueItemId = "";
let expenseItemId = "";

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

  revenueItemId = (
    await catalog.createRevenueItem(businessId, {
      name: "Website build",
      type: "service",
      pricingModel: "fixed",
      unitPriceCents: 100_000,
    })
  ).id;
  expenseItemId = (
    await catalog.createExpenseItem(businessId, { name: "Office rent", type: "operational" })
  ).id;
});

after(async () => {
  await pool.end();
});

async function sale(over: { occurredAt: Date; dueDate?: string | null; paidAt?: Date | null; amount?: number }) {
  return ledger.createTransaction(businessId, {
    direction: "in",
    occurredAt: over.occurredAt,
    paidAt: over.paidAt === undefined ? null : over.paidAt,
    dueDate: over.dueDate ?? null,
    sourceId,
    lines: [{ revenueItemId, qty: "1", unitPriceCents: over.amount ?? 100_000 }],
  });
}

async function bill(over: { occurredAt: Date; dueDate?: string | null; amount?: number; spreadMonths?: number }) {
  return ledger.createTransaction(businessId, {
    direction: "out",
    occurredAt: over.occurredAt,
    paidAt: null,
    dueDate: over.dueDate ?? null,
    sourceId,
    lines: [
      {
        expenseItemId,
        qty: "1",
        unitPriceCents: over.amount ?? 50_000,
        ...(over.spreadMonths ? { spreadMonths: over.spreadMonths } : {}),
      },
    ],
  });
}

test("both sides are empty before anything is owed", async () => {
  const report = await computeOwed(businessId, USER, NOW);
  assert.equal(report.incoming.count, 0);
  assert.equal(report.outgoing.count, 0);
  assert.equal(report.incoming.totalCents, 0);
});

test("an unpaid sale is money coming to you; an unpaid bill is money you owe", async () => {
  await sale({ occurredAt: day("2026-08-01"), dueDate: "2026-08-31", amount: 100_000 });
  await bill({ occurredAt: day("2026-08-10"), dueDate: "2026-09-30", amount: 50_000 });

  const report = await computeOwed(businessId, USER, NOW);
  assert.equal(report.incoming.count, 1);
  assert.equal(report.incoming.totalCents, 100_000);
  assert.equal(report.outgoing.count, 1);
  assert.equal(report.outgoing.totalCents, 50_000);

  // The sale's date has passed; the bill's has not.
  assert.equal(report.incoming.rows[0].state, "overdue");
  assert.equal(report.incoming.rows[0].daysOverdue, 3);
  assert.equal(report.outgoing.rows[0].state, "not_due");
  assert.equal(report.outgoing.overdueCents, 0);
});

test("a paid sale leaves the list entirely", async () => {
  const paid = await sale({ occurredAt: day("2026-08-05"), paidAt: day("2026-08-06"), amount: 70_000 });
  const report = await computeOwed(businessId, USER, NOW);
  assert.ok(!report.incoming.rows.some((row) => row.id === paid.transaction.id));
  assert.equal(report.incoming.totalCents, 100_000, "the settled sale adds nothing to the total");
});

test("marking one paid removes it, and the total drops by exactly its amount", async () => {
  const before = await computeOwed(businessId, USER, NOW);
  const target = before.incoming.rows[0];

  await ledger.updateTransactionHeader(businessId, target.id, { paidAt: NOW });

  const after = await computeOwed(businessId, USER, NOW);
  assert.equal(after.incoming.count, before.incoming.count - 1);
  assert.equal(after.incoming.totalCents, before.incoming.totalCents - target.amountCents);
});

test("a spread purchase is owed ONCE, as the invoice — never again as its monthly slices", async () => {
  // The trap this guards: a capitalised purchase writes N child transactions,
  // and counting them alongside the parent owes the same money twice over.
  const kiln = await bill({ occurredAt: day("2026-08-15"), dueDate: "2026-09-15", amount: 240_000, spreadMonths: 12 });

  const slices = await db
    .select()
    .from(transactionsTable)
    .where(eq(transactionsTable.parentTransactionId, kiln.transaction.id));
  assert.ok(slices.length > 1, "the purchase really did generate slices");

  const report = await computeOwed(businessId, USER, NOW);
  const matching = report.outgoing.rows.filter((row) => row.amountCents === 240_000);
  assert.equal(matching.length, 1, "the invoice appears once");
  assert.ok(
    !report.outgoing.rows.some((row) => slices.some((slice) => slice.id === row.id)),
    "no slice is on the list",
  );
});

test("a refund owed to a customer is not a bill to chase", async () => {
  const settled = await sale({ occurredAt: day("2026-07-01"), paidAt: day("2026-07-02"), amount: 30_000 });
  const before = await computeOwed(businessId, USER, NOW);

  await ledger.createRefund(businessId, {
    transactionId: settled.transaction.id,
    occurredAt: day("2026-07-20"),
    requests: [{ lineId: settled.lines[0].id, qtyRefunded: "1", amountRefundedCents: 30_000 }],
  });

  const after = await computeOwed(businessId, USER, NOW);
  assert.equal(after.outgoing.count, before.outgoing.count, "the refund did not become a payable");
  assert.equal(after.incoming.count, before.incoming.count, "nor a receivable");
});

test("an undated bill is outstanding, and is never called overdue", async () => {
  const undated = await bill({ occurredAt: day("2026-05-01"), dueDate: null, amount: 12_000 });
  const report = await computeOwed(businessId, USER, NOW);
  const row = report.outgoing.rows.find((candidate) => candidate.id === undated.transaction.id);
  assert.ok(row);
  assert.equal(row.state, "no_due_date");
  assert.equal(row.daysOverdue, 0);
  assert.ok(row.daysOutstanding > 100, "it is still ageing");
  // It counts toward what is owed, but not toward what is late.
  assert.ok(report.outgoing.totalCents >= 12_000);
  assert.ok(!report.outgoing.rows.filter((r) => r.state === "overdue").some((r) => r.id === undated.transaction.id));
});

test("the buckets partition each side — nothing owed goes uncounted", async () => {
  const report = await computeOwed(businessId, USER, NOW);
  for (const side of [report.incoming, report.outgoing]) {
    assert.equal(
      side.buckets.reduce((sum, bucket) => sum + bucket.cents, 0),
      side.totalCents,
    );
    assert.equal(
      side.buckets.reduce((sum, bucket) => sum + bucket.count, 0),
      side.count,
    );
  }
});

test("the most broken promise sorts first, ahead of the merely oldest", async () => {
  const report = await computeOwed(businessId, USER, NOW);
  const rows = report.outgoing.rows;
  for (let i = 1; i < rows.length; i += 1) {
    const previous = rows[i - 1];
    const current = rows[i];
    assert.ok(
      previous.daysOverdue > current.daysOverdue ||
        (previous.daysOverdue === current.daysOverdue && previous.daysOutstanding >= current.daysOutstanding),
      `${previous.displayName} should not sort above ${current.displayName}`,
    );
  }
});
