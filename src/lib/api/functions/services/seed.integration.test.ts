/**
 * The seed IS the fixture: seeding the test database must reproduce the
 * hand-computed P&L in seedCore.ts to the cent, through the one ladder
 * implementation in lib/domain.
 */
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { assertLocalTestDatabases } from "@/core/db/target";

const TEST_DB_NAME = "profit_loop_test";
const ADMIN_URL = process.env.TEST_ADMIN_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/postgres";
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? `postgres://postgres:postgres@localhost:5432/${TEST_DB_NAME}`;

// Never anything but a Postgres on this machine: these suites create, migrate and wipe.
assertLocalTestDatabases(ADMIN_URL, process.env.DATABASE_URL);

const { db, pool } = await import("@workspace/db");
const { migrate } = await import("drizzle-orm/node-postgres/migrator");
const { runSeed, loadSeededLadder, EXPECTED_PNL } = await import("../scripts/seedCore");
const { subscriptionSummary, buildContributionCohorts } = await import("./analytics");

before(async () => {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE ${TEST_DB_NAME}`);
  } catch (err) {
    if ((err as { code?: string }).code !== "42P04") throw err;
  }
  await admin.end();

  const { fileURLToPath } = await import("node:url");
  const path = await import("node:path");
  const migrations = path.join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..", "..", "drizzle", "migrations");
  await migrate(db, { migrationsFolder: migrations });
});

after(async () => {
  await pool.end();
});

test("seeded ledger reproduces the hand-computed P&L to the cent", async () => {
  const businessId = await runSeed("seed-test-user");
  const ladder = await loadSeededLadder(businessId);
  assert.deepEqual(ladder, EXPECTED_PNL);
});

test("re-seeding is a clean reset, not an accumulation", async () => {
  const businessId = await runSeed("seed-test-user");
  const ladder = await loadSeededLadder(businessId);
  assert.deepEqual(ladder, EXPECTED_PNL);
});

test("seeded subscriptions produce the expected MRR / active / churn", async () => {
  const businessId = await runSeed("seed-test-user");
  const summary = await subscriptionSummary(businessId, {});
  // 2 Pro (10_000) + Team (15_000) + Annual 60_000/yr (5_000) + trialing Pro (5_000)
  // + past_due Pro (5_000) = 40_000/mo; 6 counted active; 2 canceled.
  assert.equal(summary.mrrCents, 40_000);
  assert.equal(summary.activeCount, 6);
  assert.equal(summary.churnedCount, 2);
});

test("seeded customers form a non-trivial cohort grid", async () => {
  const businessId = await runSeed("seed-test-user");
  const grid = await buildContributionCohorts(businessId);
  // 8 subscription customers + 17 one-off customers spread across ~6 months.
  // The trialing customer has no payment yet, so 24 land in purchase cohorts.
  assert.ok(grid.cohorts.length >= 4, `expected multiple cohorts, got ${grid.cohorts.length}`);
  const totalCustomers = grid.cohorts.reduce((sum, c) => sum + c.size, 0);
  assert.equal(totalCustomers, 24);
  // The curve accumulates: later months are ≥ the first month for at least one cohort.
  assert.ok(grid.cohorts.some((c) => c.cumulativeContributionPerCustomer.length > 1));
});
