/**
 * Deleting an account leaves nothing behind — and touches nobody else.
 *
 * The check does not list tables by hand. It asks the database for EVERY table
 * with a `business_id` column, so a table added next year is covered the day
 * it is migrated: if the wipe forgets it, this fails (or the delete itself
 * does, on the foreign key).
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
// The route is driven over real HTTP; the dev bypass reads the user from a header.
process.env.LOCAL_AUTH_BYPASS = "true";
process.env.DISABLE_RATE_LIMIT = "true";

// Never anything but a Postgres on this machine: these suites create, migrate and wipe.
assertLocalTestDatabases(ADMIN_URL, process.env.DATABASE_URL);

const dbModule = await import("@workspace/db");
const {
  db,
  pool,
  businessesTable,
  integrationsTable,
  transactionAttachmentsTable,
  transactionTemplatesTable,
  transactionsTable,
  userSettingsTable,
} = dbModule;
const { migrate } = await import("drizzle-orm/node-postgres/migrator");
const { eq, sql } = await import("drizzle-orm");
const { createBusiness, wipeBusinessData } = await import("./business");
const { runSeed } = await import("../scripts/seedCore");
const { deleteAccountData } = await import("@/app/api/account/functions");
const { uid } = await import("../lib/uid");
const { default: app } = await import("../app");

const MIGRATIONS = path.join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..", "..", "drizzle", "migrations");
const LEAVING = "account-delete-leaving";
const STAYING = "account-delete-staying";
const OVER_HTTP = "account-delete-http";

/** Rows per table that belong to any of these businesses, across every table with a business_id. */
async function rowsFor(businessIds: string[]): Promise<Record<string, number>> {
  const tables = await db.execute<{ table_name: string }>(sql`
    SELECT table_name FROM information_schema.columns
    WHERE table_schema = 'public' AND column_name = 'business_id'
  `);
  const counts: Record<string, number> = {};
  for (const { table_name } of tables.rows) {
    const result = await db.execute<{ n: string }>(
      sql`SELECT count(*) AS n FROM ${sql.identifier(table_name)} WHERE business_id IN ${businessIds}`,
    );
    counts[table_name] = Number(result.rows[0].n);
  }
  return counts;
}

let leavingIds: string[] = [];
let stayingIds: string[] = [];
let server: http.Server;
let baseUrl = "";

async function postDelete(body: unknown): Promise<{ status: number; json: unknown }> {
  const res = await fetch(`${baseUrl}/api/account/delete`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-profit-loop-dev-user-id": OVER_HTTP },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() };
}

before(async () => {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  const exists = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [TEST_DB_NAME]);
  if (exists.rowCount === 0) await admin.query(`CREATE DATABASE ${TEST_DB_NAME}`);
  await admin.end();
  await migrate(db, { migrationsFolder: MIGRATIONS });

  await deleteAccountData(LEAVING);
  await wipeBusinessData(STAYING);

  // The person leaving: a full demo business, a receipt on one of its
  // transactions, a saved shortcut, a connected store, their own settings —
  // and a second, archived business, which must go too.
  const main = await createBusiness(LEAVING, { name: "Leaving main", businessType: "service" });
  await runSeed(LEAVING, main.id);
  const [txn] = await db.select().from(transactionsTable).where(eq(transactionsTable.businessId, main.id)).limit(1);
  await db.insert(transactionAttachmentsTable).values({
    id: uid("att"),
    businessId: main.id,
    transactionId: txn.id,
    filename: "receipt.pdf",
    mimeType: "application/pdf",
    sizeBytes: 3,
    data: Buffer.from("pdf"),
  });
  await db.insert(transactionTemplatesTable).values({ id: uid("tpl"), businessId: main.id, name: "Rent", payload: {} });
  await db.insert(integrationsTable).values({
    id: uid("int"),
    userId: LEAVING,
    businessId: main.id,
    kind: "shopify",
    displayName: "Shopify",
    externalAccount: "leaving.myshopify.com",
  });
  await db.insert(userSettingsTable).values({ userId: LEAVING }).onConflictDoNothing();
  const archived = await createBusiness(LEAVING, { name: "Leaving archived", businessType: "ecommerce" });
  await db.update(businessesTable).set({ archivedAt: new Date() }).where(eq(businessesTable.id, archived.id));
  leavingIds = [main.id, archived.id];

  // Somebody else, who must not notice anything.
  const other = await createBusiness(STAYING, { name: "Staying", businessType: "service" });
  await runSeed(STAYING, other.id);
  await db.insert(userSettingsTable).values({ userId: STAYING }).onConflictDoNothing();
  stayingIds = [other.id];

  await deleteAccountData(OVER_HTTP);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await deleteAccountData(OVER_HTTP);
  await deleteAccountData(LEAVING);
  await wipeBusinessData(STAYING);
  await db.delete(userSettingsTable).where(eq(userSettingsTable.userId, STAYING));
  await pool.end();
});

test("deleting an account removes every row of every business it owned, and its settings", async () => {
  const before = await rowsFor(leavingIds);
  assert.ok(before.transactions > 0, "the seed wrote transactions to delete");
  assert.equal(before.transaction_attachments, 1);

  const othersBefore = await rowsFor(stayingIds);

  const { businessesDeleted } = await deleteAccountData(LEAVING);
  assert.equal(businessesDeleted, 2, "the archived business goes too");

  const left = Object.entries(await rowsFor(leavingIds)).filter(([, n]) => n > 0);
  assert.deepEqual(left, [], "no table still holds a row for a deleted business");
  const businesses = await db.select().from(businessesTable).where(eq(businessesTable.userId, LEAVING));
  assert.equal(businesses.length, 0);
  const settings = await db.select().from(userSettingsTable).where(eq(userSettingsTable.userId, LEAVING));
  assert.equal(settings.length, 0);
  const integrations = await db.select().from(integrationsTable).where(eq(integrationsTable.userId, LEAVING));
  assert.equal(integrations.length, 0);

  assert.deepEqual(await rowsFor(stayingIds), othersBefore, "another person's books are untouched");
  const otherSettings = await db.select().from(userSettingsTable).where(eq(userSettingsTable.userId, STAYING));
  assert.equal(otherSettings.length, 1);
});

test("deleting an account that has nothing left is harmless, so a retry is safe", async () => {
  const { businessesDeleted } = await deleteAccountData(LEAVING);
  assert.equal(businessesDeleted, 0);
});

test("over HTTP, a request without the typed word deletes nothing", async () => {
  await createBusiness(OVER_HTTP, { name: "Kept", businessType: "service" });
  const { status } = await postDelete({});
  assert.equal(status, 400);
  const still = await db.select().from(businessesTable).where(eq(businessesTable.userId, OVER_HTTP));
  assert.equal(still.length, 1);
});

test("over HTTP, the typed word deletes the caller's account and only theirs", async () => {
  const othersBefore = await rowsFor(stayingIds);
  const { status, json } = await postDelete({ confirm: "DELETE" });
  assert.equal(status, 200);
  assert.deepEqual(json, { ok: true });
  const left = await db.select().from(businessesTable).where(eq(businessesTable.userId, OVER_HTTP));
  assert.equal(left.length, 0);
  assert.deepEqual(await rowsFor(stayingIds), othersBefore);
});
