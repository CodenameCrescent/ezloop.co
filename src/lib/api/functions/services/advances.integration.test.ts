/**
 * Advances against a real ledger.
 *
 * The rules are unit-tested beside `lib/domain/advances.ts`. What only a
 * database can prove is the LIFECYCLE: cash out now, no cost yet, then a bill
 * arrives and the advance is drawn down — and the money is counted exactly once
 * across the whole of it.
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
const advances = await import("./advances");
const read = await import("./read");
const { computeOwed } = await import("./owed");

const MIGRATIONS = path.join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..", "..", "drizzle", "migrations");
const USER = "advance-test-user";
const day = (iso: string) => new Date(`${iso}T09:00:00Z`);
const AUGUST = { start: day("2026-08-01"), end: new Date("2026-08-31T23:59:59.999Z") };

let businessId = "";
let sourceId = "";
let subcontractorId = "";

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
  subcontractorId = (await catalog.createExpenseItem(businessId, { name: "Subcontractors", type: "cogs" })).id;
});

after(async () => {
  await pool.end();
});

async function advance(cents: number, when: string) {
  return ledger.createTransaction(businessId, {
    direction: "out",
    occurredAt: day(when),
    paidAt: day(when),
    sourceId,
    lines: [{ expenseItemId: subcontractorId, qty: "1", unitPriceCents: cents, isAdvance: true }],
  });
}

async function bill(cents: number, when: string) {
  return ledger.createTransaction(businessId, {
    direction: "out",
    occurredAt: day(when),
    paidAt: null,
    sourceId,
    lines: [{ expenseItemId: subcontractorId, qty: "1", unitPriceCents: cents }],
  });
}

test("an advance is cash out today and no cost at all", async () => {
  await advance(200_000, "2026-08-01");

  const accrual = await read.computePnl(businessId, USER, AUGUST, "accrual");
  const cash = await read.computePnl(businessId, USER, AUGUST, "cash");

  // The month the money left the bank had no work done in it. Charging the
  // advance to profit would report a loss August did not have.
  assert.equal(accrual.ladder.periodExpenses, 0);
  assert.equal(cash.ladder.periodExpenses, 200_000);
});

test("an advance is not owed to anyone — it is already paid", async () => {
  const owed = await computeOwed(businessId, USER, day("2026-09-03"));
  assert.equal(owed.outgoing.count, 0, "money already paid is not a bill to chase");
});

test("it shows on the paid-ahead list with its whole amount still on it", async () => {
  const open = await advances.listOpenAdvances(businessId, USER);
  assert.equal(open.length, 1);
  assert.equal(open[0].amountCents, 200_000);
  assert.equal(open[0].usedCents, 0);
  assert.equal(open[0].remainingCents, 200_000);
  assert.equal(open[0].direction, "out");
});

test("the bill arrives, and settling from the advance draws it down", async () => {
  const invoice = await bill(500_000, "2026-08-20");
  const advanceRow = (await advances.listOpenAdvances(businessId, USER))[0];

  const result = await advances.settleFromAdvance(businessId, {
    transactionId: invoice.transaction.id,
    advanceTransactionId: advanceRow.id,
    appliedOn: "2026-08-20",
  });

  assert.equal(result.appliedCents, 200_000, "the whole advance goes, since the bill is bigger");
  assert.equal(result.billStillOwesCents, 300_000);
  assert.equal(result.advanceRemainingCents, 0);
  assert.equal(result.billSettled, false, "Rs 300,000 is still owed");
});

test("the money is counted ONCE across the whole lifecycle", async () => {
  // The trap: the advance was cash out in August and the bill is a cost in
  // August, so a careless implementation charges Rs 700,000 for Rs 500,000 of
  // work. Accrual counts the bill only; cash counts what actually moved.
  const accrual = await read.computePnl(businessId, USER, AUGUST, "accrual");
  assert.equal(accrual.ladder.periodExpenses, 500_000, "the bill, and only the bill");

  const cash = await read.computePnl(businessId, USER, AUGUST, "cash");
  assert.equal(cash.ladder.periodExpenses, 200_000, "only the advance actually left the bank");
});

test("a used-up advance leaves the paid-ahead list", async () => {
  const open = await advances.listOpenAdvances(businessId, USER);
  assert.equal(open.length, 0, "nothing is paid ahead any more");
});

test("only what is LEFT on the bill is owed — the advance already covered the rest", async () => {
  // Without this the list keeps chasing money that has already changed hands,
  // which is the exact overstatement the advance was recorded to avoid.
  const owed = await computeOwed(businessId, USER, day("2026-09-03"));
  assert.equal(owed.outgoing.count, 1);
  assert.equal(owed.outgoing.rows[0].amountCents, 300_000, "Rs 500,000 bill less the Rs 200,000 advance");
  assert.equal(owed.outgoing.totalCents, 300_000);
});

test("settling the rest marks the bill paid, and paid_at stays the one answer", async () => {
  const second = await advance(300_000, "2026-08-25");
  const [invoice] = await db
    .select()
    .from(transactionsTable)
    .where(eq(transactionsTable.id, (await computeOwed(businessId, USER, day("2026-09-03"))).outgoing.rows[0].id));

  const result = await advances.settleFromAdvance(businessId, {
    transactionId: invoice.id,
    advanceTransactionId: second.transaction.id,
    appliedOn: "2026-08-26",
  });
  assert.equal(result.appliedCents, 300_000);
  assert.equal(result.billSettled, true);

  const [after] = await db.select().from(transactionsTable).where(eq(transactionsTable.id, invoice.id));
  assert.ok(after.paidAt, "paid_at is what says it is settled");

  const owed = await computeOwed(businessId, USER, day("2026-09-03"));
  assert.equal(owed.outgoing.count, 0, "and the owed list agrees");
});

test("an advance cannot be over-drawn", async () => {
  const spare = await advance(50_000, "2026-08-28");
  const invoice = await bill(400_000, "2026-08-29");
  await assert.rejects(
    advances.settleFromAdvance(businessId, {
      transactionId: invoice.transaction.id,
      advanceTransactionId: spare.transaction.id,
      amountCents: 90_000,
    }),
    /can be applied/i,
  );
});

test("an advance cannot settle a bill facing the other way", async () => {
  // A customer's deposit does not pay a supplier. Netting them would cancel two
  // unrelated obligations against each other.
  const deposit = await ledger.createTransaction(businessId, {
    direction: "in",
    occurredAt: day("2026-08-02"),
    paidAt: day("2026-08-02"),
    sourceId,
    lines: [{ label: "Customer deposit", qty: "1", unitPriceCents: 100_000, isAdvance: true }],
  });
  const supplierBill = await bill(100_000, "2026-08-30");

  await assert.rejects(
    advances.settleFromAdvance(businessId, {
      transactionId: supplierBill.transaction.id,
      advanceTransactionId: deposit.transaction.id,
    }),
    /moving the same way/i,
  );
});

test("a deposit taken from a customer is money held, not revenue", async () => {
  const accrual = await read.computePnl(businessId, USER, AUGUST, "accrual");
  assert.equal(accrual.ladder.grossRevenue, 0, "a deposit has not been earned");

  const cash = await read.computePnl(businessId, USER, AUGUST, "cash");
  assert.equal(cash.ladder.grossRevenue, 100_000, "but the cash did arrive");

  const open = await advances.listOpenAdvances(businessId, USER);
  const held = open.find((row) => row.direction === "in");
  assert.ok(held, "it is money being held on someone's behalf");
  assert.equal(held.remainingCents, 100_000);
});

test("a settled bill cannot be settled again", async () => {
  const paid = await ledger.createTransaction(businessId, {
    direction: "out",
    occurredAt: day("2026-08-05"),
    paidAt: day("2026-08-05"),
    sourceId,
    lines: [{ expenseItemId: subcontractorId, qty: "1", unitPriceCents: 10_000 }],
  });
  const spare = await advance(20_000, "2026-08-06");
  await assert.rejects(
    advances.settleFromAdvance(businessId, {
      transactionId: paid.transaction.id,
      advanceTransactionId: spare.transaction.id,
    }),
    /already settled/i,
  );
});

test("a cost inside a sale cannot be an advance — it has already happened", async () => {
  await assert.rejects(
    ledger.createTransaction(businessId, {
      direction: "in",
      occurredAt: day("2026-08-10"),
      sourceId,
      lines: [
        { label: "Job", direction: "in", qty: "1", unitPriceCents: 100_000 },
        { expenseItemId: subcontractorId, direction: "out", qty: "1", unitPriceCents: 20_000, isAdvance: true },
      ],
    }),
    /already happened/i,
  );
});

test("money paid ahead cannot also be spread over months", async () => {
  await assert.rejects(
    ledger.createTransaction(businessId, {
      direction: "out",
      occurredAt: day("2026-08-11"),
      paidAt: day("2026-08-11"),
      sourceId,
      lines: [
        { expenseItemId: subcontractorId, qty: "1", unitPriceCents: 240_000, isAdvance: true, spreadMonths: 12 },
      ],
    }),
    /cannot also be spread/i,
  );
});

/**
 * The Dashboard and the Money owed screen must say the same thing.
 *
 * They did not. `owed.ts` subtracts what an advance has already covered; the
 * leaks report — which is where the Dashboard's "You owe" tile comes from — had
 * its own copy of the payables sum and had never heard of advances. On the
 * construction demo that was Rs 1,154,000 on one screen and Rs 1,004,000 on the
 * other, for the same business at the same moment, with the Rs 150,000 a
 * deposit had already settled chased twice.
 *
 * The fix was to delete the second copy rather than teach it the rule, so this
 * asserts the two reports AGREE rather than asserting a figure — the figure is
 * already pinned by the test above, and a test that repeated it would pass just
 * as happily with the two screens wired to two different sums again.
 */
test("what the Dashboard says you owe is what the Money owed screen says", async () => {
  const analytics = await import("./analytics");
  const PRIOR = { start: day("2026-07-01"), end: new Date("2026-07-31T23:59:59.999Z") };
  const bothSides = async () => {
    const owed = await computeOwed(businessId, USER, new Date("2026-08-31T12:00:00Z"));
    const leaks = await analytics.computeLeaks(businessId, USER, AUGUST, PRIOR);
    return { owed, leaks };
  };

  const before = await bothSides();

  // A fresh pair of this test's own, so the assertions below measure THIS
  // advance rather than everything the file has accumulated above.
  const deposit = await advance(50_000, "2026-08-05");
  const invoice = await bill(120_000, "2026-08-25");
  await advances.settleFromAdvance(businessId, {
    transactionId: invoice.transaction.id,
    advanceTransactionId: deposit.transaction.id,
    appliedOn: "2026-08-25",
  });

  const after = await bothSides();

  assert.equal(
    after.leaks.unpaidPayables.totalCents,
    after.owed.outgoing.totalCents,
    "the two screens disagree about what you owe",
  );
  assert.equal(after.leaks.unpaidPayables.count, after.owed.outgoing.count);
  assert.equal(
    after.leaks.unpaidAging.totalCents,
    after.owed.incoming.totalCents,
    "and about what you are owed",
  );

  // Not vacuously equal: the bill really is part-settled, so a sum that ignored
  // the advance would have grown by the whole Rs 120,000.
  assert.equal(
    after.owed.outgoing.totalCents - before.owed.outgoing.totalCents,
    70_000,
    "Rs 120,000 bill less the Rs 50,000 already paid ahead",
  );
});
