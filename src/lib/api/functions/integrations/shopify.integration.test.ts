/**
 * The Shopify connector against a real ledger.
 *
 * No network: `importShopifyOrder` takes a payload, so the whole money path can
 * be driven with fixtures. What only a database can prove is the part that
 * matters — that a re-sync changes nothing, that an imported sale is the same
 * shape of row the UI writes, and that tax and refunds land where the ladder
 * expects rather than where Shopify happens to put them.
 */
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import path from "node:path";
import pg from "pg";
import { assertLocalTestDatabases } from "@/core/db/target";

const TEST_DB_NAME = "profit_loop_test";
const ADMIN_URL = process.env.TEST_ADMIN_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/postgres";
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? `postgres://postgres:postgres@localhost:5432/${TEST_DB_NAME}`;

// Never anything but a Postgres on this machine: these suites create, migrate and wipe.
assertLocalTestDatabases(ADMIN_URL, process.env.DATABASE_URL);

const dbModule = await import("@workspace/db");
const { db, pool, integrationsTable, transactionsTable, transactionLinesTable } = dbModule;
const { migrate } = await import("drizzle-orm/node-postgres/migrator");
const { createBusiness, wipeBusinessData } = await import("../services/business");
const catalog = await import("../services/catalog");
const read = await import("../services/read");
const shopify = await import("./shopify");
const { eq, and } = await import("drizzle-orm");
const { uid } = await import("../lib/uid");
import type { ShopifyOrder } from "./shopifyNormalize";

const MIGRATIONS = path.join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..", "..", "drizzle", "migrations");
const USER = "shopify-test-user";

let businessId = "";
let integration: typeof integrationsTable.$inferSelect;
let sourceId = "";
let mugId = "";

before(async () => {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  const exists = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [TEST_DB_NAME]);
  if (exists.rowCount === 0) await admin.query(`CREATE DATABASE ${TEST_DB_NAME}`);
  await admin.end();
  await migrate(db, { migrationsFolder: MIGRATIONS });

  await wipeBusinessData(USER);
  businessId = (await createBusiness(USER, { name: "Shopify test", businessType: "ecommerce" })).id;

  [integration] = await db
    .insert(integrationsTable)
    .values({
      id: uid("int"),
      userId: USER,
      businessId,
      kind: "shopify",
      displayName: "Shopify",
      externalAccount: "test-store.myshopify.com",
    })
    .returning();

  sourceId = await shopify.ensureIntegrationSource(integration);

  // A catalogue item with a real cost, linked to its Shopify variant. This is
  // the mapping hook: `revenue_item_sources.external_id`.
  const mug = await catalog.createRevenueItem(businessId, {
    name: "Ceramic mug",
    type: "product",
    pricingModel: "per_unit",
    unitPriceCents: 250_000,
  });
  mugId = mug.id;
  await catalog.addCostComponent(businessId, mug.id, {
    name: "Clay",
    calcType: "fixed_per_unit",
    valueCents: 80_000,
    effectiveFrom: new Date("2026-01-01T00:00:00Z"),
  });
  await catalog.setRevenueItemSourceLinks(businessId, mug.id, [
    { sourceId, externalId: "variant:900", priceOverrideCents: null },
  ]);
});

after(async () => {
  await pool.end();
});

const order = (over: Partial<ShopifyOrder> = {}): ShopifyOrder => ({
  id: 5001,
  name: "#1001",
  created_at: "2026-03-04T10:00:00Z",
  financial_status: "paid",
  currency: "PKR",
  line_items: [{ id: 1, variant_id: 900, product_id: 800, title: "Ceramic mug", quantity: 2, price: "2500.00" }],
  ...over,
});

async function linesOf(externalRef: string) {
  const [header] = await db
    .select()
    .from(transactionsTable)
    .where(and(eq(transactionsTable.businessId, businessId), eq(transactionsTable.externalRef, externalRef)));
  if (!header) return null;
  const lines = await db
    .select()
    .from(transactionLinesTable)
    .where(eq(transactionLinesTable.transactionId, header.id));
  return { header, lines };
}

test("a connected store becomes a source, and keeps the same one", async () => {
  const again = await shopify.ensureIntegrationSource(integration);
  // Matching a channel by NAME would split a store's history the first time
  // somebody renamed it. The id is remembered on the integration row.
  assert.equal(again, sourceId);
  const [row] = await db.select().from(integrationsTable).where(eq(integrationsTable.id, integration.id));
  assert.equal(row.sourceId, sourceId);
});

test("an imported order is an ordinary sale that says where it came from", async () => {
  const result = await shopify.importShopifyOrder(integration, sourceId, order());
  assert.equal(result.imported, 1);

  const found = await linesOf("shopify-order-5001");
  assert.ok(found);
  assert.equal(found.header.origin, "integration");
  assert.equal(found.header.referenceNumber, "#1001");
  assert.equal(found.header.paidAt !== null, true);
  assert.equal(found.lines.length, 1);
  assert.equal(found.lines[0].revenueItemId, mugId, "the variant resolved to the catalogue item");
  assert.equal(found.lines[0].unitPriceCents, 250_000);
  // The cost came from the catalogue and is frozen on the line — which is the
  // whole reason mapping an item is worth doing.
  assert.ok(found.lines[0].costSnapshot, "a mapped line carries its cost snapshot");
});

test("importing the same order again changes nothing", async () => {
  const before = await linesOf("shopify-order-5001");
  const result = await shopify.importShopifyOrder(integration, sourceId, order());
  assert.equal(result.imported, 0);
  assert.equal(result.skipped, 1);

  const after = await linesOf("shopify-order-5001");
  assert.equal(after!.header.id, before!.header.id, "same row, not a second one");
  const all = await db
    .select()
    .from(transactionsTable)
    .where(and(eq(transactionsTable.sourceId, sourceId), eq(transactionsTable.externalRef, "shopify-order-5001")));
  assert.equal(all.length, 1, "unique(source_id, external_ref) is the real guard");
});

test("a line with no catalogue mapping is still a real sale, just without costs", async () => {
  const result = await shopify.importShopifyOrder(
    integration,
    sourceId,
    order({
      id: 5002,
      line_items: [{ id: 2, variant_id: 999, product_id: 888, title: "Sticker pack", quantity: 3, price: "800.00" }],
    }),
  );
  assert.equal(result.imported, 1);
  assert.equal(result.unmappedLines, 1, "the owner is told there is something to link");

  const found = await linesOf("shopify-order-5002");
  assert.equal(found!.lines[0].revenueItemId, null);
  assert.equal(found!.lines[0].label, "Sticker pack");
  assert.equal(found!.lines[0].unitPriceCents, 80_000);
  // Zero-catalogue entry is a product requirement, not an edge case.
  assert.equal(found!.lines[0].costSnapshot, null);
});

test("tax collected is excluded from revenue, exactly as the ladder requires", async () => {
  await shopify.importShopifyOrder(
    integration,
    sourceId,
    order({ id: 5003, total_tax: "425.00", line_items: [{ id: 3, variant_id: 900, product_id: 800, title: "Ceramic mug", quantity: 1, price: "2500.00" }] }),
  );

  const found = await linesOf("shopify-order-5003");
  assert.equal(found!.header.taxCollectedCents, 42_500);

  const pnl = await read.computePnl(businessId, USER, {
    start: new Date("2026-03-04T00:00:00Z"),
    end: new Date("2026-03-04T23:59:59Z"),
  });
  // Three orders that day: 2 mugs + 3 stickers + 1 mug. The tax is somebody
  // else's money in transit and appears in none of it.
  assert.equal(pnl.ladder.grossRevenue, 250_000 * 2 + 80_000 * 3 + 250_000);
});

test("the processor's fee is a cost inside the sale, not a deduction from it", async () => {
  await shopify.importShopifyOrder(
    integration,
    sourceId,
    order({ id: 5004, line_items: [{ id: 4, variant_id: 900, product_id: 800, title: "Ceramic mug", quantity: 1, price: "2500.00" }] }),
    { feeCents: 7_250 },
  );

  const found = await linesOf("shopify-order-5004");
  const fee = found!.lines.find((line) => line.label === "Shopify payment fee");
  assert.ok(fee, "the fee is its own line");
  assert.equal(fee.direction, "out");
  assert.equal(fee.unitPriceCents, 7_250);
  const sale = found!.lines.find((line) => line.revenueItemId === mugId);
  assert.equal(sale!.unitPriceCents, 250_000, "the sale is still what it sold for");
});

test("a refund is a new transaction carrying its own external ref", async () => {
  const withRefund = order({
    id: 5005,
    financial_status: "refunded",
    line_items: [{ id: 5, variant_id: 900, product_id: 800, title: "Ceramic mug", quantity: 1, price: "2500.00" }],
    refunds: [
      {
        id: 77,
        created_at: "2026-03-10T10:00:00Z",
        note: "Cracked in transit",
        refund_line_items: [{ quantity: 1, subtotal: "2500.00" }],
        transactions: [{ amount: "2500.00", kind: "refund", status: "success" }],
      },
    ],
  });

  const first = await shopify.importShopifyOrder(integration, sourceId, withRefund);
  assert.equal(first.imported, 1);
  assert.equal(first.refunded, 1);

  const [refundRow] = await db
    .select()
    .from(transactionsTable)
    .where(and(eq(transactionsTable.businessId, businessId), eq(transactionsTable.externalRef, "shopify-refund-77")));
  assert.ok(refundRow, "the refund is its own row — the ledger is append-only");
  assert.equal(refundRow.adjustmentType, "refund");
  assert.equal(refundRow.origin, "integration");

  // The replay that matters: Shopify re-delivers webhooks whenever it is
  // unsure, and a second copy would give the customer their money back twice.
  const second = await shopify.importShopifyOrder(integration, sourceId, withRefund);
  assert.equal(second.refunded, 0);
  const all = await db
    .select()
    .from(transactionsTable)
    .where(and(eq(transactionsTable.sourceId, sourceId), eq(transactionsTable.externalRef, "shopify-refund-77")));
  assert.equal(all.length, 1);
});

test("a cancelled order is voided, never deleted", async () => {
  await shopify.importShopifyOrder(
    integration,
    sourceId,
    order({ id: 5006, line_items: [{ id: 6, variant_id: 900, product_id: 800, title: "Ceramic mug", quantity: 1, price: "2500.00" }] }),
  );
  const result = await shopify.importShopifyOrder(
    integration,
    sourceId,
    order({
      id: 5006,
      cancelled_at: "2026-03-06T09:00:00Z",
      line_items: [{ id: 6, variant_id: 900, product_id: 800, title: "Ceramic mug", quantity: 1, price: "2500.00" }],
    }),
  );
  assert.equal(result.cancelled, 1);

  const found = await linesOf("shopify-order-5006");
  assert.equal(found!.header.status, "void", "money rows are never hard-deleted");
});

test("a test order is not money and is never imported", async () => {
  const result = await shopify.importShopifyOrder(integration, sourceId, order({ id: 5007, test: true }));
  assert.equal(result.imported, 0);
  assert.equal(result.skipped, 1);
  assert.equal(await linesOf("shopify-order-5007"), null);
});
