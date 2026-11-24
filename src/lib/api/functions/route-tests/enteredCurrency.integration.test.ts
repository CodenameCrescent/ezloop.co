/**
 * ENTRIES TYPED IN ANOTHER CURRENCY, driven over real HTTP.
 *
 * The conversion happens in the route, before the ledger or the preview sees
 * the entry, so a service test would skip the one step that matters. These pin:
 * the typed dollars convert on save and are remembered beside the rupees; a
 * catalogue item's rupee costs are NOT multiplied by the rate; the preview
 * promises the figure the ledger then lists; and a dollar amount with no rate
 * is refused rather than counted as rupees.
 */
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import path from "node:path";
import http from "node:http";
import type { AddressInfo } from "node:net";
import pg from "pg";
import {
  createRevenueItem as createRevenueItemContract,
  createTransaction as createTransactionContract,
  getFxRate as getFxRateContract,
  previewTransaction as previewContract,
} from "@workspace/api-contract";
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
const { setFxFetcherForTests } = await import("@/app/api/fx-rate/functions");
const { default: app } = await import("../app");

const MIGRATIONS = path.join(
  fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..", "..", "drizzle", "migrations",
);

const USER = "entered-currency-user";
let baseUrl = "";
let server: http.Server;
let businessId = "";

async function call(contract: { method: string; path: string }, body?: unknown, query = "") {
  const res = await fetch(`${baseUrl}/api${contract.path}${query}`, {
    method: contract.method,
    headers: {
      "content-type": "application/json",
      "x-profit-loop-dev-user-id": USER,
      "x-profit-loop-business-id": businessId,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: res.status, body: (await res.json()) as any };
}

const today = new Date().toISOString();

before(async () => {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  const exists = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [TEST_DB_NAME]);
  if (exists.rowCount === 0) await admin.query(`CREATE DATABASE ${TEST_DB_NAME}`);
  await admin.end();
  await migrate(db, { migrationsFolder: MIGRATIONS });
  await wipeBusinessData(USER);
  // Base currency defaults to PKR.
  businessId = (await createBusiness(USER, { name: "Dollar entries", businessType: "ecommerce" })).id;

  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  setFxFetcherForTests(null);
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.end();
});

test("a sale typed in dollars is saved in rupees, and the dollars are remembered beside it", async () => {
  const { status, body } = await call(createTransactionContract, {
    direction: "in",
    occurredAt: today,
    enteredIn: { currency: "USD", fxRate: "280.5" },
    lines: [{ direction: "in", label: "Mug", qty: "2", unitPriceCents: 1000 }],
  });
  assert.equal(status, 200, JSON.stringify(body));
  // 2 × $10.00 at 280.5 = Rs 5,610.00
  assert.equal(body.amountCents, 561000);
  assert.equal(body.netRevenueCents, 561000);
  assert.equal(body.lines[0].unitPriceCents, 280500);
  assert.deepEqual(body.entered, { currency: "USD", fxRate: "280.5", amountCents: 2000 });
  // Stored as base money: nothing downstream converts it a second time.
  assert.equal(body.fxRateToBase, "1");
});

test("a catalogue item's rupee cost is not multiplied by the rate", async () => {
  const item = await call(createRevenueItemContract, {
    name: "Vase",
    type: "product",
    pricingModel: "fixed",
    unitPriceCents: 300000,
    components: [{ name: "Clay", calcType: "fixed_per_unit", valueCents: 50000 }],
  });
  assert.equal(item.status, 200, JSON.stringify(item.body));

  const { status, body } = await call(createTransactionContract, {
    direction: "in",
    // Dated after the item exists: a cost only applies from the moment it was set.
    occurredAt: new Date().toISOString(),
    enteredIn: { currency: "USD", fxRate: "280" },
    lines: [{ direction: "in", revenueItemId: item.body.id, qty: "1", unitPriceCents: 1500 }],
  });
  assert.equal(status, 200, JSON.stringify(body));
  // $15 at 280 = Rs 4,200; less Rs 500 of clay — not Rs 500 × 280.
  assert.equal(body.netRevenueCents, 420000);
  assert.equal(body.contributionProfitCents, 420000 - 50000);
});

test("a catalogue item with no typed price is refused: its saved price is in rupees", async () => {
  const item = await call(createRevenueItemContract, {
    name: "Bowl",
    type: "product",
    pricingModel: "fixed",
    unitPriceCents: 200000,
  });
  const { status, body } = await call(createTransactionContract, {
    direction: "in",
    occurredAt: today,
    enteredIn: { currency: "USD", fxRate: "280" },
    lines: [{ direction: "in", revenueItemId: item.body.id, qty: "1" }],
  });
  assert.equal(status, 400, JSON.stringify(body));
});

test("the preview promises exactly the rupee figure the saved entry then lists", async () => {
  const entry = {
    direction: "out" as const,
    occurredAt: today,
    enteredIn: { currency: "USD", fxRate: "279.99" },
    lines: [{ direction: "out" as const, label: "Figma", qty: "1", unitPriceCents: 1500 }],
  };
  const preview = await call(previewContract, entry);
  const saved = await call(createTransactionContract, entry);
  assert.equal(preview.status, 200, JSON.stringify(preview.body));
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  // $15.00 × 279.99 = Rs 4,199.85
  assert.equal(preview.body.amountCents, 419985);
  assert.equal(saved.body.amountCents, 419985);
  assert.deepEqual(saved.body.entered, { currency: "USD", fxRate: "279.99", amountCents: 1500 });
});

test("dollars with no rate are refused rather than counted as rupees", async () => {
  const bare = await call(createTransactionContract, {
    direction: "in",
    occurredAt: today,
    currency: "USD",
    lines: [{ direction: "in", label: "Mug", qty: "1", unitPriceCents: 1000 }],
  });
  assert.equal(bare.status, 400, JSON.stringify(bare.body));

  const rateOfOne = await call(createTransactionContract, {
    direction: "in",
    occurredAt: today,
    enteredIn: { currency: "USD", fxRate: "1" },
    lines: [{ direction: "in", label: "Mug", qty: "1", unitPriceCents: 1000 }],
  });
  assert.equal(rateOfOne.status, 400, JSON.stringify(rateOfOne.body));
});

test("typing the business's own currency as 'another' currency is refused", async () => {
  const { status } = await call(createTransactionContract, {
    direction: "in",
    occurredAt: today,
    enteredIn: { currency: "PKR", fxRate: "2" },
    lines: [{ direction: "in", label: "Mug", qty: "1", unitPriceCents: 1000 }],
  });
  assert.equal(status, 400);
});

test("the rate box is offered today's rate into the business's own currency", async () => {
  setFxFetcherForTests(async (url) => {
    assert.ok(url.endsWith("/USD"), url);
    return { ok: true, json: async () => ({ result: "success", rates: { PKR: 276.956128 } }) } as Response;
  });
  const { status, body } = await call(getFxRateContract, undefined, "?from=USD");
  assert.equal(status, 200, JSON.stringify(body));
  assert.equal(body.to, "PKR");
  assert.equal(body.rate, "276.96");
});
