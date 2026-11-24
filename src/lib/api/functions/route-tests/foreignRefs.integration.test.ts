/**
 * A request about business A may only REFERENCE business A's records.
 *
 * Two owners, two businesses. B owns a customer, categories, a project, items
 * and a channel. A then sends every write that stores a reference, naming B's
 * ids. Each must answer 404 — exactly like an id that does not exist — and
 * write NOTHING anywhere: every table with a business_id is counted for both
 * businesses before and after, and B's customer row is compared field by field
 * (`firstTransactionAt` used to be written through a foreign person id).
 *
 * Each refusal has a positive control with A's OWN ids, so the checks are
 * proven not to break the legitimate workflow.
 */
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import path from "node:path";
import http from "node:http";
import type { AddressInfo } from "node:net";
import pg from "pg";
import { assertLocalTestDatabases } from "@/core/db/target";

const TEST_DB_NAME = "profit_loop_test";
const ADMIN_URL = process.env.TEST_ADMIN_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/postgres";
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? `postgres://postgres:postgres@localhost:5432/${TEST_DB_NAME}`;
process.env.LOCAL_AUTH_BYPASS = "true";
process.env.DISABLE_RATE_LIMIT = "true";

// Never anything but a Postgres on this machine: these suites create, migrate and wipe.
assertLocalTestDatabases(ADMIN_URL, process.env.DATABASE_URL);

const { db, pool, peopleTable } = await import("@workspace/db");
const { migrate } = await import("drizzle-orm/node-postgres/migrator");
const { eq, sql } = await import("drizzle-orm");
const { createBusiness, wipeBusinessData, getManualSource } = await import("../services/business");
const { findOrCreatePerson } = await import("../services/person");
const { findOrCreateCategory, createRevenueItem, createExpenseItem } = await import("../services/catalog");
const { createProject } = await import("../services/project");
const { default: app } = await import("../app");

const MIGRATIONS = path.join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..", "..", "drizzle", "migrations");
const USER_A = "foreign-refs-a";
const USER_B = "foreign-refs-b";

let server: http.Server;
let baseUrl = "";

interface Fixtures {
  business: string;
  person: string;
  revenueCategory: string;
  expenseCategory: string;
  revenueItem: string;
  subscriptionItem: string;
  expenseItem: string;
  project: string;
  source: string;
}
let A: Fixtures;
let B: Fixtures;
/** A's own records the PATCH cases edit. */
let aTxn = "";
let aBudget = "";

async function fixtures(userId: string, tag: string): Promise<Fixtures> {
  const business = (await createBusiness(userId, { name: `${tag} books`, businessType: "service" })).id;
  return {
    business,
    person: (await findOrCreatePerson(business, { name: `${tag} customer`, kind: "customer" })).id,
    revenueCategory: (await findOrCreateCategory(business, `${tag} sales`, "revenue"))!,
    expenseCategory: (await findOrCreateCategory(business, `${tag} costs`, "expense"))!,
    revenueItem: (await createRevenueItem(business, { name: `${tag} widget`, type: "product", pricingModel: "fixed", unitPriceCents: 1000 })).id,
    subscriptionItem: (await createRevenueItem(business, { name: `${tag} plan`, type: "subscription", pricingModel: "fixed", unitPriceCents: 500 })).id,
    expenseItem: (await createExpenseItem(business, { name: `${tag} rent`, type: "operational" })).id,
    project: (await createProject(business, { name: `${tag} project` })).id,
    source: (await getManualSource(business))!.id,
  };
}

async function call(
  method: string,
  url: string,
  body: unknown,
  as: { user: string; business: string },
): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(`${baseUrl}/api${url}`, {
    method,
    headers: { "content-type": "application/json", "x-profit-loop-dev-user-id": as.user, "x-profit-loop-business-id": as.business },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : {} };
}
const asA = () => ({ user: USER_A, business: A.business });

/** Rows per table, for every table with a business_id, for one business. */
async function rowCounts(businessId: string): Promise<Record<string, number>> {
  const tables = await db.execute<{ table_name: string }>(sql`
    SELECT DISTINCT table_name FROM information_schema.columns WHERE table_schema = 'public' AND column_name = 'business_id'`);
  const out: Record<string, number> = {};
  for (const { table_name } of tables.rows) {
    const r = await db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM ${sql.identifier(table_name)} WHERE business_id = ${businessId}`);
    out[table_name] = Number(r.rows[0].n);
  }
  return out;
}

async function bPerson() {
  const [row] = await db.select().from(peopleTable).where(eq(peopleTable.id, B.person));
  return row;
}

/** The refusal shape: 404, nothing written in A or B, B's customer untouched, no B name in the reply. */
async function expectRefused(method: string, url: string, body: unknown) {
  const [beforeA, beforeB, personBefore] = await Promise.all([rowCounts(A.business), rowCounts(B.business), bPerson()]);
  const { status, json } = await call(method, url, body, asA());
  assert.equal(status, 404, `${method} ${url} should refuse a foreign reference, got ${status} ${JSON.stringify(json)}`);
  assert.deepEqual(await rowCounts(A.business), beforeA, `${method} ${url} wrote into A`);
  assert.deepEqual(await rowCounts(B.business), beforeB, `${method} ${url} wrote into B`);
  assert.deepEqual(await bPerson(), personBefore, `${method} ${url} changed B's customer`);
  assert.ok(!JSON.stringify(json).includes("B "), "a refusal must not echo B's names");
}

async function expectOk(method: string, url: string, body: unknown) {
  const { status, json } = await call(method, url, body, asA());
  assert.equal(status, 200, `${method} ${url} with A's own ids should work, got ${status} ${JSON.stringify(json)}`);
  return json;
}


/**
 * The 2.3 tests PLANT cross-business links on purpose, and those links block
 * an ordinary wipe on the foreign key (which is the harm they stand for). Undo
 * them first so a re-run — even after an interrupted one — starts clean.
 */
async function wipeBoth() {
  await db.execute(sql`
    UPDATE transactions SET person_id = NULL
    WHERE business_id IN (SELECT id FROM businesses WHERE user_id IN (${USER_A}, ${USER_B}))`);
  await wipeBusinessData(USER_A);
  await wipeBusinessData(USER_B);
}

before(async () => {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  const exists = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [TEST_DB_NAME]);
  if (exists.rowCount === 0) await admin.query(`CREATE DATABASE ${TEST_DB_NAME}`);
  await admin.end();
  await migrate(db, { migrationsFolder: MIGRATIONS });
  await wipeBoth();

  A = await fixtures(USER_A, "A");
  B = await fixtures(USER_B, "B");

  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const txn = await expectOk("POST", "/transactions", {
    direction: "in",
    occurredAt: "2026-03-01T12:00:00.000Z",
    lines: [{ label: "A sale", qty: "1", unitPriceCents: 1000 }],
  });
  aTxn = String(txn.id);
  const budget = await expectOk("POST", "/budgets", {
    name: "A budget",
    periodStart: "2026-01-01",
    periodEnd: "2026-12-31",
    lines: [{ side: "in", revenueItemId: A.revenueItem, amountCents: 5000 }],
  });
  aBudget = String((budget as { id?: string; budget?: { id: string } }).id ?? (budget as { budget: { id: string } }).budget.id);
});

after(async () => {
  await wipeBoth();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.end();
});

// ── 2.1 transactions and catalog ─────────────────────────────────────────────

const sale = (extra: Record<string, unknown> = {}, line: Record<string, unknown> = {}) => ({
  direction: "in",
  occurredAt: "2026-03-02T12:00:00.000Z",
  ...extra,
  lines: [{ label: "sale", qty: "1", unitPriceCents: 700, ...line }],
});

test("2.1 transaction create: B's customer is refused; A's own works", async () => {
  await expectRefused("POST", "/transactions", sale({ personId: B.person }));
  await expectOk("POST", "/transactions", sale({ personId: A.person }));
});

test("2.1 transaction create: a line with B's category is refused; A's own works", async () => {
  await expectRefused("POST", "/transactions", sale({}, { categoryId: B.revenueCategory }));
  await expectOk("POST", "/transactions", sale({}, { categoryId: A.revenueCategory }));
});

test("2.1 transaction edit: switching to B's customer is refused; A's own works", async () => {
  await expectRefused("PATCH", `/transactions/${aTxn}`, { personId: B.person });
  await expectOk("PATCH", `/transactions/${aTxn}`, { personId: A.person });
});

test("2.1 revenue item create/edit: B's category is refused; A's own works", async () => {
  await expectRefused("POST", "/revenue-items", { name: "R1", type: "product", pricingModel: "fixed", unitPriceCents: 100, categoryId: B.revenueCategory });
  await expectOk("POST", "/revenue-items", { name: "R2", type: "product", pricingModel: "fixed", unitPriceCents: 100, categoryId: A.revenueCategory });
  await expectRefused("PATCH", `/revenue-items/${A.revenueItem}`, { categoryId: B.revenueCategory });
  await expectOk("PATCH", `/revenue-items/${A.revenueItem}`, { categoryId: A.revenueCategory });
});

test("2.1 expense item create/edit: B's category is refused; A's own works", async () => {
  await expectRefused("POST", "/expense-items", { name: "E1", type: "operational", categoryId: B.expenseCategory });
  await expectOk("POST", "/expense-items", { name: "E2", type: "operational", categoryId: A.expenseCategory });
  await expectRefused("PATCH", `/expense-items/${A.expenseItem}`, { categoryId: B.expenseCategory });
  await expectOk("PATCH", `/expense-items/${A.expenseItem}`, { categoryId: A.expenseCategory });
});

// ── 2.2 recurring, subscriptions, projects, budgets ──────────────────────────

const schedule = (extra: Record<string, unknown>) => ({ interval: "monthly", startDate: "2026-04-01", amountCents: 900, ...extra });

test("2.2 recurring create: each of B's references is refused; A's own works", async () => {
  await expectRefused("POST", "/recurring", schedule({ direction: "in", revenueItemId: B.revenueItem }));
  await expectRefused("POST", "/recurring", schedule({ direction: "out", expenseItemId: B.expenseItem }));
  await expectRefused("POST", "/recurring", schedule({ direction: "in", revenueItemId: A.revenueItem, personId: B.person }));
  await expectRefused("POST", "/recurring", schedule({ direction: "in", revenueItemId: A.revenueItem, sourceId: B.source }));
  const ok = await expectOk("POST", "/recurring", schedule({ direction: "in", revenueItemId: A.revenueItem, personId: A.person }));
  assert.equal(ok.itemName, "A widget");
  assert.equal(ok.personName, "A customer");
});

test("2.2 subscription create: B's customer is refused; A's own works", async () => {
  await expectRefused("POST", "/subscriptions", { revenueItemId: A.subscriptionItem, personId: B.person, startDate: "2026-04-01" });
  await expectOk("POST", "/subscriptions", { revenueItemId: A.subscriptionItem, personId: A.person, startDate: "2026-04-01" });
});

test("2.2 project create/edit: B's customer is refused; A's own works", async () => {
  await expectRefused("POST", "/projects", { name: "P1", personId: B.person });
  await expectOk("POST", "/projects", { name: "P2", personId: A.person });
  await expectRefused("PATCH", `/projects/${A.project}`, { personId: B.person });
  await expectOk("PATCH", `/projects/${A.project}`, { personId: A.person });
});

test("2.2 budget create/edit: B's project, items and category are refused; A's own work", async () => {
  const base = { name: "Bgt", periodStart: "2026-01-01", periodEnd: "2026-12-31" };
  await expectRefused("POST", "/budgets", { ...base, scope: "project", projectId: B.project });
  await expectRefused("POST", "/budgets", { ...base, lines: [{ side: "in", revenueItemId: B.revenueItem, amountCents: 100 }] });
  await expectRefused("POST", "/budgets", { ...base, lines: [{ side: "out", expenseItemId: B.expenseItem, amountCents: 100 }] });
  await expectRefused("POST", "/budgets", { ...base, lines: [{ side: "out", categoryId: B.expenseCategory, amountCents: 100 }] });
  await expectOk("POST", "/budgets", { ...base, scope: "project", projectId: A.project, lines: [{ side: "out", expenseItemId: A.expenseItem, amountCents: 100 }] });

  await expectRefused("PATCH", `/budgets/${aBudget}`, { scope: "project", projectId: B.project });
  await expectRefused("PATCH", `/budgets/${aBudget}`, { lines: [{ side: "out", categoryId: B.expenseCategory, amountCents: 100 }] });
  await expectOk("PATCH", `/budgets/${aBudget}`, { lines: [{ side: "out", categoryId: A.expenseCategory, amountCents: 100 }] });
});

// ── 2.3 defence in depth: references that are ALREADY wrong ────────────────
//
// The checks above stop new bad links. These plant some directly (as a past
// bug or a manual edit could have), then read EVERY GET endpoint in the
// contract as A. No response may contain B's names, and a merge in A must not
// reach B's rows.

const MARK = "ZZB-SECRET";

test("2.3 sweep: with foreign references planted in A, no GET endpoint reveals B's names", async () => {
  const contract = await import("@workspace/api-contract");
  const { recurringSchedulesTable, budgetsTable, subscriptionsTable, revenueItemsTable, projectsTable } = await import("@workspace/db");
  const { uid } = await import("../lib/uid");

  // B's records, with names nobody in A could legitimately see.
  await db.update(peopleTable).set({ displayName: `${MARK} customer` }).where(eq(peopleTable.id, B.person));
  await db.update(revenueItemsTable).set({ name: `${MARK} plan`, unitPriceCents: 7777 }).where(eq(revenueItemsTable.id, B.subscriptionItem));
  await db.update(projectsTable).set({ name: `${MARK} project` }).where(eq(projectsTable.id, B.project));

  // Planted in A, pointing at B.
  const schedId = uid("sched");
  await db.insert(recurringSchedulesTable).values({
    id: schedId, businessId: A.business, direction: "in", revenueItemId: B.subscriptionItem, personId: B.person,
    sourceId: A.source, amountCents: null, interval: "monthly", startDate: new Date("2026-05-01"), nextRunAt: new Date("2026-05-01"),
  });
  await db.insert(subscriptionsTable).values({
    id: uid("sub"), businessId: A.business, revenueItemId: B.subscriptionItem, personId: B.person, scheduleId: schedId,
    status: "active", startedAt: new Date("2026-05-01"),
  });
  const plantedBudget = uid("bud");
  await db.insert(budgetsTable).values({
    id: plantedBudget, businessId: A.business, name: "Planted", scope: "project", projectId: B.project,
    periodStart: "2026-01-01", periodEnd: "2026-12-31",
  });

  const idFor: Record<string, string> = { "/budgets/:id": plantedBudget, "/projects/:id": A.project, "/revenue-items/:id": A.revenueItem, "/expense-items/:id": A.expenseItem, "/transactions/:id": aTxn, "/people/:id": A.person };
  const leaks: string[] = [];
  let called = 0;
  for (const value of Object.values(contract)) {
    const e = value as { method?: string; path?: string };
    if (e?.method !== "GET" || typeof e.path !== "string") continue;
    let url = e.path;
    if (url.includes(":")) {
      const known = Object.entries(idFor).find(([pattern]) => url.startsWith(pattern.split(":")[0]) && url.split("/").length === pattern.split("/").length);
      if (!known) continue;
      url = url.replace(/:[A-Za-z]+/, known[1]);
    }
    let text = "";
    let status = 0;
    try {
      const res = await fetch(`${baseUrl}/api${url}`, {
        headers: { "x-profit-loop-dev-user-id": USER_A, "x-profit-loop-business-id": A.business },
        signal: AbortSignal.timeout(20_000),
      });
      status = res.status;
      text = await res.text();
    } catch (err) {
      leaks.push(`${url} (no answer: ${(err as Error).name})`);
      continue;
    }
    called++;
    const res = { status };
    if (text.includes(MARK) || text.includes("7777")) leaks.push(`${url} (${res.status})`);
  }
  assert.ok(called > 30, `the sweep must actually cover the API (called ${called})`);
  assert.deepEqual(leaks, [], `GET endpoints revealing B's records: ${leaks.join(", ")}`);
});

test("2.3 merging people in A never moves B's rows", async () => {
  const { transactionsTable } = await import("@workspace/db");
  const { createTransaction } = await import("../services/ledger");
  const keep = await findOrCreatePerson(A.business, { name: "Keep me", kind: "customer" });
  const drop = await findOrCreatePerson(A.business, { name: "Merge me", kind: "customer" });
  // A B transaction that (wrongly) names A's person — the shape a past bug could leave behind.
  const bTxn = await createTransaction(B.business, { direction: "in", occurredAt: new Date("2026-02-01"), sourceId: B.source, lines: [{ label: "b sale", qty: "1", unitPriceCents: 100 }] });
  await db.update(transactionsTable).set({ personId: drop.id }).where(eq(transactionsTable.id, bTxn.transaction.id));

  const { status } = await call("POST", `/people/${keep.id}/merge`, { mergeId: drop.id }, asA());
  assert.ok(status === 200 || status === 404, `merge answered ${status}`);
  const [after] = await db.select().from(transactionsTable).where(eq(transactionsTable.id, bTxn.transaction.id));
  assert.equal(after.personId, drop.id, "B's transaction must not be repointed by A's merge");
});
