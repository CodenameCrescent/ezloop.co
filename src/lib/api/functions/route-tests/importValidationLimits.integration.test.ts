/**
 * GHSA-mrhx-c7xc-m3w5: zod records one issue per bad element of a collection,
 * so a near-4 MB import body full of bad elements meant millions of issue
 * objects (hundreds of MB) per request. The import contract caps its
 * collections and zod >= 4.6.6 checks an array's cap before its elements, so
 * such a body must now fail with ONE issue. Real HTTP through the harness, at
 * the import routes' own body limit.
 *
 * Also pins the request-error wording the zod 4 upgrade had to preserve.
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

const { db, pool } = await import("@workspace/db");
const { migrate } = await import("drizzle-orm/node-postgres/migrator");
const { createBusiness, wipeBusinessData } = await import("../services/business");
const { IMPORTS_BODY_LIMIT } = await import("@/app/api/imports/functions");
const { default: app } = await import("../app");

const MIGRATIONS = path.join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..", "..", "drizzle", "migrations");
const USER = "import-limits-test-user";
let server: http.Server;
let baseUrl = "";
let business = "";

before(async () => {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  const exists = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [TEST_DB_NAME]);
  if (exists.rowCount === 0) await admin.query(`CREATE DATABASE ${TEST_DB_NAME}`);
  await admin.end();
  await migrate(db, { migrationsFolder: MIGRATIONS });
  await wipeBusinessData(USER);
  business = (await createBusiness(USER, { name: "Import limits books", businessType: "service" })).id;
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  await wipeBusinessData(USER);
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.end();
});

type ErrorBody = { error?: { code?: string; message?: string; details?: { formErrors: string[]; fieldErrors: Record<string, string[]> } } };

async function post(route: string, body: string) {
  const res = await fetch(`${baseUrl}/api${route}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-profit-loop-dev-user-id": USER, "x-profit-loop-business-id": business },
    body,
  });
  return { status: res.status, json: (await res.json()) as ErrorBody, bytes: Buffer.byteLength(body) };
}

const base = { kind: "transactions", filename: "statement.csv", csv: "Date,Amount\n2026-01-02,10", dateOrder: "dmy" };
/** `{...base, <key>: <raw>}` as JSON, the raw part filled with `unit`s (`#` = index) up to just under the import body limit. */
function nearLimit(key: string, unit: string, open: string, close: string, extra: Record<string, unknown> = {}) {
  const head = JSON.stringify({ ...base, ...extra }).slice(0, -1) + `,"${key}":${open}`;
  const budget = IMPORTS_BODY_LIMIT - head.length - close.length - 1 - 1024;
  const parts: string[] = [];
  let used = 0;
  for (let i = 0; ; i++) {
    const part = unit.replace("#", String(i));
    if (used + part.length + 1 > budget) break;
    parts.push(part);
    used += part.length + 1;
  }
  return { body: head + parts.join(",") + close + "}", count: parts.length };
}

test("commit: ~2 million bad includeKeys at the body limit fail with ONE issue", async () => {
  const { body, count } = nearLimit("includeKeys", "0", "[", "]", { mapping: { date: "Date", amount: "Amount" } });
  assert.ok(count > 1_000_000, `the attack is real: ${count} elements`);
  const started = Date.now();
  const r = await post("/imports/commit", body);
  assert.ok(r.bytes <= IMPORTS_BODY_LIMIT, "inside the route's own body limit");
  assert.equal(r.status, 400);
  assert.equal(r.json.error?.code, "invalid_request");
  assert.deepEqual(r.json.error?.details?.fieldErrors.includeKeys?.length, 1, "one issue, not one per element");
  assert.ok(Date.now() - started < 10_000, "answered promptly");
});

for (const route of ["/imports/preview", "/imports/commit"]) {
  test(`${route}: a mapping with hundreds of thousands of bad entries fails with ONE issue`, async () => {
    const { body, count } = nearLimit("mapping", `"k#":0`, "{", "}");
    assert.ok(count > 100_000, `the attack is real: ${count} keys`);
    const r = await post(route, body);
    assert.ok(r.bytes <= IMPORTS_BODY_LIMIT);
    assert.equal(r.status, 400);
    assert.equal(r.json.error?.code, "invalid_request");
    assert.deepEqual(r.json.error?.details?.fieldErrors.mapping?.length, 1, "one issue, not one per key");
  });
}

test("a real-sized commit body still validates: 5,000 include keys and a full mapping pass the contract", async () => {
  const includeKeys = Array.from({ length: 5_000 }, (_, i) => `:${i + 2}`);
  const r = await post("/imports/commit", JSON.stringify({ ...base, mapping: { date: "Date", amount: "Amount" }, includeKeys }));
  assert.notEqual(r.json.error?.code, "invalid_request", JSON.stringify(r.json).slice(0, 300));
});

test("request-error wording survives zod 4: left out, not a number, otherwise generic", async () => {
  const missing = await post("/sources", JSON.stringify({ kind: "manual" }));
  assert.equal(missing.status, 400);
  assert.equal(missing.json.error?.message, "Something required was left out");

  const twoMissing = await post("/imports/commit", JSON.stringify({ kind: "transactions", filename: "a.csv", csv: "x" }));
  assert.equal(twoMissing.json.error?.message, "2 required things were left out");

  const notNumber = await fetch(`${baseUrl}/api/transactions?limit=abc`, {
    headers: { "x-profit-loop-dev-user-id": USER, "x-profit-loop-business-id": business },
  });
  assert.equal(notNumber.status, 400);
  assert.match(((await notNumber.json()) as ErrorBody).error?.message ?? "", /isn't a number/);

  const wrongType = await post("/sources", JSON.stringify({ name: 5, kind: "manual" }));
  assert.equal(wrongType.status, 400);
  assert.equal(wrongType.json.error?.message, "Something in that request wasn't right");
});
