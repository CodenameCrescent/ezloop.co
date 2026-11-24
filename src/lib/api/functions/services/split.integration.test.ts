/**
 * Integration tests: splitting one bill across the several things it was for.
 *
 * The claim under test is narrow and total: **a split is lines**. The server
 * turns one instruction into N ordinary expense lines whose amounts add back to
 * the bill to the cent, each carrying its own target — and from that point on
 * nothing downstream knows a split happened, because there is nothing to know.
 *
 * Two failure modes this is here to prevent:
 *   1. Money invented or lost in the division. `splitReconciles` is asserted in
 *      the ledger, and the sums are asserted again here against the P&L.
 *   2. A split that writes lines nobody reads. Client profitability reads
 *      `target_id`, which until now nothing ever wrote — so the whole point is
 *      that Acme's costs actually MOVE when a bill is split onto them.
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
const { db, pool, clientEngagementsTable } = dbModule;
const { migrate } = await import("drizzle-orm/node-postgres/migrator");
const { ensureBusiness, getManualSource } = await import("./business");
const catalog = await import("./catalog");
const ledger = await import("./ledger");
const read = await import("./read");
const people = await import("./person");
const clientProfit = await import("./clientProfit");
const { ServiceError } = await import("./errors");

const MIGRATIONS = path.join(
  fileURLToPath(new URL(".", import.meta.url)),
  "..",
  "..",
  "..",
  "..",
  "..",
  "drizzle",
  "migrations",
);

const DAY = (d: string) => new Date(`${d}T12:00:00Z`);
const MONTH = (d: string) => {
  const [year, month] = d.split("-").map(Number);
  return {
    start: new Date(Date.UTC(year, month - 1, 1, 0, 0, 0)),
    end: new Date(Date.UTC(year, month, 1, 0, 0, 0) - 1),
  };
};

const USER = "split-user";
let businessId: string;
let sourceId: string;
let designItemId: string;
let acmeId: string;
let belmontId: string;
let mugId: string;

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
    `TRUNCATE time_entries, client_engagements, transaction_lines, transactions, cost_components,
       revenue_item_sources, revenue_items, expense_items, categories, sources, people, businesses CASCADE`,
  );

  const business = await ensureBusiness(USER);
  businessId = business.id;
  sourceId = (await getManualSource(businessId))!.id;

  const design = await catalog.findOrCreateExpenseItem(businessId, {
    name: "Design contractor",
    type: "operational",
    costNature: "variable",
  });
  designItemId = design.id;

  const mug = await catalog.createRevenueItem(businessId, {
    name: "Ceramic mug",
    type: "product",
    pricingModel: "fixed",
    unitPriceCents: 1_000_00,
  });
  mugId = mug.id;

  // Only clients with a LIVE engagement are targetable, so both need one.
  const acme = await people.findOrCreatePerson(businessId, { name: "Acme Ltd", kind: "customer" });
  const belmont = await people.findOrCreatePerson(businessId, { name: "Belmont & Co", kind: "customer" });
  acmeId = acme.id;
  belmontId = belmont.id;
  await db.insert(clientEngagementsTable).values([
    { id: "eng_acme", businessId, personId: acmeId, engagementStatus: "active" },
    { id: "eng_belmont", businessId, personId: belmontId, engagementStatus: "active" },
  ]);
});

after(async () => {
  await pool.end();
});

test("one bill becomes one line per share, adding back to the bill exactly", async () => {
  const bill = await ledger.createTransaction(businessId, {
    direction: "out",
    occurredAt: DAY("2026-03-04"),
    paidAt: DAY("2026-03-04"),
    sourceId,
    lines: [
      {
        expenseItemId: designItemId,
        qty: "1",
        unitPriceCents: 30_000_00,
        split: [
          { targetType: "client", targetId: acmeId, weight: "50" },
          { targetType: "client", targetId: belmontId, weight: "30" },
          { targetType: "revenue_item", targetId: mugId, weight: "20" },
        ],
      },
    ],
  });

  assert.equal(bill.lines.length, 3, "one input line, three written lines");
  assert.deepEqual(
    bill.lines.map((l) => l.unitPriceCents),
    [15_000_00, 9_000_00, 6_000_00],
  );
  assert.equal(
    bill.lines.reduce((sum, l) => sum + l.unitPriceCents, 0),
    30_000_00,
    "the shares are the bill, not approximately the bill",
  );

  // Each part carries its own target, and they are ordinary lines otherwise.
  assert.deepEqual(
    bill.lines.map((l) => `${l.targetType}:${l.targetId}`),
    [`client:${acmeId}`, `client:${belmontId}`, `revenue_item:${mugId}`],
  );
  assert.ok(bill.lines.every((l) => l.expenseItemId === designItemId), "every part is still the same expense item");
  assert.ok(bill.lines.every((l) => l.qty === "1" && l.lineDiscountCents === 0));

  // And the P&L is untouched by the division: Rs 30,000 spent either way.
  const march = await read.computePnl(businessId, USER, MONTH("2026-03"), "accrual");
  assert.equal(march.ladder.periodExpenses, 30_000_00);
});

test("the split is what finally makes a client's costs move", async () => {
  // Both clients bought something, so they appear on the page at all.
  for (const personId of [acmeId, belmontId]) {
    await ledger.createTransaction(businessId, {
      direction: "in",
      occurredAt: DAY("2026-03-02"),
      paidAt: DAY("2026-03-02"),
      sourceId,
      personId,
      lines: [{ revenueItemId: mugId, qty: "20" }],
    });
  }

  const report = await clientProfit.computeClientProfitability(businessId, USER, MONTH("2026-03"));
  const rowFor = (id: string) => report.rows.find((r) => r.targetType === "client" && r.targetId === id);

  // The Rs 30,000 bill was split 50/30, so this is the whole point of Phase 5:
  // before it, both of these were zero however many bills the owner recorded.
  assert.equal(rowFor(acmeId)?.directCostCents, 15_000_00);
  assert.equal(rowFor(belmontId)?.directCostCents, 9_000_00);
});

test("a share that cannot divide cleanly still costs exactly what was spent", async () => {
  const bill = await ledger.createTransaction(businessId, {
    direction: "out",
    occurredAt: DAY("2026-04-10"),
    paidAt: DAY("2026-04-10"),
    sourceId,
    lines: [
      {
        expenseItemId: designItemId,
        qty: "1",
        unitPriceCents: 100_01,
        split: [
          { targetType: "client", targetId: acmeId, weight: "1" },
          { targetType: "client", targetId: belmontId, weight: "1" },
          { targetType: "revenue_item", targetId: mugId, weight: "1" },
        ],
      },
    ],
  });

  assert.equal(bill.lines.reduce((sum, l) => sum + l.unitPriceCents, 0), 100_01);
  const april = await read.computePnl(businessId, USER, MONTH("2026-04"), "accrual");
  assert.equal(april.ladder.periodExpenses, 100_01, "no stray paisa reaches the P&L");
});

test("a line discount comes off before the split, not after", async () => {
  // Rs 10,000 billed, Rs 2,000 knocked off. The clients share the Rs 8,000 that
  // was actually spent — splitting the gross would charge them for a discount
  // the business never paid.
  const bill = await ledger.createTransaction(businessId, {
    direction: "out",
    occurredAt: DAY("2026-05-06"),
    paidAt: DAY("2026-05-06"),
    sourceId,
    lines: [
      {
        expenseItemId: designItemId,
        qty: "1",
        unitPriceCents: 10_000_00,
        lineDiscountCents: 2_000_00,
        split: [
          { targetType: "client", targetId: acmeId, weight: "1" },
          { targetType: "client", targetId: belmontId, weight: "1" },
        ],
      },
    ],
  });

  assert.deepEqual(bill.lines.map((l) => l.unitPriceCents), [4_000_00, 4_000_00]);
  const may = await read.computePnl(businessId, USER, MONTH("2026-05"), "accrual");
  assert.equal(may.ladder.periodExpenses, 8_000_00);
});

test("a split cost that is also spread keeps its target in every month", async () => {
  // A Rs 24,000 tool shared between two clients and paid for across a year.
  // Both features are per line, so the split runs first and each part spreads
  // on its own — and a part that lost its target on the way would make the
  // deferred cost belong to nobody.
  await ledger.createTransaction(businessId, {
    direction: "out",
    occurredAt: DAY("2026-06-01"),
    paidAt: DAY("2026-06-01"),
    sourceId,
    lines: [
      {
        expenseItemId: designItemId,
        qty: "1",
        unitPriceCents: 24_000_00,
        spreadMonths: 12,
        split: [
          { targetType: "client", targetId: acmeId, weight: "1" },
          { targetType: "client", targetId: belmontId, weight: "1" },
        ],
      },
    ],
  });

  // September is month 4 of 12: each client carries half of one twelfth.
  const september = await read.computePnl(businessId, USER, MONTH("2026-09"), "accrual");
  assert.equal(september.ladder.periodExpenses, 2_000_00);

  const report = await clientProfit.computeClientProfitability(businessId, USER, MONTH("2026-09"));
  const rowFor = (id: string) => report.rows.find((r) => r.targetType === "client" && r.targetId === id);
  assert.equal(rowFor(acmeId)?.directCostCents, 1_000_00, "the deferred cost still belongs to Acme");
  assert.equal(rowFor(belmontId)?.directCostCents, 1_000_00);
});

test("what the ledger refuses to split or target", async () => {
  const saleLine = { revenueItemId: mugId, qty: "1" };
  const twoWay = [
    { targetType: "client" as const, targetId: acmeId, weight: "1" },
    { targetType: "client" as const, targetId: belmontId, weight: "1" },
  ];
  const refuses = (lines: Parameters<typeof ledger.createTransaction>[1]["lines"], direction: "in" | "out" = "out") =>
    assert.rejects(
      () =>
        ledger.createTransaction(businessId, {
          direction,
          occurredAt: DAY("2026-07-01"),
          sourceId,
          lines,
        }),
      (err: unknown) => err instanceof ServiceError,
    );

  // A sale is not a cost: who was paid is the header's person, not a target.
  await refuses([{ ...saleLine, targetType: "client", targetId: acmeId }], "in");
  await refuses([{ ...saleLine, split: twoWay }], "in");

  // A cost booked against a sale belongs to that sale.
  await refuses([saleLine, { expenseItemId: designItemId, qty: "1", unitPriceCents: 500_00, split: twoWay }], "in");

  // Both at once is two contradictory answers to one question.
  await refuses([
    {
      expenseItemId: designItemId,
      qty: "1",
      unitPriceCents: 500_00,
      targetType: "client",
      targetId: acmeId,
      split: twoWay,
    },
  ]);

  // Half a target is not a target.
  await refuses([{ expenseItemId: designItemId, qty: "1", unitPriceCents: 500_00, targetType: "client" }]);
  await refuses([{ expenseItemId: designItemId, qty: "1", unitPriceCents: 500_00, targetId: acmeId }]);

  // A target that is not on the list hours use — a typo, or a client with no
  // live engagement — must not write a dangling pointer.
  await refuses([
    { expenseItemId: designItemId, qty: "1", unitPriceCents: 500_00, targetType: "client", targetId: "nobody" },
  ]);
  await refuses([
    {
      expenseItemId: designItemId,
      qty: "1",
      unitPriceCents: 500_00,
      split: [
        { targetType: "client", targetId: acmeId, weight: "1" },
        { targetType: "client", targetId: "nobody", weight: "1" },
      ],
    },
  ]);

  // Nonsense shares come back as a 400 with the reason, not a 500.
  await refuses([
    {
      expenseItemId: designItemId,
      qty: "1",
      unitPriceCents: 500_00,
      split: [
        { targetType: "client", targetId: acmeId, weight: "0" },
        { targetType: "client", targetId: belmontId, weight: "1" },
      ],
    },
  ]);
  await refuses([
    {
      expenseItemId: designItemId,
      qty: "1",
      unitPriceCents: 500_00,
      split: [
        { targetType: "client", targetId: acmeId, weight: "1" },
        { targetType: "client", targetId: acmeId, weight: "1" },
      ],
    },
  ]);
});

test("a client's zero cost is only trusted when the period leaves nothing unassigned", async () => {
  // Nothing has been recorded in this month yet, so there is nothing to
  // attribute and nothing to warn about. An empty month is fully attributed —
  // the gate must not treat "no costs" as "costs unaccounted for".
  const quiet = MONTH("2026-10");
  const empty = await clientProfit.computeClientProfitability(businessId, USER, quiet);
  assert.equal(empty.costAttribution.fullyAttributed, true);
  assert.equal(empty.costAttribution.untargetedSplittableCents, 0);

  // A rent bill is fixed, so it can never belong to a client. It must NOT close
  // the gate — otherwise every real business is permanently "uncertain" and the
  // caveat becomes wallpaper.
  const rent = await catalog.findOrCreateExpenseItem(businessId, {
    name: "Studio rent",
    type: "operational",
    costNature: "fixed",
  });
  await ledger.createTransaction(businessId, {
    direction: "out",
    occurredAt: DAY("2026-10-02"),
    paidAt: DAY("2026-10-02"),
    sourceId,
    lines: [{ expenseItemId: rent.id, qty: "1", unitPriceCents: 65_000_00 }],
  });

  const withRent = await clientProfit.computeClientProfitability(businessId, USER, quiet);
  assert.equal(withRent.costAttribution.fullyAttributed, true, "rent does not make the page uncertain");
  assert.equal(withRent.costAttribution.neverSplitCents, 65_000_00);

  // A variable cost naming nobody DOES close it — that one could have been
  // pointed at a client and wasn't, so a zero cost to serve is now unreadable.
  await ledger.createTransaction(businessId, {
    direction: "out",
    occurredAt: DAY("2026-10-09"),
    paidAt: DAY("2026-10-09"),
    sourceId,
    lines: [{ expenseItemId: designItemId, qty: "1", unitPriceCents: 4_000_00 }],
  });

  const withOrphan = await clientProfit.computeClientProfitability(businessId, USER, quiet);
  assert.equal(withOrphan.costAttribution.fullyAttributed, false);
  assert.equal(withOrphan.costAttribution.untargetedSplittableCents, 4_000_00);

  // Point it at someone and the gate opens again — the pool is work with an end.
  await ledger.createTransaction(businessId, {
    direction: "out",
    occurredAt: DAY("2026-10-11"),
    paidAt: DAY("2026-10-11"),
    sourceId,
    lines: [
      { expenseItemId: designItemId, qty: "1", unitPriceCents: 1_000_00, targetType: "client", targetId: acmeId },
    ],
  });
  const stillOpen = await clientProfit.computeClientProfitability(businessId, USER, quiet);
  // Relative, because October also carries slices from the spread-and-split
  // purchase above — those are targeted too, which is the point of that test.
  assert.equal(
    stillOpen.costAttribution.targetedCents - withOrphan.costAttribution.targetedCents,
    1_000_00,
  );
  assert.equal(stillOpen.costAttribution.untargetedSplittableCents, 4_000_00, "the earlier orphan is still there");
});

test("the three buckets are the period's expenses, to the cent", async () => {
  // The guard lives inside the service and throws, so every call above already
  // asserts it. This states the property directly against the P&L the owner
  // sees, across a window with sales, splits, spreads and a rent bill in it.
  const year = { start: new Date(Date.UTC(2026, 0, 1)), end: new Date(Date.UTC(2026, 11, 31, 23, 59, 59)) };
  const report = await clientProfit.computeClientProfitability(businessId, USER, year);
  const pnl = await read.computePnl(businessId, USER, year, "accrual");
  const a = report.costAttribution;
  assert.equal(
    a.targetedCents + a.untargetedSplittableCents + a.neverSplitCents,
    pnl.ladder.periodExpenses,
  );
});

test("a chargeback fee is a real cost that can never name a client", async () => {
  // It is a period expense the ladder counts, and adjustments cannot carry a
  // target — so it belongs in "never split", not in the pool the owner is
  // being asked to clear. Before the reconciliation guard it belonged to no
  // bucket at all and the page silently lost it.
  const month = MONTH("2026-11");
  const product = await catalog.createRevenueItem(businessId, {
    name: "Disputed print",
    type: "product",
    pricingModel: "fixed",
    unitPriceCents: 8_000_00,
  });
  const sale = await ledger.createTransaction(businessId, {
    direction: "in",
    occurredAt: DAY("2026-11-04"),
    paidAt: DAY("2026-11-04"),
    sourceId,
    personId: acmeId,
    lines: [{ revenueItemId: product.id, qty: "1" }],
  });
  await ledger.createRefund(businessId, {
    transactionId: sale.transaction.id,
    requests: sale.lines.map((l) => ({ lineId: l.id, qtyRefunded: "1", amountRefundedCents: l.unitPriceCents })),
    adjustmentType: "chargeback",
    chargebackFeeCents: 2_500_00,
    occurredAt: DAY("2026-11-12"),
  });

  const report = await clientProfit.computeClientProfitability(businessId, USER, month);
  assert.equal(report.costAttribution.neverSplitCents, 2_500_00);
  assert.equal(report.costAttribution.fullyAttributed, true, "an unpointable fee is not the owner's to fix");
});

test("the drawer names who each share was for", async () => {
  const bill = await ledger.createTransaction(businessId, {
    direction: "out",
    occurredAt: DAY("2026-08-03"),
    paidAt: DAY("2026-08-03"),
    sourceId,
    lines: [
      {
        expenseItemId: designItemId,
        qty: "1",
        unitPriceCents: 5_000_00,
        split: [
          { targetType: "client", targetId: acmeId, weight: "3" },
          { targetType: "revenue_item", targetId: mugId, weight: "2" },
        ],
      },
    ],
  });

  const detail = await read.getTransactionDetail(businessId, USER, bill.transaction.id);
  assert.deepEqual(
    detail?.transaction.lines.map((l) => `${l.targetLabel} ${l.unitPriceCents}`),
    [`Acme Ltd ${3_000_00}`, `Ceramic mug ${2_000_00}`],
  );
});
