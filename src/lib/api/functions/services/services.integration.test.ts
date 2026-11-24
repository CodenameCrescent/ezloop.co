/**
 * Integration tests: the domain services against a REAL Postgres
 * (profit_loop_test — created and migrated here, wiped before the run).
 * These prove persistence round-trips: snapshots freeze, effective-dated
 * edits, refund limits, void recomputation, unique external_ref dedupe.
 */
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import path from "node:path";
import pg from "pg";
// Pure math, no database — safe to import statically alongside node:test.
import { addHours, costOfHours, isWeekend } from "@workspace/domain";
import { assertLocalTestDatabases } from "@/core/db/target";

const TEST_DB_NAME = "profit_loop_test";
const ADMIN_URL = process.env.TEST_ADMIN_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/postgres";
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? `postgres://postgres:postgres@localhost:5432/${TEST_DB_NAME}`;

// Everything that touches @workspace/db is imported dynamically AFTER the env
// override above, so the pool binds to the test database.
// Never anything but a Postgres on this machine: these suites create, migrate and wipe.
assertLocalTestDatabases(ADMIN_URL, process.env.DATABASE_URL);

const dbModule = await import("@workspace/db");
const { db, pool, transactionsTable, transactionLinesTable, costComponentsTable } = dbModule;
const { migrate } = await import("drizzle-orm/node-postgres/migrator");
const { and, eq } = await import("drizzle-orm");
const { ensureBusiness, getManualSource } = await import("./business");
const { findOrCreatePerson } = await import("./person");
const catalog = await import("./catalog");
const ledger = await import("./ledger");
const read = await import("./read");
const analytics = await import("./analytics");
const { ServiceError } = await import("./errors");

const MIGRATIONS = path.join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..", "..", "drizzle", "migrations");

/**
 * Drizzle wraps the driver error, so the useful part is on `cause`. Matching the
 * Postgres SQLSTATE is also more precise than a message regex: 23505 is a
 * unique violation, 23514 a failed CHECK.
 */
function isPgError(code: string) {
  return (err: unknown) => (err as { cause?: { code?: string } })?.cause?.code === code;
}
const isUniqueViolation = isPgError("23505");
const isCheckViolation = isPgError("23514");

let businessId: string;
let manualSourceId: string;

before(async () => {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE ${TEST_DB_NAME}`);
  } catch (err) {
    if ((err as { code?: string }).code !== "42P04") throw err; // 42P04 = already exists
  }
  await admin.end();

  await migrate(db, { migrationsFolder: MIGRATIONS });
  await db.execute(
    `TRUNCATE transaction_lines, transactions, cost_components, revenue_item_sources, revenue_items, expense_items, categories, sources, businesses CASCADE`,
  );

  const business = await ensureBusiness("test-user");
  businessId = business.id;
  manualSourceId = (await getManualSource(businessId))!.id;
});

after(async () => {
  await pool.end();
});

test("ensureBusiness is idempotent and guarantees the Manual source", async () => {
  const again = await ensureBusiness("test-user");
  assert.equal(again.id, businessId);
  const manual = await getManualSource(businessId);
  assert.ok(manual);
  assert.equal(manual.kind, "manual");
});

test("catalog round-trip: item + components; sale freezes a snapshot from the item price", async () => {
  const fiverr = await catalog.createSource(businessId, { name: "Fiverr — acctX", kind: "marketplace", platformFeePercent: "20" });
  const item = await catalog.createRevenueItem(businessId, {
    name: "Logo design",
    type: "service",
    pricingModel: "fixed",
    unitPriceCents: 500_00,
  });
  assert.equal(item.unitLabel, "hour"); // default by type

  await catalog.addCostComponent(businessId, item.id, {
    name: "Stock assets",
    calcType: "fixed_per_unit",
    valueCents: 50_00,
    effectiveFrom: new Date("2026-01-01T00:00:00Z"),
  });
  await catalog.addCostComponent(businessId, item.id, {
    name: "Fiverr fee",
    calcType: "percent_of_price",
    valueRate: "20",
    sourceId: fiverr.id,
    effectiveFrom: new Date("2026-01-01T00:00:00Z"),
  });

  // Manual sale: the source-scoped Fiverr fee must NOT apply. 500_00 price, cost 50_00.
  const manualSale = await ledger.createTransaction(businessId, {
    direction: "in",
    occurredAt: new Date("2026-06-01T10:00:00Z"),
    sourceId: manualSourceId,
    lines: [{ revenueItemId: item.id }],
  });
  assert.equal(manualSale.lines[0].unitPriceCents, 500_00); // defaulted from the item
  const manualSnap = manualSale.lines[0].costSnapshot as { total_per_unit_cents: number; components: unknown[] };
  assert.equal(manualSnap.total_per_unit_cents, 50_00);
  assert.equal(manualSnap.components.length, 1);

  // Fiverr sale: + 20% of 500_00 = 100_00 → total 150_00 per unit.
  const fiverrSale = await ledger.createTransaction(businessId, {
    direction: "in",
    occurredAt: new Date("2026-06-02T10:00:00Z"),
    sourceId: fiverr.id,
    lines: [{ revenueItemId: item.id }],
  });
  const fiverrSnap = fiverrSale.lines[0].costSnapshot as { total_per_unit_cents: number };
  assert.equal(fiverrSnap.total_per_unit_cents, 150_00);
});

test("updateCostComponent is effective-dated: old snapshots stay frozen in the DB", async () => {
  const item = await catalog.createRevenueItem(businessId, {
    name: "Handmade lamp",
    type: "product",
    pricingModel: "per_unit",
    unitPriceCents: 40_00,
  });
  const component = await catalog.addCostComponent(businessId, item.id, {
    name: "Materials",
    calcType: "fixed_per_unit",
    valueCents: 12_00,
    effectiveFrom: new Date("2026-01-01T00:00:00Z"),
  });

  const oldSale = await ledger.createTransaction(businessId, {
    direction: "in",
    occurredAt: new Date("2026-05-01T10:00:00Z"),
    sourceId: manualSourceId,
    lines: [{ revenueItemId: item.id, qty: "2" }],
  });
  const frozen = JSON.stringify(oldSale.lines[0].costSnapshot);

  // Edit: materials rise to 15_00 effective June 1.
  const next = await catalog.updateCostComponent(businessId, component.id, {
    valueCents: 15_00,
    effectiveFrom: new Date("2026-06-01T00:00:00Z"),
  });
  assert.equal(next.valueCents, 15_00);
  const versions = await db.select().from(costComponentsTable).where(eq(costComponentsTable.revenueItemId, item.id));
  assert.equal(versions.length, 2);
  assert.equal(versions.filter((v) => v.effectiveTo === null).length, 1); // exactly one open version

  // A sale BEFORE the edit boundary still snapshots 12_00; after → 15_00.
  const backdated = await ledger.createTransaction(businessId, {
    direction: "in",
    occurredAt: new Date("2026-05-20T10:00:00Z"),
    sourceId: manualSourceId,
    lines: [{ revenueItemId: item.id }],
  });
  assert.equal((backdated.lines[0].costSnapshot as { total_per_unit_cents: number }).total_per_unit_cents, 12_00);

  const afterEdit = await ledger.createTransaction(businessId, {
    direction: "in",
    occurredAt: new Date("2026-06-10T10:00:00Z"),
    sourceId: manualSourceId,
    lines: [{ revenueItemId: item.id }],
  });
  assert.equal((afterEdit.lines[0].costSnapshot as { total_per_unit_cents: number }).total_per_unit_cents, 15_00);

  // The old line's stored snapshot is byte-identical after the edit.
  const [storedLine] = await db
    .select()
    .from(transactionLinesTable)
    .where(eq(transactionLinesTable.id, oldSale.lines[0].id));
  assert.equal(JSON.stringify(storedLine.costSnapshot), frozen);
});

test("refund round-trip: partial then full, cumulative limits, parent status", async () => {
  const item = await catalog.createRevenueItem(businessId, {
    name: "Sticker pack",
    type: "product",
    pricingModel: "per_unit",
    unitPriceCents: 10_00,
  });
  await catalog.addCostComponent(businessId, item.id, {
    name: "Printing",
    calcType: "fixed_per_unit",
    valueCents: 3_00,
    effectiveFrom: new Date("2026-01-01T00:00:00Z"),
  });

  const sale = await ledger.createTransaction(businessId, {
    direction: "in",
    occurredAt: new Date("2026-06-05T10:00:00Z"),
    sourceId: manualSourceId,
    lines: [{ revenueItemId: item.id, qty: "3" }], // 30_00 total, cost 9_00
  });

  const partial = await ledger.createRefund(businessId, {
    transactionId: sale.transaction.id,
    requests: [{ lineId: sale.lines[0].id, qtyRefunded: "1", amountRefundedCents: 10_00, restocked: true }],
  });
  assert.equal(partial.parentStatus, "partially_refunded");
  assert.equal(partial.profitImpactCents, -10_00 + 3_00);
  assert.equal(partial.transaction.parentTransactionId, sale.transaction.id);
  assert.equal(partial.transaction.direction, "out");

  const [parentAfterPartial] = await db
    .select()
    .from(transactionsTable)
    .where(eq(transactionsTable.id, sale.transaction.id));
  assert.equal(parentAfterPartial.status, "partially_refunded");

  // Over-refund across transactions: only 20_00 refundable remains.
  await assert.rejects(
    ledger.createRefund(businessId, {
      transactionId: sale.transaction.id,
      requests: [{ lineId: sale.lines[0].id, qtyRefunded: "2", amountRefundedCents: 25_00 }],
    }),
    RangeError,
  );

  const rest = await ledger.createRefund(businessId, {
    transactionId: sale.transaction.id,
    requests: [{ lineId: sale.lines[0].id, qtyRefunded: "2", amountRefundedCents: 20_00 }],
  });
  assert.equal(rest.parentStatus, "refunded");

  // Refunding a refund is forbidden.
  await assert.rejects(
    ledger.createRefund(businessId, {
      transactionId: partial.transaction.id,
      requests: [{ lineId: partial.lines[0].id, qtyRefunded: "1", amountRefundedCents: 1 }],
    }),
    ServiceError,
  );
});

test("void rules: children first; voiding a refund recomputes the parent", async () => {
  const sale = await ledger.createTransaction(businessId, {
    direction: "in",
    occurredAt: new Date("2026-06-07T10:00:00Z"),
    sourceId: manualSourceId,
    lines: [{ label: "One-off consulting", unitPriceCents: 100_00 }],
  });
  const refund = await ledger.createRefund(businessId, {
    transactionId: sale.transaction.id,
    requests: [{ lineId: sale.lines[0].id, qtyRefunded: "1", amountRefundedCents: 40_00 }],
  });

  // Parent has a live child → cannot void the parent.
  await assert.rejects(ledger.voidTransaction(businessId, sale.transaction.id), ServiceError);

  // Voiding the refund puts the parent back to completed.
  await ledger.voidTransaction(businessId, refund.transaction.id);
  const [parent] = await db.select().from(transactionsTable).where(eq(transactionsTable.id, sale.transaction.id));
  assert.equal(parent.status, "completed");

  // Now the parent itself can be voided.
  const voided = await ledger.voidTransaction(businessId, sale.transaction.id);
  assert.equal(voided.status, "void");
});

test("price overrides and external_ref dedupe", async () => {
  const etsy = await catalog.createSource(businessId, { name: "Etsy shop", kind: "ecommerce_store" });
  const item = await catalog.createRevenueItem(businessId, {
    name: "Ceramic mug",
    type: "product",
    pricingModel: "per_unit",
    unitPriceCents: 25_00,
  });
  const { revenueItemSourcesTable } = dbModule;
  await db.insert(revenueItemSourcesTable).values({
    id: "ris_test",
    revenueItemId: item.id,
    sourceId: etsy.id,
    priceOverrideCents: 28_00, // Etsy price is higher
  });

  const etsySale = await ledger.createTransaction(businessId, {
    direction: "in",
    occurredAt: new Date("2026-06-08T10:00:00Z"),
    sourceId: etsy.id,
    externalRef: "etsy-order-1001",
    origin: "integration",
    lines: [{ revenueItemId: item.id }],
  });
  assert.equal(etsySale.lines[0].unitPriceCents, 28_00);

  // Same source + external_ref again → the day-one dedupe constraint fires.
  await assert.rejects(
    ledger.createTransaction(businessId, {
      direction: "in",
      occurredAt: new Date("2026-06-08T11:00:00Z"),
      sourceId: etsy.id,
      externalRef: "etsy-order-1001",
      origin: "integration",
      lines: [{ revenueItemId: item.id }],
    }),
  );
});

test("line-kind and unlinked-line rules are enforced", async () => {
  const expenseItem = await catalog.createExpenseItem(businessId, {
    // Deliberately not a starter name — every business is seeded with a list,
    // and duplicate names are rejected (see the duplicate-name test below).
    name: "Rule-check subscription",
    type: "operational",
    costNature: "fixed",
    behavior: "recurring",
    defaultAmountCents: 20_00,
  });
  const revItem = await catalog.createRevenueItem(businessId, {
    name: "Rule-check service",
    type: "service",
    pricingModel: "fixed",
    unitPriceCents: 100_00,
  });

  // A single line linking BOTH a revenue and an expense item → rejected.
  await assert.rejects(
    ledger.createTransaction(businessId, {
      direction: "in",
      occurredAt: new Date(),
      sourceId: manualSourceId,
      lines: [{ revenueItemId: revItem.id, expenseItemId: expenseItem.id }],
    }),
    ServiceError,
  );

  // Unlinked line without a label → rejected.
  await assert.rejects(
    ledger.createTransaction(businessId, {
      direction: "out",
      occurredAt: new Date(),
      sourceId: manualSourceId,
      lines: [{ unitPriceCents: 5_00 }],
    }),
    ServiceError,
  );

  // Expense posts with the item's default amount.
  const expense = await ledger.createTransaction(businessId, {
    direction: "out",
    occurredAt: new Date("2026-06-09T10:00:00Z"),
    sourceId: manualSourceId,
    lines: [{ expenseItemId: expenseItem.id }],
  });
  assert.equal(expense.lines[0].unitPriceCents, 20_00);
});

test("Type, Category, and Source are orthogonal axes in the read model", async () => {
  // One shared category applied to BOTH a revenue and an expense line, posted
  // from two different sources. Grouping by each axis must partition
  // independently: category never leaks into the type/source classification.
  const category = await catalog.createCategory(businessId, { name: "Ortho label", appliesTo: "both" });
  const srcA = await catalog.createSource(businessId, { name: "Ortho source A", kind: "manual" });
  const srcB = await catalog.createSource(businessId, { name: "Ortho source B", kind: "manual" });
  const rev = await catalog.createRevenueItem(businessId, {
    name: "Ortho revenue item",
    type: "service",
    pricingModel: "fixed",
    unitPriceCents: 100_00,
  });
  const exp = await catalog.createExpenseItem(businessId, {
    name: "Ortho expense item",
    type: "operational",
    costNature: "fixed",
    defaultAmountCents: 40_00,
  });

  await ledger.createTransaction(businessId, {
    direction: "in",
    occurredAt: new Date("2026-06-20T10:00:00Z"),
    sourceId: srcA.id,
    lines: [{ revenueItemId: rev.id, categoryId: category.id }],
  });
  await ledger.createTransaction(businessId, {
    direction: "out",
    occurredAt: new Date("2026-06-21T10:00:00Z"),
    sourceId: srcB.id,
    lines: [{ expenseItemId: exp.id, categoryId: category.id }],
  });

  // Scope to just this category so accumulated fixtures don't interfere.
  const byType = await read.listTransactions(businessId, "test-user", { categoryId: category.id, groupBy: "type" });
  assert.equal(byType.totalCount, 2);
  // Same category, but Type splits them: one revenue, one expense.
  assert.deepEqual(new Set(byType.groups!.map((g) => g.key)), new Set(["revenue", "expense"]));

  const byCategory = await read.listTransactions(businessId, "test-user", { categoryId: category.id, groupBy: "category" });
  // Different type AND different source, but Category groups them into one bucket.
  assert.equal(byCategory.groups!.length, 1);
  assert.equal(byCategory.groups![0].key, category.id);

  const bySource = await read.listTransactions(businessId, "test-user", { categoryId: category.id, groupBy: "source" });
  // Same category, but Source splits them.
  assert.deepEqual(new Set(bySource.groups!.map((g) => g.key)), new Set([srcA.id, srcB.id]));
});

test("updateTransactionHeader edits safe fields; blocks money-state and adjustment edits", async () => {
  const item = await catalog.createRevenueItem(businessId, {
    name: "Edit-safe item",
    type: "service",
    pricingModel: "fixed",
    unitPriceCents: 100_00,
  });
  // An invoice that is real but not paid yet: a completed row with no paid date.
  const { transaction } = await ledger.createTransaction(businessId, {
    direction: "in",
    occurredAt: new Date("2026-02-01T00:00:00Z"),
    paidAt: null,
    sourceId: manualSourceId,
    lines: [{ revenueItemId: item.id, qty: "1" }],
  });
  assert.equal(transaction.paidAt, null);
  assert.equal(transaction.status, "completed");

  // Notes + settling it persist. Settling is a paid DATE now, not a status.
  const updated = await ledger.updateTransactionHeader(businessId, transaction.id, {
    notes: "paid in cash",
    paidAt: new Date("2026-02-20T00:00:00Z"),
  });
  assert.equal(updated.notes, "paid in cash");
  assert.equal(updated.paidAt?.toISOString().slice(0, 10), "2026-02-20");
  // The lifecycle status never moved — it was always a real transaction.
  assert.equal(updated.status, "completed");

  // And it can go back to unpaid if it was marked settled by mistake.
  const unsettled = await ledger.updateTransactionHeader(businessId, transaction.id, { paidAt: null });
  assert.equal(unsettled.paidAt, null);
  await ledger.updateTransactionHeader(businessId, transaction.id, { paidAt: new Date("2026-02-20T00:00:00Z") });

  // The incurred date can move independently of the paid date.
  const moved = await ledger.updateTransactionHeader(businessId, transaction.id, { occurredAt: new Date("2026-03-15T00:00:00Z") });
  assert.equal(moved.occurredAt.toISOString().slice(0, 10), "2026-03-15");
  assert.equal(moved.paidAt?.toISOString().slice(0, 10), "2026-02-20");

  const refund = await ledger.createRefundForAmount(businessId, { transactionId: transaction.id, amountCents: 100_00 });
  // The refund transaction itself is an adjustment → not editable.
  await assert.rejects(
    () => ledger.updateTransactionHeader(businessId, refund.transaction.id, { notes: "nope" }),
    ServiceError,
  );
});

test("getExpenseItemDetail returns period stats, per-source split, and recent transactions", async () => {
  const rent = await catalog.createExpenseItem(businessId, {
    name: "Detail-drawer rent",
    type: "operational",
    costNature: "fixed",
    behavior: "recurring",
    defaultAmountCents: 500_00,
  });
  for (const day of ["2026-04-01", "2026-04-05"]) {
    await ledger.createTransaction(businessId, {
      direction: "out",
      occurredAt: new Date(`${day}T00:00:00Z`),
      sourceId: manualSourceId,
      lines: [{ expenseItemId: rent.id, qty: "1", unitPriceCents: 500_00 }],
    });
  }

  const detail = await read.getExpenseItemDetail(businessId, "test-user", rent.id, {
    start: new Date("2026-01-01T00:00:00Z"),
    end: new Date("2026-12-31T23:59:59Z"),
  });
  assert.ok(detail);
  assert.equal(detail.item.name, "Detail-drawer rent");
  assert.equal(detail.stats.spentCents, 1000_00); // item-specific, unaffected by other fixtures
  assert.equal(detail.stats.transactionCount, 2);
  assert.equal(detail.recentTransactions.length, 2);
  // Most-recent first.
  assert.ok(new Date(detail.recentTransactions[0].occurredAt) >= new Date(detail.recentTransactions[1].occurredAt));
  // Both posted from Manual.
  assert.equal(detail.perSource.length, 1);
  assert.equal(detail.perSource[0].sourceName, "Manual");
  assert.equal(detail.perSource[0].spentCents, 1000_00);

  // Unknown id → null (route maps this to a 404).
  assert.equal(await read.getExpenseItemDetail(businessId, "test-user", "nope", { start: undefined, end: undefined }), null);
});

test("mixed transaction: revenue + expense lines in ONE transaction (cost of that job)", async () => {
  const item = await catalog.createRevenueItem(businessId, {
    name: "Mixed-job service",
    type: "service",
    pricingModel: "fixed",
    unitPriceCents: 1000_00,
  });
  const created = await ledger.createTransaction(businessId, {
    direction: "in",
    occurredAt: new Date("2026-05-10T00:00:00Z"),
    sourceId: manualSourceId,
    lines: [
      { revenueItemId: item.id, qty: "1" }, // paid Rs 1000
      { direction: "out", label: "Materials", unitPriceCents: 300_00, qty: "1" }, // cost of the job
    ],
  });

  // Header summarizes as a sale; each line persists its own direction.
  assert.equal(created.transaction.direction, "in");
  assert.deepEqual(created.lines.map((l) => l.direction).sort(), ["in", "out"]);

  const detail = await read.getTransactionDetail(businessId, "test-user", created.transaction.id);
  assert.ok(detail);
  const t = detail.transaction;
  assert.equal(t.netRevenueCents, 1000_00); // revenue side only — the expense is NOT revenue
  assert.equal(t.contributionProfitCents, 700_00); // 1000 − 300 job cost
  assert.equal(t.amountCents, 1000_00); // money in = net revenue

  // The expense line links no catalog item and carries a label + "out" direction.
  const expenseLine = t.lines.find((l) => l.direction === "out")!;
  assert.equal(expenseLine.label, "Materials");
  assert.equal(expenseLine.revenueItemId, null);
});

test("reference numbers are non-unique and searchable; external_ref dedupe untouched", async () => {
  const make = (occurredAt: string) =>
    ledger.createTransaction(businessId, {
      direction: "in",
      occurredAt: new Date(occurredAt),
      sourceId: manualSourceId,
      referenceNumber: "INV-777",
      lines: [{ label: "Ref-test sale", unitPriceCents: 10_00, qty: "1" }],
    });
  // The SAME invoice number twice must NOT throw (unlike external_ref).
  const first = await make("2026-08-01T00:00:00Z");
  const second = await make("2026-08-02T00:00:00Z");
  assert.equal(first.transaction.referenceNumber, "INV-777");
  assert.equal(second.transaction.referenceNumber, "INV-777");

  // Search finds them by reference number.
  const found = await read.listTransactions(businessId, "test-user", { search: "INV-777" });
  assert.equal(found.totalCount, 2);

  // Header edit can set and clear it.
  const updated = await ledger.updateTransactionHeader(businessId, first.transaction.id, { referenceNumber: "INV-778" });
  assert.equal(updated.referenceNumber, "INV-778");
  const cleared = await ledger.updateTransactionHeader(businessId, first.transaction.id, { referenceNumber: null });
  assert.equal(cleared.referenceNumber, null);
});

test("transaction templates: save, list, post from payload, delete", async () => {
  const templates = await import("@/app/api/transaction-templates/functions");
  const payload = {
    direction: "in" as const,
    sourceId: manualSourceId,
    lines: [{ direction: "in" as const, label: "Weekly retainer", unitPriceCents: 250_00, qty: "1" }],
  };
  const saved = await templates.createTemplate(businessId, { name: "Weekly invoice", payload });
  assert.equal(saved.name, "Weekly invoice");

  const listed = await templates.listTemplates(businessId);
  assert.ok(listed.some((t) => t.id === saved.id));

  // A template never moves money itself — posting goes through createTransaction.
  const stored = listed.find((t) => t.id === saved.id)!.payload as typeof payload;
  const posted = await ledger.createTransaction(businessId, { ...stored, occurredAt: new Date("2026-08-05T00:00:00Z") });
  assert.equal(posted.transaction.direction, "in");
  assert.equal(posted.lines[0].unitPriceCents, 250_00);

  await templates.deleteTemplate(businessId, saved.id);
  const after = await templates.listTemplates(businessId);
  assert.ok(!after.some((t) => t.id === saved.id));
  await assert.rejects(() => templates.deleteTemplate(businessId, saved.id), ServiceError);
});

test("attachments: MIME allowlist, 5MB cap, business scoping, round-trip", async () => {
  const attachments = await import("./attachments");
  const { transaction } = await ledger.createTransaction(businessId, {
    direction: "out",
    occurredAt: new Date("2026-08-10T00:00:00Z"),
    sourceId: manualSourceId,
    lines: [{ label: "Receipt-test expense", unitPriceCents: 20_00, qty: "1" }],
  });

  // Disallowed MIME → rejected server-side.
  await assert.rejects(
    () => attachments.addAttachment(businessId, transaction.id, { filename: "evil.exe", mimeType: "application/x-msdownload", data: Buffer.from("MZ") }),
    ServiceError,
  );
  // Over the cap → rejected.
  await assert.rejects(
    () => attachments.addAttachment(businessId, transaction.id, { filename: "big.png", mimeType: "image/png", data: Buffer.alloc(attachments.ATTACHMENT_MAX_BYTES + 1) }),
    ServiceError,
  );

  // Happy path: filename sanitized, bytes round-trip.
  const saved = await attachments.addAttachment(businessId, transaction.id, {
    filename: "../..\\receipt <july>.png",
    mimeType: "image/png",
    data: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
  });
  assert.ok(!saved.filename.includes("/") && !saved.filename.includes("\\") && !saved.filename.includes("<"));
  const listed = await attachments.listAttachments(businessId, transaction.id);
  assert.equal(listed.length, 1);
  const full = await attachments.getAttachment(businessId, saved.id);
  assert.deepEqual([...full.data], [0x89, 0x50, 0x4e, 0x47]);

  // A different business cannot see, fetch, or delete it.
  const stranger = await ensureBusiness("test-user-stranger");
  await assert.rejects(() => attachments.getAttachment(stranger.id, saved.id), ServiceError);
  await assert.rejects(() => attachments.deleteAttachment(stranger.id, saved.id), ServiceError);
  await assert.rejects(() => attachments.listAttachments(stranger.id, transaction.id), ServiceError);

  await attachments.deleteAttachment(businessId, saved.id);
  assert.equal((await attachments.listAttachments(businessId, transaction.id)).length, 0);
});

test("retention data layer: cohorts + repeat stats derive from the ledger", async () => {
  const analytics2 = await import("./analytics");
  const { resolvePersonByName } = await import("./person");
  const personId = await resolvePersonByName(businessId, "Repeat Rita", new Date("2026-03-03T00:00:00Z"));
  for (const day of ["2026-03-03", "2026-04-04"]) {
    await ledger.createTransaction(businessId, {
      direction: "in",
      occurredAt: new Date(`${day}T00:00:00Z`),
      sourceId: manualSourceId,
      personId,
      lines: [{ label: "Rita sale", unitPriceCents: 50_00, qty: "1" }],
    });
  }
  const out = await analytics2.buildCustomerRetention(businessId);
  const march = out.retention.cohorts.find((c) => c.cohortMonth === "2026-03");
  assert.ok(march, "Rita's March cohort exists");
  assert.ok(march!.activePctByOffset[0] > 0, "active in her first month");
  assert.ok(out.repeat.repeatCustomers >= 1, "Rita counts as a repeat customer");
  assert.ok(out.repeat.medianDaysToSecondPurchase !== null);
});

test("drivers: the profit axis reconciles to the ladder's true profit (both windows)", async () => {
  const analytics2 = await import("./analytics");
  const current = { start: new Date("2026-01-01T00:00:00"), end: new Date("2026-06-30T23:59:59") };
  const prior = { start: new Date("2025-07-01T00:00:00"), end: new Date("2025-12-31T23:59:59") };

  const drivers = await analytics2.computeDrivers(businessId, "test-user", current, prior);
  const curLadder = await read.computePnl(businessId, "test-user", current);
  const priorLadder = await read.computePnl(businessId, "test-user", prior);

  // The whole reason drivers exist: the named buckets explain the number with
  // nothing left over. currentTrueProfitCents is the sum of the profit buckets.
  assert.equal(drivers.currentTrueProfitCents, curLadder.ladder.trueProfit);
  assert.equal(drivers.priorTrueProfitCents, priorLadder.ladder.trueProfit);

  // And the reported per-bucket deltas sum to the true-profit delta between windows.
  const summedDelta = drivers.profit.reduce((s, r) => s + r.deltaCents, 0);
  // (profit is capped at 30 rows; the seed has far fewer buckets, so it's exact.)
  assert.equal(summedDelta, curLadder.ladder.trueProfit - priorLadder.ladder.trueProfit);
});

test("signals: a high refund rate raises a plain-English nudge with a link", async () => {
  const analytics2 = await import("./analytics");
  const item = await catalog.createRevenueItem(businessId, {
    name: "Signal widget",
    type: "product",
    pricingModel: "per_unit",
    unitPriceCents: 100_00,
  });
  const sale = await ledger.createTransaction(businessId, {
    direction: "in",
    occurredAt: new Date("2028-02-01T00:00:00Z"),
    sourceId: manualSourceId,
    lines: [{ revenueItemId: item.id, qty: "1" }],
  });
  await ledger.createRefundForAmount(businessId, { transactionId: sale.transaction.id, amountCents: 50_00, occurredAt: new Date("2028-02-03T00:00:00Z") });

  const cur = { start: new Date("2028-01-01T00:00:00Z"), end: new Date("2028-12-31T23:59:59Z") };
  const prior = { start: new Date("2027-06-01T00:00:00Z"), end: new Date("2027-12-31T23:59:59Z") };
  const { signals } = await analytics2.computeSignals(businessId, "test-user", cur, prior);

  // 50% refund rate (> 8% threshold) → a refunds warning.
  const refundSignal = signals.find((s) => s.id === "refunds");
  assert.ok(refundSignal, "refund-spike signal present");
  assert.equal(refundSignal!.severity, "warning");
  // Every signal is actionable — it links somewhere.
  for (const s of signals) assert.ok(s.href.startsWith("/insights") || s.href.startsWith("/workbench"));
});

test("leaks: refunds, discounts, and unpaid aging surface for the period", async () => {
  const analytics2 = await import("./analytics");
  const item = await catalog.createRevenueItem(businessId, {
    name: "Leak-test widget",
    type: "product",
    pricingModel: "per_unit",
    unitPriceCents: 100_00,
  });
  // A completed sale with an order discount, partly refunded, in an isolated year.
  const sale = await ledger.createTransaction(businessId, {
    direction: "in",
    occurredAt: new Date("2027-03-01T00:00:00Z"),
    sourceId: manualSourceId,
    orderDiscountCents: 10_00,
    lines: [{ revenueItemId: item.id, qty: "1" }],
  });
  await ledger.createRefundForAmount(businessId, { transactionId: sale.transaction.id, amountCents: 40_00, occurredAt: new Date("2027-03-05T00:00:00Z") });
  // A sale that happened but has not been paid: no paid date, not a status.
  await ledger.createTransaction(businessId, {
    direction: "in",
    occurredAt: new Date("2027-03-02T00:00:00Z"),
    paidAt: null,
    sourceId: manualSourceId,
    lines: [{ revenueItemId: item.id, qty: "1" }],
  });
  // An unconfirmed recurring post is NOT money owed to you, so it must stay off
  // the aging list even though it also has no paid date.
  await ledger.createTransaction(businessId, {
    direction: "in",
    occurredAt: new Date("2027-03-03T00:00:00Z"),
    sourceId: manualSourceId,
    status: "pending",
    origin: "recurring_engine",
    lines: [{ revenueItemId: item.id, qty: "1" }],
  });
  // The payables mirror: an unpaid BILL — money out, no paid date.
  await ledger.createTransaction(businessId, {
    direction: "out",
    occurredAt: new Date("2027-03-04T00:00:00Z"),
    paidAt: null,
    sourceId: manualSourceId,
    lines: [{ label: "Studio rent", direction: "out", unitPriceCents: 55_00, qty: "1" }],
  });
  // A PAID bill must stay out of the owed figure.
  await ledger.createTransaction(businessId, {
    direction: "out",
    occurredAt: new Date("2027-03-04T00:00:00Z"),
    paidAt: new Date("2027-03-04T00:00:00Z"),
    sourceId: manualSourceId,
    lines: [{ label: "Paid software bill", direction: "out", unitPriceCents: 20_00, qty: "1" }],
  });

  const cur = { start: new Date("2027-01-01T00:00:00Z"), end: new Date("2027-12-31T23:59:59Z") };
  const prior = { start: new Date("2026-01-01T00:00:00Z"), end: new Date("2026-12-31T23:59:59Z") };
  const leaks = await analytics2.computeLeaks(businessId, "test-user", cur, prior);

  assert.equal(leaks.refunds.totalCents, 40_00); // isolated window: only this refund
  assert.ok(leaks.refunds.byItem.some((r) => r.name === "Leak-test widget" && r.cents === 40_00));
  assert.equal(leaks.discounts.totalCents, 10_00);
  assert.equal(leaks.unpaidAging.totalCents, 100_00);
  assert.ok(leaks.unpaidAging.rows.some((r) => r.amountCents === 100_00));
  // Only the unpaid bill counts, and only once.
  assert.equal(leaks.unpaidPayables.totalCents, 55_00);
  assert.equal(leaks.unpaidPayables.count, 1);
});

test("leaks: a spread purchase owes its full amount once, never per slice", async () => {
  const analytics2 = await import("./analytics");
  const cur = { start: new Date("2027-06-01T00:00:00Z"), end: new Date("2027-12-31T23:59:59Z") };
  const prior = { start: new Date("2026-01-01T00:00:00Z"), end: new Date("2026-12-31T23:59:59Z") };

  /*
   * Measured as a DELTA across the write, not as a whole-business total.
   *
   * What is owed is no longer scoped to the report's window — `computeLeaks`
   * asks `computeOwed`, which reads every unpaid row whenever it happened. That
   * is deliberate and is the point of asking: a debt does not stop existing
   * because the header shows June, the Money owed screen says so in as many
   * words, and an AGEING distribution that drops everything older than the
   * window is the opposite of what ageing is for. It is also what stopped the
   * Dashboard's "You owe" tile and that screen disagreeing.
   *
   * The consequence for a shared fixture database is that a total here counts
   * every other test's unpaid bills too. A delta measures this purchase and
   * nothing else, which is what the test was always about.
   */
  const before = await analytics2.computeLeaks(businessId, "test-user", cur, prior);

  // A 3-month spread posts child slice rows. The DEBT is the parent's full
  // figure; a slice is an accounting artifact and must not add to what is owed.
  const spread = await ledger.createTransaction(businessId, {
    direction: "out",
    occurredAt: new Date("2027-06-01T00:00:00Z"),
    paidAt: null,
    sourceId: manualSourceId,
    lines: [{ label: "Annual licence", direction: "out", unitPriceCents: 90_00, qty: "1", spreadMonths: 3 }],
  });
  assert.ok(spread.transaction.id);

  const after = await analytics2.computeLeaks(businessId, "test-user", cur, prior);

  assert.equal(
    after.unpaidPayables.totalCents - before.unpaidPayables.totalCents,
    90_00,
    "the parent's full amount, not the sum of three slices",
  );
  assert.equal(after.unpaidPayables.count - before.unpaidPayables.count, 1, "one debt, not four rows");
});

test("pnl series: bucket rungs sum EXACTLY to the whole-period ladder", async () => {
  // Whole-window ladder vs monthly buckets over the same window: every rung is
  // a per-transaction sum, and every transaction lands in exactly one bucket,
  // so the series must tie to the cent across all accumulated fixtures.
  const range = { start: new Date("2026-01-01T00:00:00"), end: new Date("2026-12-31T23:59:59") };
  const whole = await read.computePnl(businessId, "test-user", range);
  const series = await analytics.computePnlSeries(businessId, range, "month");

  assert.equal(series.bucket, "month");
  assert.ok(series.buckets.length >= 1 && series.buckets.length <= 12);

  const rungs = ["grossRevenue", "discounts", "refunds", "netRevenue", "contributionProfit", "periodExpenses", "trueProfit"] as const;
  for (const rung of rungs) {
    const summed = series.buckets.reduce((sum, b) => sum + b[rung], 0);
    assert.equal(summed, whole.ladder[rung], `bucket sum for ${rung} must equal the whole-period ladder`);
  }

  // Buckets that contain the fixtures actually carry counts.
  const counted = series.buckets.reduce((sum, b) => sum + b.transactionCount, 0);
  assert.ok(counted > 0);

  // A pathological request is rejected, not served slowly.
  await assert.rejects(
    () =>
      analytics.computePnlSeries(
        businessId,
        { start: new Date("2000-01-01T00:00:00"), end: new Date("2026-12-31T23:59:59") },
        "day",
      ),
    ServiceError,
  );
});

test("variants: only the deepest level sells, and the direct cost is a real cost component", async () => {
  const root = await catalog.createRevenueItemWithVariants(businessId, {
    name: "Shirt",
    type: "product",
    pricingModel: "per_unit",
    variants: [
      {
        name: "Black",
        variants: [
          { name: "Medium", unitPriceCents: 2_000_00, directCostCents: 800_00 },
          { name: "Large", unitPriceCents: 2_200_00, directCostCents: 850_00 },
        ],
      },
      { name: "White", unitPriceCents: 1_900_00, directCostCents: 750_00 },
    ],
  });

  // A node with children groups; it carries no price of its own.
  assert.equal(root.unitPriceCents, null);
  assert.equal(root.parentId, null);

  const all = await read.listRevenueItemsWithStats(businessId, "test-user", {});
  const byName = new Map(all.items.map((i) => [i.name, i]));
  const black = byName.get("Black")!;
  const medium = byName.get("Medium")!;

  assert.equal(black.parentId, root.id);
  assert.equal(black.hasVariants, true);
  assert.equal(black.unitPriceCents, null);
  assert.equal(medium.parentId, black.id);
  assert.equal(medium.hasVariants, false);
  assert.equal(medium.unitPriceCents, 2_000_00);
  // The form's one "direct cost" number is stored as an effective-dated component.
  assert.equal(medium.directCostCents, 800_00);
  assert.ok(medium.openComponents.some((c) => c.name === "Direct cost" && c.calcType === "fixed_per_unit"));

  // Selling a leaf works and freezes the direct cost into the snapshot.
  const sale = await ledger.createTransaction(businessId, {
    direction: "in",
    occurredAt: new Date("2029-04-01T10:00:00Z"),
    sourceId: manualSourceId,
    lines: [{ revenueItemId: medium.id, qty: "1" }],
  });
  assert.equal(sale.lines[0].unitPriceCents, 2_000_00);
  assert.equal((sale.lines[0].costSnapshot as { total_per_unit_cents: number }).total_per_unit_cents, 800_00);

  // Selling a grouping row is refused — the sale belongs to a variant.
  await assert.rejects(
    () =>
      ledger.createTransaction(businessId, {
        direction: "in",
        occurredAt: new Date("2029-04-02T10:00:00Z"),
        sourceId: manualSourceId,
        lines: [{ revenueItemId: root.id, qty: "1" }],
      }),
    ServiceError,
  );

  // Siblings may not share a name, but the same name under a different parent is fine.
  await assert.rejects(
    () => catalog.createRevenueItem(businessId, { name: "Medium", type: "product", pricingModel: "per_unit", unitPriceCents: 1_00, parentId: black.id }),
    (err: unknown) => err instanceof ServiceError && /already exists/.test((err as Error).message),
  );
  const white = byName.get("White")!;
  const whiteMedium = await catalog.createRevenueItem(businessId, {
    name: "Medium",
    type: "product",
    pricingModel: "per_unit",
    unitPriceCents: 1_950_00,
    parentId: white.id,
  });
  assert.equal(whiteMedium.parentId, white.id);
});

/**
 * The edit form's "direct cost" box, on an item that already exists.
 *
 * This is also how a VARIANT's cost is edited — a variant is its own revenue
 * item row — so the guarantee it needs is the effective-dated one: changing the
 * number today must not restate what was already sold.
 */
test("editing direct cost re-versions the component and leaves sold units at their frozen cost", async () => {
  const mug = await catalog.createRevenueItemWithVariants(businessId, {
    name: "Enamel mug 2031",
    type: "product",
    pricingModel: "per_unit",
    unitPriceCents: 1_000_00,
    directCostCents: 400_00,
  });

  // Sold at the OLD cost — this is the line whose snapshot must never move.
  const early = await ledger.createTransaction(businessId, {
    direction: "in",
    occurredAt: new Date("2031-01-10T10:00:00Z"),
    sourceId: manualSourceId,
    lines: [{ revenueItemId: mug.id, qty: "1" }],
  });
  assert.equal((early.lines[0].costSnapshot as { total_per_unit_cents: number }).total_per_unit_cents, 400_00);

  await catalog.setDirectCostEffective(businessId, mug.id, 550_00);

  // The form's number is the new one.
  const afterEdit = await read.getRevenueItemDetail(businessId, "test-user", mug.id, {});
  assert.equal(afterEdit!.item.directCostCents, 550_00);

  // Two versions: the old one closed, the new one open. Never mutated in place.
  const versions = await db
    .select()
    .from(costComponentsTable)
    .where(and(eq(costComponentsTable.revenueItemId, mug.id), eq(costComponentsTable.name, "Direct cost")));
  assert.equal(versions.length, 2);
  const closed = versions.filter((v) => v.effectiveTo !== null);
  const open = versions.filter((v) => v.effectiveTo === null);
  assert.equal(closed.length, 1);
  assert.equal(open.length, 1);
  assert.equal(closed[0].valueCents, 400_00);
  assert.equal(open[0].valueCents, 550_00);

  // The sale that already happened still costs what it cost.
  const stillEarly = await read.getTransactionDetail(businessId, "test-user", early.transaction.id);
  assert.equal(
    (stillEarly!.transaction.lines[0].costSnapshot as { total_per_unit_cents: number }).total_per_unit_cents,
    400_00,
  );

  // A sale AFTER the edit picks up the new cost.
  const late = await ledger.createTransaction(businessId, {
    direction: "in",
    occurredAt: new Date("2031-06-10T10:00:00Z"),
    sourceId: manualSourceId,
    lines: [{ revenueItemId: mug.id, qty: "1" }],
  });
  assert.equal((late.lines[0].costSnapshot as { total_per_unit_cents: number }).total_per_unit_cents, 550_00);

  // Saving the form again without touching the box adds no version.
  await catalog.setDirectCostEffective(businessId, mug.id, 550_00);
  const unchanged = await db
    .select()
    .from(costComponentsTable)
    .where(and(eq(costComponentsTable.revenueItemId, mug.id), eq(costComponentsTable.name, "Direct cost")));
  assert.equal(unchanged.length, 2);

  // Clearing the box retires the cost — it does not delete the history.
  await catalog.setDirectCostEffective(businessId, mug.id, null);
  const cleared = await read.getRevenueItemDetail(businessId, "test-user", mug.id, {});
  assert.equal(cleared!.item.directCostCents, null);
  assert.equal(cleared!.componentHistory.filter((c) => c.name === "Direct cost").length, 2);

  // A row that groups variants has no cost of its own.
  const shirt = await catalog.createRevenueItemWithVariants(businessId, {
    name: "Linen shirt 2031",
    type: "product",
    pricingModel: "per_unit",
    variants: [{ name: "Small", unitPriceCents: 900_00, directCostCents: 300_00 }],
  });
  await assert.rejects(() => catalog.setDirectCostEffective(businessId, shirt.id, 100_00), ServiceError);
});

/**
 * The category a revenue item is filed under, end to end.
 *
 * Had no coverage at all, which is how it drifted: the value persisted
 * correctly the whole time while nothing on screen ever read it back.
 */
test("revenue item categories: created by name, reused, and readable back off the item", async () => {
  const first = await catalog.createRevenueItem(businessId, {
    name: "Tote bag 2032",
    type: "product",
    pricingModel: "per_unit",
    unitPriceCents: 800_00,
    categoryId: await catalog.findOrCreateCategory(businessId, "Bags 2032", "revenue"),
  });
  assert.ok(first.categoryId);

  const view = await read.getRevenueItemDetail(businessId, "test-user", first.id, {});
  assert.equal(view!.item.categoryName, "Bags 2032");

  // The same name resolves to the SAME category — one label, not one per item.
  const secondCategoryId = await catalog.findOrCreateCategory(businessId, "Bags 2032", "revenue");
  assert.equal(secondCategoryId, first.categoryId);

  // Re-filing an existing item works and reads back.
  const other = await catalog.findOrCreateCategory(businessId, "Accessories 2032", "revenue");
  await catalog.updateRevenueItem(businessId, first.id, { categoryId: other });
  const refiled = await read.getRevenueItemDetail(businessId, "test-user", first.id, {});
  assert.equal(refiled!.item.categoryName, "Accessories 2032");

  // Clearing it is a real state, not a no-op.
  await catalog.updateRevenueItem(businessId, first.id, { categoryId: null });
  const uncategorized = await read.getRevenueItemDetail(businessId, "test-user", first.id, {});
  assert.equal(uncategorized!.item.categoryId, null);
  assert.equal(uncategorized!.item.categoryName, null);

  // Blank input is "no category", never a category named "".
  assert.equal(await catalog.findOrCreateCategory(businessId, "   ", "revenue"), null);
  assert.equal(await catalog.findOrCreateCategory(businessId, null, "revenue"), null);
});

/**
 * A quantity is counted in the unit it was SOLD in, frozen onto the line.
 *
 * Six hours of design work read as "×6" — six logos. The arithmetic was always
 * right; the word beside it was not. Freezing rather than resolving on read is
 * the same rule cost snapshots follow: renaming an item's unit must not restate
 * what past sales were sold in.
 */
test("a line remembers the unit it was sold in, even after the item's unit changes", async () => {
  const design = await catalog.createRevenueItem(businessId, {
    name: "Logo design 2038",
    type: "service",
    pricingModel: "hourly",
    unitPriceCents: 500_00,
  });
  assert.equal(design.unitLabel, "hour"); // defaulted from the type

  const sale = await ledger.createTransaction(businessId, {
    direction: "in",
    occurredAt: new Date("2038-04-01T10:00:00Z"),
    sourceId: manualSourceId,
    lines: [{ revenueItemId: design.id, qty: "6" }],
  });

  // Six hours at Rs 500 is Rs 3,000 — and the line says which six.
  const detail = await read.getTransactionDetail(businessId, "test-user", sale.transaction.id);
  const line = detail!.transaction.lines[0];
  assert.equal(line.qty, "6");
  assert.equal(line.unitLabel, "hour");
  assert.equal(line.unitPriceCents, 500_00);
  assert.equal(detail!.transaction.netRevenueCents, 3_000_00);

  // Renaming the item's unit does NOT restate what was already sold.
  await catalog.updateRevenueItem(businessId, design.id, { unitLabel: "day" });
  const afterRename = await read.getTransactionDetail(businessId, "test-user", sale.transaction.id);
  assert.equal(afterRename!.transaction.lines[0].unitLabel, "hour");

  // A sale AFTER the rename is counted in the new unit.
  const later = await ledger.createTransaction(businessId, {
    direction: "in",
    occurredAt: new Date("2038-06-01T10:00:00Z"),
    sourceId: manualSourceId,
    lines: [{ revenueItemId: design.id, qty: "2" }],
  });
  const laterDetail = await read.getTransactionDetail(businessId, "test-user", later.transaction.id);
  assert.equal(laterDetail!.transaction.lines[0].unitLabel, "day");

  // A label-only line counts nothing in particular, and says so.
  const labelOnly = await ledger.createTransaction(businessId, {
    direction: "in",
    occurredAt: new Date("2038-06-02T10:00:00Z"),
    sourceId: manualSourceId,
    lines: [{ label: "Rush handling", qty: "1", unitPriceCents: 20_00 }],
  });
  const labelDetail = await read.getTransactionDetail(businessId, "test-user", labelOnly.transaction.id);
  assert.equal(labelDetail!.transaction.lines[0].unitLabel, null);

  // A refund is counted in whatever the sale it reverses was counted in.
  const refund = await ledger.createRefund(businessId, {
    transactionId: sale.transaction.id,
    requests: [{ lineId: line.id, qtyRefunded: "2", amountRefundedCents: 1_000_00 }],
  });
  const refundDetail = await read.getTransactionDetail(businessId, "test-user", refund.transaction.id);
  assert.equal(refundDetail!.transaction.lines[0].unitLabel, "hour");
});

/**
 * A ledger row names the whole product, not just the leaf.
 *
 * "Medium" on its own says nothing about WHICH product was sold, and an owner
 * with two things that both come in Medium cannot tell those rows apart at all.
 */
test("a sold variant reads as its full path, everywhere a name is shown", async () => {
  const root = await catalog.createRevenueItemWithVariants(businessId, {
    name: "Hoodie 2037",
    type: "product",
    pricingModel: "per_unit",
    variants: [
      { name: "Black", variants: [{ name: "Medium", unitPriceCents: 900_00, directCostCents: 300_00 }] },
    ],
  });
  // Walk down from THIS root: other tests in this suite own a "Medium" too, and
  // matching on the leaf name alone is exactly the ambiguity this test is about.
  const listed = await read.listRevenueItemsWithStats(businessId, "test-user", {});
  const black = listed.items.find((i) => i.parentId === root.id && i.name === "Black")!;
  const medium = listed.items.find((i) => i.parentId === black.id && i.name === "Medium")!;
  const plain = await catalog.createRevenueItem(businessId, {
    name: "Sticker 2037", type: "product", pricingModel: "per_unit", unitPriceCents: 50_00,
  });

  const sale = await ledger.createTransaction(businessId, {
    direction: "in",
    occurredAt: new Date("2037-03-01T10:00:00Z"),
    sourceId: manualSourceId,
    lines: [{ revenueItemId: medium.id, qty: "1" }, { revenueItemId: plain.id, qty: "1" }],
  });

  const detail = await read.getTransactionDetail(businessId, "test-user", sale.transaction.id);
  const variantLine = detail!.transaction.lines.find((l) => l.revenueItemId === medium.id)!;
  assert.equal(variantLine.itemName, "Hoodie 2037 / Black / Medium");

  // An item with no variants reads exactly as it always did — no stray slashes.
  const plainLine = detail!.transaction.lines.find((l) => l.revenueItemId === plain.id)!;
  assert.equal(plainLine.itemName, "Sticker 2037");

  // The row's own headline name carries it too — that is the ledger list.
  assert.ok(
    detail!.transaction.displayName.startsWith("Hoodie 2037 / Black / Medium"),
    `displayName was "${detail!.transaction.displayName}"`,
  );

  // And so does a refund of it, which names what it reverses.
  const refund = await ledger.createRefund(businessId, {
    transactionId: sale.transaction.id,
    requests: [{ lineId: variantLine.id, qtyRefunded: "1", amountRefundedCents: 900_00 }],
  });
  const refundDetail = await read.getTransactionDetail(businessId, "test-user", refund.transaction.id);
  assert.equal(refundDetail!.transaction.displayName, "Refund · Hoodie 2037 / Black / Medium");

  // The path follows a rename of any ancestor, because it is resolved on read.
  await catalog.updateRevenueItem(businessId, root.id, { name: "Zip hoodie 2037" });
  const afterRename = await read.getTransactionDetail(businessId, "test-user", sale.transaction.id);
  assert.equal(
    afterRename!.transaction.lines.find((l) => l.revenueItemId === medium.id)!.itemName,
    "Zip hoodie 2037 / Black / Medium",
  );
});

/**
 * The internal time buckets stay out of the money pickers.
 *
 * Admin, Sales & pitching and the rest are ordinary category rows tagged
 * `time` precisely so they do not turn up when filing money — nothing enforced
 * that, so they were being offered as categories to file a sale under, and
 * typing one by name would have quietly filed revenue into the bucket that
 * absorbs unbillable hours.
 */
test("time categories are offered to no money picker, and cannot be filed money by name", async () => {
  const seeded = await catalog.listCategories(businessId);
  const timeNames = seeded.filter((c) => c.appliesTo === "time").map((c) => c.name);
  assert.ok(timeNames.length > 0, "this business should have seeded time buckets");

  for (const picker of ["revenue", "expense", "money"] as const) {
    const offered = await catalog.listCategories(businessId, picker);
    assert.equal(
      offered.some((c) => c.appliesTo === "time"),
      false,
      `the ${picker} picker must offer no time bucket`,
    );
  }

  // Each money picker offers its own side plus the shared ones, and nothing else.
  const revenue = await catalog.listCategories(businessId, "revenue");
  assert.ok(revenue.every((c) => c.appliesTo === "revenue" || c.appliesTo === "both"));
  const expense = await catalog.listCategories(businessId, "expense");
  assert.ok(expense.every((c) => c.appliesTo === "expense" || c.appliesTo === "both"));

  // Unfiltered still returns everything — reports resolving a name need them.
  const everything = await catalog.listCategories(businessId);
  assert.ok(everything.some((c) => c.appliesTo === "time"));

  // Typing a time bucket's name as a money category is refused, not reused...
  await assert.rejects(
    () => catalog.findOrCreateCategory(businessId, timeNames[0], "revenue"),
    (err: unknown) => err instanceof ServiceError && /internal time categor/.test((err as Error).message),
  );
  // ...whatever the capitals, and on the expense side too.
  await assert.rejects(
    () => catalog.findOrCreateCategory(businessId, timeNames[0].toUpperCase(), "expense"),
    ServiceError,
  );
  await assert.rejects(
    () => catalog.createCategory(businessId, { name: timeNames[0].toLowerCase(), appliesTo: "revenue" }),
    ServiceError,
  );

  // And it did NOT quietly mint a second row with that name.
  const after = await catalog.listCategories(businessId);
  assert.equal(after.filter((c) => c.name.toLowerCase() === timeNames[0].toLowerCase()).length, 1);
});

/**
 * Grouping transactions by category splits a mixed sale across the categories
 * its LINES belong to.
 *
 * It used to take `lines[0]` — a row the database returned in no defined order
 * — and drop the whole transaction into that one bucket. So a sale of two
 * products from different categories reported all of its money under whichever
 * line happened to come back first, and could report it differently tomorrow.
 */
test("category rollups follow the lines, and the parts add up to the whole", async () => {
  const apparel = await catalog.findOrCreateCategory(businessId, "Apparel 2036", "revenue");
  const prints = await catalog.findOrCreateCategory(businessId, "Prints 2036", "revenue");

  const shirt = await catalog.createRevenueItemWithVariants(businessId, {
    name: "Shirt 2036", type: "product", pricingModel: "per_unit",
    unitPriceCents: 1_000_00, directCostCents: 300_00, categoryId: apparel,
  });
  const poster = await catalog.createRevenueItemWithVariants(businessId, {
    name: "Poster 2036", type: "product", pricingModel: "per_unit",
    unitPriceCents: 400_00, directCostCents: 100_00, categoryId: prints,
  });

  // One sale carrying BOTH categories, plus an order-level discount that has to
  // be split across them rather than landing wholly on one.
  const sale = await ledger.createTransaction(businessId, {
    direction: "in",
    occurredAt: new Date("2036-04-01T10:00:00Z"),
    sourceId: manualSourceId,
    orderDiscountCents: 140_00,
    lines: [
      { revenueItemId: shirt.id, qty: "1" },
      { revenueItemId: poster.id, qty: "1" },
    ],
  });

  const range = { startDate: "2036-01-01T00:00:00Z", endDate: "2036-12-31T23:59:59Z" };
  const grouped = await read.listTransactions(businessId, "test-user", { ...range, groupBy: "category" });
  const byLabel = new Map(grouped.groups!.map((g) => [g.label, g]));

  // Both categories are represented — not just whichever line came back first.
  assert.ok(byLabel.has("Apparel 2036"), "the shirt's category must appear");
  assert.ok(byLabel.has("Prints 2036"), "the poster's category must appear");

  // The discount rides the lines in proportion: 1000/1400 and 400/1400 of 140.
  assert.equal(byLabel.get("Apparel 2036")!.netRevenueCents, 900_00);
  assert.equal(byLabel.get("Prints 2036")!.netRevenueCents, 360_00);

  // THE PROPERTY: the parts add up to the whole the transaction itself reports.
  const whole = grouped.items.find((i) => i.id === sale.transaction.id)!;
  const parts = grouped.groups!.filter((g) => g.members.some((m) => m.id === sale.transaction.id));
  const summedNet = parts.reduce((s, g) => s + g.netRevenueCents, 0);
  const summedContribution = parts.reduce((s, g) => s + g.contributionProfitCents, 0);
  assert.equal(summedNet, whole.netRevenueCents);
  assert.equal(summedContribution, whole.contributionProfitCents);

  // And the per-member amounts add up to the transaction's own signed amount.
  const summedAmount = parts
    .flatMap((g) => g.members.filter((m) => m.id === sale.transaction.id))
    .reduce((s, m) => s + m.amountCents, 0);
  assert.equal(summedAmount, whole.amountCents);

  // Every group's subtotal equals the members it lists — headings and rows
  // are drawn from these, so they must never disagree.
  for (const g of grouped.groups!) {
    assert.equal(g.members.reduce((s, m) => s + m.amountCents, 0), g.amountCents, `${g.label} subtotal`);
    assert.equal(g.members.length, g.count, `${g.label} count`);
  }

  // Grouping by a header fact still puts a transaction in exactly one bucket.
  const byType = await read.listTransactions(businessId, "test-user", { ...range, groupBy: "type" });
  const appearances = byType.groups!.filter((g) => g.members.some((m) => m.id === sale.transaction.id));
  assert.equal(appearances.length, 1);
  assert.equal(appearances[0].label, "Revenue");
});

/**
 * The graph above the ledger is drawn from these buckets.
 *
 * It has to answer "what happened in this period" with the SAME money the
 * table below it lists, so the buckets are computed here, over the same
 * filtered set the rollups use — not added up in the browser from the rows it
 * happens to have (the page shows 200 at a time; the graph must show the whole
 * period), and not fetched from a separate report that knows nothing about the
 * filters the owner has set.
 *
 * Local dates on purpose: buckets start at local midnight, matching how the
 * period filter builds its ranges, so a sale at noon is never counted under
 * yesterday.
 */
const dayIn2041 = (day: number, hour = 12) => new Date(2041, 3, day, hour, 0, 0);

test("the graph's buckets are the same money as the rows, whatever the page size", async () => {
  const kiosk = await catalog.createSource(businessId, { name: "Kiosk 2041", kind: "manual" });
  const ticket = await catalog.createRevenueItem(businessId, {
    name: "Ticket 2041", type: "service", pricingModel: "per_unit",
    unitPriceCents: 100_00,
  });
  const fuel = await catalog.createExpenseItem(businessId, {
    name: "Fuel 2041", type: "operational", costNature: "variable", defaultAmountCents: 30_00,
  });

  // Two days with money, one of them mixed, and a fortnight of nothing either side.
  await ledger.createTransaction(businessId, {
    direction: "in", occurredAt: dayIn2041(10), sourceId: manualSourceId,
    lines: [{ revenueItemId: ticket.id, qty: "2" }],
  });
  await ledger.createTransaction(businessId, {
    direction: "in", occurredAt: dayIn2041(12), sourceId: kiosk.id,
    lines: [{ revenueItemId: ticket.id, qty: "1" }],
  });
  await ledger.createTransaction(businessId, {
    direction: "out", occurredAt: dayIn2041(12), sourceId: manualSourceId,
    lines: [{ expenseItemId: fuel.id }],
  });

  const range = { startDate: new Date(2041, 3, 1).toISOString(), endDate: new Date(2041, 3, 30, 23, 59, 59).toISOString() };
  const listed = await read.listTransactions(businessId, "test-user", range);

  // A month asks for daily bars, and every day is present — a day with no
  // money is a real gap in the shape, so it cannot be left out.
  assert.equal(listed.bucket, "day");
  assert.equal(listed.buckets.length, 30);

  const on = (day: number) => listed.buckets.find((b) => new Date(b.start).getDate() === day)!;
  assert.equal(on(10).inCents, 200_00);
  assert.equal(on(10).outCents, 0);
  assert.equal(on(12).inCents, 100_00);
  assert.equal(on(12).outCents, 30_00);
  assert.equal(on(11).inCents, 0, "a quiet day is still drawn");
  assert.equal(on(11).outCents, 0);

  // THE PROPERTY: the bars are the rows. Money in and money out are kept apart
  // — a day that took Rs 200 and spent Rs 30 is not a day that made Rs 170.
  const rowsIn = listed.items.filter((i) => i.direction === "in").reduce((s, i) => s + i.amountCents, 0);
  const rowsOut = listed.items.filter((i) => i.direction === "out").reduce((s, i) => s + i.amountCents, 0);
  assert.equal(listed.buckets.reduce((s, b) => s + b.inCents, 0), rowsIn);
  assert.equal(listed.buckets.reduce((s, b) => s + b.outCents, 0), rowsOut);

  // And the graph covers the PERIOD, not the page: one row on screen, same bars.
  const firstPage = await read.listTransactions(businessId, "test-user", { ...range, limit: 1 });
  assert.equal(firstPage.items.length, 1);
  assert.deepEqual(firstPage.buckets, listed.buckets);
});

test("filtering the ledger filters the graph with it", async () => {
  const range = { startDate: new Date(2041, 3, 1).toISOString(), endDate: new Date(2041, 3, 30, 23, 59, 59).toISOString() };
  const all = await read.listTransactions(businessId, "test-user", range);

  const moneyIn = await read.listTransactions(businessId, "test-user", { ...range, direction: "in" });
  assert.equal(moneyIn.buckets.reduce((s, b) => s + b.outCents, 0), 0, "nothing spent is drawn when only money in is asked for");
  assert.equal(
    moneyIn.buckets.reduce((s, b) => s + b.inCents, 0),
    all.buckets.reduce((s, b) => s + b.inCents, 0),
  );

  const kioskId = all.items.find((i) => i.sourceName === "Kiosk 2041")!.sourceId;
  const kioskOnly = await read.listTransactions(businessId, "test-user", { ...range, sourceId: kioskId });
  assert.equal(kioskOnly.buckets.reduce((s, b) => s + b.inCents, 0), 100_00);
  assert.equal(kioskOnly.buckets.reduce((s, b) => s + b.outCents, 0), 0);
});

/**
 * Archiving is how a revenue item is "deleted".
 *
 * Hard deletion is not available and must not be: an item that has sold is
 * named on every line it sold on. Archiving hides it from the pickers and
 * leaves every past figure exactly where it was.
 */
test("archiving an item hides it and its variants, and changes no money", async () => {
  const parent = await catalog.createRevenueItemWithVariants(businessId, {
    name: "Cap 2034",
    type: "product",
    pricingModel: "per_unit",
    variants: [
      { name: "Navy", unitPriceCents: 500_00, directCostCents: 200_00 },
      { name: "Grey", unitPriceCents: 500_00, directCostCents: 200_00 },
    ],
  });
  const listed = await read.listRevenueItemsWithStats(businessId, "test-user", {});
  const navy = listed.items.find((i) => i.name === "Navy")!;

  const sale = await ledger.createTransaction(businessId, {
    direction: "in",
    occurredAt: new Date("2034-05-01T10:00:00Z"),
    sourceId: manualSourceId,
    lines: [{ revenueItemId: navy.id, qty: "2" }],
  });
  const range = { start: new Date("2034-01-01T00:00:00Z"), end: new Date("2034-12-31T23:59:59Z") };
  const before = await read.listRevenueItemsWithStats(businessId, "test-user", range);
  const navyBefore = before.items.find((i) => i.id === navy.id)!;

  await catalog.updateRevenueItem(businessId, parent.id, { status: "archived" });

  // The whole family is hidden — a hidden group must not leave sellable leaves.
  const active = await read.listRevenueItemsWithStats(businessId, "test-user", {}, "active");
  const activeNames = new Set(active.items.map((i) => i.name));
  for (const name of ["Cap 2034", "Navy", "Grey"]) {
    assert.equal(activeNames.has(name), false, `${name} must be out of the active list`);
  }

  // Nothing was deleted, and no figure moved.
  const archived = await read.listRevenueItemsWithStats(businessId, "test-user", range, "archived");
  const navyAfter = archived.items.find((i) => i.id === navy.id)!;
  assert.equal(navyAfter.stats.unitsSold, navyBefore.stats.unitsSold);
  assert.equal(navyAfter.stats.netRevenueCents, navyBefore.stats.netRevenueCents);
  assert.equal(navyAfter.stats.contributionProfitCents, navyBefore.stats.contributionProfitCents);

  // The sale still names the item — by its full path — and keeps its frozen cost.
  const detail = await read.getTransactionDetail(businessId, "test-user", sale.transaction.id);
  assert.equal(detail!.transaction.lines[0].itemName, "Cap 2034 / Navy");
  assert.equal((detail!.transaction.lines[0].costSnapshot as { total_per_unit_cents: number }).total_per_unit_cents, 200_00);

  // Restoring brings the whole product back.
  await catalog.updateRevenueItem(businessId, parent.id, { status: "active" });
  const restored = await read.listRevenueItemsWithStats(businessId, "test-user", {}, "active");
  const restoredNames = new Set(restored.items.map((i) => i.name));
  for (const name of ["Cap 2034", "Navy", "Grey"]) {
    assert.equal(restoredNames.has(name), true, `${name} must come back`);
  }
});

/**
 * Adding the first variant to something that already sells.
 *
 * The parent has to STOP selling at that moment — the ledger refuses a sale
 * against any row with children — so leaving its price and direct cost in place
 * would show a price nothing could be bought at.
 */
test("the first variant converts its parent, and history keeps what it was sold at", async () => {
  const mug = await catalog.createRevenueItemWithVariants(businessId, {
    name: "Travel mug 2035",
    type: "product",
    pricingModel: "per_unit",
    unitPriceCents: 1_200_00,
    directCostCents: 400_00,
    categoryId: await catalog.findOrCreateCategory(businessId, "Drinkware 2035", "revenue"),
  });

  // Sold as a plain item, before any variant existed.
  const early = await ledger.createTransaction(businessId, {
    direction: "in",
    occurredAt: new Date("2035-02-01T10:00:00Z"),
    sourceId: manualSourceId,
    lines: [{ revenueItemId: mug.id, qty: "1" }],
  });
  assert.equal((early.lines[0].costSnapshot as { total_per_unit_cents: number }).total_per_unit_cents, 400_00);

  const small = await catalog.addVariant(businessId, mug.id, {
    name: "Small",
    unitPriceCents: 1_000_00,
    directCostCents: 350_00,
  });

  // The parent stopped selling: no price of its own, and its direct cost closed.
  const parentAfter = await read.getRevenueItemDetail(businessId, "test-user", mug.id, {});
  assert.equal(parentAfter!.item.unitPriceCents, null);
  assert.equal(parentAfter!.item.directCostCents, null);
  assert.equal(parentAfter!.item.hasVariants, true);

  // And the ledger agrees — the sale belongs to a variant now.
  await assert.rejects(
    () =>
      ledger.createTransaction(businessId, {
        direction: "in",
        occurredAt: new Date("2035-03-01T10:00:00Z"),
        sourceId: manualSourceId,
        lines: [{ revenueItemId: mug.id, qty: "1" }],
      }),
    ServiceError,
  );

  // The sale from BEFORE the conversion is untouched.
  const stillEarly = await read.getTransactionDetail(businessId, "test-user", early.transaction.id);
  assert.equal((stillEarly!.transaction.lines[0].costSnapshot as { total_per_unit_cents: number }).total_per_unit_cents, 400_00);
  assert.equal(stillEarly!.transaction.lines[0].unitPriceCents, 1_200_00);

  // The variant inherited the family traits rather than inventing its own.
  const variantView = await read.getRevenueItemDetail(businessId, "test-user", small.id, {});
  assert.equal(variantView!.item.categoryName, "Drinkware 2035");
  assert.equal(variantView!.item.type, "product");
  assert.equal(variantView!.item.directCostCents, 350_00);

  // A second variant does NOT re-run the conversion.
  await catalog.addVariant(businessId, mug.id, { name: "Large", unitPriceCents: 1_400_00 });
  const twice = await read.getRevenueItemDetail(businessId, "test-user", mug.id, {});
  assert.equal(twice!.item.unitPriceCents, null);

  // Siblings still cannot share a name, whatever the capitals.
  await assert.rejects(
    () => catalog.addVariant(businessId, mug.id, { name: "sMALL", unitPriceCents: 1_00 }),
    (err: unknown) => err instanceof ServiceError && /already exists/.test((err as Error).message),
  );

  // A variant of a priced family needs its own price — that is the row that sells.
  await assert.rejects(
    () => catalog.addVariant(businessId, mug.id, { name: "Medium" }),
    (err: unknown) => err instanceof ServiceError && /needs a price/.test((err as Error).message),
  );
});

/**
 * Capitals are not a new category.
 *
 * Case-sensitive matching is what produced "Waven" and "waven" in the live
 * database — one label, two rows, each holding part of the same revenue, so
 * every grouped total was split in half with nothing on screen to explain it.
 */
test("a category typed in different capitals is the same category", async () => {
  const first = await catalog.findOrCreateCategory(businessId, "Waven 2033", "revenue");
  assert.ok(first);

  for (const variant of ["waven 2033", "WAVEN 2033", "WaVeN 2033", "  waven 2033  "]) {
    assert.equal(
      await catalog.findOrCreateCategory(businessId, variant, "revenue"),
      first,
      `"${variant}" must resolve to the category that already exists`,
    );
  }

  // Exactly one row exists for that label, spelled the way it was first typed.
  const all = await catalog.listCategories(businessId);
  const matches = all.filter((c) => c.name.toLowerCase() === "waven 2033");
  assert.equal(matches.length, 1);
  assert.equal(matches[0].name, "Waven 2033");

  // A different name is still a different category.
  const other = await catalog.findOrCreateCategory(businessId, "Waven 2033 Leather", "revenue");
  assert.notEqual(other, first);

  // The direct create path cannot re-split it either.
  await assert.rejects(
    () => catalog.createCategory(businessId, { name: "wAVEN 2033", appliesTo: "revenue" }),
    (err: unknown) => err instanceof ServiceError && /already have a category/.test((err as Error).message),
  );

  // Two items filed under the two spellings land in ONE group.
  const a = await catalog.createRevenueItem(businessId, {
    name: "Belt 2033", type: "product", pricingModel: "per_unit", unitPriceCents: 100_00,
    categoryId: await catalog.findOrCreateCategory(businessId, "Waven 2033", "revenue"),
  });
  const b = await catalog.createRevenueItem(businessId, {
    name: "Wallet 2033", type: "product", pricingModel: "per_unit", unitPriceCents: 200_00,
    categoryId: await catalog.findOrCreateCategory(businessId, "waven 2033", "revenue"),
  });
  assert.equal(a.categoryId, b.categoryId);
});

test("expenses: money spent inside a job is visible, and a multi-line expense splits by line", async () => {
  const leather = await catalog.createExpenseItem(businessId, { name: "Leather hides 2030", type: "cogs", costNature: "variable" });
  const rent = await catalog.createExpenseItem(businessId, { name: "Studio rent 2030", type: "operational", costNature: "fixed" });
  const bag = await catalog.createRevenueItem(businessId, {
    name: "Custom bag 2030",
    type: "product",
    pricingModel: "per_unit",
    unitPriceCents: 5_000_00,
  });
  const range = { start: new Date("2030-01-01T00:00:00Z"), end: new Date("2030-12-31T23:59:59Z") };

  // A job you get paid for AND buy materials for — one transaction, both sides.
  await ledger.createTransaction(businessId, {
    direction: "in",
    occurredAt: new Date("2030-03-01T10:00:00Z"),
    sourceId: manualSourceId,
    lines: [
      { revenueItemId: bag.id, qty: "1" },
      { expenseItemId: leather.id, qty: "1", unitPriceCents: 1_200_00 },
    ],
  });

  // One standalone expense transaction covering TWO different expense types.
  await ledger.createTransaction(businessId, {
    direction: "out",
    occurredAt: new Date("2030-03-02T10:00:00Z"),
    sourceId: manualSourceId,
    lines: [
      { expenseItemId: leather.id, qty: "1", unitPriceCents: 300_00 },
      { expenseItemId: rent.id, qty: "1", unitPriceCents: 700_00 },
    ],
  });

  const list = await read.listExpenseItemsWithStats(businessId, "test-user", range);
  const byName = new Map(list.items.map((i) => [i.name, i]));
  const leatherRow = byName.get("Leather hides 2030")!;
  const rentRow = byName.get("Studio rent 2030")!;

  // Material bought for a job used to read as 0 spent while the ladder counted it.
  assert.equal(leatherRow.stats.spentCents, 1_500_00);
  assert.equal(leatherRow.stats.jobCostCents, 1_200_00);
  assert.equal(rentRow.stats.spentCents, 700_00);
  assert.equal(rentRow.stats.jobCostCents, 0);

  // The drawer must agree with the list about the same rows.
  const detail = await read.getExpenseItemDetail(businessId, "test-user", leather.id, range);
  assert.equal(detail!.stats.spentCents, 1_500_00);
  assert.equal(detail!.stats.jobCostCents, 1_200_00);

  // The two-line expense splits per line instead of landing entirely on the first type.
  // Groups key on PURPOSE now; whether a cost is fixed or variable is its own
  // axis, read by break-even rather than by this breakdown.
  const pnl = await read.computePnl(businessId, "test-user", range);
  const groups = new Map(pnl.expenseGroups.map((g) => [g.key, g.amountCents]));
  assert.equal(groups.get("cogs"), 300_00);
  assert.equal(groups.get("operational"), 700_00);

  // And the groups still reconcile to the ladder's period expenses, to the cent.
  const groupSum = pnl.expenseGroups.reduce((sum, g) => sum + g.amountCents, 0);
  assert.equal(groupSum, pnl.ladder.periodExpenses);
});

test("billing cycle and tiers are validated against type and pricing model", async () => {
  const plan = await catalog.createRevenueItem(businessId, {
    name: "Care plan",
    type: "subscription",
    pricingModel: "fixed",
    unitPriceCents: 500_00,
    defaultBillingCycle: "monthly",
  });
  assert.equal(plan.defaultBillingCycle, "monthly");

  // Cadence belongs to subscription/rental only.
  await assert.rejects(
    () => catalog.createRevenueItem(businessId, { name: "Cadence widget", type: "product", pricingModel: "per_unit", unitPriceCents: 1_00, defaultBillingCycle: "monthly" }),
    ServiceError,
  );

  // Tiers require the tiered model, must increase, and only the last may be open-ended.
  const tiered = await catalog.createRevenueItem(businessId, {
    name: "Bulk prints",
    type: "product",
    pricingModel: "tiered",
    tiers: [
      { upToQty: "10", unitPriceCents: 100_00 },
      { upToQty: "50", unitPriceCents: 90_00 },
      { upToQty: null, unitPriceCents: 80_00 },
    ],
  });
  // The first tier becomes the base price so a zero-setup sale still resolves.
  assert.equal(tiered.unitPriceCents, 100_00);
  assert.equal(tiered.tiersJson?.length, 3);

  await assert.rejects(
    () => catalog.createRevenueItem(businessId, { name: "Bad tiers", type: "product", pricingModel: "tiered", tiers: [{ upToQty: "50", unitPriceCents: 1_00 }, { upToQty: "10", unitPriceCents: 2_00 }] }),
    ServiceError,
  );
  await assert.rejects(
    () => catalog.createRevenueItem(businessId, { name: "Tiers without model", type: "product", pricingModel: "per_unit", unitPriceCents: 1_00, tiers: [{ upToQty: null, unitPriceCents: 1_00 }] }),
    ServiceError,
  );
});

test("expense classification: purpose and cost nature are independent, and old conflated types are refused", async () => {
  // The combination the single list could not express: a retainer that is
  // marketing spend AND does not move when sales move.
  const retainer = await catalog.createExpenseItem(businessId, {
    name: "Agency retainer",
    type: "marketing",
    costNature: "fixed",
  });
  assert.equal(retainer.type, "marketing");
  assert.equal(retainer.costNature, "fixed");

  // Omitted, the nature follows what the purpose usually is.
  const wages = await catalog.createExpenseItem(businessId, { name: "Seasonal wages", type: "payroll" });
  assert.equal(wages.costNature, "fixed");
  const flyers = await catalog.createExpenseItem(businessId, { name: "Printed flyers", type: "marketing" });
  assert.equal(flyers.costNature, "variable");

  // Re-filing an expense under a different purpose leaves the owner's own
  // nature choice alone — otherwise a deliberate classification silently flips.
  const refiled = await catalog.updateExpenseItem(businessId, retainer.id, { type: "operational" });
  assert.equal(refiled.type, "operational");
  assert.equal(refiled.costNature, "fixed");

  // The behavioural values may never come back as purposes.
  for (const legacy of ["fixed", "variable"]) {
    await assert.rejects(
      () => catalog.createExpenseItem(businessId, { name: `Legacy ${legacy}`, type: legacy as "custom" }),
      ServiceError,
    );
  }

  // Duplicate names say so in words rather than surfacing a DB constraint.
  await assert.rejects(
    () => catalog.createExpenseItem(businessId, { name: "Agency retainer", type: "custom" }),
    (err: Error) => err instanceof ServiceError && /already have an expense/i.test(err.message),
  );
});

test("break-even: fixed and variable split reconciles to the ladder, and drives the target", async () => {
  const bizUser = "break-even-user";
  const biz = await ensureBusiness(bizUser);
  const src = (await getManualSource(biz.id))!;
  const range = { start: new Date("2031-01-01"), end: new Date("2031-12-31") };
  const on = new Date("2031-06-01");

  const service = await catalog.createRevenueItem(biz.id, {
    name: "Consulting day",
    type: "service",
    pricingModel: "fixed",
    unitPriceCents: 1_000_00,
  });
  const rent = await catalog.createExpenseItem(biz.id, { name: "BE rent", type: "operational", costNature: "fixed" });
  const ads = await catalog.createExpenseItem(biz.id, { name: "BE ads", type: "marketing", costNature: "variable" });

  // Ten days sold at Rs 1,000 with no direct costs → Rs 10,000 contribution.
  await ledger.createTransaction(biz.id, {
    sourceId: src.id,
    direction: "in",
    occurredAt: on,
    lines: [{ revenueItemId: service.id, qty: "10", unitPriceCents: 1_000_00 }],
  });
  await ledger.createTransaction(biz.id, {
    sourceId: src.id,
    direction: "out",
    occurredAt: on,
    lines: [{ expenseItemId: rent.id, qty: "1", unitPriceCents: 2_500_00 }],
  });
  await ledger.createTransaction(biz.id, {
    sourceId: src.id,
    direction: "out",
    occurredAt: on,
    lines: [{ expenseItemId: ads.id, qty: "1", unitPriceCents: 1_000_00 }],
  });

  const be = await read.computeBreakEvenReport(biz.id, bizUser, range);

  // The split must account for every period expense the ladder counted — this
  // is what a break-even that disagrees with the P&L would violate.
  assert.equal(be.fixedExpensesCents + be.variableExpensesCents, be.periodExpensesCents);
  assert.equal(be.fixedExpensesCents, 2_500_00);
  assert.equal(be.variableExpensesCents, 1_000_00);
  assert.equal(be.unclassifiedExpensesCents, 0);

  // Margin after the costs that scale is 90%; Rs 2,500 of rent needs Rs 2,777.78.
  assert.equal(be.contributionMarginPct, 90);
  assert.equal(be.breakEvenRevenueCents, 277_778);
  assert.equal(be.reason, "ok");
  // This period made money, so it must read as past its own target.
  assert.ok(be.trueProfitCents > 0 && be.surplusCents! > 0);

  // The fixed breakdown names what to cut, and sums to the fixed total.
  assert.equal(be.fixedCostBreakdown.reduce((s, r) => s + r.amountCents, 0), be.fixedExpensesCents);
  assert.equal(be.fixedCostBreakdown[0].name, "BE rent");

  // Reclassifying rent as variable must move the target, not just a label.
  await catalog.updateExpenseItem(biz.id, rent.id, { costNature: "variable" });
  const after = await read.computeBreakEvenReport(biz.id, bizUser, range);
  assert.equal(after.fixedExpensesCents, 0);
  assert.equal(after.reason, "no_fixed_costs");
});

test("two dates: a July bill paid in August is July profit and August cash", async () => {
  const user = "two-dates-user";
  const biz = await ensureBusiness(user);
  const src = (await getManualSource(biz.id))!;
  const rent = await catalog.createExpenseItem(biz.id, { name: "TD rent", type: "operational", costNature: "fixed" });

  await ledger.createTransaction(biz.id, {
    direction: "out",
    occurredAt: new Date("2032-07-10T00:00:00Z"),
    paidAt: new Date("2032-08-05T00:00:00Z"),
    sourceId: src.id,
    lines: [{ expenseItemId: rent.id, qty: "1", unitPriceCents: 1_000_00 }],
  });

  const july = { start: new Date("2032-07-01T00:00:00Z"), end: new Date("2032-07-31T23:59:59Z") };
  const august = { start: new Date("2032-08-01T00:00:00Z"), end: new Date("2032-08-31T23:59:59Z") };

  // Profit: the bill belongs to the month it was incurred, though no cash moved.
  assert.equal((await read.computePnl(biz.id, user, july, "accrual")).ladder.periodExpenses, 1_000_00);
  assert.equal((await read.computePnl(biz.id, user, august, "accrual")).ladder.periodExpenses, 0);

  // Cash: the money left in August, so that is where the bank felt it.
  assert.equal((await read.computePnl(biz.id, user, july, "cash")).ladder.periodExpenses, 0);
  assert.equal((await read.computePnl(biz.id, user, august, "cash")).ladder.periodExpenses, 1_000_00);
});

test("two dates: an unpaid bill is profit now and never cash, until it is settled", async () => {
  const user = "unpaid-user";
  const biz = await ensureBusiness(user);
  const src = (await getManualSource(biz.id))!;
  const item = await catalog.createRevenueItem(biz.id, {
    name: "Unpaid consulting",
    type: "service",
    pricingModel: "fixed",
    unitPriceCents: 500_00,
  });

  const { transaction } = await ledger.createTransaction(biz.id, {
    direction: "in",
    occurredAt: new Date("2033-04-10T00:00:00Z"),
    paidAt: null,
    sourceId: src.id,
    lines: [{ revenueItemId: item.id, qty: "1" }],
  });

  const april = { start: new Date("2033-04-01T00:00:00Z"), end: new Date("2033-04-30T23:59:59Z") };
  const wide = { start: new Date("2033-01-01T00:00:00Z"), end: new Date("2033-12-31T23:59:59Z") };

  // Earned in April, so it is April revenue even though nobody has paid.
  assert.equal((await read.computePnl(biz.id, user, april, "accrual")).ladder.netRevenue, 500_00);
  // Cash has nowhere to put it — not even in a wide-open window.
  assert.equal((await read.computePnl(biz.id, user, wide, "cash")).ladder.netRevenue, 0);

  // Settling it moves only the cash side; profit does not move month.
  await ledger.updateTransactionHeader(biz.id, transaction.id, { paidAt: new Date("2033-06-02T00:00:00Z") });
  assert.equal((await read.computePnl(biz.id, user, april, "accrual")).ladder.netRevenue, 500_00);
  const june = { start: new Date("2033-06-01T00:00:00Z"), end: new Date("2033-06-30T23:59:59Z") };
  assert.equal((await read.computePnl(biz.id, user, june, "cash")).ladder.netRevenue, 500_00);
});

test("an unconfirmed recurring post is in neither profit nor cash, and cannot be marked paid", async () => {
  const user = "unconfirmed-user";
  const biz = await ensureBusiness(user);
  const src = (await getManualSource(biz.id))!;
  const rent = await catalog.createExpenseItem(biz.id, { name: "UC rent", type: "operational", costNature: "fixed" });

  const { transaction } = await ledger.createTransaction(biz.id, {
    direction: "out",
    occurredAt: new Date("2034-05-01T00:00:00Z"),
    sourceId: src.id,
    status: "pending",
    origin: "recurring_engine",
    lines: [{ expenseItemId: rent.id, qty: "1", unitPriceCents: 300_00 }],
  });
  // Pending means "not confirmed", so it never inherits a paid date.
  assert.equal(transaction.paidAt, null);

  const may = { start: new Date("2034-05-01T00:00:00Z"), end: new Date("2034-05-31T23:59:59Z") };
  assert.equal((await read.computePnl(biz.id, user, may, "accrual")).ladder.periodExpenses, 0);
  assert.equal((await read.computePnl(biz.id, user, may, "cash")).ladder.periodExpenses, 0);

  await assert.rejects(
    () => ledger.updateTransactionHeader(biz.id, transaction.id, { paidAt: new Date() }),
    (err: Error) => err instanceof ServiceError && /confirm/i.test(err.message),
  );
});

test("reclaimable input tax leaves the cost, and the ladder still reconciles", async () => {
  const user = "input-tax-user";
  const biz = await ensureBusiness(user);
  const src = (await getManualSource(biz.id))!;
  const supplies = await catalog.createExpenseItem(biz.id, { name: "IT supplies", type: "cogs", costNature: "variable" });
  const range = { start: new Date("2035-01-01T00:00:00Z"), end: new Date("2035-12-31T23:59:59Z") };

  // Rs 1,180 spent, of which Rs 180 is reclaimable input tax.
  await ledger.createTransaction(biz.id, {
    direction: "out",
    occurredAt: new Date("2035-03-01T00:00:00Z"),
    sourceId: src.id,
    taxPaidCents: 180_00,
    taxReclaimable: true,
    lines: [{ expenseItemId: supplies.id, qty: "1", unitPriceCents: 1_180_00 }],
  });

  const pnl = await read.computePnl(biz.id, user, range);
  assert.equal(pnl.ladder.periodExpenses, 1_000_00);

  // Break-even reads the same reduced cost, so the two screens agree.
  const be = await read.computeBreakEvenReport(biz.id, user, range);
  assert.equal(be.periodExpensesCents, 1_000_00);
  assert.equal(be.fixedExpensesCents + be.variableExpensesCents, be.periodExpensesCents);
});

test("foreign currency converts at the rate frozen on the transaction", async () => {
  const user = "fx-user";
  const biz = await ensureBusiness(user);
  const src = (await getManualSource(biz.id))!;
  const item = await catalog.createRevenueItem(biz.id, {
    name: "FX export job",
    type: "service",
    pricingModel: "fixed",
    unitPriceCents: 100_00,
  });
  const range = { start: new Date("2036-01-01T00:00:00Z"), end: new Date("2036-12-31T23:59:59Z") };

  // $100 billed when the rate was 280.
  const { transaction } = await ledger.createTransaction(biz.id, {
    direction: "in",
    occurredAt: new Date("2036-02-01T00:00:00Z"),
    sourceId: src.id,
    currency: "USD",
    fxRateToBase: "280",
    lines: [{ revenueItemId: item.id, qty: "1", unitPriceCents: 100_00 }],
  });
  assert.equal(transaction.currency, "USD");
  assert.equal(transaction.fxRateToBase, "280");

  // Profit reads in base currency: $100 → Rs 28,000.
  assert.equal((await read.computePnl(biz.id, user, range)).ladder.netRevenue, 2_800_000);

  // The stored amount is untouched — conversion is a reading, not a rewrite.
  const [stored] = await db.select().from(transactionsTable).where(eq(transactionsTable.id, transaction.id));
  assert.equal(stored.fxRateToBase, "280");

  // A refund inherits the ORIGINAL's frozen rate, so it cancels to exactly zero.
  await ledger.createRefundForAmount(biz.id, {
    transactionId: transaction.id,
    amountCents: 100_00,
    occurredAt: new Date("2036-03-01T00:00:00Z"),
  });
  assert.equal((await read.computePnl(biz.id, user, range)).ladder.netRevenue, 0);

  // An invalid rate is refused rather than silently treated as 1.
  await assert.rejects(
    () =>
      ledger.createTransaction(biz.id, {
        direction: "in",
        occurredAt: new Date("2036-04-01T00:00:00Z"),
        sourceId: src.id,
        fxRateToBase: "0",
        lines: [{ revenueItemId: item.id, qty: "1" }],
      }),
    ServiceError,
  );
});

// ---------------------------------------------------------------------------
// Client profitability — Phase 1: schema, seeding, and the gate
// ---------------------------------------------------------------------------

test("internal time categories are seeded, tagged for time, and re-seeding never duplicates", async () => {
  const user = "cp-seed-user";
  const biz = await ensureBusiness(user);

  const seeded = await db
    .select()
    .from(dbModule.categoriesTable)
    .where(and(eq(dbModule.categoriesTable.businessId, biz.id), eq(dbModule.categoriesTable.appliesTo, "time")));
  assert.ok(seeded.length >= 4, "a new business starts with internal buckets");
  // Splitting internal time is the point: pitching must be its own bucket.
  assert.ok(seeded.some((c) => /pitch/i.test(c.name)));
  assert.ok(seeded.some((c) => /rework/i.test(c.name)));

  // Re-running (what a business-type change does) adds nothing.
  const { seedInternalTimeCategories } = await import("./business");
  await seedInternalTimeCategories(biz.id);
  const after = await db
    .select()
    .from(dbModule.categoriesTable)
    .where(and(eq(dbModule.categoriesTable.businessId, biz.id), eq(dbModule.categoriesTable.appliesTo, "time")));
  assert.equal(after.length, seeded.length, "re-seeding must be a no-op");
});

test("a client may hold only ONE active engagement, but unlimited finished ones", async () => {
  const user = "cp-engagement-user";
  const biz = await ensureBusiness(user);
  const client = await findOrCreatePerson(biz.id, { name: "Acme Ltd", kind: "customer" });

  const engagement = (engagementStatus: string, id: string) => ({
    id,
    businessId: biz.id,
    personId: client.id,
    engagementStatus,
  });

  await db.insert(dbModule.clientEngagementsTable).values(engagement("active", "eng_a"));

  // A second LIVE engagement for the same client is refused by the database.
  await assert.rejects(
    () => db.insert(dbModule.clientEngagementsTable).values(engagement("active", "eng_b")),
    isUniqueViolation,
  );

  // But the normal agency path — a project that completes, then a retainer —
  // is legal storage today, with no schema change needed later.
  await db
    .update(dbModule.clientEngagementsTable)
    .set({ engagementStatus: "completed" })
    .where(eq(dbModule.clientEngagementsTable.id, "eng_a"));
  await db.insert(dbModule.clientEngagementsTable).values(engagement("active", "eng_b"));
  await db.insert(dbModule.clientEngagementsTable).values(engagement("completed", "eng_c"));

  const all = await db
    .select()
    .from(dbModule.clientEngagementsTable)
    .where(eq(dbModule.clientEngagementsTable.personId, client.id));
  assert.equal(all.length, 3, "history accumulates beside the live engagement");
  assert.equal(all.filter((e) => e.engagementStatus === "active").length, 1);
});

test("a team member has exactly one open rate at a time", async () => {
  const user = "cp-rate-user";
  const biz = await ensureBusiness(user);
  const member = await findOrCreatePerson(biz.id, { name: "Sara Dev", kind: "employee" });

  const rate = (id: string, effectiveTo: Date | null) => ({
    id,
    businessId: biz.id,
    personId: member.id,
    costType: "salaried",
    monthlyCostCents: 60_000_00,
    effectiveHourlyCostCents: 461_54,
    effectiveFrom: new Date("2036-01-01T00:00:00Z"),
    effectiveTo,
  });

  await db.insert(dbModule.teamMemberRatesTable).values(rate("tmr_a", null));
  // Two open versions would make "what does this person cost today" ambiguous.
  await assert.rejects(
    () => db.insert(dbModule.teamMemberRatesTable).values(rate("tmr_b", null)),
    isUniqueViolation,
  );

  // Closing the old one and opening a successor is the supported path.
  await db
    .update(dbModule.teamMemberRatesTable)
    .set({ effectiveTo: new Date("2036-07-31T23:59:59Z") })
    .where(eq(dbModule.teamMemberRatesTable.id, "tmr_a"));
  await db.insert(dbModule.teamMemberRatesTable).values(rate("tmr_b", null));

  const versions = await db
    .select()
    .from(dbModule.teamMemberRatesTable)
    .where(eq(dbModule.teamMemberRatesTable.personId, member.id));
  assert.equal(versions.length, 2);
  assert.equal(versions.filter((v) => v.effectiveTo === null).length, 1);
});

test("time entries reject impossible hours and de-duplicate a re-imported CSV", async () => {
  const user = "cp-time-user";
  const biz = await ensureBusiness(user);
  const member = await findOrCreatePerson(biz.id, { name: "Imported Dev", kind: "employee" });

  const entry = (id: string, hours: string, externalId: string | null) => ({
    id,
    businessId: biz.id,
    personId: member.id,
    targetType: "internal",
    targetId: "cat_placeholder",
    entryDate: "2036-03-02",
    hours,
    costRateSnapshotCents: 500_00,
    costAmountCents: 0,
    source: "csv_import",
    externalId,
  });

  // A day longer than a day is a typo, not a long shift.
  for (const bad of ["0", "24.5", "30"]) {
    await assert.rejects(
      () => db.insert(dbModule.timeEntriesTable).values(entry(`te_bad_${bad}`, bad, null)),
      isCheckViolation,
    );
  }

  await db.insert(dbModule.timeEntriesTable).values(entry("te_1", "7.5", "toggl-123"));
  // Importing the same file again is a no-op at the database level.
  await assert.rejects(
    () => db.insert(dbModule.timeEntriesTable).values(entry("te_2", "7.5", "toggl-123")),
    isUniqueViolation,
  );
  // Manual entries carry no external id and are never treated as duplicates.
  await db.insert(dbModule.timeEntriesTable).values({ ...entry("te_3", "7.5", null), source: "manual" });
  await db.insert(dbModule.timeEntriesTable).values({ ...entry("te_4", "7.5", null), source: "manual" });

  const rows = await db.select().from(dbModule.timeEntriesTable).where(eq(dbModule.timeEntriesTable.businessId, biz.id));
  assert.equal(rows.length, 3);
});

test("logging hours does not move a single number on the profit ladder", async () => {
  // THE load-bearing rule: attributed labour is a distribution of payroll the
  // ledger already counted, never a second cost. If this test ever fails,
  // someone has wired labour into the P&L and payroll is being counted twice.
  const user = "cp-ladder-user";
  const biz = await ensureBusiness(user);
  const src = (await getManualSource(biz.id))!;
  const range = { start: new Date("2037-01-01T00:00:00Z"), end: new Date("2037-12-31T23:59:59Z") };

  const item = await catalog.createRevenueItem(biz.id, {
    name: "CP consulting",
    type: "service",
    pricingModel: "fixed",
    unitPriceCents: 1_000_00,
  });
  const salaries = await catalog.createExpenseItem(biz.id, {
    name: "CP salaries",
    type: "payroll",
    costNature: "fixed",
  });

  await ledger.createTransaction(biz.id, {
    direction: "in",
    occurredAt: new Date("2037-05-01T00:00:00Z"),
    sourceId: src.id,
    lines: [{ revenueItemId: item.id, qty: "1" }],
  });
  await ledger.createTransaction(biz.id, {
    direction: "out",
    occurredAt: new Date("2037-05-31T00:00:00Z"),
    sourceId: src.id,
    lines: [{ expenseItemId: salaries.id, qty: "1", unitPriceCents: 600_00 }],
  });

  const before = (await read.computePnl(biz.id, user, range)).ladder;

  const member = await findOrCreatePerson(biz.id, { name: "CP Dev", kind: "employee" });
  await db.insert(dbModule.timeEntriesTable).values(
    ["1", "2", "3", "4", "5"].map((d) => ({
      id: `te_ladder_${d}`,
      businessId: biz.id,
      personId: member.id,
      targetType: "revenue_item",
      targetId: item.id,
      entryDate: `2037-05-0${d}`,
      hours: "8",
      costRateSnapshotCents: 500_00,
      costAmountCents: 4_000_00,
      source: "manual" as const,
    })),
  );

  const after = (await read.computePnl(biz.id, user, range)).ladder;
  assert.deepEqual(after, before, "time entries must not touch the profit ladder");
  // And the payroll expense is still counted exactly once.
  assert.equal(after.periodExpenses, 600_00);
});

test("the contract's gated-feature list matches the domain's, exactly", async () => {
  // The contract package has no dependency on the domain, so its enum is a
  // copy. When they drift, every settings response fails schema validation at
  // runtime — which is how it was found the first time. Fail here instead.
  const { GATED_FEATURES } = await import("@workspace/domain");
  const { gatedFeature } = await import("@workspace/api-contract");
  assert.deepEqual([...gatedFeature.options].sort(), [...GATED_FEATURES].sort());
});

// ---------------------------------------------------------------------------
// Client profitability — Phase 2: team members and effective-dated rates
// ---------------------------------------------------------------------------

test("a pay rise closes the old rate and opens a new one; history is kept", async () => {
  const user = "tm-rate-user";
  const biz = await ensureBusiness(user);
  const team = await import("./team");

  const person = await team.createTeamMember(biz.id, {
    name: "Sara",
    roleLabel: "Senior Dev",
    rate: {
      costType: "salaried",
      monthlyCostCents: 60_000_00,
      overheadShareCents: 0,
      billableTargetHours: "130",
      effectiveFrom: new Date("2038-01-01T00:00:00Z"),
    },
  });

  const first = (await team.listTeamMembers(biz.id)).find((m) => m.id === person.id)!;
  assert.equal(first.payHourlyCents, 461_54); // 60,000 / 130

  // A raise from 1 August.
  await team.setTeamMemberRate(biz.id, person.id, {
    costType: "salaried",
    monthlyCostCents: 73_125_00,
    overheadShareCents: 0,
    billableTargetHours: "130",
    effectiveFrom: new Date("2038-08-01T00:00:00Z"),
  });

  const after = (await team.listTeamMembers(biz.id)).find((m) => m.id === person.id)!;
  assert.equal(after.payHourlyCents, 562_50); // 73,125 / 130

  // Two versions, exactly one open, and the old one closed just before the new.
  const history = await team.listRateHistory(biz.id, person.id);
  assert.equal(history.length, 2);
  assert.equal(history.filter((h) => h.effectiveTo === null).length, 1);
  assert.equal(history[0].effectiveHourlyCostCents, 562_50);
  assert.equal(history[1].effectiveHourlyCostCents, 461_54);

  // The rate that applied in JULY is still the old one — this is what a July
  // time entry would freeze, so work already costed stays costed.
  const july = await team.rateOnDate(biz.id, person.id, new Date("2038-07-15T00:00:00Z"));
  assert.equal(july?.effectiveHourlyCostCents, 461_54);
  const august = await team.rateOnDate(biz.id, person.id, new Date("2038-08-15T00:00:00Z"));
  assert.equal(august?.effectiveHourlyCostCents, 562_50);
});

test("a rate cannot be backdated over one already in force", async () => {
  const user = "tm-backdate-user";
  const biz = await ensureBusiness(user);
  const team = await import("./team");

  const person = await team.createTeamMember(biz.id, {
    name: "Backdate Test",
    rate: {
      costType: "salaried",
      monthlyCostCents: 50_000_00,
      billableTargetHours: "130",
      effectiveFrom: new Date("2039-06-01T00:00:00Z"),
    },
  });

  // Rewriting a rate that work has already been costed against would silently
  // restate profit that has been reported on.
  await assert.rejects(
    () =>
      team.setTeamMemberRate(biz.id, person.id, {
        costType: "salaried",
        monthlyCostCents: 90_000_00,
        billableTargetHours: "130",
        effectiveFrom: new Date("2039-03-01T00:00:00Z"),
      }),
    (err: Error) => err instanceof ServiceError && /backdating|after the current/i.test(err.message),
  );
});

test("cost type decides which figure is required, and nonsense is refused", async () => {
  const user = "tm-validation-user";
  const biz = await ensureBusiness(user);
  const team = await import("./team");

  // A salaried person with no salary is not a cost, it is a gap.
  await assert.rejects(
    () => team.createTeamMember(biz.id, { name: "No Salary", rate: { costType: "salaried", monthlyCostCents: 0 } }),
    ServiceError,
  );
  // A contractor with no rate, likewise.
  await assert.rejects(
    () => team.createTeamMember(biz.id, { name: "No Rate", rate: { costType: "contractor" } }),
    ServiceError,
  );
  // Zero billable hours would divide by zero and produce an infinite cost.
  await assert.rejects(
    () =>
      team.createTeamMember(biz.id, {
        name: "Zero Hours",
        rate: { costType: "salaried", monthlyCostCents: 10_000_00, billableTargetHours: "0" },
      }),
    ServiceError,
  );
  await assert.rejects(
    () => team.createTeamMember(biz.id, { name: "", rate: { costType: "salaried", monthlyCostCents: 1_00 } }),
    ServiceError,
  );
});

test("the overhead default comes from the ledger and EXCLUDES payroll", async () => {
  // The trap this guards: salaries are fixed operating costs, so a naive
  // "all fixed expenses / headcount" would hand everyone a slice of everybody's
  // salary on top of their own — counting each salary roughly twice and
  // inflating every hourly rate in the system.
  const user = "tm-overhead-user";
  const biz = await ensureBusiness(user);
  const src = (await getManualSource(biz.id))!;
  const team = await import("./team");

  const rent = await catalog.createExpenseItem(biz.id, { name: "OH rent", type: "operational", costNature: "fixed" });
  const software = await catalog.createExpenseItem(biz.id, { name: "OH software", type: "operational", costNature: "fixed" });
  const ads = await catalog.createExpenseItem(biz.id, { name: "OH ads", type: "marketing", costNature: "variable" });
  const salaries = await catalog.createExpenseItem(biz.id, { name: "OH salaries", type: "payroll", costNature: "fixed" });

  // "Today" is 1 August, so the last complete month is July.
  const today = new Date("2040-08-15T00:00:00Z");
  const inJuly = new Date("2040-07-10T00:00:00Z");
  const spend = async (itemId: string, cents: number) => {
    await ledger.createTransaction(biz.id, {
      direction: "out",
      occurredAt: inJuly,
      sourceId: src.id,
      lines: [{ expenseItemId: itemId, qty: "1", unitPriceCents: cents }],
    });
  };
  await spend(rent.id, 30_000_00);
  await spend(software.id, 15_000_00);
  await spend(ads.id, 50_000_00); // variable — not overhead
  await spend(salaries.id, 200_000_00); // payroll — MUST be excluded

  // Three people to split it between.
  for (const name of ["OH One", "OH Two", "OH Three"]) {
    await team.createTeamMember(biz.id, {
      name,
      rate: { costType: "salaried", monthlyCostCents: 60_000_00, effectiveFrom: inJuly },
    });
  }

  const result = await team.computeOverheadDefault(biz.id, user, today);
  assert.equal(result.reason, "ok");
  assert.equal(result.headcount, 3);
  // Rent + software only: 45,000. NOT 245,000, and not 95,000.
  assert.equal(result.fixedCostPoolCents, 45_000_00);
  assert.equal(result.perPersonCents, 15_000_00);
  assert.match(result.periodLabel, /July 2040/);

  // The working is returned so the screen can show it rather than assert it.
  const names = result.breakdown.map((b) => b.name);
  assert.ok(names.includes("OH rent") && names.includes("OH software"));
  assert.ok(!names.includes("OH salaries"), "payroll must not appear in the overhead pool");
  assert.ok(!names.includes("OH ads"), "variable costs are not overhead");
});

test("the overhead default gives a REASON rather than a misleading zero", async () => {
  const team = await import("./team");

  // A business with costs but nobody to split them between.
  const noTeamUser = "tm-no-team-user";
  const noTeamBiz = await ensureBusiness(noTeamUser);
  const noTeam = await team.computeOverheadDefault(noTeamBiz.id, noTeamUser, new Date("2041-02-10T00:00:00Z"));
  assert.equal(noTeam.reason, "no_team");
  assert.equal(noTeam.perPersonCents, null);

  // A team, but nothing classified as staying the same.
  const noCostsUser = "tm-no-costs-user";
  const noCostsBiz = await ensureBusiness(noCostsUser);
  await team.createTeamMember(noCostsBiz.id, {
    name: "Lonely Dev",
    rate: { costType: "salaried", monthlyCostCents: 50_000_00 },
  });
  const noCosts = await team.computeOverheadDefault(noCostsBiz.id, noCostsUser, new Date("2041-02-10T00:00:00Z"));
  assert.equal(noCosts.reason, "no_fixed_costs");
  assert.equal(noCosts.perPersonCents, null);
});

test("team member payloads never carry a salary", async () => {
  // The forward-compatibility constraint made structural: when the Manager role
  // ships it must not be able to read pay, and the safest guarantee is that the
  // figure never enters a payload at all.
  const user = "tm-privacy-user";
  const biz = await ensureBusiness(user);
  const team = await import("./team");

  await team.createTeamMember(biz.id, {
    name: "Private Person",
    rate: { costType: "salaried", monthlyCostCents: 123_456_00, overheadShareCents: 9_999_00 },
  });

  const [member] = await team.listTeamMembers(biz.id);
  const serialised = JSON.stringify(member);
  for (const forbidden of ["monthlyCostCents", "hourlyRateCents", "overheadShareCents", "123456", "12345600"]) {
    assert.ok(!serialised.includes(forbidden), `payload leaked ${forbidden}`);
  }
  // The derived figures ARE present — that is what the screen needs.
  assert.ok(member.payHourlyCents! > 0);
  assert.ok(member.effectiveHourlyCostCents! > 0);
});

test("adding a team member does not move the profit ladder", async () => {
  // Team members are cost RATES, not money events. Nothing here is a transaction.
  const user = "tm-ladder-user";
  const biz = await ensureBusiness(user);
  const src = (await getManualSource(biz.id))!;
  const team = await import("./team");
  const range = { start: new Date("2042-01-01T00:00:00Z"), end: new Date("2042-12-31T23:59:59Z") };

  const item = await catalog.createRevenueItem(biz.id, {
    name: "TM ladder service",
    type: "service",
    pricingModel: "fixed",
    unitPriceCents: 5_000_00,
  });
  await ledger.createTransaction(biz.id, {
    direction: "in",
    occurredAt: new Date("2042-06-01T00:00:00Z"),
    sourceId: src.id,
    lines: [{ revenueItemId: item.id, qty: "1" }],
  });

  const before = (await read.computePnl(biz.id, user, range)).ladder;
  await team.createTeamMember(biz.id, {
    name: "Expensive Dev",
    rate: { costType: "salaried", monthlyCostCents: 500_000_00, overheadShareCents: 100_000_00 },
  });
  const after = (await read.computePnl(biz.id, user, range)).ladder;

  assert.deepEqual(after, before, "a team member's cost rate is not a money event");
});

// ---------------------------------------------------------------------------
// Client profitability — Phase 3: clients and engagements
// ---------------------------------------------------------------------------

test("adding a client who is already a ledger customer reuses that record", async () => {
  // The failure this prevents: an agency invoiced Acme for two years, then adds
  // them as a client. A second Acme would split that revenue in half and make
  // the client look worth half what they are.
  const user = "cl-reuse-user";
  const biz = await ensureBusiness(user);
  const src = (await getManualSource(biz.id))!;
  const clients = await import("@/app/api/client-profitability/functions");

  const item = await catalog.createRevenueItem(biz.id, {
    name: "CL retainer",
    type: "service",
    pricingModel: "fixed",
    unitPriceCents: 2_000_00,
  });
  // Acme exists ONLY because they were invoiced.
  await ledger.createTransaction(biz.id, {
    direction: "in",
    occurredAt: new Date("2043-03-01T00:00:00Z"),
    sourceId: src.id,
    personId: (await findOrCreatePerson(biz.id, { name: "Acme Corp", kind: "customer" })).id,
    lines: [{ revenueItemId: item.id, qty: "1" }],
  });

  const peopleBefore = await db
    .select()
    .from(dbModule.peopleTable)
    .where(and(eq(dbModule.peopleTable.businessId, biz.id), eq(dbModule.peopleTable.kind, "customer")));
  const acme = peopleBefore.find((p) => p.displayName === "Acme Corp")!;
  assert.ok(acme, "the invoice created Acme as a customer");

  // Now add them as a client, typed slightly differently.
  await clients.createClient(biz.id, { name: "acme corp", engagement: {} });

  const peopleAfter = await db
    .select()
    .from(dbModule.peopleTable)
    .where(and(eq(dbModule.peopleTable.businessId, biz.id), eq(dbModule.peopleTable.kind, "customer")));
  assert.equal(peopleAfter.length, peopleBefore.length, "no second Acme was created");

  // And the client carries the revenue that was already on the ledger.
  const [client] = await clients.listClients(biz.id);
  assert.equal(client.personId, acme.id);
  assert.equal(client.revenueToDateCents, 2_000_00);
});

test("the match lookup surfaces an existing customer, with what they have billed", async () => {
  const user = "cl-match-user";
  const biz = await ensureBusiness(user);
  const src = (await getManualSource(biz.id))!;
  const clients = await import("@/app/api/client-profitability/functions");

  const item = await catalog.createRevenueItem(biz.id, {
    name: "CL match service",
    type: "service",
    pricingModel: "fixed",
    unitPriceCents: 5_000_00,
  });
  await ledger.createTransaction(biz.id, {
    direction: "in",
    occurredAt: new Date("2044-02-01T00:00:00Z"),
    sourceId: src.id,
    personId: (await findOrCreatePerson(biz.id, { name: "Globex Limited", kind: "customer" })).id,
    lines: [{ revenueItemId: item.id, qty: "1" }],
  });

  // Exact (case-insensitive) → safe to reuse.
  const exact = await clients.findClientMatches(biz.id, { name: "GLOBEX LIMITED" });
  assert.equal(exact[0].strength, "exact_name");
  assert.equal(exact[0].lifetimeRevenueCents, 5_000_00);
  assert.equal(exact[0].alreadyAClient, false);

  // Suffix dropped → similar, for a human to confirm rather than auto-merge.
  const similar = await clients.findClientMatches(biz.id, { name: "Globex" });
  assert.equal(similar[0].strength, "similar");

  // Once they ARE a client, the list says so, so they can't be added twice.
  await clients.createClient(biz.id, { personId: exact[0].id, engagement: {} });
  const after = await clients.findClientMatches(biz.id, { name: "Globex Limited" });
  assert.equal(after[0].alreadyAClient, true);
});

test("a client holds one live engagement, and finished ones accumulate", async () => {
  const user = "cl-engagement-user";
  const biz = await ensureBusiness(user);
  const clients = await import("@/app/api/client-profitability/functions");

  const first = await clients.createClient(biz.id, {
    name: "Serial Client",
    engagement: { agreedHours: "60", agreedAmountCents: 100_000_00 },
  });
  assert.equal(first.engagementStatus, "active");

  // A second live one is refused in words, not by a constraint error.
  await assert.rejects(
    () => clients.createClient(biz.id, { name: "Serial Client", engagement: {} }),
    (err: Error) => err instanceof ServiceError && /already has a live engagement/i.test(err.message),
  );

  // The normal agency path: finish the project, then start the retainer.
  await clients.updateEngagement(biz.id, first.id, { engagementStatus: "completed" });
  const second = await clients.createClient(biz.id, {
    name: "Serial Client",
    engagement: {},
  });
  assert.equal(second.engagementStatus, "active");
  assert.notEqual(second.id, first.id);

  // Both are kept, against one person — the history is intact.
  const history = await clients.listEngagementsFor(biz.id, second.personId);
  assert.equal(history.length, 2);
  assert.equal(new Set(history.map((h) => h.personId)).size, 1);

  // And reviving the finished one is refused while the retainer is live.
  await assert.rejects(
    () => clients.updateEngagement(biz.id, first.id, { engagementStatus: "active" }),
    (err: Error) => err instanceof ServiceError && /already has a live engagement/i.test(err.message),
  );
});

test("agreed terms are validated, and nonsense is refused", async () => {
  const user = "cl-validation-user";
  const biz = await ensureBusiness(user);
  const clients = await import("@/app/api/client-profitability/functions");

  await assert.rejects(() => clients.createClient(biz.id, { name: "   " }), ServiceError);
  await assert.rejects(
    () => clients.createClient(biz.id, { name: "Bad Hours", engagement: { agreedHours: "-5" } }),
    ServiceError,
  );
  await assert.rejects(
    () => clients.createClient(biz.id, { name: "Bad Amount", engagement: { agreedAmountCents: -100 } }),
    ServiceError,
  );
  await assert.rejects(
    () =>
      clients.createClient(biz.id, {
        name: "Bad Basis",
        engagement: { agreedHoursPeriod: "quarterly" as "total" },
      }),
    ServiceError,
  );
});

test("a duplicate team member is refused rather than silently created twice", async () => {
  // Same class of bug as the client one: two records for one human would split
  // their hours, so each would look half as busy.
  const user = "cl-dup-team-user";
  const biz = await ensureBusiness(user);
  const team = await import("./team");

  await team.createTeamMember(biz.id, {
    name: "Sara Ahmed",
    rate: { costType: "salaried", monthlyCostCents: 50_000_00 },
  });
  await assert.rejects(
    () =>
      team.createTeamMember(biz.id, {
        name: "  sara   ahmed ",
        rate: { costType: "salaried", monthlyCostCents: 60_000_00 },
      }),
    (err: Error) => err instanceof ServiceError && /already have a team member/i.test(err.message),
  );
});

test("adding a client does not move the profit ladder", async () => {
  // An engagement records what was AGREED. Only the ledger moves money.
  const user = "cl-ladder-user";
  const biz = await ensureBusiness(user);
  const src = (await getManualSource(biz.id))!;
  const clients = await import("@/app/api/client-profitability/functions");
  const range = { start: new Date("2045-01-01T00:00:00Z"), end: new Date("2045-12-31T23:59:59Z") };

  const item = await catalog.createRevenueItem(biz.id, {
    name: "CL ladder service",
    type: "service",
    pricingModel: "fixed",
    unitPriceCents: 3_000_00,
  });
  await ledger.createTransaction(biz.id, {
    direction: "in",
    occurredAt: new Date("2045-04-01T00:00:00Z"),
    sourceId: src.id,
    lines: [{ revenueItemId: item.id, qty: "1" }],
  });

  const before = (await read.computePnl(biz.id, user, range)).ladder;
  await clients.createClient(biz.id, {
    name: "Ladder Client",
    engagement: { agreedAmountCents: 999_999_00, agreedHours: "500" },
  });
  const after = (await read.computePnl(biz.id, user, range)).ladder;

  assert.deepEqual(after, before, "an agreed amount is not revenue");
});

// ---------------------------------------------------------------------------
// Client profitability — Phase 4: time entries and the weekly grid
// ---------------------------------------------------------------------------

async function timesheetFixture(userLabel: string, rateFrom: Date) {
  const biz = await ensureBusiness(userLabel);
  const team = await import("./team");
  const timesheet = await import("./timesheet");
  const clients = await import("@/app/api/client-profitability/functions");

  const person = await team.createTeamMember(biz.id, {
    name: `${userLabel} Dev`,
    rate: { costType: "salaried", monthlyCostCents: 65_000_00, billableTargetHours: "130", effectiveFrom: rateFrom },
  });
  const engagement = await clients.createClient(biz.id, { name: `${userLabel} Client`, engagement: {} });
  return { biz, person, engagement, team, timesheet, clients };
}

test("a short day warns and still saves, and invents nothing", async () => {
  // The acceptance case, end to end: 6 hours on an 8-hour day.
  const { biz, person, engagement, timesheet } = await timesheetFixture("ts-short", new Date("2046-01-01T00:00:00Z"));

  const result = await timesheet.setTimesheetCell(biz.id, {
    personId: person.id,
    targetType: "client",
    targetId: engagement.personId,
    entryDate: "2046-03-04",
    hours: "6",
  });

  // Saved — the warning is a report that rides along, not a gate.
  assert.ok(result.entry, "the entry must be saved despite the short day");
  assert.equal(result.entry!.hours, "6");
  assert.equal(result.dayCheck.isShort, true);
  assert.equal(result.dayCheck.missingHours, "2");

  // And NOTHING was filled in. Exactly one entry exists for that day, for the
  // target the owner chose — no phantom Admin row carrying the missing 2 hours.
  const rows = await db
    .select()
    .from(dbModule.timeEntriesTable)
    .where(and(eq(dbModule.timeEntriesTable.businessId, biz.id), eq(dbModule.timeEntriesTable.entryDate, "2046-03-04")));
  assert.equal(rows.length, 1, "no phantom entry was created");
  assert.equal(rows[0].targetType, "client");
  assert.equal(rows[0].hours, "6");
});

test("a full day does not warn, and an empty day is not a short day", async () => {
  const { biz, person, engagement, timesheet } = await timesheetFixture("ts-full", new Date("2046-01-01T00:00:00Z"));

  const full = await timesheet.setTimesheetCell(biz.id, {
    personId: person.id,
    targetType: "client",
    targetId: engagement.personId,
    entryDate: "2046-04-01",
    hours: "8",
  });
  assert.equal(full.dayCheck.isShort, false);

  // Clearing the cell removes the entry and does not then warn about the blank.
  const cleared = await timesheet.setTimesheetCell(biz.id, {
    personId: person.id,
    targetType: "client",
    targetId: engagement.personId,
    entryDate: "2046-04-01",
    hours: "",
  });
  assert.equal(cleared.entry, null);
  assert.equal(cleared.dayCheck.isShort, false, "a blank day must not warn");
  const rows = await db
    .select()
    .from(dbModule.timeEntriesTable)
    .where(and(eq(dbModule.timeEntriesTable.businessId, biz.id), eq(dbModule.timeEntriesTable.entryDate, "2046-04-01")));
  assert.equal(rows.length, 0, "clearing a cell deletes the entry, not zeroes it");
});

test("a day is short only until the rest of it is accounted for", async () => {
  const { biz, person, engagement, timesheet } = await timesheetFixture("ts-accum", new Date("2046-01-01T00:00:00Z"));
  const targets = await timesheet.listTimeTargets(biz.id);
  const internal = targets.find((t) => t.targetType === "internal")!;

  const first = await timesheet.setTimesheetCell(biz.id, {
    personId: person.id, targetType: "client", targetId: engagement.personId, entryDate: "2046-05-06", hours: "5",
  });
  assert.equal(first.dayCheck.isShort, true);

  // The rest logged against Admin BY THE OWNER — the same total the auto-fill
  // would have produced, but entered deliberately rather than invented.
  const second = await timesheet.setTimesheetCell(biz.id, {
    personId: person.id, targetType: "internal", targetId: internal.targetId, entryDate: "2046-05-06", hours: "3",
  });
  assert.equal(second.dayCheck.isShort, false);
  assert.equal(second.dayCheck.loggedHours, "8");
});

test("cost freezes at the rate that applied on the day worked", async () => {
  const { biz, person, engagement, team, timesheet } = await timesheetFixture("ts-freeze", new Date("2047-01-01T00:00:00Z"));

  // 65,000 / 130 = Rs 500/hr in the spring.
  const spring = await timesheet.setTimesheetCell(biz.id, {
    personId: person.id, targetType: "client", targetId: engagement.personId, entryDate: "2047-03-10", hours: "4",
  });
  assert.equal(spring.entry!.costRateSnapshotCents, 500_00);
  assert.equal(spring.entry!.costAmountCents, 2_000_00);

  // A raise from July: 78,000 / 130 = Rs 600/hr.
  await team.setTeamMemberRate(biz.id, person.id, {
    costType: "salaried",
    monthlyCostCents: 78_000_00,
    billableTargetHours: "130",
    effectiveFrom: new Date("2047-07-01T00:00:00Z"),
  });

  // March's entry is untouched by the raise.
  const [march] = await db
    .select()
    .from(dbModule.timeEntriesTable)
    .where(and(eq(dbModule.timeEntriesTable.businessId, biz.id), eq(dbModule.timeEntriesTable.entryDate, "2047-03-10")));
  assert.equal(march.costRateSnapshotCents, 500_00, "a raise must not restate work already costed");

  // August's work takes the new rate.
  const august = await timesheet.setTimesheetCell(biz.id, {
    personId: person.id, targetType: "client", targetId: engagement.personId, entryDate: "2047-08-12", hours: "4",
  });
  assert.equal(august.entry!.costRateSnapshotCents, 600_00);
  assert.equal(august.entry!.costAmountCents, 2_400_00);

  // Editing March LATER still re-freezes at March's rate, not today's.
  const marchAgain = await timesheet.setTimesheetCell(biz.id, {
    personId: person.id, targetType: "client", targetId: engagement.personId, entryDate: "2047-03-10", hours: "6",
  });
  assert.equal(marchAgain.entry!.costRateSnapshotCents, 500_00);
  assert.equal(marchAgain.entry!.costAmountCents, 3_000_00);
});

test("hours cannot be logged for someone with no rate covering that day", async () => {
  // Otherwise the entry would carry a zero cost and the client would look free.
  const { biz, person, engagement, timesheet } = await timesheetFixture("ts-norate", new Date("2048-06-01T00:00:00Z"));

  await assert.rejects(
    () =>
      timesheet.setTimesheetCell(biz.id, {
        personId: person.id,
        targetType: "client",
        targetId: engagement.personId,
        entryDate: "2048-01-15", // before any rate exists
        hours: "4",
      }),
    (err: Error) => err instanceof ServiceError && /no pay rate/i.test(err.message),
  );
});

test("impossible hours are refused", async () => {
  const { biz, person, engagement, timesheet } = await timesheetFixture("ts-bad", new Date("2049-01-01T00:00:00Z"));
  for (const bad of ["25", "-3", "abc"]) {
    await assert.rejects(
      () =>
        timesheet.setTimesheetCell(biz.id, {
          personId: person.id, targetType: "client", targetId: engagement.personId, entryDate: "2049-02-02", hours: bad,
        }),
      ServiceError,
      `${bad} should be refused`,
    );
  }
});

test("the week reads back as a grid, Monday first", async () => {
  const { biz, person, engagement, timesheet } = await timesheetFixture("ts-grid", new Date("2050-01-01T00:00:00Z"));

  // Wednesday and Thursday of the same week.
  for (const [date, hours] of [["2050-03-02", "7"], ["2050-03-03", "5.5"]] as const) {
    await timesheet.setTimesheetCell(biz.id, {
      personId: person.id, targetType: "client", targetId: engagement.personId, entryDate: date, hours,
    });
  }

  const sheet = await timesheet.getTimesheet(biz.id, new Date("2050-03-04T00:00:00Z"));
  assert.equal(sheet.weekStart, "2050-02-28"); // the Monday
  assert.equal(sheet.days.length, 7);
  assert.equal(sheet.days[0], "2050-02-28");
  // One row for the person/target pair, with both days' cells on it.
  assert.equal(sheet.rows.length, 1);
  assert.equal(sheet.cells.length, 2);
  assert.deepEqual(sheet.cells.map((c) => c.hours).sort(), ["5.5", "7"]);
  // The picker offers clients, what you sell, and internal buckets.
  assert.ok(sheet.targets.some((t) => t.targetType === "client"));
  assert.ok(sheet.targets.some((t) => t.targetType === "internal"));
});

test("logging a full week of hours does not move the profit ladder", async () => {
  // Still the load-bearing rule, now with the screen that actually writes them.
  const { biz, person, engagement, timesheet } = await timesheetFixture("ts-ladder", new Date("2051-01-01T00:00:00Z"));
  const src = (await getManualSource(biz.id))!;
  const range = { start: new Date("2051-01-01T00:00:00Z"), end: new Date("2051-12-31T23:59:59Z") };

  const item = await catalog.createRevenueItem(biz.id, {
    name: "TS ladder service", type: "service", pricingModel: "fixed", unitPriceCents: 9_000_00,
  });
  await ledger.createTransaction(biz.id, {
    direction: "in", occurredAt: new Date("2051-03-02T00:00:00Z"), sourceId: src.id,
    lines: [{ revenueItemId: item.id, qty: "1" }],
  });

  const before = (await read.computePnl(biz.id, "ts-ladder", range)).ladder;
  for (const date of ["2051-03-02", "2051-03-03", "2051-03-04", "2051-03-05", "2051-03-06"]) {
    await timesheet.setTimesheetCell(biz.id, {
      personId: person.id, targetType: "client", targetId: engagement.personId, entryDate: date, hours: "8",
    });
  }
  const after = (await read.computePnl(biz.id, "ts-ladder", range)).ladder;

  assert.deepEqual(after, before, "40 hours of labour must not touch the ladder");
});

// ---------------------------------------------------------------------------
// Client profitability — Phase 5: the answer, and the lie it must never tell
// ---------------------------------------------------------------------------

async function profitFixture(label: string) {
  const biz = await ensureBusiness(label);
  const src = (await getManualSource(biz.id))!;
  const team = await import("./team");
  const clients = await import("@/app/api/client-profitability/functions");
  const timesheet = await import("./timesheet");
  const profit = await import("./clientProfit");
  const start = new Date("2060-01-01T00:00:00Z");

  const member = await team.createTeamMember(biz.id, {
    name: `${label} Dev`,
    rate: { costType: "salaried", monthlyCostCents: 65_000_00, billableTargetHours: "130", effectiveFrom: start },
  });
  const service = await catalog.createRevenueItem(biz.id, {
    name: `${label} service`, type: "service", pricingModel: "fixed", unitPriceCents: 1_000_00,
  });
  const range = { start: new Date("2060-01-01T00:00:00Z"), end: new Date("2060-12-31T23:59:59Z") };

  const invoice = async (personId: string, cents: number) => {
    await ledger.createTransaction(biz.id, {
      direction: "in",
      occurredAt: new Date("2060-03-02T00:00:00Z"),
      sourceId: src.id,
      personId,
      lines: [{ revenueItemId: service.id, qty: "1", unitPriceCents: cents }],
    });
  };

  return { biz, src, team, clients, timesheet, profit, member, service, range, invoice, label };
}

test("a client with revenue and NO hours shows no margin ANYWHERE", async () => {
  // The failure the entire design exists to prevent. Rs 45,000 of revenue with
  // nothing logged against it computes to Rs 45,000 profit at 100% margin —
  // the most flattering possible lie about the client most likely to be losing
  // money. Every surface below must refuse to say it.
  const fx = await profitFixture("cp-lie");
  const ghost = await fx.clients.createClient(fx.biz.id, { name: "Ghost Client", engagement: {} });
  await fx.invoice(ghost.personId, 45_000_00);

  const report = await fx.profit.computeClientProfitability(fx.biz.id, fx.label, fx.range);
  const row = report.rows.find((r) => r.targetType === "client" && r.targetId === ghost.personId)!;

  // The row itself.
  assert.equal(row.revenueCents, 45_000_00, "revenue is still shown — the money did arrive");
  assert.equal(row.isCosted, false);
  assert.equal(row.contributionCents, null, "contribution must be ABSENT, not zero");
  assert.equal(row.marginPct, null, "margin must be ABSENT, not 100");
  assert.equal(row.labourCostCents, null);
  assert.equal(row.afterOverheadCents, null);
  assert.equal(row.effectiveHourlyRateCents, null);

  // The summary.
  assert.equal(report.summary.state, "no_hours");
  assert.equal(report.summary.costedContributionCents, null, "no business-level total either");
  assert.equal(report.summary.costedMarginPct, null);
  assert.equal(report.summary.costedRevenueCents, null);
  // The revenue is reported apart so nothing goes missing.
  assert.equal(report.summary.uncostedRevenueCents, 45_000_00);
  assert.equal(report.summary.uncostedWithRevenueCount, 1);

  // And nowhere in the whole payload does a margin-shaped number appear.
  const serialised = JSON.stringify(report);
  assert.ok(!/"marginPct":\s*(100|[0-9])/.test(serialised), "no margin value anywhere in the response");
});

test("a costed client produces the real answer, including a loss", async () => {
  const fx = await profitFixture("cp-real");
  const good = await fx.clients.createClient(fx.biz.id, { name: "Good Client", engagement: {} });
  await fx.invoice(good.personId, 200_000_00);

  // 40 hours at Rs 500/hr = Rs 20,000 of labour.
  for (const d of ["2060-03-02", "2060-03-03", "2060-03-04", "2060-03-05", "2060-03-06"]) {
    await fx.timesheet.setTimesheetCell(fx.biz.id, {
      personId: fx.member.id, targetType: "client", targetId: good.personId, entryDate: d, hours: "8",
    });
  }

  const report = await fx.profit.computeClientProfitability(fx.biz.id, fx.label, fx.range);
  const row = report.rows.find((r) => r.targetId === good.personId && r.targetType === "client")!;

  assert.equal(row.isCosted, true);
  assert.equal(row.hoursLogged, "40");
  assert.equal(row.labourCostCents, 20_000_00);
  assert.equal(row.contributionCents, 180_000_00);
  assert.equal(row.marginPct, 90);
  // Rs 200,000 over 40 hours = Rs 5,000/hr actually earned.
  assert.equal(row.effectiveHourlyRateCents, 5_000_00);
  assert.equal(report.summary.state, "complete");
});

test("a client who costs more than they pay reads as a loss, not a small profit", async () => {
  const fx = await profitFixture("cp-loss");
  const bad = await fx.clients.createClient(fx.biz.id, { name: "Bad Client", engagement: {} });
  await fx.invoice(bad.personId, 5_000_00); // Rs 5,000 paid

  // 40 hours at Rs 500 = Rs 20,000 of time against Rs 5,000 of revenue.
  for (const d of ["2060-04-05", "2060-04-06", "2060-04-07", "2060-04-08", "2060-04-09"]) {
    await fx.timesheet.setTimesheetCell(fx.biz.id, {
      personId: fx.member.id, targetType: "client", targetId: bad.personId, entryDate: d, hours: "8",
    });
  }

  const report = await fx.profit.computeClientProfitability(fx.biz.id, fx.label, fx.range);
  const row = report.rows.find((r) => r.targetId === bad.personId && r.targetType === "client")!;
  assert.equal(row.contributionCents, -15_000_00, "a Rs 15,000 loss, stated plainly");
  assert.equal(row.marginPct, -300);
  // This is the whole point: without hours it would have read as Rs 5,000 profit.
});

test("a mixed period totals only the costed clients and reports the rest apart", async () => {
  const fx = await profitFixture("cp-mixed");
  const costed = await fx.clients.createClient(fx.biz.id, { name: "Costed Co", engagement: {} });
  await fx.invoice(costed.personId, 100_000_00);
  await fx.timesheet.setTimesheetCell(fx.biz.id, {
    personId: fx.member.id, targetType: "client", targetId: costed.personId, entryDate: "2060-05-04", hours: "8",
  });

  // A second client with revenue and no hours. Its revenue must NOT join the total.
  const ghostPerson = await findOrCreatePerson(fx.biz.id, { name: "Uncosted Co", kind: "customer" });
  await fx.clients.createClient(fx.biz.id, { personId: ghostPerson.id, engagement: {} });
  await fx.invoice(ghostPerson.id, 70_000_00);

  const report = await fx.profit.computeClientProfitability(fx.biz.id, fx.label, fx.range);
  assert.equal(report.summary.state, "partial");
  assert.equal(report.summary.costedCount, 1);
  // 100,000 — NOT 170,000, which would smuggle the uncosted client's fake
  // margin back in at business level.
  assert.equal(report.summary.costedRevenueCents, 100_000_00);
  assert.equal(report.summary.costedContributionCents, 100_000_00 - 4_000_00);
  assert.equal(report.summary.uncostedRevenueCents, 70_000_00);
  assert.equal(report.summary.uncostedWithRevenueCount, 1);
});

test("the reconciliation guard: attribution equals the time entries total", async () => {
  const fx = await profitFixture("cp-guard");
  const c = await fx.clients.createClient(fx.biz.id, { name: "Guard Co", engagement: {} });
  await fx.invoice(c.personId, 50_000_00);

  const targets = await fx.timesheet.listTimeTargets(fx.biz.id);
  const internal = targets.find((t) => t.targetType === "internal")!;
  await fx.timesheet.setTimesheetCell(fx.biz.id, {
    personId: fx.member.id, targetType: "client", targetId: c.personId, entryDate: "2060-06-01", hours: "6",
  });
  await fx.timesheet.setTimesheetCell(fx.biz.id, {
    personId: fx.member.id, targetType: "internal", targetId: internal.targetId, entryDate: "2060-06-01", hours: "2",
  });

  const report = await fx.profit.computeClientProfitability(fx.biz.id, fx.label, fx.range);
  // Every logged hour lands on exactly one row, and the rows account for all of
  // it. Labour that vanished between the grid and this report would throw.
  const attributed = report.rows.reduce((s, r) => s + (r.labourCostCents ?? 0), 0);
  assert.equal(attributed, 8 * 500_00, "8 hours at Rs 500 fully attributed");
  assert.equal(report.coverage.attributedCents, 8 * 500_00);
  // Internal time is costed too — it is real money earning nothing.
  const internalRow = report.rows.find((r) => r.targetType === "internal")!;
  assert.equal(internalRow.contributionCents, -1_000_00);
});

test("coverage compares logged hours against the actual wage bill", async () => {
  const fx = await profitFixture("cp-coverage");
  const c = await fx.clients.createClient(fx.biz.id, { name: "Coverage Co", engagement: {} });
  await fx.invoice(c.personId, 50_000_00);

  // Rs 65,000 of wages actually paid in the period.
  const salaries = await catalog.createExpenseItem(fx.biz.id, {
    name: "CP wages", type: "payroll", costNature: "fixed",
  });
  await ledger.createTransaction(fx.biz.id, {
    direction: "out",
    occurredAt: new Date("2060-03-31T00:00:00Z"),
    sourceId: fx.src.id,
    lines: [{ expenseItemId: salaries.id, qty: "1", unitPriceCents: 65_000_00 }],
  });

  // Only 26 hours logged = Rs 13,000 of the Rs 65,000 accounted for.
  for (const d of ["2060-03-02", "2060-03-03", "2060-03-04"]) {
    await fx.timesheet.setTimesheetCell(fx.biz.id, {
      personId: fx.member.id, targetType: "client", targetId: c.personId, entryDate: d, hours: "8",
    });
  }
  await fx.timesheet.setTimesheetCell(fx.biz.id, {
    personId: fx.member.id, targetType: "client", targetId: c.personId, entryDate: "2060-03-05", hours: "2",
  });

  const report = await fx.profit.computeClientProfitability(fx.biz.id, fx.label, fx.range);
  assert.equal(report.coverage.payrollCents, 65_000_00);
  assert.equal(report.coverage.attributedCents, 13_000_00);
  assert.equal(report.coverage.pct, 20);
  assert.equal(report.coverage.direction, "under", "under-logging is the dangerous direction");
});

test("the whole report does not move the profit ladder", async () => {
  const fx = await profitFixture("cp-ladder");
  const c = await fx.clients.createClient(fx.biz.id, { name: "Ladder Co", engagement: {} });
  await fx.invoice(c.personId, 80_000_00);

  const before = (await read.computePnl(fx.biz.id, fx.label, fx.range)).ladder;
  for (const d of ["2060-07-05", "2060-07-06", "2060-07-07"]) {
    await fx.timesheet.setTimesheetCell(fx.biz.id, {
      personId: fx.member.id, targetType: "client", targetId: c.personId, entryDate: d, hours: "8",
    });
  }
  const report = await fx.profit.computeClientProfitability(fx.biz.id, fx.label, fx.range);
  const after = (await read.computePnl(fx.biz.id, fx.label, fx.range)).ladder;

  assert.ok(report.rows.length > 0, "the report produced figures");
  assert.deepEqual(after, before, "attributed labour is a distribution, never a second cost");
});

test("the summary uses ONE lens: a sale is not counted as both client and product revenue", async () => {
  // The same sale appears twice in `rows` — once under the client, once under
  // the product — because each answers a different question. Summing both would
  // double the revenue and halve the margin: the same class of lie as a fake
  // 100% margin, just at business level.
  const fx = await profitFixture("cp-lens");
  const c = await fx.clients.createClient(fx.biz.id, { name: "Lens Co", engagement: {} });
  await fx.invoice(c.personId, 60_000_00);
  await fx.timesheet.setTimesheetCell(fx.biz.id, {
    personId: fx.member.id, targetType: "client", targetId: c.personId, entryDate: "2060-08-03", hours: "10",
  });

  const report = await fx.profit.computeClientProfitability(fx.biz.id, fx.label, fx.range);

  // Both lenses exist as rows, each showing the full sale.
  const clientRow = report.rows.find((r) => r.targetType === "client")!;
  const productRow = report.rows.find((r) => r.targetType === "revenue_item")!;
  assert.equal(clientRow.revenueCents, 60_000_00);
  assert.equal(productRow.revenueCents, 60_000_00);

  // But the summary counts it ONCE — 60,000, never 120,000.
  assert.equal(report.summary.costedRevenueCents, 60_000_00);
  assert.equal(report.summary.costedContributionCents, 60_000_00 - 5_000_00);
});

test("revenue naming no customer is reported apart, never silently dropped", async () => {
  const fx = await profitFixture("cp-unattributed");
  const c = await fx.clients.createClient(fx.biz.id, { name: "Named Co", engagement: {} });
  await fx.invoice(c.personId, 30_000_00);
  await fx.timesheet.setTimesheetCell(fx.biz.id, {
    personId: fx.member.id, targetType: "client", targetId: c.personId, entryDate: "2060-09-07", hours: "4",
  });

  // A sale with no customer on it at all.
  await ledger.createTransaction(fx.biz.id, {
    direction: "in",
    occurredAt: new Date("2060-09-08T00:00:00Z"),
    sourceId: fx.src.id,
    lines: [{ revenueItemId: fx.service.id, qty: "1", unitPriceCents: 12_000_00 }],
  });

  const report = await fx.profit.computeClientProfitability(fx.biz.id, fx.label, fx.range);
  // It is outside the client lens, so it is not in the client total...
  assert.equal(report.summary.costedRevenueCents, 30_000_00);
  // ...but it is reported, so the owner can see money sitting outside the view.
  assert.equal(report.unattributedRevenueCents, 12_000_00);
});


// ---------------------------------------------------------------------------
// Client profitability — Phase 6: scope creep, utilization, concentration
// ---------------------------------------------------------------------------

test("scope creep end to end: 60 agreed hours, 88 actual, and the two rates pull apart", async () => {
  // The spec's worked example, through the real service: "a client at 47% over
  // hours is earning them Rs 1,705/hr on a Rs 2,500/hr assumption".
  const fx = await profitFixture("wi-creep");
  const c = await fx.clients.createClient(fx.biz.id, {
    name: "Creep Co",
    engagement: { agreedHours: "60", agreedAmountCents: 150_000_00 },
  });
  await fx.invoice(c.personId, 150_000_00);

  // 88 hours: eleven 8-hour days.
  const days = ["02", "03", "04", "05", "06", "09", "10", "11", "12", "13", "16"];
  for (const d of days) {
    await fx.timesheet.setTimesheetCell(fx.biz.id, {
      personId: fx.member.id, targetType: "client", targetId: c.personId, entryDate: `2060-03-${d}`, hours: "8",
    });
  }

  const report = await fx.profit.computeClientProfitability(fx.biz.id, fx.label, fx.range);
  const creep = report.scopeCreep.find((r) => r.targetId === c.personId)!;

  assert.equal(creep.actualHours, "88");
  assert.equal(creep.agreedHours, "60");
  assert.equal(creep.overHours, "28");
  assert.equal(Math.round(creep.overPct!), 47);
  assert.equal(creep.agreedHourlyRateCents, 2_500_00);
  assert.equal(creep.effectiveHourlyRateCents, 1_704_55); // displays as ~Rs 1,705
  assert.equal(creep.isOver, true);
});

test("a client with no agreed hours never appears in scope creep", async () => {
  // No agreement means nothing to be over — not "0% over".
  const fx = await profitFixture("wi-noagreement");
  const c = await fx.clients.createClient(fx.biz.id, { name: "Open Co", engagement: {} });
  await fx.invoice(c.personId, 40_000_00);
  await fx.timesheet.setTimesheetCell(fx.biz.id, {
    personId: fx.member.id, targetType: "client", targetId: c.personId, entryDate: "2060-04-06", hours: "8",
  });

  const report = await fx.profit.computeClientProfitability(fx.biz.id, fx.label, fx.range);
  assert.equal(report.scopeCreep.find((r) => r.targetId === c.personId), undefined);
});

test("utilization end to end: billable against total, with the gap named", async () => {
  const fx = await profitFixture("wi-util");
  const c = await fx.clients.createClient(fx.biz.id, { name: "Util Co", engagement: {} });
  await fx.invoice(c.personId, 50_000_00);
  const targets = await fx.timesheet.listTimeTargets(fx.biz.id);
  const internal = targets.find((t) => t.targetType === "internal")!;

  // 6 billable hours on the client, 2 non-billable on Admin = 75%.
  await fx.timesheet.setTimesheetCell(fx.biz.id, {
    personId: fx.member.id, targetType: "client", targetId: c.personId,
    entryDate: "2060-05-04", hours: "6", billable: true,
  });
  await fx.timesheet.setTimesheetCell(fx.biz.id, {
    personId: fx.member.id, targetType: "internal", targetId: internal.targetId,
    entryDate: "2060-05-04", hours: "2", billable: false,
  });

  const report = await fx.profit.computeClientProfitability(fx.biz.id, fx.label, fx.range);
  assert.equal(report.utilization.overall.billableHours, "6");
  assert.equal(report.utilization.overall.totalHours, "8");
  assert.equal(report.utilization.overall.nonBillableHours, "2");
  assert.equal(report.utilization.overall.pct, 75);

  // And per person, so it is actionable rather than an aggregate.
  const member = report.utilization.byMember.find((m) => m.personId === fx.member.id)!;
  assert.equal(member.pct, 75);
  assert.ok(member.name.length > 0);
});

test("concentration end to end: one client's share of everything earned", async () => {
  const fx = await profitFixture("wi-conc");
  const big = await fx.clients.createClient(fx.biz.id, { name: "Big Co", engagement: {} });
  const small = await fx.clients.createClient(fx.biz.id, { name: "Small Co", engagement: {} });
  await fx.invoice(big.personId, 570_000_00);
  await fx.invoice(small.personId, 430_000_00);
  await fx.timesheet.setTimesheetCell(fx.biz.id, {
    personId: fx.member.id, targetType: "client", targetId: big.personId, entryDate: "2060-06-01", hours: "8",
  });

  const report = await fx.profit.computeClientProfitability(fx.biz.id, fx.label, fx.range);
  assert.equal(report.concentration.topLabel, "Big Co");
  assert.equal(report.concentration.topSharePct, 57);
  assert.equal(report.concentration.risk, "high");
  // Concentration is about REVENUE, so it counts clients with no hours too —
  // unlike profit, a share of income is knowable without costing it.
  assert.equal(report.concentration.slices.length, 2);
  assert.equal(report.concentration.totalRevenueCents, 1_000_000_00);
});

test("rework stands on its own and is never folded into delivery", async () => {
  // The spec's example: 14 rework hours of 62.
  const fx = await profitFixture("wi-rework");
  const c = await fx.clients.createClient(fx.biz.id, { name: "Fussy Co", engagement: {} });
  await fx.invoice(c.personId, 80_000_00);

  const log = async (date: string, hours: string, workType: "delivery" | "rework" | "admin") =>
    fx.timesheet.setTimesheetCell(fx.biz.id, {
      personId: fx.member.id, targetType: "client", targetId: c.personId, entryDate: date, hours, workType,
    });

  // 40 delivery + 14 rework + 8 admin = 62 hours, on separate days so each
  // cell is its own entry.
  await log("2060-07-05", "8", "delivery");
  await log("2060-07-06", "8", "delivery");
  await log("2060-07-07", "8", "delivery");
  await log("2060-07-08", "8", "delivery");
  await log("2060-07-09", "8", "delivery");
  await log("2060-07-12", "8", "rework");
  await log("2060-07-13", "6", "rework");
  await log("2060-07-14", "8", "admin");

  const report = await fx.profit.computeClientProfitability(fx.biz.id, fx.label, fx.range);

  const rework = report.workTypes.find((w) => w.workType === "rework")!;
  const delivery = report.workTypes.find((w) => w.workType === "delivery")!;
  assert.equal(rework.hours, "14");
  assert.equal(delivery.hours, "40", "delivery does NOT include the redone work");
  assert.equal(rework.sharePct, 22.6); // 14 of 62

  // And it is attributed to the client, because that is what makes it useful.
  const perClient = report.reworkByClient.find((r) => r.targetId === c.personId)!;
  assert.equal(perClient.hours, "14");
  assert.equal(perClient.label, "Fussy Co");
});

test("the three measures do not disturb the profit figures or the ladder", async () => {
  const fx = await profitFixture("wi-safe");
  const c = await fx.clients.createClient(fx.biz.id, {
    name: "Safe Co", engagement: { agreedHours: "10", agreedAmountCents: 50_000_00 },
  });
  await fx.invoice(c.personId, 50_000_00);

  const before = (await read.computePnl(fx.biz.id, fx.label, fx.range)).ladder;
  await fx.timesheet.setTimesheetCell(fx.biz.id, {
    personId: fx.member.id, targetType: "client", targetId: c.personId, entryDate: "2060-08-03", hours: "20",
  });
  const report = await fx.profit.computeClientProfitability(fx.biz.id, fx.label, fx.range);
  const after = (await read.computePnl(fx.biz.id, fx.label, fx.range)).ladder;

  // The new measures fired...
  assert.equal(report.scopeCreep.find((r) => r.targetId === c.personId)!.overPct, 100);
  assert.ok(report.utilization.overall.pct !== null);
  // ...and the money is untouched.
  assert.deepEqual(after, before);
  const row = report.rows.find((r) => r.targetType === "client" && r.targetId === c.personId)!;
  assert.equal(row.contributionCents, 50_000_00 - 10_000_00);
});

// ---------------------------------------------------------------------------
// Client profitability — Phase 7: CSV import
// ---------------------------------------------------------------------------

/** A business with one team member, one client, and an importer to point at it. */
async function importFixture(label: string) {
  const fx = await profitFixture(label);
  const timeImport = await import("@/app/api/client-profitability/functions");
  const client = await fx.clients.createClient(fx.biz.id, { name: "Acme Corp", engagement: {} });
  return { ...fx, timeImport, client };
}

/** A Toggl-shaped export. `who` and `what` are what makes a row match or not. */
const togglCsv = (rows: Array<[string, string, string, string, string?]>) =>
  [
    "User,Email,Client,Project,Description,Start date,Duration,Billable,Tags",
    ...rows.map(
      ([who, what, date, duration, tags]) => `${who},x@x.com,${what},Website,Work,${date},${duration},Yes,${tags ?? ""}`,
    ),
  ].join("\r\n");

test("the same CSV imported twice adds nothing the second time", async () => {
  // Acceptance test 19. The failure this prevents is silent: a week imported
  // twice doubles the hours behind every cost figure and halves every client's
  // margin, with nothing on screen to say why.
  const fx = await importFixture("csv-twice");
  const csv = togglCsv([
    [`${fx.label} Dev`, "Acme Corp", "2060-04-05", "04:00:00"],
    [`${fx.label} Dev`, "Acme Corp", "2060-04-06", "06:30:00"],
  ]);

  const first = await fx.timeImport.commitTimeImport(fx.biz.id, { csv });
  assert.equal(first.added, 2);
  assert.equal(first.updated, 0);

  const second = await fx.timeImport.commitTimeImport(fx.biz.id, { csv });
  assert.equal(second.added, 0, "nothing new on a re-import");
  assert.equal(second.unchanged, 2, "both days recognised as already imported");

  const entries = await db
    .select()
    .from(dbModule.timeEntriesTable)
    .where(eq(dbModule.timeEntriesTable.businessId, fx.biz.id));
  assert.equal(entries.length, 2, "two days in, two rows stored");
  assert.equal(addHours(...entries.map((e) => e.hours)), "10.5");

  // And the preview says so before anything is written.
  const preview = await fx.timeImport.previewTimeImport(fx.biz.id, { csv });
  assert.equal(preview.totals.unchanged, 2);
  assert.equal(preview.totals.new, 0);
});

test("an unmatched team member blocks the whole import, not just their rows", async () => {
  // Acceptance test 20. Importing "the rest of it" would leave the owner
  // believing a week is complete while someone's hours are missing — which
  // understates cost on every client that person touched.
  const fx = await importFixture("csv-unmatched");
  const csv = togglCsv([
    [`${fx.label} Dev`, "Acme Corp", "2060-04-05", "04:00:00"],
    ["Nobody Atall", "Acme Corp", "2060-04-06", "08:00:00"],
  ]);

  const preview = await fx.timeImport.previewTimeImport(fx.biz.id, { csv });
  assert.equal(preview.canCommit, false);
  assert.equal(preview.unmatchedPeople.length, 1);
  assert.equal(preview.unmatchedPeople[0].name, "Nobody Atall");
  assert.equal(preview.unmatchedPeople[0].hours, "8");

  await assert.rejects(
    () => fx.timeImport.commitTimeImport(fx.biz.id, { csv }),
    (err: unknown) => err instanceof ServiceError && /Nobody Atall/.test(err.message),
  );

  // NOTHING was written — not even the row that would have matched.
  const entries = await db
    .select()
    .from(dbModule.timeEntriesTable)
    .where(eq(dbModule.timeEntriesTable.businessId, fx.biz.id));
  assert.equal(entries.length, 0);

  // Once the owner says who that is, the whole file goes in.
  const resolved = await fx.timeImport.commitTimeImport(fx.biz.id, {
    csv,
    personMap: { "Nobody Atall": fx.member.id },
  });
  assert.equal(resolved.added, 2);
});

test("an unmatched client blocks it too, and the closest name is offered", async () => {
  const fx = await importFixture("csv-unclient");
  // "Acme Ltd" is not "Acme Corp" — close enough to suggest, never to assume.
  const csv = togglCsv([[`${fx.label} Dev`, "Acme Ltd", "2060-04-05", "04:00:00"]]);

  const preview = await fx.timeImport.previewTimeImport(fx.biz.id, { csv });
  assert.equal(preview.canCommit, false);
  assert.equal(preview.unmatchedTargets.length, 1);
  assert.equal(preview.unmatchedTargets[0].name, "Acme Ltd");
  const suggestion = preview.unmatchedTargets[0].suggestions.find((s) => s.label === "Acme Corp");
  assert.ok(suggestion, "the real Acme is offered as a suggestion");
  assert.equal(suggestion.id, `client:${fx.client.personId}`);

  await assert.rejects(
    () => fx.timeImport.commitTimeImport(fx.biz.id, { csv }),
    (err: unknown) => err instanceof ServiceError && /Acme Ltd/.test(err.message),
  );

  const done = await fx.timeImport.commitTimeImport(fx.biz.id, {
    csv,
    targetMap: { "Acme Ltd": `client:${fx.client.personId}` },
  });
  assert.equal(done.added, 1);
});

test("several timer rows on one day become one cell, and the grid agrees with the cost", async () => {
  // Toggl exports a row per started timer. Three rows on one Monday must be one
  // cell of 7.5 hours — otherwise the grid shows one figure and profitability
  // counts another.
  const fx = await importFixture("csv-sum");
  const csv = togglCsv([
    [`${fx.label} Dev`, "Acme Corp", "2060-04-05", "02:00:00"],
    [`${fx.label} Dev`, "Acme Corp", "2060-04-05", "03:30:00"],
    [`${fx.label} Dev`, "Acme Corp", "2060-04-05", "02:00:00"],
  ]);

  const result = await fx.timeImport.commitTimeImport(fx.biz.id, { csv });
  assert.equal(result.added, 1, "three rows, one day, one cell");

  const [entry] = await db
    .select()
    .from(dbModule.timeEntriesTable)
    .where(eq(dbModule.timeEntriesTable.businessId, fx.biz.id));
  assert.equal(entry.hours, "7.5");

  // The grid and the profitability engine see the same 7.5 hours.
  const sheet = await fx.timesheet.getTimesheet(fx.biz.id, new Date("2060-04-05T00:00:00Z"));
  const cell = sheet.cells.find((c) => c.entryDate === "2060-04-05");
  assert.equal(cell?.hours, "7.5");

  const report = await fx.profit.computeClientProfitability(fx.biz.id, fx.label, fx.range);
  const row = report.rows.find((r) => r.targetId === fx.client.personId);
  assert.equal(row?.hoursLogged, "7.5");
  assert.equal(row?.labourCostCents, entry.costAmountCents);
});

test("rework survives the import instead of being folded into the day's delivery", async () => {
  const fx = await importFixture("csv-rework");
  const csv = togglCsv([
    [`${fx.label} Dev`, "Acme Corp", "2060-04-05", "06:00:00"],
    [`${fx.label} Dev`, "Acme Corp", "2060-04-05", "02:00:00", "rework"],
  ]);

  await fx.timeImport.commitTimeImport(fx.biz.id, { csv });

  const report = await fx.profit.computeClientProfitability(fx.biz.id, fx.label, fx.range);
  assert.equal(report.workTypes.find((w) => w.workType === "rework")?.hours, "2");
  assert.equal(report.workTypes.find((w) => w.workType === "delivery")?.hours, "6");

  // And the grid still shows the day's real total, not one of its halves.
  const sheet = await fx.timesheet.getTimesheet(fx.biz.id, new Date("2060-04-05T00:00:00Z"));
  assert.equal(sheet.cells.find((c) => c.entryDate === "2060-04-05")?.hours, "8");
});

test("a corrected day is restated, never added a second time", async () => {
  // Fix Monday in Toggl, re-export, re-import. A content-hashed id would land
  // the corrected row beside the old one and count the day twice.
  const fx = await importFixture("csv-fixed");
  const day = (duration: string) => togglCsv([[`${fx.label} Dev`, "Acme Corp", "2060-04-05", duration]]);

  await fx.timeImport.commitTimeImport(fx.biz.id, { csv: day("04:00:00") });
  const second = await fx.timeImport.commitTimeImport(fx.biz.id, { csv: day("06:00:00") });

  assert.equal(second.added, 0);
  assert.equal(second.updated, 1);

  const entries = await db
    .select()
    .from(dbModule.timeEntriesTable)
    .where(eq(dbModule.timeEntriesTable.businessId, fx.biz.id));
  assert.equal(entries.length, 1, "one day, one row");
  assert.equal(entries[0].hours, "6");
  // The cost was re-frozen with it, not left at the old figure.
  assert.equal(entries[0].costAmountCents, costOfHours("6", entries[0].costRateSnapshotCents));
});

test("hours typed by hand are never overwritten or added to by an import", async () => {
  const fx = await importFixture("csv-manual");
  await fx.timesheet.setTimesheetCell(fx.biz.id, {
    personId: fx.member.id,
    targetType: "client",
    targetId: fx.client.personId,
    entryDate: "2060-04-05",
    hours: "3",
  });

  const csv = togglCsv([[`${fx.label} Dev`, "Acme Corp", "2060-04-05", "08:00:00"]]);
  const preview = await fx.timeImport.previewTimeImport(fx.biz.id, { csv });
  assert.equal(preview.entries[0].outcome, "conflict");
  assert.match(preview.entries[0].issue ?? "", /by hand/i);

  const result = await fx.timeImport.commitTimeImport(fx.biz.id, { csv });
  assert.equal(result.added, 0);
  assert.equal(result.skippedConflicts, 1);

  const entries = await db
    .select()
    .from(dbModule.timeEntriesTable)
    .where(eq(dbModule.timeEntriesTable.businessId, fx.biz.id));
  assert.equal(entries.length, 1);
  assert.equal(entries[0].hours, "3", "what the person typed stands");
});

test("editing an imported cell takes ownership of it, and a re-import respects that", async () => {
  const fx = await importFixture("csv-edited");
  const csv = togglCsv([[`${fx.label} Dev`, "Acme Corp", "2060-04-05", "08:00:00"]]);
  await fx.timeImport.commitTimeImport(fx.biz.id, { csv });

  // The owner knows only 5 of those hours were really this client's.
  await fx.timesheet.setTimesheetCell(fx.biz.id, {
    personId: fx.member.id,
    targetType: "client",
    targetId: fx.client.personId,
    entryDate: "2060-04-05",
    hours: "5",
  });

  const again = await fx.timeImport.commitTimeImport(fx.biz.id, { csv });
  assert.equal(again.added, 0);
  assert.equal(again.skippedConflicts, 1, "the correction is not undone by the file");

  const entries = await db
    .select()
    .from(dbModule.timeEntriesTable)
    .where(eq(dbModule.timeEntriesTable.businessId, fx.biz.id));
  assert.equal(entries.length, 1);
  assert.equal(entries[0].hours, "5");
});

test("a row with no pay rate covering it blocks the import with a reason", async () => {
  // Costing at zero would be worse than refusing: it makes the client look
  // free, which is exactly the client worth looking at.
  const fx = await importFixture("csv-norate");
  // 2059 is before the member's rate starts.
  const csv = togglCsv([[`${fx.label} Dev`, "Acme Corp", "2059-04-05", "04:00:00"]]);

  const preview = await fx.timeImport.previewTimeImport(fx.biz.id, { csv });
  assert.equal(preview.canCommit, false);
  assert.equal(preview.entries[0].outcome, "blocked");
  assert.equal(preview.entries[0].costAmountCents, null, "no cost invented");
  assert.match(preview.entries[0].issue ?? "", /no pay rate/i);

  await assert.rejects(
    () => fx.timeImport.commitTimeImport(fx.biz.id, { csv }),
    (err: unknown) => err instanceof ServiceError && /pay rate/.test(err.message),
  );
});

test("an unreadable row is reported with its line number and never invented", async () => {
  const fx = await importFixture("csv-bad");
  const csv = [
    "User,Client,Start date,Duration",
    `${fx.label} Dev,Acme Corp,2060-04-05,04:00:00`,
    `${fx.label} Dev,Acme Corp,gibberish,04:00:00`,
    `${fx.label} Dev,Acme Corp,2060-04-06,banana`,
  ].join("\n");

  const preview = await fx.timeImport.previewTimeImport(fx.biz.id, { csv });
  assert.equal(preview.problems.length, 2);
  assert.deepEqual(
    preview.problems.map((p) => p.lineNumber),
    [3, 4],
  );
  // The readable row still imports; one bad line does not cost the owner the file.
  assert.equal(preview.totals.new, 1);
  assert.equal(preview.canCommit, true);

  const result = await fx.timeImport.commitTimeImport(fx.biz.id, { csv });
  assert.equal(result.added, 1);
  assert.equal(result.unreadableRows, 2);
});

test("importing hours does not move a single number on the profit ladder", async () => {
  // The distribution rule, proven for the import path too: attributed labour is
  // a SHARE of payroll already in the ledger, never a second cost.
  const fx = await importFixture("csv-ladder");
  await fx.invoice(fx.client.personId, 90_000_00);

  const before = await read.computePnl(fx.biz.id, fx.label, fx.range);
  await fx.timeImport.commitTimeImport(fx.biz.id, {
    csv: togglCsv([
      [`${fx.label} Dev`, "Acme Corp", "2060-04-05", "08:00:00"],
      [`${fx.label} Dev`, "Acme Corp", "2060-04-06", "08:00:00"],
      [`${fx.label} Dev`, "Acme Corp", "2060-04-07", "08:00:00"],
    ]),
  });
  const after = await read.computePnl(fx.biz.id, fx.label, fx.range);

  assert.deepEqual(after.ladder, before.ladder);

  // The hours did land — this is not a test that passes because nothing happened.
  const report = await fx.profit.computeClientProfitability(fx.biz.id, fx.label, fx.range);
  assert.equal(report.rows.find((r) => r.targetId === fx.client.personId)?.hoursLogged, "24");
});

// ---------------------------------------------------------------------------
// Client profitability — Phase 8: estimated hours
// ---------------------------------------------------------------------------

/** A business with a team member, a client, and the estimate service loaded. */
async function estimateFixture(label: string) {
  const fx = await profitFixture(label);
  const estimates = await import("@/app/api/client-profitability/functions");
  const timeImport = await import("@/app/api/client-profitability/functions");
  const client = await fx.clients.createClient(fx.biz.id, { name: "Acme Corp", engagement: {} });
  /** July 2060 has 22 working days; the whole month is the natural stretch. */
  const july = { periodStart: "2060-07-01", periodEnd: "2060-07-31" };
  const on = (over: Record<string, unknown> = {}) => ({
    personId: fx.member.id,
    targetType: "client" as const,
    targetId: client.personId,
    ...july,
    hours: "80",
    ...over,
  });
  return { ...fx, estimates, timeImport, client, july, on };
}

test("an estimate produces figures, and every one of them is marked estimated", async () => {
  // Acceptance test 14. The alternative to this feature is not a better number,
  // it is NO number — but a rough figure that reads like a logged one would be
  // trusted exactly as much as a logged one, which is the whole danger.
  const fx = await estimateFixture("est-marked");
  await fx.invoice(fx.client.personId, 200_000_00);

  const preview = await fx.estimates.previewEstimate(fx.biz.id, fx.on());
  assert.equal(preview.blockedReason, null);
  assert.equal(preview.totalHours, "80");
  assert.ok(preview.workingDays >= 22 && preview.workingDays <= 23);
  assert.match(preview.sentence, /80 hours for .* on Acme Corp/);

  const done = await fx.estimates.setTargetEstimate(fx.biz.id, fx.on());
  assert.equal(done.totalHours, "80");

  // On the profitability read: figures appear, and the row says they are rough.
  const report = await fx.profit.computeClientProfitability(fx.biz.id, fx.label, fx.range);
  const row = report.rows.find((r) => r.targetId === fx.client.personId);
  assert.equal(row?.hoursLogged, "80");
  assert.equal(row?.isCosted, true, "an estimate DOES produce a figure");
  assert.ok((row?.labourCostCents ?? 0) > 0);
  assert.equal(row?.hasEstimates, true, "and the row is flagged");
  assert.equal(report.summary.hasEstimates, true, "as is the summary above it");

  // And on the grid, every cell it wrote carries the flag.
  const sheet = await fx.timesheet.getTimesheet(fx.biz.id, new Date("2060-07-05T00:00:00Z"));
  const cells = sheet.cells.filter((c) => c.targetId === fx.client.personId);
  assert.ok(cells.length > 0);
  assert.ok(cells.every((c) => c.isEstimated), "no estimated hour is ever shown as logged");
});

test("the hours stored add up to exactly the figure that was typed", async () => {
  // 80 over 22 working days is 3.636..., which no clean split gives. Storing
  // 79.98 would make every downstream figure disagree with what the owner
  // typed, for no reason they could ever see.
  const fx = await estimateFixture("est-exact");
  await fx.estimates.setTargetEstimate(fx.biz.id, fx.on({ hours: "80" }));

  const entries = await db
    .select()
    .from(dbModule.timeEntriesTable)
    .where(eq(dbModule.timeEntriesTable.businessId, fx.biz.id));
  assert.equal(addHours(...entries.map((e) => e.hours)), "80");

  // Each day's cost is that day's hours at that day's frozen rate, and the
  // stored total is the sum of the parts — not a separately rounded figure.
  const summed = entries.reduce((total, e) => total + costOfHours(e.hours, e.costRateSnapshotCents), 0);
  assert.equal(entries.reduce((total, e) => total + e.costAmountCents, 0), summed);

  // No entry is zero-hours, which the database would refuse anyway.
  assert.ok(entries.every((e) => Number(e.hours) > 0));
});

test("weekends get no hours, so an estimate never claims the team worked Sunday", async () => {
  const fx = await estimateFixture("est-weekend");
  await fx.estimates.setTargetEstimate(fx.biz.id, fx.on());

  const entries = await db
    .select()
    .from(dbModule.timeEntriesTable)
    .where(eq(dbModule.timeEntriesTable.businessId, fx.biz.id));
  assert.ok(entries.length > 0);
  assert.ok(entries.every((e) => !isWeekend(e.entryDate)), "no weekend days");
});

test("re-estimating replaces the previous guess rather than stacking on it", async () => {
  // Two estimates for one stretch would mean 80 + 120 = 200 hours nobody
  // worked, and nothing on screen would say why the client looked so expensive.
  const fx = await estimateFixture("est-replace");
  await fx.estimates.setTargetEstimate(fx.biz.id, fx.on({ hours: "80" }));
  const second = await fx.estimates.setTargetEstimate(fx.biz.id, fx.on({ hours: "120" }));

  assert.ok(second.daysReplaced > 0, "the first estimate was cleared out");
  assert.equal(second.totalHours, "120");

  const entries = await db
    .select()
    .from(dbModule.timeEntriesTable)
    .where(eq(dbModule.timeEntriesTable.businessId, fx.biz.id));
  assert.equal(addHours(...entries.map((e) => e.hours)), "120", "120, not 200");

  const report = await fx.profit.computeClientProfitability(fx.biz.id, fx.label, fx.range);
  assert.equal(report.rows.find((r) => r.targetId === fx.client.personId)?.hoursLogged, "120");
});

test("an estimate is refused on top of hours somebody actually logged", async () => {
  // Guessing over facts doubles them, invisibly. Better to say so and stop.
  const fx = await estimateFixture("est-refuse");
  await fx.timesheet.setTimesheetCell(fx.biz.id, {
    personId: fx.member.id,
    targetType: "client",
    targetId: fx.client.personId,
    entryDate: "2060-07-06",
    hours: "6",
  });

  const preview = await fx.estimates.previewEstimate(fx.biz.id, fx.on());
  assert.ok(preview.blockedReason, "the preview says no before anything is written");
  assert.match(preview.blockedReason!, /already has 6 hours logged/);
  assert.equal(preview.loggedHours, "6");

  await assert.rejects(
    () => fx.estimates.setTargetEstimate(fx.biz.id, fx.on()),
    (err: unknown) => err instanceof ServiceError && /count them twice/.test(err.message),
  );

  // The logged hours are untouched and still the only thing there.
  const entries = await db
    .select()
    .from(dbModule.timeEntriesTable)
    .where(eq(dbModule.timeEntriesTable.businessId, fx.biz.id));
  assert.equal(entries.length, 1);
  assert.equal(entries[0].hours, "6");
  assert.equal(entries[0].isEstimated, false);
});

test("real hours arriving from a CSV replace the estimate they stood in for", async () => {
  // An estimate is a placeholder for hours nobody had. When the real ones show
  // up, keeping both would double the day — the grid sums a cell.
  const fx = await estimateFixture("est-import");
  await fx.estimates.setTargetEstimate(fx.biz.id, fx.on({ hours: "80" }));

  const csv = [
    "User,Email,Client,Project,Description,Start date,Duration,Billable,Tags",
    `${fx.label} Dev,x@x.com,Acme Corp,Website,Real work,2060-07-06,07:00:00,Yes,`,
  ].join("\r\n");

  const preview = await fx.timeImport.previewTimeImport(fx.biz.id, { csv });
  assert.equal(preview.canCommit, true, "an estimate does not block an import the way hand-typed hours do");
  assert.equal(preview.entries[0].outcome, "new");
  assert.match(preview.entries[0].issue ?? "", /replaces the estimate/i);

  const result = await fx.timeImport.commitTimeImport(fx.biz.id, { csv });
  assert.equal(result.added, 1);
  assert.equal(result.estimatesReplaced, 1);

  // That day is now 7 real hours, not 7 real plus an estimated 3.64.
  const sheet = await fx.timesheet.getTimesheet(fx.biz.id, new Date("2060-07-06T00:00:00Z"));
  const monday = sheet.cells.find((c) => c.entryDate === "2060-07-06");
  assert.equal(monday?.hours, "7");
  assert.equal(monday?.isEstimated, false, "the day stopped being an estimate");
});

test("typing over an estimated cell makes it a real entry, flag and all", async () => {
  const fx = await estimateFixture("est-typed");
  await fx.estimates.setTargetEstimate(fx.biz.id, fx.on({ hours: "80" }));

  await fx.timesheet.setTimesheetCell(fx.biz.id, {
    personId: fx.member.id,
    targetType: "client",
    targetId: fx.client.personId,
    entryDate: "2060-07-06",
    hours: "5",
  });

  const [entry] = await db
    .select()
    .from(dbModule.timeEntriesTable)
    .where(
      and(
        eq(dbModule.timeEntriesTable.businessId, fx.biz.id),
        eq(dbModule.timeEntriesTable.entryDate, "2060-07-06"),
      ),
    );
  assert.equal(entry.hours, "5");
  assert.equal(entry.source, "manual");
  assert.equal(entry.isEstimated, false, "somebody has now said what the day was");
  assert.equal(entry.note, null, "and it no longer carries the estimate's caption");
});

test("clearing an estimate takes only the guesses, never logged hours", async () => {
  const fx = await estimateFixture("est-clear");
  await fx.estimates.setTargetEstimate(fx.biz.id, fx.on({ hours: "40" }));
  // One day is then corrected by hand, which makes it a real entry.
  await fx.timesheet.setTimesheetCell(fx.biz.id, {
    personId: fx.member.id,
    targetType: "client",
    targetId: fx.client.personId,
    entryDate: "2060-07-06",
    hours: "5",
  });

  const cleared = await fx.estimates.clearTargetEstimate(fx.biz.id, {
    personId: fx.member.id,
    targetType: "client",
    targetId: fx.client.personId,
    ...fx.july,
  });
  assert.ok(cleared.removed > 0);

  const left = await db
    .select()
    .from(dbModule.timeEntriesTable)
    .where(eq(dbModule.timeEntriesTable.businessId, fx.biz.id));
  assert.equal(left.length, 1, "the hand-typed day survives");
  assert.equal(left[0].hours, "5");
  assert.equal(left[0].source, "manual");
});

test("an impossible estimate and an empty stretch are both refused with a reason", async () => {
  const fx = await estimateFixture("est-silly");

  // 5,000 hours in a month is a typo, not a workload.
  const tooMuch = await fx.estimates.previewEstimate(fx.biz.id, fx.on({ hours: "5000" }));
  assert.match(tooMuch.blockedReason ?? "", /more than anyone can work in a day/);

  // A weekend on its own has no working days to spread over.
  const weekend = await fx.estimates.previewEstimate(
    fx.biz.id,
    fx.on({ periodStart: "2060-07-03", periodEnd: "2060-07-04" }),
  );
  assert.match(weekend.blockedReason ?? "", /no working days/);

  // A stretch before the member was ever paid cannot be costed.
  const tooEarly = await fx.estimates.previewEstimate(
    fx.biz.id,
    fx.on({ periodStart: "2059-07-01", periodEnd: "2059-07-31" }),
  );
  assert.match(tooEarly.blockedReason ?? "", /no pay rate/);
  assert.equal(tooEarly.totalCostCents, null, "no cost invented");

  // Nothing was written by any of that.
  const entries = await db
    .select()
    .from(dbModule.timeEntriesTable)
    .where(eq(dbModule.timeEntriesTable.businessId, fx.biz.id));
  assert.equal(entries.length, 0);
});

test("estimates are listed back as the stretches they were entered as", async () => {
  // 23 rows of 3.48 hours is not what the owner typed; "80 hours in July" is.
  const fx = await estimateFixture("est-list");
  await fx.estimates.setTargetEstimate(fx.biz.id, fx.on({ hours: "80" }));

  const listed = await fx.estimates.listTargetEstimates(fx.biz.id);
  assert.equal(listed.length, 1);
  assert.equal(listed[0].hours, "80");
  assert.equal(listed[0].targetLabel, "Acme Corp");
  assert.equal(listed[0].personName, `${fx.label} Dev`);
  assert.ok(listed[0].dayCount >= 22);
  assert.ok(listed[0].costCents > 0);
});

test("estimating hours does not move a single number on the profit ladder", async () => {
  // The distribution rule holds for guesses too: attributed labour is a SHARE
  // of payroll already in the ledger, never a second cost.
  const fx = await estimateFixture("est-ladder");
  await fx.invoice(fx.client.personId, 150_000_00);

  const before = await read.computePnl(fx.biz.id, fx.label, fx.range);
  await fx.estimates.setTargetEstimate(fx.biz.id, fx.on({ hours: "80" }));
  const after = await read.computePnl(fx.biz.id, fx.label, fx.range);

  assert.deepEqual(after.ladder, before.ladder);

  // The hours did land — this is not a test that passes because nothing happened.
  const report = await fx.profit.computeClientProfitability(fx.biz.id, fx.label, fx.range);
  assert.equal(report.rows.find((r) => r.targetId === fx.client.personId)?.hoursLogged, "80");
});

// ---------------------------------------------------------------------------
// Client profitability — Phase 9: wired into Insights, and still reconciling
// ---------------------------------------------------------------------------

/** The client lens must account for every rupee the ladder calls net revenue. */
const clientLensRevenue = (report: { rows: Array<{ targetType: string; revenueCents: number }>; unattributedRevenueCents: number }) =>
  report.rows.filter((r) => r.targetType === "client").reduce((sum, r) => sum + r.revenueCents, 0) +
  report.unattributedRevenueCents;

/** Turns the module on or off for a business, the way Settings does. */
async function setClientProfitability(businessId: string, on: boolean) {
  await db
    .update(dbModule.businessesTable)
    .set({ featureOverrides: { client_profitability: on } })
    .where(eq(dbModule.businessesTable.id, businessId));
}

test("the client lens accounts for every rupee the P&L calls revenue", async () => {
  // The money counterpart of the labour guard. Every rupee of net revenue must
  // land on exactly one client row or in `unattributedRevenueCents`, so this
  // page and the P&L cannot drift apart without something failing loudly.
  const fx = await profitFixture("recon-rev");
  const named = await fx.clients.createClient(fx.biz.id, { name: "Named Co", engagement: {} });
  await fx.invoice(named.personId, 60_000_00);

  // A sale with no customer on it — its revenue belongs to nobody, and must
  // still be counted somewhere.
  await ledger.createTransaction(fx.biz.id, {
    direction: "in",
    occurredAt: new Date("2060-03-02T00:00:00Z"),
    sourceId: fx.src.id,
    lines: [{ revenueItemId: fx.service.id, qty: "1", unitPriceCents: 25_000_00 }],
  });

  const report = await fx.profit.computeClientProfitability(fx.biz.id, fx.label, fx.range);
  const pnl = await read.computePnl(fx.biz.id, fx.label, fx.range);

  assert.equal(clientLensRevenue(report), pnl.ladder.netRevenue, "not a rupee more or less than the ladder");
  assert.equal(report.unattributedRevenueCents, 25_000_00, "the anonymous sale is reported, not dropped");
});

test("shipping charged on a sale with no customer is counted, not lost", async () => {
  // Caught by the revenue guard the moment it was added: shipping IS revenue in
  // the ladder, but the client lens only credited it when the sale named
  // somebody — so a walk-in with delivery on it left the two disagreeing by
  // exactly the shipping. The guard turned a silent gap into a throw.
  const fx = await profitFixture("recon-ship");
  await ledger.createTransaction(fx.biz.id, {
    direction: "in",
    occurredAt: new Date("2060-03-02T00:00:00Z"),
    sourceId: fx.src.id,
    shippingChargedCents: 1_500_00,
    lines: [{ revenueItemId: fx.service.id, qty: "1", unitPriceCents: 10_000_00 }],
  });

  // Would have THROWN before the fix — the guard is what makes this a test.
  const report = await fx.profit.computeClientProfitability(fx.biz.id, fx.label, fx.range);
  const pnl = await read.computePnl(fx.biz.id, fx.label, fx.range);

  assert.equal(report.unattributedRevenueCents, 11_500_00, "the sale AND its shipping");
  assert.equal(clientLensRevenue(report), pnl.ladder.netRevenue);
});

test("discounts, refunds and shipping all reconcile through the client lens", async () => {
  // The awkward cases together, because each is allocated by its own rule and a
  // change to any one of them could quietly break the other two.
  const fx = await profitFixture("recon-hard");
  const c = await fx.clients.createClient(fx.biz.id, { name: "Hard Co", engagement: {} });

  const sale = await ledger.createTransaction(fx.biz.id, {
    direction: "in",
    occurredAt: new Date("2060-03-02T00:00:00Z"),
    sourceId: fx.src.id,
    personId: c.personId,
    orderDiscountCents: 3_000_00,
    shippingChargedCents: 900_00,
    lines: [
      { revenueItemId: fx.service.id, qty: "2", unitPriceCents: 20_000_00 },
      { label: "Extra", qty: "1", unitPriceCents: 5_000_00 },
    ],
  });
  await ledger.createRefund(fx.biz.id, {
    transactionId: sale.transaction.id,
    requests: [{ lineId: sale.lines[0].id, qtyRefunded: "1", amountRefundedCents: 7_000_00 }],
    occurredAt: new Date("2060-03-09T00:00:00Z"),
  });

  const report = await fx.profit.computeClientProfitability(fx.biz.id, fx.label, fx.range);
  const pnl = await read.computePnl(fx.biz.id, fx.label, fx.range);
  assert.equal(clientLensRevenue(report), pnl.ladder.netRevenue);
});

test("logging hours changes no figure on any other report", async () => {
  // The distribution rule checked against every read the app serves, not the
  // ladder alone — this is the phase that wires the module into the rest of the
  // app, so "nothing else moved" has to mean all of it.
  const fx = await profitFixture("recon-wide");
  const c = await fx.clients.createClient(fx.biz.id, {
    name: "Wide Co",
    engagement: { agreedHours: "10", agreedAmountCents: 40_000_00 },
  });
  await fx.invoice(c.personId, 120_000_00);

  const prior = { start: new Date("2059-01-01T00:00:00Z"), end: new Date("2059-12-31T23:59:59Z") };
  const snapshot = async () => ({
    pnl: (await read.computePnl(fx.biz.id, fx.label, fx.range)).ladder,
    drivers: await analytics.computeDrivers(fx.biz.id, fx.label, fx.range, prior),
    leaks: await analytics.computeLeaks(fx.biz.id, fx.label, fx.range, prior),
    breakEven: await read.computeBreakEvenReport(fx.biz.id, fx.label, fx.range),
    series: await analytics.computePnlSeries(fx.biz.id, fx.range, "month"),
  });

  const before = await snapshot();
  await fx.timesheet.setTimesheetCell(fx.biz.id, {
    personId: fx.member.id,
    targetType: "client",
    targetId: c.personId,
    entryDate: "2060-03-02",
    hours: "8",
  });
  const after = await snapshot();

  assert.deepEqual(after.pnl, before.pnl, "the ladder");
  assert.deepEqual(after.drivers, before.drivers, "the drivers axes");
  assert.deepEqual(after.leaks, before.leaks, "the leaks report");
  assert.deepEqual(after.breakEven, before.breakEven, "break-even");
  assert.deepEqual(after.series, before.series, "the P&L series buckets");

  // And the hours DID land, so this is not passing because nothing happened.
  const report = await fx.profit.computeClientProfitability(fx.biz.id, fx.label, fx.range);
  assert.equal(report.rows.find((r) => r.targetId === c.personId)?.hoursLogged, "8");
});

test("client nudges reach the Insights feed, and only when the module is on", async () => {
  const fx = await profitFixture("recon-signals");
  const c = await fx.clients.createClient(fx.biz.id, { name: "Sinkhole Co", engagement: {} });
  await fx.invoice(c.personId, 5_000_00);
  // 24 hours against Rs 5,000 of revenue: they cost far more than they pay.
  for (const day of ["2060-03-02", "2060-03-03", "2060-03-04"]) {
    await fx.timesheet.setTimesheetCell(fx.biz.id, {
      personId: fx.member.id,
      targetType: "client",
      targetId: c.personId,
      entryDate: day,
      hours: "8",
    });
  }

  const prior = { start: new Date("2059-01-01T00:00:00Z"), end: new Date("2059-12-31T23:59:59Z") };
  await setClientProfitability(fx.biz.id, true);
  const withFeature = await analytics.computeSignals(fx.biz.id, fx.label, fx.range, prior);
  const loss = withFeature.signals.find((s) => s.id === "client-loss");
  assert.ok(loss, "the loss-making client reaches the overview");
  assert.match(loss.title, /Sinkhole Co costs more than they pay/);

  // Switched off, the module contributes nothing — and the existing signals are
  // exactly as they were, not merely "mostly the same".
  await setClientProfitability(fx.biz.id, false);
  const without = await analytics.computeSignals(fx.biz.id, fx.label, fx.range, prior);
  assert.equal(without.signals.filter((s) => s.id.startsWith("client-")).length, 0);
  assert.deepEqual(
    without.signals,
    withFeature.signals.filter((s) => !s.id.startsWith("client-")),
    "every non-client signal is untouched",
  );
  await setClientProfitability(fx.biz.id, true);
});

test("a client with revenue and no hours produces a nudge that claims no margin", async () => {
  // The nudge version of the failure the whole design prevents: 100% margin is
  // the most flattering possible lie about the client most likely to be losing
  // money, and a signal is read alone with no table underneath it to check.
  const fx = await profitFixture("recon-ghost");
  await setClientProfitability(fx.biz.id, true);
  const ghost = await fx.clients.createClient(fx.biz.id, { name: "Ghost Co", engagement: {} });
  await fx.invoice(ghost.personId, 80_000_00);

  const prior = { start: new Date("2059-01-01T00:00:00Z"), end: new Date("2059-12-31T23:59:59Z") };
  const { signals } = await analytics.computeSignals(fx.biz.id, fx.label, fx.range, prior);

  assert.equal(signals.find((s) => s.id === "client-loss"), undefined);
  assert.equal(signals.find((s) => s.id === "client-best"), undefined);
  const uncosted = signals.find((s) => s.id === "client-uncosted");
  assert.ok(uncosted);
  assert.match(uncosted.plainEnglish, /no time behind it/);
  // Not one signal anywhere claims a margin for them.
  assert.ok(!signals.some((s) => /Ghost Co/.test(s.plainEnglish) && /margin/.test(s.plainEnglish)));
});

test("a broken profitability read costs its own nudges and nothing else", async () => {
  // The reconciliation guards THROW, which is right on a page whose whole job
  // is that number. Here it would take down the sidebar health chip for an
  // unrelated business-wide read, so the feed degrades instead of failing.
  const fx = await profitFixture("recon-degrade");
  await setClientProfitability(fx.biz.id, true);
  await fx.invoice((await fx.clients.createClient(fx.biz.id, { name: "Fine Co", engagement: {} })).personId, 30_000_00);

  const prior = { start: new Date("2059-01-01T00:00:00Z"), end: new Date("2059-12-31T23:59:59Z") };
  const healthy = await analytics.computeSignals(fx.biz.id, fx.label, fx.range, prior);

  // A time entry pointing at a person who is not an employee cannot be costed
  // by the report, standing in for any failure inside the module.
  await db.insert(dbModule.timeEntriesTable).values({
    id: "te_broken_recon",
    businessId: fx.biz.id,
    personId: fx.member.id,
    targetType: "client",
    targetId: "person_does_not_exist",
    entryDate: "2060-03-02",
    hours: "8",
    costRateSnapshotCents: 500_00,
    costAmountCents: 400_000,
    source: "manual",
  });

  const stillWorks = await analytics.computeSignals(fx.biz.id, fx.label, fx.range, prior);
  assert.ok(Array.isArray(stillWorks.signals), "the feed still answers");
  assert.deepEqual(
    stillWorks.signals.filter((s) => !s.id.startsWith("client-")),
    healthy.signals.filter((s) => !s.id.startsWith("client-")),
    "and every money signal is exactly as it was",
  );
});

test("a refund takes revenue back off the client who got it", async () => {
  // Found by the revenue guard on real data. Refunds were skipped entirely, so
  // a client's revenue here was their GROSS while the P&L's was net — meaning
  // the worst kind of client, the one who buys and returns, read as one of the
  // best. The guard turned that into a failing request instead of a plausible
  // number.
  const fx = await profitFixture("recon-refund");
  const c = await fx.clients.createClient(fx.biz.id, { name: "Returner Co", engagement: {} });

  const sale = await ledger.createTransaction(fx.biz.id, {
    direction: "in",
    occurredAt: new Date("2060-03-02T00:00:00Z"),
    sourceId: fx.src.id,
    personId: c.personId,
    lines: [{ revenueItemId: fx.service.id, qty: "1", unitPriceCents: 50_000_00 }],
  });
  await ledger.createRefund(fx.biz.id, {
    transactionId: sale.transaction.id,
    requests: [{ lineId: sale.lines[0].id, qtyRefunded: "1", amountRefundedCents: 20_000_00 }],
    occurredAt: new Date("2060-03-09T00:00:00Z"),
  });

  const report = await fx.profit.computeClientProfitability(fx.biz.id, fx.label, fx.range);
  const pnl = await read.computePnl(fx.biz.id, fx.label, fx.range);

  const row = report.rows.find((r) => r.targetType === "client" && r.targetId === c.personId);
  assert.equal(row?.revenueCents, 30_000_00, "Rs 50,000 sold less Rs 20,000 returned");
  assert.equal(pnl.ladder.netRevenue, 30_000_00, "and the ladder agrees");
  assert.equal(clientLensRevenue(report), pnl.ladder.netRevenue);

  // The product lens too, so a returned item stops looking like a seller.
  const item = report.rows.find((r) => r.targetType === "revenue_item" && r.targetId === fx.service.id);
  assert.equal(item?.revenueCents, 30_000_00);
});

test("a fully refunded client shows no revenue, not their gross", async () => {
  const fx = await profitFixture("recon-refund-full");
  const c = await fx.clients.createClient(fx.biz.id, { name: "Cancelled Co", engagement: {} });
  const sale = await ledger.createTransaction(fx.biz.id, {
    direction: "in",
    occurredAt: new Date("2060-03-02T00:00:00Z"),
    sourceId: fx.src.id,
    personId: c.personId,
    lines: [{ revenueItemId: fx.service.id, qty: "1", unitPriceCents: 40_000_00 }],
  });
  await ledger.createRefund(fx.biz.id, {
    transactionId: sale.transaction.id,
    requests: [{ lineId: sale.lines[0].id, qtyRefunded: "1", amountRefundedCents: 40_000_00 }],
    occurredAt: new Date("2060-03-09T00:00:00Z"),
  });

  const report = await fx.profit.computeClientProfitability(fx.biz.id, fx.label, fx.range);
  assert.equal(report.rows.find((r) => r.targetId === c.personId)?.revenueCents, 0);
  assert.equal(clientLensRevenue(report), (await read.computePnl(fx.biz.id, fx.label, fx.range)).ladder.netRevenue);
});

test("every category the database can store is one the contract can send", async () => {
  // The internal time buckets were seeded with applies_to = 'time' in Phase 1,
  // but the contract enum was never widened — so GET /categories failed its own
  // response schema and 500'd for every business that had them. A core endpoint
  // broken by a feature that never touches it.
  const contract = await import("@workspace/api-contract");
  assert.deepEqual(
    [...contract.categoryAppliesTo.options].sort(),
    [...dbModule.categoryAppliesToValues].sort(),
    "the contract's applies-to list must match the database's, exactly",
  );

  // And a business with seeded time categories really does serve them.
  const biz = await ensureBusiness("cat-enum-user");
  const rows = await db
    .select()
    .from(dbModule.categoriesTable)
    .where(and(eq(dbModule.categoriesTable.businessId, biz.id), eq(dbModule.categoriesTable.appliesTo, "time")));
  assert.ok(rows.length > 0, "the time buckets are seeded");
  for (const row of rows) {
    assert.doesNotThrow(() => contract.categoryAppliesTo.parse(row.appliesTo));
  }
});

// ---------------------------------------------------------------------------
// Acceptance test 24 — business A cannot reach business B, through anything
// ---------------------------------------------------------------------------
//
// The one class of bug in this module where being wrong is unrecoverable: one
// business reading another's salaries. Isolation here is STRUCTURAL — every
// service takes `businessId` as its first argument, and the routes get that
// from `ensureBusiness(userId)`, never from anything the caller sends. So a
// request cannot name someone else's business.
//
// Which means the real attack surface is the one thing a caller DOES choose:
// the resource ids. Authenticated as A, pass B's person id, B's engagement id,
// B's client as a time target, B's name in a CSV. Every one of those is tried
// below, against all 21 endpoints of the module, and B's data is compared
// byte-for-byte afterwards.

/** One business with a full set of records, so there is something real to steal. */
async function isolationFixture(label: string) {
  const biz = await ensureBusiness(label);
  const src = (await getManualSource(biz.id))!;
  const team = await import("./team");
  const clients = await import("@/app/api/client-profitability/functions");
  const timesheet = await import("./timesheet");
  const estimates = await import("@/app/api/client-profitability/functions");
  const timeImport = await import("@/app/api/client-profitability/functions");
  const profit = await import("./clientProfit");

  const member = await team.createTeamMember(biz.id, {
    name: `${label} Employee`,
    rate: {
      costType: "salaried",
      monthlyCostCents: 90_000_00,
      billableTargetHours: "130",
      effectiveFrom: new Date("2062-01-01T00:00:00Z"),
    },
  });
  const service = await catalog.createRevenueItem(biz.id, {
    name: `${label} service`, type: "service", pricingModel: "fixed", unitPriceCents: 1_000_00,
  });
  const client = await clients.createClient(biz.id, {
    name: `${label} Client`,
    engagement: { agreedHours: "50", agreedAmountCents: 100_000_00 },
  });
  await ledger.createTransaction(biz.id, {
    direction: "in",
    occurredAt: new Date("2062-03-02T00:00:00Z"),
    sourceId: src.id,
    personId: client.personId,
    lines: [{ revenueItemId: service.id, qty: "1", unitPriceCents: 75_000_00 }],
  });
  await timesheet.setTimesheetCell(biz.id, {
    personId: member.id, targetType: "client", targetId: client.personId,
    entryDate: "2062-03-02", hours: "8",
  });
  await estimates.setTargetEstimate(biz.id, {
    personId: member.id, targetType: "client", targetId: client.personId,
    periodStart: "2062-04-01", periodEnd: "2062-04-30", hours: "20",
  });

  const range = { start: new Date("2062-01-01T00:00:00Z"), end: new Date("2062-12-31T23:59:59Z") };
  return { biz, src, label, team, clients, timesheet, estimates, timeImport, profit, member, service, client, range };
}

/** Everything of B's that must be untouched, in a form that compares exactly. */
async function snapshotOf(businessId: string) {
  const [people, rates, engagements, entries] = await Promise.all([
    db.select().from(dbModule.peopleTable).where(eq(dbModule.peopleTable.businessId, businessId)),
    db.select().from(dbModule.teamMemberRatesTable).where(eq(dbModule.teamMemberRatesTable.businessId, businessId)),
    db.select().from(dbModule.clientEngagementsTable).where(eq(dbModule.clientEngagementsTable.businessId, businessId)),
    db.select().from(dbModule.timeEntriesTable).where(eq(dbModule.timeEntriesTable.businessId, businessId)),
  ]);
  const sort = <T extends { id: string }>(rows: T[]) => [...rows].sort((x, y) => x.id.localeCompare(y.id));
  return JSON.stringify({
    people: sort(people), rates: sort(rates), engagements: sort(engagements), entries: sort(entries),
  });
}

/** Ran it, and it neither threw nor changed anything — which is also a pass. */
async function refused(attempt: () => Promise<unknown>): Promise<"threw" | "no-op"> {
  try {
    await attempt();
    return "no-op";
  } catch {
    return "threw";
  }
}

test("acceptance 24: business A cannot READ business B through any endpoint", async () => {
  const a = await isolationFixture("iso-a");
  const b = await isolationFixture("iso-b");

  // 1. internal-categories — the route's own query, scoped the same way.
  const aCats = await db
    .select()
    .from(dbModule.categoriesTable)
    .where(and(eq(dbModule.categoriesTable.businessId, a.biz.id), eq(dbModule.categoriesTable.appliesTo, "time")));
  const bCats = await db
    .select()
    .from(dbModule.categoriesTable)
    .where(and(eq(dbModule.categoriesTable.businessId, b.biz.id), eq(dbModule.categoriesTable.appliesTo, "time")));
  assert.ok(aCats.length > 0 && bCats.length > 0, "both have seeded buckets");
  assert.equal(aCats.filter((c) => bCats.some((x) => x.id === c.id)).length, 0);

  // 2. team-members — B's employee is not in A's list, by id OR by name.
  const aMembers = await a.team.listTeamMembers(a.biz.id);
  assert.ok(aMembers.some((m) => m.id === a.member.id), "A sees its own");
  assert.equal(aMembers.filter((m) => m.id === b.member.id).length, 0);
  assert.equal(aMembers.filter((m) => m.name === "iso-b Employee").length, 0);

  // 6. rate-history for B's member, asked for as A. It REFUSES rather than
  // returning an empty list — stronger than it needs to be, and better: an
  // empty list is also what a real member with no history looks like.
  await assert.rejects(
    () => a.team.listRateHistory(a.biz.id, b.member.id),
    (err: unknown) => err instanceof ServiceError && err.code === "not_found",
  );

  // …and the direct read behind it refuses too, so nothing downstream can.
  assert.equal(await a.team.openRateFor(a.biz.id, b.member.id), null);
  assert.equal(await a.team.rateOnDate(a.biz.id, b.member.id, new Date("2062-03-02T12:00:00Z")), null);
  await assert.rejects(() => a.team.getTeamMember(a.biz.id, b.member.id));

  // 7. overhead-default — derived from A's OWN ledger and headcount.
  const overhead = await a.team.computeOverheadDefault(a.biz.id, a.label);
  assert.equal(overhead.headcount, 1, "A has one employee, not two");

  // 8. clients — B's client is not in A's list.
  const aClients = await a.clients.listClients(a.biz.id);
  assert.ok(aClients.some((c) => c.engagementId === a.client.id));
  assert.equal(aClients.filter((c) => c.engagementId === b.client.id).length, 0);
  assert.equal(aClients.filter((c) => c.personId === b.client.personId).length, 0);

  // 9. client-matches — searching B's exact client name finds nobody.
  const matches = await a.clients.findClientMatches(a.biz.id, { name: "iso-b Client" });
  assert.equal(matches.filter((m) => m.id === b.client.personId).length, 0, "no cross-business match");

  // …and the engagement read behind the PATCH refuses as well.
  await assert.rejects(() => a.clients.getEngagement(a.biz.id, b.client.id));
  assert.deepEqual(await a.clients.listEngagementsFor(a.biz.id, b.client.personId), []);
  assert.equal(await a.clients.activeEngagementFor(a.biz.id, b.client.personId), null);

  // 12. timesheet — none of B's members, targets, rows or cells.
  const sheet = await a.timesheet.getTimesheet(a.biz.id, new Date("2062-03-02T00:00:00Z"));
  assert.equal(sheet.members.filter((m) => m.id === b.member.id).length, 0);
  assert.equal(sheet.targets.filter((t) => t.targetId === b.client.personId).length, 0);
  assert.equal(sheet.rows.filter((r) => r.personId === b.member.id).length, 0);
  assert.equal(sheet.cells.filter((c) => c.personId === b.member.id).length, 0);
  assert.ok(sheet.cells.some((c) => c.personId === a.member.id), "A still sees its own");

  // 20. estimates — B's estimate is not in A's list.
  const listed = await a.estimates.listTargetEstimates(a.biz.id);
  assert.equal(listed.filter((e) => e.personId === b.member.id).length, 0);
  assert.ok(listed.some((e) => e.personId === a.member.id), "A still sees its own");

  // 21. profitability — no row, no revenue and no hours belonging to B.
  const report = await a.profit.computeClientProfitability(a.biz.id, a.label, a.range);
  assert.equal(report.rows.filter((r) => r.targetId === b.client.personId).length, 0);
  assert.equal(report.rows.filter((r) => r.label.includes("iso-b")).length, 0);
  assert.equal(report.utilization.byMember.filter((m) => m.personId === b.member.id).length, 0);
  // A's own numbers are its own, not the pair's.
  const own = report.rows.find((r) => r.targetId === a.client.personId);
  assert.equal(own?.revenueCents, 75_000_00, "A's revenue only");
  assert.equal(report.coverage.attributedCents, own?.labourCostCents ?? -1);
});

test("acceptance 24: business A cannot WRITE to business B through any endpoint", async () => {
  const a = await isolationFixture("iso-w-a");
  const b = await isolationFixture("iso-w-b");
  const before = await snapshotOf(b.biz.id);

  // Every write below is attempted as A, aimed at one of B's records.
  const attempts: Array<[string, () => Promise<unknown>]> = [
    // 4. rename B's employee
    ["updateTeamMember", () => a.team.updateTeamMember(a.biz.id, b.member.id, { name: "Renamed by A" })],
    // 4b. archive B's employee
    ["archiveTeamMember", () => a.team.updateTeamMember(a.biz.id, b.member.id, { status: "archived" })],
    // 5. give B's employee a new pay rate
    [
      "setTeamMemberRate",
      () =>
        a.team.setTeamMemberRate(a.biz.id, b.member.id, {
          costType: "salaried", monthlyCostCents: 1_00, billableTargetHours: "130",
          effectiveFrom: new Date("2062-06-01T00:00:00Z"),
        }),
    ],
    // 10. adopt B's person as A's client
    ["createClient(personId)", () => a.clients.createClient(a.biz.id, { personId: b.client.personId, engagement: {} })],
    // 11. rewrite B's agreed terms
    [
      "updateClientEngagement",
      () => a.clients.updateEngagement(a.biz.id, b.client.id, { agreedAmountCents: 1_00, engagementStatus: "churned" }),
    ],
    // 13. log hours for B's employee
    [
      "setTimesheetCell(B person)",
      () =>
        a.timesheet.setTimesheetCell(a.biz.id, {
          personId: b.member.id, targetType: "client", targetId: b.client.personId,
          entryDate: "2062-03-03", hours: "8",
        }),
    ],
    // 13b. log A's own employee against B's client
    [
      "setTimesheetCell(B target)",
      () =>
        a.timesheet.setTimesheetCell(a.biz.id, {
          personId: a.member.id, targetType: "client", targetId: b.client.personId,
          entryDate: "2062-03-03", hours: "8",
        }),
    ],
    // 14. wipe a week of B's hours
    [
      "clearTimesheetRow",
      () =>
        a.timesheet.clearTimesheetRow(a.biz.id, {
          personId: b.member.id, targetType: "client", targetId: b.client.personId, weekStart: "2062-02-27",
        }),
    ],
    // 16. import hours onto B's people by mapping their id in
    [
      "commitTimeImport(personMap)",
      () =>
        a.timeImport.commitTimeImport(a.biz.id, {
          csv: ["User,Client,Start date,Duration", "Whoever,iso-w-b Client,2062-03-04,08:00:00"].join("\n"),
          personMap: { Whoever: b.member.id },
          targetMap: { "iso-w-b Client": `client:${b.client.personId}` },
        }),
    ],
    // 18. estimate hours onto B's employee and client
    [
      "setTargetEstimate",
      () =>
        a.estimates.setTargetEstimate(a.biz.id, {
          personId: b.member.id, targetType: "client", targetId: b.client.personId,
          periodStart: "2062-05-01", periodEnd: "2062-05-31", hours: "40",
        }),
    ],
    // 19. delete B's estimate
    [
      "clearTargetEstimate",
      () =>
        a.estimates.clearTargetEstimate(a.biz.id, {
          personId: b.member.id, targetType: "client", targetId: b.client.personId,
          periodStart: "2062-04-01", periodEnd: "2062-04-30",
        }),
    ],
  ];

  const outcomes: Record<string, string> = {};
  for (const [name, attempt] of attempts) outcomes[name] = await refused(attempt);

  // Refusing loudly and doing nothing are both acceptable. Succeeding is not,
  // and that is what the snapshot decides.
  assert.equal(await snapshotOf(b.biz.id), before, `B's data changed. Outcomes: ${JSON.stringify(outcomes)}`);

  // Spelled out for the ones where a silent no-op would be easy to mistake for
  // a pass: B's employee still has their name, their pay, and their hours.
  const [bMember] = await db
    .select()
    .from(dbModule.peopleTable)
    .where(eq(dbModule.peopleTable.id, b.member.id));
  assert.equal(bMember.displayName, "iso-w-b Employee");
  assert.equal(bMember.status, "active");

  const bRates = await db
    .select()
    .from(dbModule.teamMemberRatesTable)
    .where(eq(dbModule.teamMemberRatesTable.personId, b.member.id));
  assert.equal(bRates.length, 1, "no second rate version was opened");
  assert.equal(bRates[0].monthlyCostCents, 90_000_00, "and the pay is untouched");

  const [bEngagement] = await db
    .select()
    .from(dbModule.clientEngagementsTable)
    .where(eq(dbModule.clientEngagementsTable.id, b.client.id));
  assert.equal(bEngagement.engagementStatus, "active");
  assert.equal(bEngagement.agreedAmountCents, 100_000_00);

  const bEntries = await db
    .select()
    .from(dbModule.timeEntriesTable)
    .where(eq(dbModule.timeEntriesTable.businessId, b.biz.id));
  assert.ok(bEntries.length > 1, "the logged day and the estimate are both still there");
  assert.ok(bEntries.some((e) => e.entryDate === "2062-03-02" && e.hours === "8"));
  assert.ok(bEntries.some((e) => e.source === "estimate"));
  assert.equal(bEntries.filter((e) => e.entryDate === "2062-03-03").length, 0, "nothing new was written");
});

test("acceptance 24: an import run by A cannot resolve B's people or clients by NAME", async () => {
  // The subtler path: not passing B's ids, but naming B's staff and clients in
  // a CSV and letting the matcher find them. It must not — an unknown name is
  // reported as unmatched, which is what the whole import design is built on.
  const a = await isolationFixture("iso-n-a");
  const b = await isolationFixture("iso-n-b");
  const before = await snapshotOf(b.biz.id);

  const csv = [
    "User,Client,Start date,Duration",
    "iso-n-b Employee,iso-n-b Client,2062-03-05,08:00:00",
  ].join("\n");

  const preview = await a.timeImport.previewTimeImport(a.biz.id, { csv });
  assert.equal(preview.canCommit, false, "neither name resolves");
  assert.equal(preview.unmatchedPeople.length, 1);
  assert.equal(preview.unmatchedPeople[0].name, "iso-n-b Employee");
  assert.equal(preview.unmatchedTargets.length, 1);
  assert.equal(preview.unmatchedTargets[0].name, "iso-n-b Client");
  // And no suggestion points into B either.
  assert.equal(preview.unmatchedPeople[0].suggestions.filter((s) => s.id === b.member.id).length, 0);
  assert.equal(
    preview.unmatchedTargets[0].suggestions.filter((s) => s.id === `client:${b.client.personId}`).length,
    0,
  );

  await assert.rejects(() => a.timeImport.commitTimeImport(a.biz.id, { csv }));

  // The estimate preview refuses B's employee by id as well, before writing.
  const est = await refused(() =>
    a.estimates.previewEstimate(a.biz.id, {
      personId: b.member.id, targetType: "client", targetId: b.client.personId,
      periodStart: "2062-06-01", periodEnd: "2062-06-30", hours: "10",
    }),
  );
  assert.equal(est, "threw");

  assert.equal(await snapshotOf(b.biz.id), before, "B is untouched by any of it");
});

test("acceptance 24 (control): every one of those writes SUCCEEDS on your own data", async () => {
  // Without this the isolation test could pass for the wrong reason. A call
  // that throws because its arguments are malformed looks exactly like a call
  // that throws because the record belongs to someone else — and a typo in the
  // test would read as proof of security. So the same eleven operations run
  // against the business's OWN records, and every one must work.
  const own = await isolationFixture("iso-ctl");

  await own.team.updateTeamMember(own.biz.id, own.member.id, { name: "Renamed by self" });
  const [renamed] = await db
    .select()
    .from(dbModule.peopleTable)
    .where(eq(dbModule.peopleTable.id, own.member.id));
  assert.equal(renamed.displayName, "Renamed by self");

  await own.team.setTeamMemberRate(own.biz.id, own.member.id, {
    costType: "salaried", monthlyCostCents: 95_000_00, billableTargetHours: "130",
    effectiveFrom: new Date("2062-06-01T00:00:00Z"),
  });
  assert.equal((await own.team.listRateHistory(own.biz.id, own.member.id)).length, 2, "a second rate version opened");

  await own.clients.updateEngagement(own.biz.id, own.client.id, { agreedAmountCents: 111_00 });
  const [engagement] = await db
    .select()
    .from(dbModule.clientEngagementsTable)
    .where(eq(dbModule.clientEngagementsTable.id, own.client.id));
  assert.equal(engagement.agreedAmountCents, 111_00);

  await own.timesheet.setTimesheetCell(own.biz.id, {
    personId: own.member.id, targetType: "client", targetId: own.client.personId,
    entryDate: "2062-03-03", hours: "8",
  });
  assert.equal(
    (await db.select().from(dbModule.timeEntriesTable).where(eq(dbModule.timeEntriesTable.entryDate, "2062-03-03")))
      .filter((e) => e.businessId === own.biz.id).length,
    1,
    "the cell really was written",
  );

  const imported = await own.timeImport.commitTimeImport(own.biz.id, {
    csv: ["User,Client,Start date,Duration", "Whoever,iso-ctl Client,2062-03-04,08:00:00"].join("\n"),
    personMap: { Whoever: own.member.id },
    targetMap: { "iso-ctl Client": `client:${own.client.personId}` },
  });
  assert.equal(imported.added, 1, "the import lands on your own people");

  await own.estimates.setTargetEstimate(own.biz.id, {
    personId: own.member.id, targetType: "client", targetId: own.client.personId,
    periodStart: "2062-05-01", periodEnd: "2062-05-31", hours: "40",
  });
  assert.ok((await own.estimates.listTargetEstimates(own.biz.id)).some((e) => e.hours === "40"));

  // And the two that are SILENT no-ops across a business boundary really do
  // delete when they are pointed at your own records — which is what makes
  // their silence in the isolation test meaningful rather than accidental.
  const clearedRow = await own.timesheet.clearTimesheetRow(own.biz.id, {
    personId: own.member.id, targetType: "client", targetId: own.client.personId, weekStart: "2062-02-27",
  });
  const leftInWeek = (
    await db.select().from(dbModule.timeEntriesTable).where(eq(dbModule.timeEntriesTable.businessId, own.biz.id))
  ).filter((e) => e.entryDate >= "2062-03-02" && e.entryDate <= "2062-03-04");
  assert.equal(leftInWeek.length, 0, "clearTimesheetRow deletes when it is your own row");
  void clearedRow;

  const clearedEstimate = await own.estimates.clearTargetEstimate(own.biz.id, {
    personId: own.member.id, targetType: "client", targetId: own.client.personId,
    periodStart: "2062-04-01", periodEnd: "2062-04-30",
  });
  assert.ok(clearedEstimate.removed > 0, "clearTargetEstimate deletes when it is your own estimate");

  // createClient adopting an existing person of your own is the supported path.
  const adopted = await ensureBusiness("iso-ctl");
  const stranger = await findOrCreatePerson(adopted.id, { name: "Walk-in Co", kind: "customer" });
  const engagementForStranger = await own.clients.createClient(own.biz.id, {
    personId: stranger.id,
    engagement: {},
  });
  assert.equal(engagementForStranger.personId, stranger.id, "adopting your OWN person works");

  // Archiving last, because it changes what the other calls can see.
  await own.team.updateTeamMember(own.biz.id, own.member.id, { status: "archived" });
  const [archived] = await db
    .select()
    .from(dbModule.peopleTable)
    .where(eq(dbModule.peopleTable.id, own.member.id));
  assert.equal(archived.status, "archived");
});

// ---------------------------------------------------------------------------
// Finishing a client stops new hours — and changes nothing else
// ---------------------------------------------------------------------------

test("a client marked Finished keeps their scope-creep record", async () => {
  // The bug: the report read agreed hours from the ACTIVE engagement only, so
  // marking a client done erased "you went over on them" — at exactly the
  // moment the owner would sit down to review it. Their hours and revenue were
  // still counted everywhere else, which is what made it so easy to miss.
  const fx = await profitFixture("eng-finished");
  const client = await fx.clients.createClient(fx.biz.id, {
    name: "Overrun Co",
    engagement: { agreedHours: "10", agreedAmountCents: 50_000_00 },
  });
  await fx.invoice(client.personId, 50_000_00);
  await fx.timesheet.setTimesheetCell(fx.biz.id, {
    personId: fx.member.id, targetType: "client", targetId: client.personId,
    entryDate: "2060-03-02", hours: "20",
  });

  const whileLive = await fx.profit.computeClientProfitability(fx.biz.id, fx.label, fx.range);
  const before = whileLive.scopeCreep.find((c) => c.targetId === client.personId);
  assert.ok(before, "over the hours while the arrangement is live");
  assert.equal(before.overPct, 100);

  await fx.clients.updateEngagement(fx.biz.id, client.id, { engagementStatus: "completed" });

  const whenDone = await fx.profit.computeClientProfitability(fx.biz.id, fx.label, fx.range);
  const after = whenDone.scopeCreep.find((c) => c.targetId === client.personId);
  assert.ok(after, "and still over after it is marked Finished");
  assert.equal(after.overPct, before.overPct, "the same figure, not a different one");
  assert.equal(after.engagementStatus, "completed", "so the wording can say 'was over'");
});

test("a finished client's hours keep their name on the grid and in estimates", async () => {
  // The row used to rename itself to "(removed)" mid-week, as though the client
  // had gone rather than the arrangement.
  const fx = await profitFixture("eng-label");
  const client = await fx.clients.createClient(fx.biz.id, { name: "Renamed Co", engagement: {} });
  await fx.timesheet.setTimesheetCell(fx.biz.id, {
    personId: fx.member.id, targetType: "client", targetId: client.personId,
    entryDate: "2060-03-02", hours: "4",
  });
  const estimates = await import("@/app/api/client-profitability/functions");
  await estimates.setTargetEstimate(fx.biz.id, {
    personId: fx.member.id, targetType: "client", targetId: client.personId,
    periodStart: "2060-04-01", periodEnd: "2060-04-30", hours: "10",
  });

  await fx.clients.updateEngagement(fx.biz.id, client.id, { engagementStatus: "churned" });

  const sheet = await fx.timesheet.getTimesheet(fx.biz.id, new Date("2060-03-02T00:00:00Z"));
  const row = sheet.rows.find((r) => r.targetId === client.personId);
  assert.equal(row?.label, "Renamed Co", "not (removed)");

  const listed = await estimates.listTargetEstimates(fx.biz.id);
  assert.equal(listed.find((e) => e.targetId === client.personId)?.targetLabel, "Renamed Co");

  // And the picker still refuses to offer them, which is what the warning promises.
  assert.equal(sheet.targets.filter((t) => t.targetId === client.personId).length, 0);
});

test("an ARCHIVED product keeps its name too — the same bug, one line away", async () => {
  const fx = await profitFixture("eng-archived-item");
  await fx.timesheet.setTimesheetCell(fx.biz.id, {
    personId: fx.member.id, targetType: "revenue_item", targetId: fx.service.id,
    entryDate: "2060-03-02", hours: "6",
  });
  await catalog.updateRevenueItem(fx.biz.id, fx.service.id, { status: "archived" });

  const sheet = await fx.timesheet.getTimesheet(fx.biz.id, new Date("2060-03-02T00:00:00Z"));
  const row = sheet.rows.find((r) => r.targetId === fx.service.id);
  assert.equal(row?.label, `${fx.label} service`, "not (removed)");
});

test("the warning is true: a finished client still refuses new hours", async () => {
  // The Clients dialog now promises that Finished and Left stop new hours. If
  // this ever stops throwing, that promise becomes a lie and this test says so.
  const fx = await profitFixture("eng-refuse");
  const client = await fx.clients.createClient(fx.biz.id, { name: "Closed Co", engagement: {} });
  await fx.clients.updateEngagement(fx.biz.id, client.id, { engagementStatus: "completed" });

  const cell = {
    personId: fx.member.id, targetType: "client" as const, targetId: client.personId,
    entryDate: "2060-03-03", hours: "4",
  };
  await assert.rejects(
    () => fx.timesheet.setTimesheetCell(fx.biz.id, cell),
    (err: unknown) => err instanceof ServiceError && err.code === "not_found",
  );

  // All three ways hours arrive, as the warning claims.
  const estimates = await import("@/app/api/client-profitability/functions");
  await assert.rejects(() =>
    estimates.setTargetEstimate(fx.biz.id, {
      personId: fx.member.id, targetType: "client", targetId: client.personId,
      periodStart: "2060-05-01", periodEnd: "2060-05-31", hours: "10",
    }),
  );

  const timeImport = await import("@/app/api/client-profitability/functions");
  const preview = await timeImport.previewTimeImport(fx.biz.id, {
    csv: ["User,Client,Start date,Duration", `${fx.label} Dev,Closed Co,2060-03-04,04:00:00`].join("\n"),
  });
  assert.equal(preview.canCommit, false, "and the importer will not resolve them either");
});

// ---------------------------------------------------------------------------
// Agreed figures carry their own basis
// ---------------------------------------------------------------------------

test("a monthly agreement scales to the window, and the hourly price does not", async () => {
  // The single best proof the design is right: change the date filter and the
  // agreed hours move, while "you priced this at Rs X an hour" stays put.
  const fx = await profitFixture("eng-monthly");
  const client = await fx.clients.createClient(fx.biz.id, {
    name: "Retainer Co",
    engagement: {
      agreedHours: "40",
      agreedHoursPeriod: "monthly",
      agreedAmountCents: 200_000_00,
      agreedAmountPeriod: "monthly",
    },
  });
  await fx.invoice(client.personId, 200_000_00);
  await fx.timesheet.setTimesheetCell(fx.biz.id, {
    personId: fx.member.id, targetType: "client", targetId: client.personId,
    entryDate: "2060-03-02", hours: "24",
  });

  const march = await fx.profit.computeClientProfitability(fx.biz.id, fx.label, {
    start: new Date("2060-03-01T00:00:00Z"), end: new Date("2060-03-31T00:00:00Z"),
  });
  const quarter = await fx.profit.computeClientProfitability(fx.biz.id, fx.label, {
    start: new Date("2060-01-01T00:00:00Z"), end: new Date("2060-03-31T00:00:00Z"),
  });

  const inMarch = march.scopeCreep.find((c) => c.targetId === client.personId);
  const inQuarter = quarter.scopeCreep.find((c) => c.targetId === client.personId);

  // One month of a 40-hour agreement is 40; three months is 120.
  assert.equal(inMarch?.agreedHours, "40");
  assert.equal(inQuarter?.agreedHours, "120");
  assert.equal(inMarch?.agreedHoursPerPeriod, "40", "what the owner actually typed, either way");
  assert.equal(inQuarter?.agreedHoursPerPeriod, "40");
  assert.equal(inMarch?.periodMonths, "1");
  assert.equal(inQuarter?.periodMonths, "3");

  // THE assertion. Rs 200,000 ÷ 40 = Rs 5,000, in both windows.
  assert.equal(inMarch?.agreedHourlyRateCents, 5_000_00);
  assert.equal(
    inQuarter?.agreedHourlyRateCents,
    inMarch?.agreedHourlyRateCents,
    "the price must not move when the date filter does",
  );
  assert.equal(inMarch?.rateReason, "ok");
});

test("a figure agreed in total is untouched by the window", async () => {
  // The default, and today's behaviour: 60 hours for the job is 60 hours
  // whatever range is on screen.
  const fx = await profitFixture("eng-total");
  const client = await fx.clients.createClient(fx.biz.id, {
    name: "Fixed Co",
    engagement: { agreedHours: "10", agreedAmountCents: 50_000_00 },
  });
  await fx.invoice(client.personId, 50_000_00);
  await fx.timesheet.setTimesheetCell(fx.biz.id, {
    personId: fx.member.id, targetType: "client", targetId: client.personId,
    entryDate: "2060-03-02", hours: "20",
  });

  for (const range of [
    { start: new Date("2060-03-01T00:00:00Z"), end: new Date("2060-03-31T00:00:00Z") },
    { start: new Date("2060-01-01T00:00:00Z"), end: new Date("2060-12-31T00:00:00Z") },
  ]) {
    const report = await fx.profit.computeClientProfitability(fx.biz.id, fx.label, range);
    const creep = report.scopeCreep.find((c) => c.targetId === client.personId);
    assert.equal(creep?.agreedHours, "10", "unscaled, whatever the window");
    assert.equal(creep?.agreedHoursPeriod, "total");
    assert.equal(creep?.agreedHourlyRateCents, 5_000_00);
  }
});

test("mixed bases with no dates give a reason, not an invented hourly price", async () => {
  // Forty hours a month against a fixed total fee: the ratio means nothing
  // until both sit on one basis, and that needs the length of the contract.
  const fx = await profitFixture("eng-mixed");
  const client = await fx.clients.createClient(fx.biz.id, {
    name: "Mixed Co",
    engagement: {
      agreedHours: "40",
      agreedHoursPeriod: "monthly",
      agreedAmountCents: 1_200_000_00,
      agreedAmountPeriod: "total",
    },
  });
  await fx.invoice(client.personId, 200_000_00);
  // 60 hours against a 40-a-month agreement, spread over three days because a
  // single day cannot hold more than 24.
  for (const day of ["2060-03-02", "2060-03-03", "2060-03-04"]) {
    await fx.timesheet.setTimesheetCell(fx.biz.id, {
      personId: fx.member.id, targetType: "client", targetId: client.personId,
      entryDate: day, hours: "20",
    });
  }
  const march = { start: new Date("2060-03-01T00:00:00Z"), end: new Date("2060-03-31T00:00:00Z") };

  const noDates = await fx.profit.computeClientProfitability(fx.biz.id, fx.label, march);
  const undated = noDates.scopeCreep.find((c) => c.targetId === client.personId);
  assert.equal(undated?.agreedHours, "40", "the overrun is still measurable");
  assert.equal(undated?.overPct, 50);
  assert.equal(undated?.agreedHourlyRateCents, null, "but the price is not invented");
  assert.equal(undated?.rateReason, "needs_dates");

  // Give it a six-month contract and the price becomes knowable.
  await fx.clients.updateEngagement(fx.biz.id, client.id, {
    startDate: "2060-01-01",
    endDate: "2060-06-30",
  });
  const dated = await fx.profit.computeClientProfitability(fx.biz.id, fx.label, march);
  const priced = dated.scopeCreep.find((c) => c.targetId === client.personId);
  // Rs 1,200,000 over 40 × 6 = 240 hours → Rs 5,000/hr.
  assert.equal(priced?.agreedHourlyRateCents, 5_000_00);
  assert.equal(priced?.rateReason, "ok");
});

test("the agreed periods round-trip, and nonsense is refused", async () => {
  const fx = await profitFixture("eng-roundtrip");
  const client = await fx.clients.createClient(fx.biz.id, {
    name: "Basis Co",
    engagement: { agreedHours: "40", agreedHoursPeriod: "monthly", agreedAmountCents: 1_00 },
  });

  const [listed] = (await fx.clients.listClients(fx.biz.id)).filter((c) => c.engagementId === client.id);
  assert.equal(listed.agreedHoursPeriod, "monthly");
  assert.equal(listed.agreedAmountPeriod, "total", "each figure answers for itself");

  await assert.rejects(
    () => fx.clients.updateEngagement(fx.biz.id, client.id, { agreedHoursPeriod: "quarterly" as "total" }),
    ServiceError,
  );
});

test("logging hours against a monthly agreement does not move the profit ladder", async () => {
  // The distribution rule holds through all of this: none of it is a cost.
  const fx = await profitFixture("eng-ladder");
  const client = await fx.clients.createClient(fx.biz.id, {
    name: "Steady Co",
    engagement: { agreedHours: "40", agreedHoursPeriod: "monthly", agreedAmountCents: 200_000_00, agreedAmountPeriod: "monthly" },
  });
  await fx.invoice(client.personId, 200_000_00);

  const before = await read.computePnl(fx.biz.id, fx.label, fx.range);
  await fx.timesheet.setTimesheetCell(fx.biz.id, {
    personId: fx.member.id, targetType: "client", targetId: client.personId,
    entryDate: "2060-03-02", hours: "8",
  });
  await fx.clients.updateEngagement(fx.biz.id, client.id, { engagementStatus: "completed" });
  const after = await read.computePnl(fx.biz.id, fx.label, fx.range);

  assert.deepEqual(after.ladder, before.ladder);
});

test("a person's live commitments name each posting once, and only the ones that still post", async () => {
  const user = "commit-user";
  const biz = await ensureBusiness(user);
  const src = (await getManualSource(biz.id))!;
  const person = await findOrCreatePerson(biz.id, { name: "Commit Customer", kind: "customer" });
  const recurring = await import("./recurring");
  const subs = await import("./subscription");
  const { listPersonCommitments } = await import("./person");

  const seat = await catalog.createRevenueItem(biz.id, {
    name: "Seat licence",
    type: "subscription",
    pricingModel: "fixed",
    unitPriceCents: 1_500_00,
  });
  const retainer = await catalog.createRevenueItem(biz.id, {
    name: "Support retainer",
    type: "service",
    pricingModel: "fixed",
    unitPriceCents: 900_00,
  });

  // Nothing scheduled yet: archiving them would stop nothing, so warn about nothing.
  assert.deepEqual(await listPersonCommitments(biz.id, person.id), []);

  // A subscription is BACKED by a schedule. Both rows point at this person, and
  // the pair must be reported as one posting, labelled as the subscription.
  const seatSchedule = await recurring.createSchedule(biz.id, {
    direction: "in",
    revenueItemId: seat.id,
    personId: person.id,
    sourceId: src.id,
    interval: "monthly",
    startDate: new Date("2046-01-01T00:00:00Z"),
  });
  await subs.createSubscription(biz.id, {
    revenueItemId: seat.id,
    personId: person.id,
    scheduleId: seatSchedule.id,
    startedAt: new Date("2046-01-01T00:00:00Z"),
  });

  const one = await listPersonCommitments(biz.id, person.id);
  assert.equal(one.length, 1, "a subscription and its schedule are one posting, not two");
  assert.equal(one[0].kind, "subscription");
  assert.equal(one[0].itemName, "Seat licence");

  // A plain schedule with no subscription behind it reads as recurring.
  await recurring.createSchedule(biz.id, {
    direction: "in",
    revenueItemId: retainer.id,
    personId: person.id,
    sourceId: src.id,
    interval: "weekly",
    intervalCount: 2,
    startDate: new Date("2046-01-05T00:00:00Z"),
  });
  const two = await listPersonCommitments(biz.id, person.id);
  assert.equal(two.length, 2);
  assert.equal(two.filter((c) => c.kind === "recurring").length, 1);
  assert.equal(two.filter((c) => c.kind === "subscription").length, 1);

  // Pausing the schedule stops the posting, so it stops being a warning. This is
  // the point of keying on the schedule: a subscription row still says "active",
  // but the engine selects on the SCHEDULE and would post nothing.
  await recurring.setScheduleStatus(biz.id, seatSchedule.id, "paused");
  const afterPause = await listPersonCommitments(biz.id, person.id);
  assert.equal(afterPause.length, 1, "a paused schedule posts nothing and must not be warned about");
  assert.equal(afterPause[0].kind, "recurring");

  // Somebody else's schedule is never this person's problem.
  const other = await findOrCreatePerson(biz.id, { name: "Commit Bystander", kind: "customer" });
  assert.deepEqual(await listPersonCommitments(biz.id, other.id), []);
});

/**
 * A refund lands in one period; the sale it unwinds happened in an earlier one.
 *
 * Both the item stats and the leaks report resolve a refund back to its item
 * through the ORIGINAL line, which by definition may sit outside the window
 * being reported on. They used to guarantee that by loading every line in the
 * business on every call — correct, but it read the whole ledger to answer a
 * question about a handful of refunds, and grew forever. Now only the
 * referenced originals are fetched, so this is the case that proves the
 * narrower query still reaches back past the window's start.
 */
test("a refund still names its item when the sale it unwinds is outside the period", async () => {
  const item = await catalog.createRevenueItem(businessId, {
    name: "Cross-period widget",
    type: "product",
    pricingModel: "fixed",
    unitPriceCents: 100_00,
  });

  // Sold in May.
  const sale = await ledger.createTransaction(businessId, {
    direction: "in",
    occurredAt: new Date("2038-05-10T00:00:00Z"),
    sourceId: manualSourceId,
    lines: [{ revenueItemId: item.id, qty: "1" }],
  });

  // Refunded in June — a different period entirely.
  await ledger.createRefund(businessId, {
    transactionId: sale.transaction.id,
    requests: [{ lineId: sale.lines[0].id, qtyRefunded: "1", amountRefundedCents: 100_00 }],
    occurredAt: new Date("2038-06-12T00:00:00Z"),
  });

  const june = { start: new Date("2038-06-01T00:00:00Z"), end: new Date("2038-06-30T23:59:59Z") };
  const may = { start: new Date("2038-05-01T00:00:00Z"), end: new Date("2038-05-31T23:59:59Z") };

  // The item stats for June must carry the refund, even though June contains no
  // sale of this item at all.
  const report = await read.listRevenueItemsWithStats(businessId, "test-user", june, "active");
  const stats = report.items.find((i) => i.id === item.id);
  assert.ok(stats, "the item is still reportable in a period it only had a refund in");
  assert.equal(
    stats.stats.refundedCents,
    100_00,
    "the refund resolved back to its item across the period boundary",
  );

  // And the leaks report must name it rather than dropping it into the void.
  const leaks = await analytics.computeLeaks(businessId, "test-user", june, may);
  const named = leaks.refunds.byItem.find((r) => r.name === "Cross-period widget");
  assert.ok(named, `leaks named: ${leaks.refunds.byItem.map((r) => r.name).join(", ") || "(nothing)"}`);
  assert.equal(named.cents, 100_00);
});

/**
 * A breakdown must add up to the rung it breaks down.
 *
 * Both halves of `computePnl` had drifted from `computeProfitLadder`, in
 * opposite directions and for the same underlying reason — each had quietly
 * kept its own opinion of a rule the ladder already owned:
 *
 *   · REVENUE. The ladder skips a deposit taken, because cash in before the
 *     work is not revenue yet. The type/category/source groups added it. On the
 *     construction demo the P&L read "Gross revenue Rs 11,991,591.88" with
 *     "Where revenue came from" directly beneath it reading Rs 12,391,591.88 —
 *     Rs 400,000 apart, on the same screen, at the same moment.
 *
 *   · EXPENSES. The ladder counts a non-refund line on an adjustment (a
 *     chargeback fee) as a period expense. The expense-type groups skipped
 *     every adjustment header, so the "what the period cost" block came up
 *     short by exactly that fee — on screen and in both exported reports, where
 *     an accountant adding the rows gets a different number from the line above
 *     them.
 *
 * One fixture holding both, and four assertions of the same shape. This is the
 * guard; the two fixes are only how it passes today.
 */
test("every P&L breakdown sums EXACTLY to the rung it explains", async () => {
  const source = await catalog.createSource(businessId, { name: "Recon channel", kind: "manual" });
  const item = await catalog.createRevenueItem(businessId, {
    name: "Recon service",
    type: "service",
    pricingModel: "fixed",
    unitPriceCents: 500_00,
  });

  const range = { start: new Date("2026-10-01T00:00:00Z"), end: new Date("2026-10-31T23:59:59Z") };
  const on = (day: string) => new Date(`2026-10-${day}T10:00:00Z`);

  // An ordinary sale — the part every version of this got right.
  const sale = await ledger.createTransaction(businessId, {
    direction: "in",
    occurredAt: on("05"),
    sourceId: source.id,
    lines: [{ revenueItemId: item.id, qty: "1", unitPriceCents: 500_00 }],
  });

  // A deposit taken. Real money in, and NOT revenue until the work is done.
  await ledger.createTransaction(businessId, {
    direction: "in",
    occurredAt: on("06"),
    paidAt: on("06"),
    sourceId: source.id,
    lines: [{ label: "Deposit for November", qty: "1", unitPriceCents: 200_00, isAdvance: true }],
  });

  // A chargeback on the sale, carrying a fee. The fee is a real cost that
  // reverses no sale line, so the ladder counts it as a period expense.
  await ledger.createRefund(businessId, {
    transactionId: sale.transaction.id,
    adjustmentType: "chargeback",
    chargebackFeeCents: 25_00,
    occurredAt: on("20"),
    requests: [{ lineId: sale.lines[0].id, qtyRefunded: "1", amountRefundedCents: 500_00 }],
  });

  const pnl = await read.computePnl(businessId, "test-user", range);
  const sum = (rows: Array<{ amountCents: number }>) => rows.reduce((total, row) => total + row.amountCents, 0);

  for (const axis of ["type", "category", "source"] as const) {
    assert.equal(
      sum(pnl.revenueGroups[axis]),
      pnl.ladder.grossRevenue,
      `revenue by ${axis} does not add up to Gross revenue`,
    );
  }
  assert.equal(
    sum(pnl.expenseGroups),
    pnl.ladder.periodExpenses,
    "the expense-type breakdown does not add up to Period expenses",
  );

  // And the figures are the ones expected, so the test cannot pass by both
  // sides being wrong together: the sale is revenue, the deposit is not, and
  // the chargeback fee is the period's only cost.
  assert.equal(pnl.ladder.grossRevenue, 500_00, "the deposit must not be counted as revenue");
  assert.equal(pnl.ladder.periodExpenses, 25_00, "the chargeback fee is a period expense");
});
