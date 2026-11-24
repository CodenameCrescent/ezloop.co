/**
 * Signed-in writes must come from this site; nothing else may be broken by
 * that. Real HTTP through the harness, with the headers a browser sends.
 */
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
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
const JOB_TOKEN = crypto.randomBytes(24).toString("hex");
process.env.RECURRING_JOB_TOKEN = JOB_TOKEN;

// Never anything but a Postgres on this machine: these suites create, migrate and wipe.
assertLocalTestDatabases(ADMIN_URL, process.env.DATABASE_URL);

const { db, pool, sourcesTable } = await import("@workspace/db");
const { migrate } = await import("drizzle-orm/node-postgres/migrator");
const { eq } = await import("drizzle-orm");
const { createBusiness, wipeBusinessData } = await import("../services/business");
const { default: app } = await import("../app");

const MIGRATIONS = path.join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..", "..", "drizzle", "migrations");
const USER = "csrf-test-user";
let server: http.Server;
let baseUrl = "";
let host = "";
let business = "";

before(async () => {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  const exists = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [TEST_DB_NAME]);
  if (exists.rowCount === 0) await admin.query(`CREATE DATABASE ${TEST_DB_NAME}`);
  await admin.end();
  await migrate(db, { migrationsFolder: MIGRATIONS });
  await wipeBusinessData(USER);
  business = (await createBusiness(USER, { name: "CSRF books", businessType: "service" })).id;
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  host = `127.0.0.1:${(server.address() as AddressInfo).port}`;
  baseUrl = `http://${host}`;
});

after(async () => {
  await wipeBusinessData(USER);
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.end();
});

const sourceCount = async () => (await db.select().from(sourcesTable).where(eq(sourcesTable.businessId, business))).length;

async function createSource(browser: Record<string, string>) {
  const res = await fetch(`${baseUrl}/api/sources`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-profit-loop-dev-user-id": USER, "x-profit-loop-business-id": business, ...browser },
    body: JSON.stringify({ name: `S-${crypto.randomUUID().slice(0, 8)}`, kind: "manual" }),
  });
  const json = await res.json();
  return { status: res.status, code: (json as { error?: { code?: string } }).error?.code };
}

test("the app's own writes pass: same-origin Fetch Metadata and Origin", async () => {
  const before = await sourceCount();
  assert.equal((await createSource({ "sec-fetch-site": "same-origin", origin: `http://${host}` })).status, 200);
  assert.equal(await sourceCount(), before + 1);
});

test("a non-browser client (no Origin, no Fetch Metadata) passes", async () => {
  assert.equal((await createSource({})).status, 200);
});

test("cross-site and same-site writes are refused — and write nothing", async () => {
  const before = await sourceCount();
  for (const site of ["cross-site", "same-site"]) {
    const r = await createSource({ "sec-fetch-site": site });
    assert.equal(r.status, 403, site);
    assert.equal(r.code, "cross_site_request");
  }
  assert.equal(await sourceCount(), before);
});

test("a foreign or null Origin is refused, even without Fetch Metadata (older browsers)", async () => {
  const before = await sourceCount();
  assert.equal((await createSource({ origin: "https://evil.example" })).status, 403);
  assert.equal((await createSource({ origin: "null" })).status, 403);
  assert.equal((await createSource({ origin: `http://${host}.evil.example` })).status, 403);
  assert.equal(await sourceCount(), before);
});

test("reads are not affected (GET is safe)", async () => {
  const res = await fetch(`${baseUrl}/api/sources`, {
    headers: { "x-profit-loop-dev-user-id": USER, "x-profit-loop-business-id": business, "sec-fetch-site": "cross-site", origin: "https://evil.example" },
  });
  assert.equal(res.status, 200);
});

test("independently authenticated routes are untouched: cron job, webhook, sign-up", async () => {
  const cross = { "sec-fetch-site": "cross-site", origin: "https://elsewhere.example" };
  const job = await fetch(`${baseUrl}/api/jobs/recurring`, { method: "POST", headers: { authorization: `Bearer ${JOB_TOKEN}`, ...cross } });
  assert.equal(job.status, 200, "the cron job answers to its token, not to Origin");

  const hook = await fetch(`${baseUrl}/api/webhooks/shopify`, { method: "POST", headers: { "content-type": "application/json", ...cross }, body: "{}" });
  const hookBody = await hook.text();
  assert.notEqual(hook.status, 403, "the webhook is judged by its HMAC, not by Origin");
  assert.ok(!hookBody.includes("cross_site_request"));

  const signUp = await fetch(`${baseUrl}/api/auth/sign-up`, { method: "POST", headers: { "content-type": "application/json", ...cross }, body: "{}" });
  assert.equal(signUp.status, 400, "sign-up has no session to forge; it reaches its own validation");
});
