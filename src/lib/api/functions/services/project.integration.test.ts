/**
 * Projects against a real ledger.
 *
 * The arithmetic is unit-tested beside `lib/domain/projectProfit.ts`. What only
 * a database can prove is that money REACHES a project — through ordinary lines,
 * through a split bill, through the monthly slices of a spread purchase — and
 * that retention writes two honest receivables rather than one confused one.
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
const projects = await import("./project");
const read = await import("./read");
const { computeOwed } = await import("./owed");

const MIGRATIONS = path.join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..", "..", "drizzle", "migrations");
const USER = "project-test-user";
const NOW = new Date("2026-09-03T11:30:00Z");
const day = (iso: string) => new Date(`${iso}T09:00:00Z`);

let businessId = "";
let sourceId = "";
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
  expenseItemId = (await catalog.createExpenseItem(businessId, { name: "Materials", type: "cogs" })).id;
});

after(async () => {
  await pool.end();
});

async function moneyFor(projectId: string) {
  const project = await projects.getProject(businessId, projectId);
  const map = await projects.computeProjectMoney(businessId, [project]);
  return map.get(projectId)!;
}

test("a new project has no money and says so with nulls, not zeros", async () => {
  const project = await projects.createProject(businessId, { name: "Gulberg Villa" });
  const money = await moneyFor(project.id);
  assert.equal(money.billedCents, 0);
  assert.equal(money.costToDateCents, 0);
  // Nothing billed means no margin to measure. Zero percent would be a claim.
  assert.equal(money.marginPct, null);
  // No contract value means nothing to measure billing against.
  assert.equal(money.leftToBillCents, null);
});

test("costs booked to a project land on it, and revenue does too", async () => {
  const project = await projects.createProject(businessId, {
    name: "Phase 2",
    contractValueCents: 1_000_000,
  });

  await ledger.createTransaction(businessId, {
    direction: "out",
    occurredAt: day("2026-08-05"),
    sourceId,
    lines: [
      { expenseItemId, qty: "1", unitPriceCents: 300_000, targetType: "project", targetId: project.id },
    ],
  });
  await ledger.createTransaction(businessId, {
    direction: "in",
    occurredAt: day("2026-08-20"),
    paidAt: null,
    sourceId,
    lines: [{ label: "Stage 1", qty: "1", unitPriceCents: 600_000, targetType: "project", targetId: project.id }],
  });

  const money = await moneyFor(project.id);
  assert.equal(money.directCostCents, 300_000);
  assert.equal(money.billedCents, 600_000);
  assert.equal(money.contributionProfitCents, 300_000);
  assert.equal(money.leftToBillCents, 400_000);
  // Billed but unpaid: the project has earned it and has not received it.
  assert.equal(money.receivedCents, 0);
  assert.equal(money.stillOwedCents, 600_000);
});

test("a sale can ONLY be booked against a project — never a client or an item", async () => {
  const client = await ledger.createTransaction(businessId, {
    direction: "in",
    occurredAt: day("2026-08-01"),
    sourceId,
    lines: [{ label: "Anything", qty: "1", unitPriceCents: 1_000 }],
  });
  assert.ok(client.transaction.id, "an untargeted sale is still fine");

  await assert.rejects(
    ledger.createTransaction(businessId, {
      direction: "in",
      occurredAt: day("2026-08-01"),
      sourceId,
      lines: [
        { label: "Wrong target", qty: "1", unitPriceCents: 1_000, targetType: "internal", targetId: "whatever" },
      ],
    }),
    /only be recorded against a project/i,
  );
});

test("one bill split across two projects reaches both, and the parts sum to the bill", async () => {
  const a = await projects.createProject(businessId, { name: "Split site A" });
  const b = await projects.createProject(businessId, { name: "Split site B" });

  await ledger.createTransaction(businessId, {
    direction: "out",
    occurredAt: day("2026-08-10"),
    sourceId,
    lines: [
      {
        expenseItemId,
        qty: "1",
        unitPriceCents: 100_000,
        split: [
          { targetType: "project", targetId: a.id, weight: "60" },
          { targetType: "project", targetId: b.id, weight: "40" },
        ],
      },
    ],
  });

  const moneyA = await moneyFor(a.id);
  const moneyB = await moneyFor(b.id);
  assert.equal(moneyA.directCostCents, 60_000);
  assert.equal(moneyB.directCostCents, 40_000);
  assert.equal(moneyA.directCostCents + moneyB.directCostCents, 100_000, "no money invented or lost");
});

test("a machine bought for a site charges that site across every month it covers", async () => {
  const site = await projects.createProject(businessId, { name: "Spread site" });
  const purchase = await ledger.createTransaction(businessId, {
    direction: "out",
    occurredAt: day("2026-04-01"),
    sourceId,
    lines: [
      {
        expenseItemId,
        qty: "1",
        unitPriceCents: 240_000,
        spreadMonths: 12,
        targetType: "project",
        targetId: site.id,
      },
    ],
  });

  const slices = await db
    .select()
    .from(transactionsTable)
    .where(eq(transactionsTable.parentTransactionId, purchase.transaction.id));
  assert.equal(slices.length, 12, "twelve months, twelve slices");

  // The purchase itself is capitalised and spends nothing; the slices carry the
  // cost, and they inherited the project from their line.
  const money = await moneyFor(site.id);
  assert.equal(money.directCostCents, 240_000, "the site is charged the whole machine, exactly once");
});

test("hours booked to a project cost it, at the rate frozen on the day", async () => {
  const site = await projects.createProject(businessId, { name: "Labour site" });
  const worker = await (await import("./person")).findOrCreatePerson(businessId, {
    name: "Site foreman",
    kind: "employee",
  });
  const team = await import("./team");
  await team.setTeamMemberRate(businessId, worker.id, {
    costType: "hourly",
    hourlyRateCents: 50_000,
    effectiveFrom: day("2026-01-01"),
  });

  const timesheet = await import("./timesheet");
  await timesheet.setTimesheetCell(businessId, {
    personId: worker.id,
    targetType: "project",
    targetId: site.id,
    entryDate: "2026-08-12",
    hours: "8",
  });

  const money = await moneyFor(site.id);
  assert.equal(money.labourCostCents, 400_000, "eight hours at Rs 500");
  assert.equal(money.costToDateCents, 400_000);
});

// ── Retention ───────────────────────────────────────────────────────────────

test("billing with retention writes TWO receivables that sum to the invoice", async () => {
  const site = await projects.createProject(businessId, {
    name: "Retention site",
    contractValueCents: 2_000_000,
  });

  const result = await projects.billProject(businessId, site.id, {
    amountCents: 1_000_000,
    occurredAt: day("2026-08-01"),
    label: "Stage 1 completion",
    dueDate: "2026-08-31",
    retentionPct: "10",
    retentionDueDate: "2027-08-31",
  });

  assert.equal(result.transactionIds.length, 2);
  assert.equal(result.dueNowCents, 900_000);
  assert.equal(result.heldBackCents, 100_000);
  assert.equal(result.dueNowCents + result.heldBackCents, 1_000_000);

  // Both are money the project has earned — retention is billed work, not a
  // discount — so the project's billed figure is the whole invoice.
  const money = await moneyFor(site.id);
  assert.equal(money.billedCents, 1_000_000);
  assert.equal(money.leftToBillCents, 1_000_000);
});

test("the held-back part is owed on ITS OWN date, and is not late while the main part is", async () => {
  const owed = await computeOwed(businessId, USER, NOW);
  const rows = owed.incoming.rows;

  const main = rows.find((row) => row.displayName === "Stage 1 completion");
  const held = rows.find((row) => row.displayName.includes("held back"));
  assert.ok(main, "the main invoice is owed");
  assert.ok(held, "so is the retention");

  // The whole point of two rows rather than one part-paid row: they have
  // different deadlines and only one of them has been missed.
  assert.equal(main.state, "overdue");
  assert.equal(held.state, "not_due");
  assert.equal(held.amountCents, 100_000);
  assert.equal(held.dueDate, "2027-08-31");
});

test("retention without a release date is refused rather than left undated for ever", async () => {
  const site = await projects.createProject(businessId, { name: "No release date" });
  await assert.rejects(
    projects.billProject(businessId, site.id, {
      amountCents: 500_000,
      occurredAt: day("2026-08-01"),
      label: "Stage 1",
      retentionPct: "10",
    }),
    /when the held-back money is due/i,
  );
});

test("billing without retention writes one ordinary invoice", async () => {
  const site = await projects.createProject(businessId, { name: "Plain billing" });
  const result = await projects.billProject(businessId, site.id, {
    amountCents: 250_000,
    occurredAt: day("2026-08-01"),
    label: "Full and final",
    dueDate: "2026-09-30",
  });
  assert.equal(result.transactionIds.length, 1);
  assert.equal(result.heldBackCents, 0);
  assert.equal((await moneyFor(site.id)).billedCents, 250_000);
});

test("cost per unit made divides the project's whole cost by what it produced", async () => {
  const batch = await projects.createProject(businessId, {
    name: "Batch 4412",
    outputQty: "500",
    outputUnitLabel: "unit",
  });
  await ledger.createTransaction(businessId, {
    direction: "out",
    occurredAt: day("2026-08-02"),
    sourceId,
    lines: [{ expenseItemId, qty: "1", unitPriceCents: 400_000, targetType: "project", targetId: batch.id }],
  });

  const money = await moneyFor(batch.id);
  assert.equal(money.costPerUnitCents, 800, "Rs 4,000 across 500 units is Rs 8 each");
});

test("refunding a project's invoice reduces what that project has earned", async () => {
  // The gap this closes: a refund line used to name nobody, so a site billed
  // Rs 2,000,000 and refunded Rs 500,000 went on reporting Rs 2,000,000 earned
  // for ever. Refund lines now inherit the target of the line they reverse, and
  // the reader subtracts them.
  const site = await projects.createProject(businessId, { name: "Refund site" });
  const invoice = await ledger.createTransaction(businessId, {
    direction: "in",
    occurredAt: day("2026-08-01"),
    paidAt: day("2026-08-02"),
    sourceId,
    lines: [{ label: "Stage 1", qty: "1", unitPriceCents: 200_000, targetType: "project", targetId: site.id }],
  });

  const before = await moneyFor(site.id);
  assert.equal(before.billedCents, 200_000);
  assert.equal(before.receivedCents, 200_000);

  await ledger.createRefund(businessId, {
    transactionId: invoice.transaction.id,
    occurredAt: day("2026-08-20"),
    requests: [{ lineId: invoice.lines[0].id, qtyRefunded: "1", amountRefundedCents: 50_000 }],
  });

  const after = await moneyFor(site.id);
  assert.equal(after.billedCents, 150_000, "the refund came off what the project earned");
  // A refund is paid the moment it is posted, so the cash went back too.
  assert.equal(after.receivedCents, 150_000);
  assert.equal(after.contributionProfitCents, 150_000);
});

test("refunding a cost booked to a project gives that project its money back", async () => {
  // The mirror: a supplier credit on materials should reduce the site's cost,
  // not add to it. Refund lines inherit the original's direction, so without
  // the sign this would have made the site look MORE expensive.
  const site = await projects.createProject(businessId, { name: "Credit note site" });
  const bill = await ledger.createTransaction(businessId, {
    direction: "out",
    occurredAt: day("2026-08-01"),
    sourceId,
    lines: [
      { expenseItemId, qty: "1", unitPriceCents: 80_000, targetType: "project", targetId: site.id },
    ],
  });
  assert.equal((await moneyFor(site.id)).directCostCents, 80_000);

  await ledger.createRefund(businessId, {
    transactionId: bill.transaction.id,
    occurredAt: day("2026-08-15"),
    requests: [{ lineId: bill.lines[0].id, qtyRefunded: "1", amountRefundedCents: 30_000 }],
  });

  assert.equal((await moneyFor(site.id)).directCostCents, 50_000, "the credit came off the site's cost");
});

test("a voided sale stops counting toward what the project has billed", async () => {
  const site = await projects.createProject(businessId, { name: "Void site" });
  const sale = await ledger.createTransaction(businessId, {
    direction: "in",
    occurredAt: day("2026-08-01"),
    sourceId,
    lines: [{ label: "Mistake", qty: "1", unitPriceCents: 90_000, targetType: "project", targetId: site.id }],
  });
  assert.equal((await moneyFor(site.id)).billedCents, 90_000);

  await ledger.voidTransaction(businessId, sale.transaction.id);
  assert.equal((await moneyFor(site.id)).billedCents, 0);
});

/**
 * The drawer has to NAME the site a cost was booked to.
 *
 * `targetLabelOf` knew three of the four target types and resolved `project`
 * against the category table, where it could never match — so every job cost in
 * a construction business read "for (no longer listed)", pointing at a site that
 * was live and on screen two clicks away. The money was attributed correctly
 * throughout; only the label was wrong, which is the kind of defect a figures
 * test never catches.
 */
test("a cost booked to a project is NAMED after that project, not orphaned", async () => {
  const site = await projects.createProject(businessId, { name: "Named site" });
  const bill = await ledger.createTransaction(businessId, {
    direction: "out",
    occurredAt: day("2026-08-04"),
    sourceId,
    lines: [
      { expenseItemId, qty: "1", unitPriceCents: 120_000, targetType: "project", targetId: site.id },
    ],
  });

  const detail = await read.getTransactionDetail(businessId, USER, bill.transaction.id);
  assert.ok(detail, "the transaction must read back");
  assert.equal(detail.transaction.lines[0].targetType, "project");
  assert.equal(detail.transaction.lines[0].targetLabel, "Named site");
});

test("a FINISHED project still names the costs it already carries", async () => {
  // The picker filters to live sites on purpose (`listTimeTargets`), and reusing
  // that filter here would hand back "(no longer listed)" the day a site was
  // signed off — restating history no one changed.
  const site = await projects.createProject(businessId, { name: "Handed-over site" });
  const bill = await ledger.createTransaction(businessId, {
    direction: "out",
    occurredAt: day("2026-08-05"),
    sourceId,
    lines: [
      { expenseItemId, qty: "1", unitPriceCents: 75_000, targetType: "project", targetId: site.id },
    ],
  });
  await projects.updateProject(businessId, site.id, { status: "completed" });

  const detail = await read.getTransactionDetail(businessId, USER, bill.transaction.id);
  assert.ok(detail, "the transaction must read back");
  assert.equal(detail.transaction.lines[0].targetLabel, "Handed-over site");
});

test("a project pointer can never dangle, because the ledger refuses one that does", async () => {
  /*
   * Written after the two above, and it changed what they mean.
   *
   * "(no longer listed)" was never reachable for a project by any route an
   * owner has: `resolveTransactionLines` refuses an unknown target at write
   * time, and nothing in the app deletes a project — `updateProject` changes
   * its status and that is all. So every one of those labels in the demo
   * business came from the resolver not knowing the type, not from a pointer
   * that had gone anywhere. This pins the reason, so nobody later "fixes" the
   * fallback instead of the lookup.
   */
  await assert.rejects(
    ledger.createTransaction(businessId, {
      direction: "out",
      occurredAt: day("2026-08-06"),
      sourceId,
      lines: [
        { expenseItemId, qty: "1", unitPriceCents: 10_000, targetType: "project", targetId: "prj_does_not_exist" },
      ],
    }),
    /not found/i,
  );
});
