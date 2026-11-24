/**
 * THE SECURITY TEST for many-businesses-per-user.
 *
 * Scoping used to be implicit: a session named a user, a user had exactly one
 * business, and there was nothing for a caller to get wrong. Now the business
 * id arrives in a header, which means every money endpoint is one missing check
 * away from serving one customer another customer's books.
 *
 * ── Why it enumerates the CONTRACT ──────────────────────────────────────────
 *
 * A hand-written list of endpoints tests the endpoints someone remembered. This
 * walks every endpoint defined in `@workspace/api-contract` — the repo's single
 * source of truth for what the API is — so an endpoint added next year is
 * covered the moment it is defined, whether or not its author read this file.
 * That is the whole point: the failure mode being defended against is
 * forgetting.
 */
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import path from "node:path";
import http from "node:http";
import type { AddressInfo } from "node:net";
import pg from "pg";
import * as contract from "@workspace/api-contract";
import { assertLocalTestDatabases } from "@/core/db/target";

const TEST_DB_NAME = "profit_loop_test";
const ADMIN_URL = process.env.TEST_ADMIN_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/postgres";
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? `postgres://postgres:postgres@localhost:5432/${TEST_DB_NAME}`;
// The app is driven over real HTTP, so it needs an auth mode that a test can
// speak. The dev bypass reads the user from a header, which is exactly the two
// users this file needs.
process.env.LOCAL_AUTH_BYPASS = "true";
process.env.DISABLE_RATE_LIMIT = "true";

// Never anything but a Postgres on this machine: these suites create, migrate and wipe.
assertLocalTestDatabases(ADMIN_URL, process.env.DATABASE_URL);

const dbModule = await import("@workspace/db");
const { db, pool, businessesTable } = dbModule;
const { migrate } = await import("drizzle-orm/node-postgres/migrator");
const { eq } = await import("drizzle-orm");
const { createBusiness, listBusinesses, wipeBusinessById, wipeBusinessData } = await import("./business");
const { default: app } = await import("../app");

const MIGRATIONS = path.join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..", "..", "drizzle", "migrations");

const USER_A = "isolation-user-a";
const USER_B = "isolation-user-b";
const USER_EMPTY = "isolation-user-empty";

let baseUrl = "";
let server: http.Server;
let businessA = "";
let businessB = "";

/**
 * Endpoints that legitimately answer without naming one business, and are
 * therefore mounted outside the gate. Listed by path prefix and kept short on
 * purpose: every addition here is a hole someone has to justify.
 *
 *   /healthz     — infrastructure, no session
 *   /businesses  — the list itself; "which businesses do I have" cannot
 *                  presuppose one
 *   /account     — deleting the account takes EVERY business the caller owns.
 *                  It reads only the signed-in user id, never a business id,
 *                  so there is no one else's business for it to reach.
 */
const UNSCOPED_PREFIXES = ["/healthz", "/businesses", "/account", "/auth"];

interface Endpoint {
  method: string;
  path: string;
  body?: unknown;
}

function isEndpoint(value: unknown): value is Endpoint {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.method === "string" &&
    typeof candidate.path === "string" &&
    candidate.path.startsWith("/") &&
    candidate.response !== undefined
  );
}

/** Every scoped endpoint the contract defines, deduped by method+path. */
function scopedEndpoints(): Endpoint[] {
  const seen = new Set<string>();
  const out: Endpoint[] = [];
  for (const value of Object.values(contract)) {
    if (!isEndpoint(value)) continue;
    if (UNSCOPED_PREFIXES.some((prefix) => value.path.startsWith(prefix))) continue;
    const key = `${value.method} ${value.path}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ method: value.method, path: value.path });
  }
  return out;
}

/** Path params are irrelevant here: the gate answers before any handler runs. */
function concretePath(template: string): string {
  return template.replace(/:[A-Za-z0-9_]+/g, "no-such-id");
}

async function call(
  endpoint: Endpoint,
  headers: Record<string, string>,
): Promise<{ status: number; body: { error?: { code?: string } } | null }> {
  const method = endpoint.method.toUpperCase();
  const res = await fetch(`${baseUrl}/api${concretePath(endpoint.path)}`, {
    method,
    headers: { "content-type": "application/json", ...headers },
    // A body on every mutation, so a 400 can never be blamed on a missing one.
    body: method === "GET" || method === "HEAD" ? undefined : "{}",
  });
  const text = await res.text();
  let body: { error?: { code?: string } } | null = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  return { status: res.status, body };
}

before(async () => {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  const exists = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [TEST_DB_NAME]);
  if (exists.rowCount === 0) await admin.query(`CREATE DATABASE ${TEST_DB_NAME}`);
  await admin.end();

  await migrate(db, { migrationsFolder: MIGRATIONS });

  // These users own nothing else in the test database; leftovers from a prior
  // run would make the "how many do I own" assertions read the wrong count.
  for (const userId of [USER_A, USER_B, USER_EMPTY]) await wipeBusinessData(userId);

  businessA = (await createBusiness(USER_A, { name: "A's books", businessType: "service" })).id;
  businessB = (await createBusiness(USER_B, { name: "B's books", businessType: "service" })).id;

  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.end();
});

test("the contract defines endpoints to check — the sweep is not vacuously passing", () => {
  // A refactor that stopped exporting endpoints would make every assertion
  // below pass by testing nothing. This is the canary for that.
  assert.ok(
    scopedEndpoints().length >= 40,
    `expected the contract to expose many scoped endpoints, found ${scopedEndpoints().length}`,
  );
});

test("no money endpoint serves another user's business", async () => {
  const endpoints = scopedEndpoints();
  const leaked: string[] = [];

  for (const endpoint of endpoints) {
    const { status, body } = await call(endpoint, {
      "x-profit-loop-dev-user-id": USER_A,
      "x-profit-loop-business-id": businessB,
    });
    // 404 with the gate's own code is the only acceptable answer. Anything
    // else means the request got past the gate, whatever it did afterwards.
    if (status !== 404 || body?.error?.code !== "business_not_found") {
      leaked.push(`${endpoint.method} ${endpoint.path} → ${status} ${body?.error?.code ?? ""}`);
    }
  }

  assert.deepEqual(
    leaked,
    [],
    `these endpoints did not refuse another user's business:\n${leaked.join("\n")}`,
  );
});

test("a business id that exists nowhere is refused the same way as one that isn't yours", async () => {
  const { status, body } = await call(
    { method: "GET", path: "/settings" },
    { "x-profit-loop-dev-user-id": USER_A, "x-profit-loop-business-id": "biz_does_not_exist" },
  );
  // Identical to the foreign-business answer on purpose: telling the two apart
  // would confirm which ids are real.
  assert.equal(status, 404);
  assert.equal(body?.error?.code, "business_not_found");
});

test("a malformed business id is refused, not passed to the database", async () => {
  const { status, body } = await call(
    { method: "GET", path: "/settings" },
    { "x-profit-loop-dev-user-id": USER_A, "x-profit-loop-business-id": "'; DROP TABLE businesses; --" },
  );
  assert.equal(status, 404);
  assert.equal(body?.error?.code, "business_not_found");

  const survivors = await db.select().from(businessesTable).where(eq(businessesTable.id, businessA));
  assert.equal(survivors.length, 1, "the businesses table is still there");
});

test("your own business is served", async () => {
  const { status } = await call(
    { method: "GET", path: "/settings" },
    { "x-profit-loop-dev-user-id": USER_A, "x-profit-loop-business-id": businessA },
  );
  assert.equal(status, 200);
});

test("with exactly one business and no header, the only possible answer is used", async () => {
  const { status } = await call({ method: "GET", path: "/settings" }, { "x-profit-loop-dev-user-id": USER_A });
  assert.equal(status, 200, "one business is not a guess — it is the only candidate");
});

test("with no businesses and no header, the request is refused rather than given one", async () => {
  const { status, body } = await call(
    { method: "GET", path: "/settings" },
    { "x-profit-loop-dev-user-id": USER_EMPTY },
  );
  assert.equal(status, 400);
  assert.equal(body?.error?.code, "business_required");

  const owned = await listBusinesses(USER_EMPTY);
  assert.equal(owned.length, 0, "asking for settings must not conjure a business");
});

test("with two businesses and no header, the server refuses to choose", async () => {
  const second = await createBusiness(USER_A, { name: "A's second books", businessType: "ecommerce" });
  try {
    const { status, body } = await call({ method: "GET", path: "/settings" }, { "x-profit-loop-dev-user-id": USER_A });
    assert.equal(status, 400);
    assert.equal(body?.error?.code, "business_required");
  } finally {
    // Through the service, not a raw delete: a business owns seeded categories
    // and expense types, so removing the row directly trips its foreign keys.
    await wipeBusinessById(second.id);
  }
});

test("thresholds set on one business do not follow the owner into another", async () => {
  // Before the settings split these lived on `user_settings`, so a second
  // business silently reported against the first one's numbers.
  const shop = await createBusiness(USER_B, { name: "Threshold shop", businessType: "ecommerce" });
  const studio = await createBusiness(USER_B, { name: "Threshold studio", businessType: "service" });
  try {
    const patch = await fetch(`${baseUrl}/api/settings`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        "x-profit-loop-dev-user-id": USER_B,
        "x-profit-loop-business-id": shop.id,
      },
      // All three thresholds: the contract's `.partial()` reaches the top level
      // only, so the nested object arrives whole or not at all.
      body: JSON.stringify({
        thresholds: { scaleMargin: 42, stopScore: -30, minOrders: 3 },
        cashBuffer: 500,
      }),
    }).then((r) => r.json() as Promise<{ thresholds: { scaleMargin: number }; cashBuffer: number }>);
    assert.equal(patch.thresholds.scaleMargin, 42);
    assert.equal(patch.cashBuffer, 500);

    const other = await fetch(`${baseUrl}/api/settings`, {
      headers: { "x-profit-loop-dev-user-id": USER_B, "x-profit-loop-business-id": studio.id },
    }).then((r) => r.json() as Promise<{ thresholds: { scaleMargin: number }; cashBuffer: number }>);
    assert.notEqual(other.thresholds.scaleMargin, 42, "the studio kept its own threshold");
    assert.equal(other.cashBuffer, 0);
  } finally {
    await wipeBusinessById(shop.id);
    await wipeBusinessById(studio.id);
  }
});

test("the plan is account-wide and IS shared between a user's businesses", async () => {
  // The mirror of the test above, and the reason the split is a split rather
  // than a move: billing is per person, so this one is meant to follow.
  const first = await createBusiness(USER_B, { name: "Plan one", businessType: "service" });
  const second = await createBusiness(USER_B, { name: "Plan two", businessType: "service" });
  try {
    await fetch(`${baseUrl}/api/settings`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        "x-profit-loop-dev-user-id": USER_B,
        "x-profit-loop-business-id": first.id,
      },
      body: JSON.stringify({ plan: "Pro Plan" }),
    });
    const seen = await fetch(`${baseUrl}/api/settings`, {
      headers: { "x-profit-loop-dev-user-id": USER_B, "x-profit-loop-business-id": second.id },
    }).then((r) => r.json() as Promise<{ plan: string }>);
    assert.equal(seen.plan, "Pro Plan");
  } finally {
    await wipeBusinessById(first.id);
    await wipeBusinessById(second.id);
  }
});

test("one owner can connect a Shopify store to each of two businesses", async () => {
  // REWRITE_PLAN known-broken #10: `unique(user_id, kind)` meant the second
  // store overwrote the first. Keyed on the business, two stores is two
  // businesses — which is also the only arrangement where their profit can be
  // told apart.
  const storeOne = await createBusiness(USER_B, { name: "Store one", businessType: "ecommerce" });
  const storeTwo = await createBusiness(USER_B, { name: "Store two", businessType: "ecommerce" });
  try {
    for (const [business, account] of [
      [storeOne, "one.myshopify.com"],
      [storeTwo, "two.myshopify.com"],
    ] as const) {
      const res = await fetch(`${baseUrl}/api/integrations/shopify/connect`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-profit-loop-dev-user-id": USER_B,
          "x-profit-loop-business-id": business.id,
        },
        body: JSON.stringify({ externalAccount: account }),
      });
      assert.equal(res.status, 200, `connecting ${account} succeeded`);
    }

    const listFor = (id: string) =>
      fetch(`${baseUrl}/api/integrations`, {
        headers: { "x-profit-loop-dev-user-id": USER_B, "x-profit-loop-business-id": id },
      }).then((r) => r.json() as Promise<{ externalAccount: string | null }[]>);

    const one = await listFor(storeOne.id);
    const two = await listFor(storeTwo.id);
    assert.equal(one.length, 1);
    assert.equal(two.length, 1);
    assert.equal(one[0].externalAccount, "one.myshopify.com");
    assert.equal(two[0].externalAccount, "two.myshopify.com", "the second store did not overwrite the first");
  } finally {
    await wipeBusinessById(storeOne.id);
    await wipeBusinessById(storeTwo.id);
  }
});

test("a business carries its own name and currency, not the account's", async () => {
  // The bug this prevents: two sets of books sharing one name, so the switcher
  // shows the same label twice and the owner cannot tell them apart.
  const shop = await createBusiness(USER_B, { name: "Corner Shop", businessType: "ecommerce", currency: "PKR" });
  const studio = await createBusiness(USER_B, { name: "Design Studio", businessType: "service", currency: "USD" });
  try {
    const one = await fetch(`${baseUrl}/api/settings`, {
      headers: { "x-profit-loop-dev-user-id": USER_B, "x-profit-loop-business-id": shop.id },
    }).then((r) => r.json() as Promise<{ businessName: string; currency: string }>);
    const two = await fetch(`${baseUrl}/api/settings`, {
      headers: { "x-profit-loop-dev-user-id": USER_B, "x-profit-loop-business-id": studio.id },
    }).then((r) => r.json() as Promise<{ businessName: string; currency: string }>);

    assert.equal(one.businessName, "Corner Shop");
    assert.equal(two.businessName, "Design Studio");
    assert.equal(one.currency, "PKR");
    assert.equal(two.currency, "USD");
  } finally {
    await wipeBusinessById(shop.id);
    await wipeBusinessById(studio.id);
  }
});
