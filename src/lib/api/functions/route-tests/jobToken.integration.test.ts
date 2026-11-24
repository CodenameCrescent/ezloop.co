/**
 * The recurring job posts into every business, so it answers only to its
 * token — in the Authorization header, never the query string — and never to
 * the dev bypass.
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
process.env.LOCAL_AUTH_BYPASS = "true"; // on — and it must NOT open the job
process.env.DISABLE_RATE_LIMIT = "true";
const TOKEN = crypto.randomBytes(24).toString("hex"); // this process only
process.env.RECURRING_JOB_TOKEN = TOKEN;

// Never anything but a Postgres on this machine: these suites create, migrate and wipe.
assertLocalTestDatabases(ADMIN_URL, process.env.DATABASE_URL);

const { db, pool } = await import("@workspace/db");
const { migrate } = await import("drizzle-orm/node-postgres/migrator");
const { default: app } = await import("../app");

const MIGRATIONS = path.join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..", "..", "drizzle", "migrations");
let server: http.Server;
let baseUrl = "";

before(async () => {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  const exists = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [TEST_DB_NAME]);
  if (exists.rowCount === 0) await admin.query(`CREATE DATABASE ${TEST_DB_NAME}`);
  await admin.end();
  await migrate(db, { migrationsFolder: MIGRATIONS });
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.end();
});

async function status(url: string, headers: Record<string, string> = {}) {
  const res = await fetch(`${baseUrl}${url}`, { method: "POST", headers });
  await res.text();
  return res.status;
}

test("the right token in the Authorization header runs the job", async () => {
  assert.equal(await status("/api/jobs/recurring", { authorization: `Bearer ${TOKEN}` }), 200);
});

test("the right token in the query string is refused", async () => {
  assert.equal(await status(`/api/jobs/recurring?token=${TOKEN}`), 401);
});

test("a wrong, truncated or missing token is refused — and the dev bypass does not help", async () => {
  assert.equal(await status("/api/jobs/recurring", { authorization: `Bearer ${TOKEN}x` }), 401);
  assert.equal(await status("/api/jobs/recurring", { authorization: `Bearer ${TOKEN.slice(0, -1)}` }), 401);
  assert.equal(await status("/api/jobs/recurring", { "x-profit-loop-dev-user-id": "local-user" }), 401);
  assert.equal(await status("/api/jobs/recurring"), 401);
});
