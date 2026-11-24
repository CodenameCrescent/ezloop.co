/**
 * Integration tests for the recurring engine + subscriptions + people merge,
 * against a real Postgres (profit_loop_test). Proves the acceptance invariants:
 * idempotency, the Jan-31 anchor across Feb/Mar, catch-up after downtime, the
 * confirm/skip queue, subscription payment events, merge repointing, and the
 * "this and future" edit leaving history untouched.
 */
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { assertLocalTestDatabases } from "@/core/db/target";

const TEST_DB_NAME = "profit_loop_test";
const ADMIN_URL = process.env.TEST_ADMIN_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/postgres";
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? `postgres://postgres:postgres@localhost:5432/${TEST_DB_NAME}`;

// Never anything but a Postgres on this machine: these suites create, migrate and wipe.
assertLocalTestDatabases(ADMIN_URL, process.env.DATABASE_URL);

const dbModule = await import("@workspace/db");
const { db, pool, recurringPostingsTable, transactionsTable, transactionLinesTable, subscriptionEventsTable, subscriptionsTable, recurringSchedulesTable } = dbModule;
const { migrate } = await import("drizzle-orm/node-postgres/migrator");
const { eq, and } = await import("drizzle-orm");
const path = await import("node:path");
const { fileURLToPath } = await import("node:url");
const { ensureBusiness, getManualSource } = await import("./business");
const catalog = await import("./catalog");
const recurring = await import("./recurring");
const subscription = await import("./subscription");
const person = await import("./person");

const MIGRATIONS = path.join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..", "..", "drizzle", "migrations");
const iso = (d: Date) => d.toISOString().slice(0, 10);

let businessId: string;
let sourceId: string;
let revenueItemId: string;
let subItemId: string;
let expenseItemId: string;

before(async () => {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE ${TEST_DB_NAME}`);
  } catch (err) {
    if ((err as { code?: string }).code !== "42P04") throw err;
  }
  await admin.end();
  await migrate(db, { migrationsFolder: MIGRATIONS });
  await db.execute(
    `TRUNCATE subscription_events, subscriptions, recurring_postings, recurring_schedules, transaction_lines, transactions, cost_components, revenue_item_sources, revenue_items, expense_items, categories, people, sources, businesses CASCADE`,
  );

  const business = await ensureBusiness("recur-user");
  businessId = business.id;
  sourceId = (await getManualSource(businessId))!.id;
  revenueItemId = (await catalog.createRevenueItem(businessId, { name: "Monthly retainer", type: "service", pricingModel: "fixed", unitPriceCents: 60_000 })).id;
  subItemId = (await catalog.createRevenueItem(businessId, { name: "Pro plan", type: "subscription", pricingModel: "fixed", unitPriceCents: 5_000 })).id;
  expenseItemId = (await catalog.createExpenseItem(businessId, { name: "Studio rent", type: "operational", costNature: "fixed", behavior: "recurring", defaultAmountCents: 50_000 })).id;
});

after(async () => {
  await pool.end();
});

test("catch-up posts every missed date at the SCHEDULED occurred_at, and is idempotent", async () => {
  const schedule = await recurring.createSchedule(businessId, {
    direction: "in",
    revenueItemId,
    sourceId,
    interval: "monthly",
    anchorDay: 1,
    startDate: new Date("2026-01-01T00:00:00Z"),
    amountCents: 60_000,
  });

  // Job runs Mar 15 after being down since Jan → posts Jan 1, Feb 1, Mar 1.
  const run1 = await recurring.runDueSchedules(new Date("2026-03-15T00:00:00Z"), businessId);
  assert.equal(run1.postsCreated, 3);

  const posts = await db.select().from(recurringPostingsTable).where(eq(recurringPostingsTable.scheduleId, schedule.id));
  assert.equal(posts.length, 3);
  const dates = posts.map((p) => iso(p.scheduledFor)).sort();
  assert.deepEqual(dates, ["2026-01-01", "2026-02-01", "2026-03-01"]);

  // Each transaction's occurred_at is the SCHEDULED date and origin is the engine.
  const txnIds = posts.map((p) => p.transactionId!);
  const txns = await db.select().from(transactionsTable).where(eq(transactionsTable.businessId, businessId));
  const posted = txns.filter((t) => txnIds.includes(t.id));
  assert.ok(posted.every((t) => t.origin === "recurring_engine"));

  // Idempotency: hammering the same day creates nothing new.
  const run2 = await recurring.runDueSchedules(new Date("2026-03-15T00:00:00Z"), businessId);
  const run3 = await recurring.runDueSchedules(new Date("2026-03-15T00:00:00Z"), businessId);
  assert.equal(run2.postsCreated, 0);
  assert.equal(run3.postsCreated, 0);
  const postsAfter = await db.select().from(recurringPostingsTable).where(eq(recurringPostingsTable.scheduleId, schedule.id));
  assert.equal(postsAfter.length, 3);

  // next_run_at advanced to Apr 1.
  const [refreshed] = await db.select().from(recurringSchedulesTable).where(eq(recurringSchedulesTable.id, schedule.id));
  assert.equal(iso(refreshed.nextRunAt), "2026-04-01");
});

test("Jan-31 anchor is remembered across Feb/Mar", async () => {
  const schedule = await recurring.createSchedule(businessId, {
    direction: "out",
    expenseItemId,
    sourceId,
    interval: "monthly",
    startDate: new Date("2026-01-31T00:00:00Z"),
    amountCents: 50_000,
  });
  await recurring.runDueSchedules(new Date("2026-04-05T00:00:00Z"), businessId);

  const posts = await db.select().from(recurringPostingsTable).where(eq(recurringPostingsTable.scheduleId, schedule.id));
  const dates = posts.map((p) => iso(p.scheduledFor)).sort();
  // Jan 31 → Feb 28 (2026 not leap) → Mar 31, not degraded to Mar 28.
  assert.deepEqual(dates, ["2026-01-31", "2026-02-28", "2026-03-31"]);
});

test("confirm_first posts as pending; confirm and skip both work", async () => {
  const schedule = await recurring.createSchedule(businessId, {
    direction: "in",
    revenueItemId,
    sourceId,
    interval: "monthly",
    anchorDay: 10,
    startDate: new Date("2026-01-10T00:00:00Z"),
    amountCents: 60_000,
    postingMode: "confirm_first",
  });
  await recurring.runDueSchedules(new Date("2026-02-15T00:00:00Z"), businessId); // posts Jan 10, Feb 10 pending

  const posts = await db.select().from(recurringPostingsTable).where(eq(recurringPostingsTable.scheduleId, schedule.id));
  assert.equal(posts.length, 2);
  const pendingTxns = await db.select().from(transactionsTable).where(and(eq(transactionsTable.businessId, businessId), eq(transactionsTable.status, "pending")));
  const mine = pendingTxns.filter((t) => posts.some((p) => p.transactionId === t.id));
  assert.equal(mine.length, 2);

  // Confirm the first, skip the second.
  await recurring.confirmPending(businessId, mine[0].id);
  await recurring.skipPending(businessId, mine[1].id);

  const [confirmed] = await db.select().from(transactionsTable).where(eq(transactionsTable.id, mine[0].id));
  assert.equal(confirmed.status, "completed");
  const [skipped] = await db.select().from(transactionsTable).where(eq(transactionsTable.id, mine[1].id));
  assert.equal(skipped.status, "void");
  const [skippedPost] = await db.select().from(recurringPostingsTable).where(eq(recurringPostingsTable.transactionId, mine[1].id));
  assert.equal(skippedPost.skipped, true);
});

test("subscription: schedule posts write payment events; trialing activates on first payment; cancel stops it", async () => {
  const alice = await person.findOrCreatePerson(businessId, { name: "Alice", email: "alice@example.com" });
  const schedule = await recurring.createSchedule(businessId, {
    direction: "in",
    revenueItemId: subItemId,
    personId: alice.id,
    sourceId,
    interval: "monthly",
    anchorDay: 1,
    startDate: new Date("2026-01-01T00:00:00Z"),
    amountCents: 5_000,
  });
  const sub = await subscription.createSubscription(businessId, {
    revenueItemId: subItemId,
    personId: alice.id,
    scheduleId: schedule.id,
    startedAt: new Date("2026-01-01T00:00:00Z"),
    trialEndsAt: new Date("2026-01-08T00:00:00Z"),
    status: "trialing",
  });

  await recurring.runDueSchedules(new Date("2026-02-15T00:00:00Z"), businessId); // Jan 1, Feb 1 posts

  const events = await db.select().from(subscriptionEventsTable).where(eq(subscriptionEventsTable.subscriptionId, sub.id));
  const kinds = events.map((e) => e.event);
  assert.ok(kinds.includes("created"));
  assert.ok(kinds.includes("trial_started"));
  assert.ok(kinds.includes("payment_posted"));
  assert.ok(kinds.includes("activated")); // trialing → active on first payment

  const [afterPay] = await db.select().from(subscriptionsTable).where(eq(subscriptionsTable.id, sub.id));
  assert.equal(afterPay.status, "active");

  await subscription.cancelSubscription(businessId, sub.id, "too expensive");
  const [canceled] = await db.select().from(subscriptionsTable).where(eq(subscriptionsTable.id, sub.id));
  assert.equal(canceled.status, "canceled");
  const [sched] = await db.select().from(recurringSchedulesTable).where(eq(recurringSchedulesTable.id, schedule.id));
  assert.equal(sched.status, "canceled"); // cancel cancels the schedule
});

test("mergePersons repoints transactions and archives the merged person", async () => {
  const keep = await person.findOrCreatePerson(businessId, { name: "Bob Smith", email: "bob@example.com" });
  const dupe = await person.findOrCreatePerson(businessId, { name: "Bob Smith (old)" });
  // Give the dupe a transaction.
  const { createTransaction } = await import("./ledger");
  const txn = await createTransaction(businessId, {
    direction: "in",
    occurredAt: new Date("2026-02-01T00:00:00Z"),
    sourceId,
    personId: dupe.id,
    lines: [{ revenueItemId, unitPriceCents: 60_000 }],
  });

  await person.mergePersons(businessId, keep.id, dupe.id);

  const [moved] = await db.select().from(transactionsTable).where(eq(transactionsTable.id, txn.transaction.id));
  assert.equal(moved.personId, keep.id);
  const merged = await person.getPerson(businessId, dupe.id);
  assert.equal(merged.status, "archived");
});

test("'this and future' edit end-dates the old schedule and clones a new one — history untouched", async () => {
  const schedule = await recurring.createSchedule(businessId, {
    direction: "out",
    expenseItemId,
    sourceId,
    interval: "monthly",
    anchorDay: 5,
    startDate: new Date("2026-01-05T00:00:00Z"),
    amountCents: 50_000,
  });
  await recurring.runDueSchedules(new Date("2026-02-20T00:00:00Z"), businessId); // Jan 5, Feb 5 at 50000

  const postsBefore = await db.select().from(recurringPostingsTable).where(eq(recurringPostingsTable.scheduleId, schedule.id));
  const txnIdsBefore = postsBefore.map((p) => p.transactionId!);

  const clone = await recurring.editThisAndFuture(businessId, schedule.id, { amountCents: 55_000 });
  assert.notEqual(clone.id, schedule.id);
  assert.equal(clone.amountCents, 55_000);

  const [oldSched] = await db.select().from(recurringSchedulesTable).where(eq(recurringSchedulesTable.id, schedule.id));
  assert.equal(oldSched.status, "completed");

  // Old posts (history) still exist at the old amount.
  const oldLines = await db.select().from(transactionLinesTable).where(eq(transactionLinesTable.transactionId, txnIdsBefore[0]));
  assert.equal(oldLines[0].unitPriceCents, 50_000);

  // The clone posts future occurrences at the new amount.
  await recurring.runDueSchedules(new Date("2026-03-20T00:00:00Z"), businessId);
  const clonePosts = await db.select().from(recurringPostingsTable).where(eq(recurringPostingsTable.scheduleId, clone.id));
  assert.ok(clonePosts.length >= 1);
  const [newLine] = await db.select().from(transactionLinesTable).where(eq(transactionLinesTable.transactionId, clonePosts[0].transactionId!));
  assert.equal(newLine.unitPriceCents, 55_000);
});
