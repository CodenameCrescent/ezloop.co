/**
 * A signed session cookie is not enough: the account behind it must still be
 * allowed in. Real NextAuth cookies (signed with a test secret), real HTTP, and
 * a stand-in for Supabase's `auth.users` in the LOCAL test database with the
 * same columns the check reads (`deleted_at`, `banned_until`,
 * `raw_app_meta_data`). The dev bypass is OFF here, so this is the production
 * path through `authenticate`.
 */
import test, { after, before, beforeEach } from "node:test";
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
delete process.env.LOCAL_AUTH_BYPASS; // the real session path
process.env.DISABLE_RATE_LIMIT = "true";
process.env.NEXTAUTH_SECRET = crypto.randomBytes(32).toString("hex"); // test-only, this process only

// Never anything but a Postgres on this machine: these suites create, migrate and wipe.
assertLocalTestDatabases(ADMIN_URL, process.env.DATABASE_URL);

const { db, pool, businessesTable } = await import("@workspace/db");
const { migrate } = await import("drizzle-orm/node-postgres/migrator");
const { eq } = await import("drizzle-orm");
const { encode } = await import("next-auth/jwt");
const { wipeBusinessData } = await import("../services/business");
const { clearAccountStatusCache, forgetAccountStatus } = await import("../auth/accountStatus");
const { default: app } = await import("../app");

const MIGRATIONS = path.join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..", "..", "drizzle", "migrations");

let server: http.Server;
let baseUrl = "";
const made: string[] = [];

async function user(fields: { deletedAt?: Date | null; bannedUntil?: Date | null; validAfter?: Date | null } = {}): Promise<string> {
  const id = crypto.randomUUID();
  made.push(id);
  await pool.query(
    `INSERT INTO auth.users (id, email, deleted_at, banned_until, raw_app_meta_data, email_confirmed_at)
     VALUES ($1, $2, $3, $4, $5, now())`,
    [id, `${id}@test.local`, fields.deletedAt ?? null, fields.bannedUntil ?? null, fields.validAfter ? { provider: "email", sessions_valid_after: fields.validAfter.toISOString() } : { provider: "email" }],
  );
  return id;
}

async function cookieFor(uid: string, claims: { authTime?: number; iat?: number } = { authTime: Date.now() }): Promise<string> {
  const token = await encode({ token: { uid, sub: uid, ...claims }, secret: process.env.NEXTAUTH_SECRET! });
  return `next-auth.session-token=${token}`;
}

async function get(cookie: string): Promise<number> {
  const res = await fetch(`${baseUrl}/api/businesses`, { headers: { cookie } });
  await res.text();
  return res.status;
}

before(async () => {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  const exists = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [TEST_DB_NAME]);
  if (exists.rowCount === 0) await admin.query(`CREATE DATABASE ${TEST_DB_NAME}`);
  await admin.end();
  await migrate(db, { migrationsFolder: MIGRATIONS });
  // The columns Supabase's auth.users has and the check reads — LOCAL test DB only.
  await pool.query(`CREATE SCHEMA IF NOT EXISTS auth`);
  await pool.query(`CREATE TABLE IF NOT EXISTS auth.users (
    id uuid PRIMARY KEY, email text, deleted_at timestamptz, banned_until timestamptz,
    raw_app_meta_data jsonb, email_confirmed_at timestamptz, encrypted_password text)`);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

beforeEach(() => clearAccountStatusCache());

after(async () => {
  for (const id of made) {
    await wipeBusinessData(id);
    await pool.query(`DELETE FROM auth.users WHERE id = $1`, [id]);
  }
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.end();
});

test("an active account is let in", async () => {
  assert.equal(await get(await cookieFor(await user())), 200);
});

test("a session for an account that no longer exists is refused", async () => {
  assert.equal(await get(await cookieFor(crypto.randomUUID())), 401);
});

test("a deleted (soft-deleted) account is refused — and cannot create a business", async () => {
  const id = await user({ deletedAt: new Date() });
  const cookie = await cookieFor(id);
  assert.equal(await get(cookie), 401);
  const res = await fetch(`${baseUrl}/api/businesses`, {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ name: "Ghost books", businessType: "service" }),
  });
  assert.equal(res.status, 401);
  assert.equal((await db.select().from(businessesTable).where(eq(businessesTable.userId, id))).length, 0, "nothing was created");
});

test("a banned account is refused; a ban that has ended is not", async () => {
  assert.equal(await get(await cookieFor(await user({ bannedUntil: new Date(Date.now() + 3_600_000) }))), 401);
  assert.equal(await get(await cookieFor(await user({ bannedUntil: new Date(Date.now() - 3_600_000) }))), 200);
});

test("a password reset revokes sessions that began before it, not ones that began after", async () => {
  const resetAt = new Date();
  const id = await user({ validAfter: resetAt });
  assert.equal(await get(await cookieFor(id, { authTime: resetAt.getTime() - 60_000 })), 401, "the old session is revoked");
  assert.equal(await get(await cookieFor(id, { authTime: resetAt.getTime() + 1_000 })), 200, "signing in again works");
});

test("sessions from before the authTime claim fall back to iat", async () => {
  // NextAuth's encode() always stamps a fresh iat, so an OLD cookie cannot be
  // minted here; the fallback is checked on the claims directly instead.
  const { sessionAllowed, sessionStartMs } = await import("../auth/accountStatus");
  const resetAt = new Date();
  const id = await user({ validAfter: resetAt });
  const secs = Math.floor(resetAt.getTime() / 1000);
  assert.equal(sessionStartMs({ iat: secs - 120 }), (secs - 120) * 1000);
  assert.equal(sessionStartMs({ authTime: 5, iat: 999 }), 5, "authTime wins when present");
  assert.equal(await sessionAllowed(id, sessionStartMs({ iat: secs - 120 })), false);
  assert.equal(await sessionAllowed(id, sessionStartMs({ iat: secs + 120 })), true);
});

test("a session whose uid is not a Supabase id is refused (no database lookup)", async () => {
  assert.equal(await get(await cookieFor("not-a-uuid")), 401);
});

test("the verdict is cached for the TTL, and forgetting it applies a change at once", async () => {
  const id = await user();
  const cookie = await cookieFor(id);
  assert.equal(await get(cookie), 200);
  await pool.query(`UPDATE auth.users SET banned_until = now() + interval '1 hour' WHERE id = $1`, [id]);
  assert.equal(await get(cookie), 200, "within the TTL the cached verdict stands (documented: up to 60 s)");
  forgetAccountStatus(id); // what the instance that bans/deletes/revokes does
  assert.equal(await get(cookie), 401);
});

test("a forged cookie (wrong secret) is refused before any account lookup", async () => {
  const id = await user();
  const forged = await encode({ token: { uid: id, sub: id, authTime: Date.now() }, secret: "not-the-secret" });
  assert.equal(await get(`next-auth.session-token=${forged}`), 401);
});
