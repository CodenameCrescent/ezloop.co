/**
 * Integration tests: ad spend against a REAL Postgres (profit_loop_test).
 *
 * The load-bearing test in this file is "ad spend reaches True profit". Ad
 * spend used to live in a table of its own, which `computeProfitLadder` never
 * read — so True profit silently excluded the whole ad budget. The fix was to
 * stop having a separate table at all; this file is what stops anyone
 * reintroducing one without noticing.
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
const { db, pool, sourcesTable, transactionsTable } = dbModule;
const { migrate } = await import("drizzle-orm/node-postgres/migrator");
const { and, eq } = await import("drizzle-orm");
const { ensureBusiness, getManualSource } = await import("./business");
const catalog = await import("./catalog");
const ledger = await import("./ledger");
const read = await import("./read");
const adSpend = await import("./adSpend");
const { ServiceError } = await import("./errors");

const MIGRATIONS = path.join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..", "..", "drizzle", "migrations");

const DAY = (d: string) => new Date(`${d}T12:00:00Z`);
const PERIOD = { start: new Date("2026-03-01T00:00:00Z"), end: new Date("2026-03-31T23:59:59Z") };

let businessId: string;
let manualSourceId: string;

before(async () => {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE ${TEST_DB_NAME}`);
  } catch (err) {
    if ((err as { code?: string }).code !== "42P04") throw err; // already exists
  }
  await admin.end();

  await migrate(db, { migrationsFolder: MIGRATIONS });
  await db.execute(
    `TRUNCATE transaction_lines, transactions, cost_components, revenue_item_sources, revenue_items, expense_items, categories, sources, businesses CASCADE`,
  );

  const business = await ensureBusiness("ad-spend-user");
  businessId = business.id;
  manualSourceId = (await getManualSource(businessId))!.id;
});

after(async () => {
  await pool.end();
});

test("logging spend creates an ad_platform source and the Advertising item once", async () => {
  await adSpend.logAdSpend(businessId, {
    platform: "Meta Ads",
    spentOn: DAY("2026-03-05"),
    amountCents: 220_00,
    campaign: "Retargeting – broad",
  });
  await adSpend.logAdSpend(businessId, {
    platform: "Meta Ads",
    spentOn: DAY("2026-03-06"),
    amountCents: 180_00,
  });

  const platforms = await adSpend.listAdPlatforms(businessId);
  assert.equal(platforms.length, 1, "the second log adopts the existing source, it does not make a second one");
  assert.equal(platforms[0].name, "Meta Ads");
  assert.equal(platforms[0].kind, "ad_platform");

  // One shared Advertising item, so every ad line rolls up under one name.
  const item = await catalog.findExpenseItemByName(businessId, "Advertising");
  assert.ok(item);
  assert.equal(item.type, "marketing");
  // Load-bearing: break-even folds VARIABLE period expenses into the margin.
  // Booked as fixed, ads would push the break-even point out and every
  // margin-adjusted ROAS number downstream would be wrong.
  assert.equal(item.costNature, "variable");
});

test("ad spend reaches True profit — the reason there is no ad_spend table", async () => {
  // A sale so the ladder has revenue to work with.
  const product = await catalog.createRevenueItem(businessId, {
    name: "Ceramic mug",
    type: "product",
    pricingModel: "fixed",
    unitPriceCents: 1_000_00,
  });
  await ledger.createTransaction(businessId, {
    direction: "in",
    occurredAt: DAY("2026-03-04"),
    sourceId: manualSourceId,
    lines: [{ revenueItemId: product.id, qty: "1" }],
  });

  const before = await read.computePnl(businessId, "ad-spend-user", PERIOD);

  await adSpend.logAdSpend(businessId, {
    platform: "Google Ads",
    spentOn: DAY("2026-03-10"),
    amountCents: 150_00,
  });

  const after = await read.computePnl(businessId, "ad-spend-user", PERIOD);

  // Advertising is a PERIOD expense: it does not touch contribution (it is not
  // the cost of any one sale), and it comes off True profit.
  assert.equal(
    after.ladder.contributionProfit,
    before.ladder.contributionProfit,
    "ad spend is not a direct cost of a sale",
  );
  assert.equal(after.ladder.periodExpenses, before.ladder.periodExpenses + 150_00);
  assert.equal(after.ladder.trueProfit, before.ladder.trueProfit - 150_00);
  // And it never looks like revenue.
  assert.equal(after.ladder.grossRevenue, before.ladder.grossRevenue);
});

test("the period read ties to the ladder, splits by platform, and shares against real revenue", async () => {
  const entries = await adSpend.listAdSpend(businessId, {
    startDate: PERIOD.start,
    endDate: PERIOD.end,
  });
  const pnl = await read.computePnl(businessId, "ad-spend-user", PERIOD);
  const report = adSpend.summariseAdSpend(entries, pnl.ladder.grossRevenue);

  // Meta 220 + 180, Google 150.
  assert.equal(report.totalCents, 550_00);
  assert.deepEqual(
    report.byPlatform.map((p) => [p.platform, p.amountCents, p.entryCount]),
    [
      ["Meta Ads", 400_00, 2],
      ["Google Ads", 150_00, 1],
    ],
    "sorted by spend, largest first",
  );

  // The campaign name survives the round-trip as the line's own words.
  const tagged = entries.find((e) => e.campaign === "Retargeting – broad");
  assert.ok(tagged, "the campaign label is readable back off the ledger");
  assert.equal(tagged.amountCents, 220_00);

  // 550 of 1000 gross revenue = 55% = 5500 basis points.
  assert.equal(report.shareOfRevenueBps, 5_500);
});

test("share of revenue is null with no revenue, never a confident zero", () => {
  const report = adSpend.summariseAdSpend(
    [
      {
        id: "t1",
        spentOn: "2026-03-01T00:00:00.000Z",
        platform: "Meta Ads",
        sourceId: "s1",
        campaign: null,
        amountCents: 100_00,
        currency: "PKR",
        paidAt: null,
        origin: "manual",
        status: "completed",
        notes: null,
      },
    ],
    0,
  );
  assert.equal(report.shareOfRevenueBps, null, "a share of nothing is unanswerable, not 0%");
  assert.equal(report.totalCents, 100_00);
});

test("a connector's re-sync is a no-op at the database level", async () => {
  const charge = { platform: "Meta Ads", spentOn: DAY("2026-03-12"), amountCents: 90_00 };

  await adSpend.logAdSpend(businessId, { ...charge, origin: "integration", externalRef: "meta_chg_991" });

  // The same charge arriving twice — a webhook replay or a re-run backfill.
  await assert.rejects(
    () => adSpend.logAdSpend(businessId, { ...charge, origin: "integration", externalRef: "meta_chg_991" }),
    (err: unknown) => (err as { cause?: { code?: string } })?.cause?.code === "23505",
    "unique(source_id, external_ref) makes the replay fail rather than double-count",
  );

  const rows = await db
    .select({ id: transactionsTable.id })
    .from(transactionsTable)
    .where(and(eq(transactionsTable.businessId, businessId), eq(transactionsTable.externalRef, "meta_chg_991")));
  assert.equal(rows.length, 1);
});

test("voiding takes the spend back out of profit without deleting the row", async () => {
  const { transaction } = await adSpend.logAdSpend(businessId, {
    platform: "TikTok Ads",
    spentOn: DAY("2026-03-15"),
    amountCents: 75_00,
  });

  const before = await read.computePnl(businessId, "ad-spend-user", PERIOD);
  const voided = await adSpend.voidAdSpend(businessId, transaction.id);
  assert.equal(voided.status, "void");

  const after = await read.computePnl(businessId, "ad-spend-user", PERIOD);
  assert.equal(after.ladder.trueProfit, before.ladder.trueProfit + 75_00);

  // Append-only: the row is still there, it just stopped counting.
  const [row] = await db
    .select({ status: transactionsTable.status })
    .from(transactionsTable)
    .where(eq(transactionsTable.id, transaction.id));
  assert.equal(row.status, "void");

  // And it drops out of the ad-spend list too.
  const entries = await adSpend.listAdSpend(businessId, { startDate: PERIOD.start, endDate: PERIOD.end });
  assert.ok(!entries.some((e) => e.id === transaction.id));
});

test("a non-ad source cannot be voided through this path, and is never mistaken for a platform", async () => {
  const sale = await ledger.createTransaction(businessId, {
    direction: "out",
    occurredAt: DAY("2026-03-16"),
    sourceId: manualSourceId,
    lines: [{ label: "Office chair", qty: "1", unitPriceCents: 200_00 }],
  });

  await assert.rejects(
    () => adSpend.voidAdSpend(businessId, sale.transaction.id),
    (err: unknown) => err instanceof ServiceError && err.code === "not_found",
    "an ordinary expense is not ad spend just because it is money out",
  );

  const entries = await adSpend.listAdSpend(businessId, { startDate: PERIOD.start, endDate: PERIOD.end });
  assert.ok(!entries.some((e) => e.id === sale.transaction.id));
});

test("a name already used by a different kind of source is refused, not silently adopted", async () => {
  await catalog.createSource(businessId, { name: "Barclays", kind: "bank" });

  await assert.rejects(
    () =>
      adSpend.logAdSpend(businessId, {
        platform: "Barclays",
        spentOn: DAY("2026-03-18"),
        amountCents: 10_00,
      }),
    (err: unknown) => err instanceof ServiceError && err.code === "invalid",
    "a bank account must not become an ad platform by name collision",
  );
});

test("spend must be a positive whole number of cents", async () => {
  for (const amountCents of [0, -100, 12.5]) {
    await assert.rejects(
      () => adSpend.logAdSpend(businessId, { platform: "Meta Ads", spentOn: DAY("2026-03-19"), amountCents }),
      (err: unknown) => err instanceof ServiceError && err.code === "invalid",
      `rejects ${amountCents}`,
    );
  }
});

test("unpaid spend is a payable: it counts in profit now, not in cash yet", async () => {
  const { transaction } = await adSpend.logAdSpend(businessId, {
    platform: "Google Ads",
    spentOn: DAY("2026-03-20"),
    amountCents: 60_00,
    paidAt: null,
  });

  const [row] = await db
    .select({ paidAt: transactionsTable.paidAt, occurredAt: transactionsTable.occurredAt })
    .from(transactionsTable)
    .where(eq(transactionsTable.id, transaction.id));
  assert.equal(row.paidAt, null, "invoiced-not-settled spend stays unpaid");

  const accrual = await read.computePnl(businessId, "ad-spend-user", PERIOD, "accrual");
  const cash = await read.computePnl(businessId, "ad-spend-user", PERIOD, "cash");
  assert.ok(
    accrual.ladder.periodExpenses > cash.ladder.periodExpenses,
    "accrual counts the bill, cash does not",
  );
});

test("another business cannot see or void this one's ad spend", async () => {
  const other = await ensureBusiness("ad-spend-intruder");

  const mine = await adSpend.listAdSpend(businessId, { startDate: PERIOD.start, endDate: PERIOD.end });
  assert.ok(mine.length > 0);

  const theirs = await adSpend.listAdSpend(other.id, { startDate: PERIOD.start, endDate: PERIOD.end });
  assert.deepEqual(theirs, [], "a fresh business sees none of ours");

  await assert.rejects(
    () => adSpend.voidAdSpend(other.id, mine[0].id),
    (err: unknown) => err instanceof ServiceError && err.code === "not_found",
  );

  // Control: ours is still live and untouched by the attempt.
  const stillMine = await adSpend.listAdSpend(businessId, { startDate: PERIOD.start, endDate: PERIOD.end });
  assert.equal(stillMine.length, mine.length);

  // And their platform list stays empty rather than borrowing ours.
  const theirPlatforms = await db
    .select({ id: sourcesTable.id })
    .from(sourcesTable)
    .where(and(eq(sourcesTable.businessId, other.id), eq(sourcesTable.kind, "ad_platform")));
  assert.equal(theirPlatforms.length, 0);
});
