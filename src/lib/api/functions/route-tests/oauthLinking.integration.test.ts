/**
 * Google (any OAuth) sign-in may only join an existing account that has
 * CONFIRMED its email — and never touches the existing record. Real lookup
 * against a stand-in for Supabase's `auth.users` in the LOCAL test database;
 * the Supabase admin API is a fake that records what it was asked to create.
 * Google sign-in itself stays switched off; this exercises the linking rule.
 */
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import pg from "pg";
import { assertLocalTestDatabases } from "@/core/db/target";

const TEST_DB_NAME = "profit_loop_test";
const ADMIN_URL = process.env.TEST_ADMIN_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/postgres";
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? `postgres://postgres:postgres@localhost:5432/${TEST_DB_NAME}`;

// Never anything but a Postgres on this machine: these suites create, migrate and wipe.
assertLocalTestDatabases(ADMIN_URL, process.env.DATABASE_URL);

const { pool } = await import("@workspace/db");
const { findOrCreateOAuthUser, OAuthLinkRefused } = await import("../auth/accounts");

const made: string[] = [];
const tag = crypto.randomBytes(4).toString("hex");

async function authUser(email: string, opts: { confirmed: boolean; deleted?: boolean }) {
  const id = crypto.randomUUID();
  made.push(id);
  await pool.query(
    `INSERT INTO auth.users (id, email, email_confirmed_at, deleted_at, encrypted_password, raw_app_meta_data)
     VALUES ($1, $2, $3, $4, 'attacker-or-owner-hash', '{"provider":"email"}')`,
    [id, email, opts.confirmed ? new Date() : null, opts.deleted ? new Date() : null],
  );
  return id;
}
const rowOf = async (id: string) => (await pool.query(`SELECT * FROM auth.users WHERE id = $1`, [id])).rows[0];

function fakeAdmin() {
  const created: Array<Record<string, unknown>> = [];
  return {
    created,
    admin: {
      createUser: async (attrs: Record<string, unknown>) => {
        created.push(attrs);
        return { data: { user: { id: crypto.randomUUID() } }, error: null };
      },
    } as never,
  };
}
const google = (email: string, emailVerified = true) => ({ email, emailVerified, name: "G User", image: null, provider: "google" });

before(async () => {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  const exists = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [TEST_DB_NAME]);
  if (exists.rowCount === 0) await admin.query(`CREATE DATABASE ${TEST_DB_NAME}`);
  await admin.end();
  await pool.query(`CREATE SCHEMA IF NOT EXISTS auth`);
  await pool.query(`CREATE TABLE IF NOT EXISTS auth.users (
    id uuid PRIMARY KEY, email text, deleted_at timestamptz, banned_until timestamptz,
    raw_app_meta_data jsonb, email_confirmed_at timestamptz, encrypted_password text)`);
});

after(async () => {
  for (const id of made) await pool.query(`DELETE FROM auth.users WHERE id = $1`, [id]);
  await pool.end();
});

test("an UNCONFIRMED account with that email is refused, and left exactly as it was", async () => {
  const email = `victim-${tag}@test.local`;
  const id = await authUser(email, { confirmed: false }); // e.g. an attacker signed up with the victim's address
  const before = await rowOf(id);
  const { admin, created } = fakeAdmin();
  await assert.rejects(
    () => findOrCreateOAuthUser(google(email), undefined, admin),
    (e: unknown) => e instanceof OAuthLinkRefused && e.code === "OAUTH_ACCOUNT_UNCONFIRMED",
  );
  assert.deepEqual(await rowOf(id), before, "the existing record is not modified");
  assert.equal(created.length, 0, "no second account is created");
});

test("a CONFIRMED account is linked — same id, record untouched", async () => {
  const email = `owner-${tag}@test.local`;
  const id = await authUser(email, { confirmed: true });
  const before = await rowOf(id);
  const { admin, created } = fakeAdmin();
  assert.equal(await findOrCreateOAuthUser(google(email.toUpperCase()), undefined, admin), id, "matched case-insensitively");
  assert.deepEqual(await rowOf(id), before);
  assert.equal(created.length, 0);
});

test("a Google email Google has not verified is refused before anything is looked up or created", async () => {
  const { admin, created } = fakeAdmin();
  let looked = false;
  await assert.rejects(
    () => findOrCreateOAuthUser(google(`x-${tag}@test.local`, false), async () => ((looked = true), []), admin),
    (e: unknown) => e instanceof OAuthLinkRefused && e.code === "OAUTH_EMAIL_UNVERIFIED",
  );
  assert.equal(looked, false);
  assert.equal(created.length, 0);
});

test("a soft-deleted account, or two accounts sharing the email, are refused", async () => {
  const deleted = `gone-${tag}@test.local`;
  await authUser(deleted, { confirmed: true, deleted: true });
  const dup = `dup-${tag}@test.local`;
  await authUser(dup, { confirmed: true });
  await authUser(dup.toUpperCase(), { confirmed: true });
  const { admin, created } = fakeAdmin();
  for (const email of [deleted, dup]) {
    await assert.rejects(
      () => findOrCreateOAuthUser(google(email), undefined, admin),
      (e: unknown) => e instanceof OAuthLinkRefused && e.code === "OAUTH_ACCOUNT_UNAVAILABLE",
    );
  }
  assert.equal(created.length, 0);
});

test("no account yet: one is created, confirmed (Google verified it)", async () => {
  const { admin, created } = fakeAdmin();
  const id = await findOrCreateOAuthUser(google(`New-${tag}@Test.local`), undefined, admin);
  assert.match(id, /^[0-9a-f-]{36}$/);
  assert.equal(created.length, 1);
  assert.equal(created[0].email, `new-${tag}@test.local`);
  assert.equal(created[0].email_confirm, true);
});
