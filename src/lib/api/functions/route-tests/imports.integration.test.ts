/**
 * THE ROUTE TESTS for importing — the three things no service test can reach.
 *
 * Everything about reading and writing a file is covered against the services in
 * `csvImport.integration.test.ts`. This file exists for what only shows up once
 * the app is assembled and driven over real HTTP:
 *
 *  1. **The body-size ordering.** A CSV rides inside the JSON body, and the
 *     parser that allows one sits in `app.ts` AHEAD of the global 100 kB parser.
 *     Swap those two `app.use` calls and uploading stops working completely —
 *     with every other test in the suite still green, because the only thing
 *     holding the order in place was a comment. That is the exact bug this pins.
 *  2. **The template download.** It returns `text/csv`, so it is not a contract
 *     endpoint, so `isolation.integration.test.ts` — which enumerates the
 *     contract — structurally cannot see it. It is the one import endpoint no
 *     automatic sweep covers.
 *  3. **Method and path.** The routes hand-write `router.post(...)` beside
 *     `contract.path`, and nothing tied the VERB to `contract.method`. Change the
 *     method in the contract and the route would sit on the old one, answering
 *     nothing, with no test failing. So these requests are built FROM the
 *     contract rather than typed out again here — a literal copied into a test
 *     tests the copy.
 */
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import path from "node:path";
import http from "node:http";
import type { AddressInfo } from "node:net";
import pg from "pg";
import {
  commitImport as commitImportContract,
  listImportBatches as listImportBatchesContract,
  previewImport as previewImportContract,
  undoImportBatch as undoImportBatchContract,
} from "@workspace/api-contract";
import { IMPORT_KINDS, templateFilename } from "@workspace/domain";
import { assertLocalTestDatabases } from "@/core/db/target";

const TEST_DB_NAME = "profit_loop_test";
const ADMIN_URL = process.env.TEST_ADMIN_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/postgres";
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? `postgres://postgres:postgres@localhost:5432/${TEST_DB_NAME}`;
// The app is driven over real HTTP, so it needs an auth mode a test can speak —
// the same dev bypass `isolation.integration.test.ts` uses. The rate limit is off
// because three of these five routes carry `mutationRateLimit`, and a burst of
// requests from one address is precisely what a test file is.
process.env.LOCAL_AUTH_BYPASS = "true";
process.env.DISABLE_RATE_LIMIT = "true";

// Never anything but a Postgres on this machine: these suites create, migrate and wipe.
assertLocalTestDatabases(ADMIN_URL, process.env.DATABASE_URL);

const dbModule = await import("@workspace/db");
const { db, pool } = dbModule;
const { migrate } = await import("drizzle-orm/node-postgres/migrator");
const { createBusiness, getManualSource, wipeBusinessData } = await import("../services/business");
const { default: app } = await import("../app");

const MIGRATIONS = path.join(
  fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..", "..", "drizzle", "migrations",
);

const USER = "imports-routes-user";
const OTHER_USER = "imports-routes-other";

let baseUrl = "";
let server: http.Server;
let businessId = "";
let otherBusinessId = "";
let sourceId = "";

/** The two headers the dev bypass reads: who is asking, and about which books. */
function headersFor(business: string): Record<string, string> {
  return {
    "content-type": "application/json",
    "x-profit-loop-dev-user-id": USER,
    "x-profit-loop-business-id": business,
  };
}

before(async () => {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  const exists = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [TEST_DB_NAME]);
  if (exists.rowCount === 0) await admin.query(`CREATE DATABASE ${TEST_DB_NAME}`);
  await admin.end();

  await migrate(db, { migrationsFolder: MIGRATIONS });

  // Leftovers from a previous run would give this user two businesses, and the
  // gate refuses to choose between two.
  for (const userId of [USER, OTHER_USER]) await wipeBusinessData(userId);

  businessId = (await createBusiness(USER, { name: "Import routes", businessType: "ecommerce" })).id;
  otherBusinessId = (await createBusiness(OTHER_USER, { name: "Someone else's", businessType: "service" })).id;
  sourceId = (await getManualSource(businessId))!.id;

  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.end();
});

// ── 1. The body limit, and the order the two parsers run in ─────────────────

test("a body too big for the global parser is READ on an imports route and REFUSED everywhere else", async () => {
  // THE TEST THE FEATURE'S SURVIVAL DEPENDS ON.
  //
  // Both halves are load-bearing, and they fail in opposite directions:
  //
  //   · the imports half goes red if the bigger parser is moved BELOW the global
  //     one in `app.ts` (or removed), because the global 100 kB parser would
  //     answer 413 before any router ran — the feature silently stops working;
  //   · the settings half goes red if someone "fixes" that by raising the GLOBAL
  //     limit instead, which would hand every endpoint in the app a multi-megabyte
  //     buffer for an unauthenticated caller to fill.
  //
  // One assertion alone would be satisfied by the wrong fix. Together they say
  // the thing that is actually true: the big body is allowed HERE and nowhere
  // else.
  const csv = `Date,Details,Money in\r\n02/06/2026,${"z".repeat(120 * 1024)},10.00`;
  const body = JSON.stringify({ kind: "transactions", filename: "big.csv", csv, sourceId });
  assert.ok(
    body.length > 100 * 1024,
    `the fixture must exceed body-parser's 100 kB default, it is ${body.length}`,
  );

  const onImports = await fetch(`${baseUrl}/api/imports/preview`, {
    method: "POST",
    headers: headersFor(businessId),
    body,
  });
  assert.equal(onImports.status, 200, "a CSV bigger than the global limit reaches the import service");
  const preview = (await onImports.json()) as { sourceRowCount: number; counts: { ready: number } };
  // Not just "not 413": the WHOLE body arrived and was understood. A truncated
  // read could still answer 200 and would be a different bug.
  assert.equal(preview.sourceRowCount, 1);
  assert.equal(preview.counts.ready, 1);

  const onSettings = await fetch(`${baseUrl}/api/settings`, {
    method: "PATCH",
    headers: headersFor(businessId),
    body,
  });
  assert.equal(onSettings.status, 413, "every other endpoint keeps the 100 kB cap");
});

test("a file just over the cap is answered in words; one far over gets the parser's 413", async () => {
  // WHAT THE PARSER'S SPARE MEGABYTE IS FOR, and the only test that can see it.
  //
  // `importsBodyParser` is deliberately set ABOVE the file cap — the cap plus a
  // megabyte — so that a file which breaks the rule is still READ, and the owner
  // gets `csvImport.ts`'s sentence naming 3 MB instead of a bare 413 carrying no
  // words at all. That is arithmetic between two files, and arithmetic in a
  // comment is not a guarantee.
  //
  // Both halves are needed, and again they fail in opposite directions:
  //
  //   · the first goes red if the parser limit drops to the cap or below, which
  //     is the natural-looking "tidy-up" — every over-size upload would then be
  //     a wordless 413 and the owner would never learn what was wrong;
  //   · the second goes red if someone raises the parser to something enormous,
  //     which would put a multi-megabyte buffer behind these routes and hand the
  //     platform's own 4.5 MB refusal back to the owner instead of ours.
  //
  // The number is spelled out rather than imported, for the same reason the
  // service test spells it out: the cap and the sentence the owner reads have to
  // agree, and a test reading both from one constant cannot notice when they
  // stop agreeing.
  const CAP = 3 * 1024 * 1024;
  const head = `Date,Details,Money in\r\n02/06/2026,`;
  const tail = ",10.00";

  const justOver = head + "z".repeat(CAP + 1 - Buffer.byteLength(head + tail, "utf8")) + tail;
  assert.equal(Buffer.byteLength(justOver, "utf8"), CAP + 1, "one byte past the cap, not a megabyte past it");
  const overCap = await fetch(`${baseUrl}/api/imports/preview`, {
    method: "POST",
    headers: headersFor(businessId),
    body: JSON.stringify({ kind: "transactions", filename: "over.csv", csv: justOver, sourceId }),
  });
  assert.equal(overCap.status, 400, "read and refused by us, not cut off by the parser");
  const refusal = (await overCap.json()) as { error: { code: string; message: string } };
  assert.equal(refusal.error.code, "invalid");
  assert.equal(refusal.error.message, "That file is over 3 MB — try splitting it by month.");

  // And past the parser's own limit, where there is nothing to do but 413. A
  // megabyte of slack above the cap does not stretch forever, and it is better
  // for that edge to be pinned than assumed.
  const farOver = head + "z".repeat(5 * 1024 * 1024) + tail;
  const overParser = await fetch(`${baseUrl}/api/imports/preview`, {
    method: "POST",
    headers: headersFor(businessId),
    body: JSON.stringify({ kind: "transactions", filename: "huge.csv", csv: farOver, sourceId }),
  });
  assert.equal(overParser.status, 413, "the imports parser has a ceiling of its own, and it is real");
});

// ── 2. The template: the one endpoint the contract sweep cannot see ─────────

test("every template kind downloads as a named CSV file", async () => {
  // Driven over `IMPORT_KINDS` rather than four hand-written cases, so a fifth
  // kind added to the domain arrives here without anyone remembering to.
  for (const kind of IMPORT_KINDS) {
    const res = await fetch(`${baseUrl}/api/imports/template?kind=${kind}`, { headers: headersFor(businessId) });
    assert.equal(res.status, 200, `${kind} template answers`);
    assert.match(res.headers.get("content-type") ?? "", /^text\/csv/, `${kind} is served as CSV`);
    // Read from the domain, not spelled out again: the filename an owner sees and
    // the one the code builds are one fact.
    assert.equal(
      res.headers.get("content-disposition"),
      `attachment; filename="${templateFilename(kind)}"`,
      `${kind} downloads under its own name`,
    );

    const text = await res.text();
    const [header, example] = text.split(/\r?\n/);
    assert.ok(header.includes(","), `${kind} has a header row of columns`);
    assert.ok(example && example.length > 0, `${kind} carries an example row to copy`);
  }
});

test("a template kind that does not exist is refused in the app's own words", async () => {
  const res = await fetch(`${baseUrl}/api/imports/template?kind=not-a-kind`, { headers: headersFor(businessId) });
  assert.equal(res.status, 400);
  const body = (await res.json()) as { error: { code: string; message: string } };
  assert.equal(body.error.code, "invalid");
  assert.equal(body.error.message, "Unknown template");
});

test("the template is behind the business gate, like every other import route", async () => {
  // It carries no business data — `templateCsv` is generated from a static column
  // list — but it is mounted inside `scoped`, and this is the proof rather than
  // the claim. The contract sweep in `isolation.integration.test.ts` cannot reach
  // this endpoint, so without this line nothing checks it at all.
  const res = await fetch(`${baseUrl}/api/imports/template?kind=transactions`, {
    headers: { ...headersFor(businessId), "x-profit-loop-business-id": otherBusinessId },
  });
  assert.equal(res.status, 404);
  const body = (await res.json()) as { error: { code: string } };
  assert.equal(body.error.code, "business_not_found");
});

// ── 3. The verb and the path come from the contract, not from memory ────────

test("every imports endpoint is mounted on the method and path its contract names", async () => {
  // The routes write `router.post(...)` next to `contract.path`, so the PATH is
  // already tied to the contract but the VERB is not. Change `method` in
  // `lib/api-contract` and the route keeps answering on the old one — a dead
  // endpoint with nothing failing anywhere.
  //
  // So each request below is built from the contract object itself. What it
  // asserts is deliberately weak about the OUTCOME and strong about ARRIVAL: a
  // request that reaches a mounted handler comes back as this app's JSON — a
  // result, or the contract's own error envelope. A request that matches no
  // route falls through to Express's default, which is an HTML page. That is the
  // difference the verb makes, and it is the only difference this test is about.
  const endpoints = [
    previewImportContract,
    commitImportContract,
    listImportBatchesContract,
    undoImportBatchContract,
  ];

  const unreachable: string[] = [];
  for (const endpoint of endpoints) {
    const method = endpoint.method.toUpperCase();
    const url = `${baseUrl}/api${endpoint.path.replace(/:[A-Za-z0-9_]+/g, "no-such-id")}`;
    const res = await fetch(url, {
      method,
      headers: headersFor(businessId),
      body: method === "GET" || method === "HEAD" ? undefined : "{}",
    });
    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.includes("application/json")) {
      unreachable.push(`${method} ${endpoint.path} → ${res.status} ${contentType || "(no content-type)"}`);
    }
  }

  assert.deepEqual(
    unreachable,
    [],
    `these contract endpoints reached no mounted route — the verb or the path has drifted:\n${unreachable.join("\n")}`,
  );
});

test("the list and undo routes answer on their own verbs, and not on each other's", async () => {
  // The mirror of the test above. Arrival is necessary but not sufficient: if a
  // router mounted a path on every method, the check above would pass while the
  // API accepted a write where it promised a read.
  const listOnPost = await fetch(`${baseUrl}/api/imports`, {
    method: "POST",
    headers: headersFor(businessId),
    body: "{}",
  });
  assert.notEqual(listOnPost.status, 200, "the history is a GET, and POSTing to it is not a way to read it");

  const undoOnGet = await fetch(`${baseUrl}/api/imports/no-such-id/undo`, { headers: headersFor(businessId) });
  assert.notEqual(undoOnGet.status, 200, "undo is a POST; it must not be reachable by a link");
});
