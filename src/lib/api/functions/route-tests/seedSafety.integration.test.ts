/**
 * "Seed sample data" may never delete an owner's records — not even when the
 * owner writes at the same moment.
 *
 * Seeding wipes first, so `/api/data/seed` only accepts a business holding
 * nothing but its untouched starter rows, and does the check and the wipe in
 * ONE transaction that holds `FOR UPDATE` on the business row. These tests
 * prove the parts that matter: the refusal, the welcome flow still working,
 * the lock actually blocking a concurrent insert, and — under real
 * concurrency — a record written during a seed always surviving it.
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

const { db, pool, peopleTable, transactionsTable } = await import("@workspace/db");
const { migrate } = await import("drizzle-orm/node-postgres/migrator");
const { eq, and } = await import("drizzle-orm");
const { createBusiness, wipeBusinessData } = await import("../services/business");
const { findOrCreatePerson } = await import("../services/person");
const { runSeed } = await import("../scripts/seedCore");
const { prepareBusinessForSeed } = await import("@/app/api/data/functions");
const { default: app } = await import("../app");

const MIGRATIONS = path.join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..", "..", "drizzle", "migrations");
const USER = "seed-safety-user";

let server: http.Server;
let baseUrl = "";

async function seedOverHttp(businessId: string): Promise<{ status: number; body: { error?: { code?: string } } }> {
  const res = await fetch(`${baseUrl}/api/data/seed`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-profit-loop-dev-user-id": USER, "x-profit-loop-business-id": businessId },
    body: "{}",
  });
  return { status: res.status, body: await res.json() };
}

async function personExists(businessId: string, name: string): Promise<boolean> {
  const rows = await db
    .select({ id: peopleTable.id })
    .from(peopleTable)
    .where(and(eq(peopleTable.businessId, businessId), eq(peopleTable.displayName, name)));
  return rows.length === 1;
}

before(async () => {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  const exists = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [TEST_DB_NAME]);
  if (exists.rowCount === 0) await admin.query(`CREATE DATABASE ${TEST_DB_NAME}`);
  await admin.end();
  await migrate(db, { migrationsFolder: MIGRATIONS });
  await wipeBusinessData(USER);

  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  await wipeBusinessData(USER);
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.end();
});

test("the welcome flow still works: a brand-new business can be seeded", async () => {
  const fresh = await createBusiness(USER, { name: "Fresh", businessType: "service" });
  const { status } = await seedOverHttp(fresh.id);
  assert.equal(status, 200);
  const txns = await db.select({ id: transactionsTable.id }).from(transactionsTable).where(eq(transactionsTable.businessId, fresh.id));
  assert.ok(txns.length > 0, "the sample data landed");
});

test("a business with any owner record is refused, and keeps the record", async () => {
  const used = await createBusiness(USER, { name: "Used", businessType: "service" });
  await findOrCreatePerson(used.id, { name: "A real customer" });
  const { status, body } = await seedOverHttp(used.id);
  assert.equal(status, 400);
  assert.equal(body.error?.code, "business_not_empty");
  assert.ok(await personExists(used.id, "A real customer"));
});

test("seeding twice is refused the second time (the first run's records count)", async () => {
  const once = await createBusiness(USER, { name: "Once", businessType: "service" });
  assert.equal((await seedOverHttp(once.id)).status, 200);
  assert.equal((await seedOverHttp(once.id)).status, 400);
});

test("the lock really blocks: an insert waits while the seed holds the business row", async () => {
  const biz = await createBusiness(USER, { name: "Locked", businessType: "service" });
  const holder = await pool.connect();
  try {
    await holder.query("BEGIN");
    await holder.query("SELECT id FROM businesses WHERE id = $1 FOR UPDATE", [biz.id]);

    let landed = false;
    const insert = findOrCreatePerson(biz.id, { name: "Waits" }).then(() => {
      landed = true;
    });
    await new Promise((r) => setTimeout(r, 400));
    assert.equal(landed, false, "the insert must wait behind FOR UPDATE (foreign-key FOR KEY SHARE)");

    await holder.query("COMMIT");
    await insert;
    assert.equal(landed, true);
  } finally {
    holder.release();
  }
});

test("under real concurrency, a record written during a seed always survives", async () => {
  for (let round = 0; round < 20; round++) {
    const biz = await createBusiness(USER, { name: `Race ${round}`, businessType: "service" });
    const name = `Concurrent customer ${round}`;
    // Start both together, with a small random head start either way.
    const jitter = () => new Promise((r) => setTimeout(r, Math.floor(Math.random() * 15)));
    const seed = (async () => {
      await jitter();
      try {
        await prepareBusinessForSeed(biz.id);
        await runSeed(USER, biz.id, { alreadyEmptied: true });
        return "seeded";
      } catch (err) {
        if ((err as { code?: string }).code === "business_not_empty") return "refused";
        throw err;
      }
    })();
    const write = (async () => {
      await jitter();
      await findOrCreatePerson(biz.id, { name });
    })();
    const [outcome] = await Promise.all([seed, write]);
    assert.ok(outcome === "seeded" || outcome === "refused");
    assert.ok(await personExists(biz.id, name), `round ${round}: the owner's record was lost (seed ${outcome})`);
  }
});
