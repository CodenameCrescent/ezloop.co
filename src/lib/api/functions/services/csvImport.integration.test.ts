/**
 * Integration tests for reading an uploaded file into a plan, against a real
 * Postgres (profit_loop_test).
 *
 * The check screen is the one place an owner confirms a figure before it becomes
 * money, so most of what is asserted here is agreement: the amount the preview
 * shows is the amount the ledger will write, and the fingerprint the preview
 * builds is the fingerprint the ledger already stored.
 */
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import pg from "pg";
import { assertLocalTestDatabases } from "@/core/db/target";

const TEST_DB_NAME = "profit_loop_test";
const ADMIN_URL = process.env.TEST_ADMIN_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/postgres";
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? `postgres://postgres:postgres@localhost:5432/${TEST_DB_NAME}`;

// Never anything but a Postgres on this machine: these suites create, migrate and wipe.
assertLocalTestDatabases(ADMIN_URL, process.env.DATABASE_URL);

const dbModule = await import("@workspace/db");
const {
  db,
  expenseItemsTable,
  importBatchesTable,
  peopleTable,
  pool,
  revenueItemSourcesTable,
  revenueItemsTable,
  sourcesTable,
  transactionLinesTable,
  transactionsTable,
} = dbModule;
const { and, eq } = await import("drizzle-orm");
const { migrate } = await import("drizzle-orm/node-postgres/migrator");
const path = await import("node:path");
const { fileURLToPath } = await import("node:url");
const { ensureBusiness, getManualSource } = await import("./business");
const catalog = await import("./catalog");
const ledger = await import("./ledger");
const read = await import("./read");
/** The other thing that points at a catalogue item and posts money on a timer. */
const recurring = await import("./recurring");
/**
 * Both halves of the module under one name.
 *
 * Reading a file into a plan and writing that plan now live in two files, and
 * every call below is unchanged because of this line. Re-exporting the commit
 * half FROM the read half would have saved even this — and bought an import
 * cycle across the exact seam the split exists to create. The arrow runs one
 * way: `csvImportCommit` imports `csvImport`, and never the reverse.
 */
const csvImport = { ...(await import("@/app/api/imports/functions")), ...(await import("@/app/api/imports/functions")) };
/** History and undo — the third file of the trio, and the only one that reverses. */
const batches = await import("@/app/api/imports/functions");
/** The class the refusals below are asserted to BE, not merely to read like. */
const { ServiceError } = await import("./errors");
/** The `error.code` the matching-step fall-through branches on. See below. */
const { IMPORT_MAPPING_UNUSABLE } = await import("@workspace/api-contract");

const MIGRATIONS = path.join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..", "..", "drizzle", "migrations");

/** The auth user this file's business belongs to. */
const USER = "csv-import-user";

let businessId: string;
let sourceId: string;

/**
 * Wide enough to hold every date any test in this file uses, so each helper
 * below reads the WHOLE ledger and a delta means what it says.
 *
 * `PeriodRange` (read.ts:58) is `{ start?: Date; end?: Date }` — two Dates, not
 * the ISO pair the plan sketched, which is why there is no cast here.
 */
const WHOLE_RANGE: import("./read").PeriodRange = {
  start: new Date("2020-01-01T00:00:00.000Z"),
  end: new Date("2030-12-31T23:59:59.999Z"),
};

/**
 * The ladder's first rung, read through the real read model.
 *
 * `computePnl` returns `computeProfitLadder`'s own object, so these two helpers
 * ask the same module every screen asks. Re-adding the rows here instead would
 * prove only that the test can add up.
 */
async function grossRevenue(bid: string): Promise<number> {
  const pnl = await read.computePnl(bid, USER, WHOLE_RANGE);
  return pnl.ladder.grossRevenue;
}

async function sumOut(bid: string): Promise<number> {
  const pnl = await read.computePnl(bid, USER, WHOLE_RANGE);
  // True profit falls as costs land, so its movement is the cost movement.
  return pnl.ladder.trueProfit;
}

before(async () => {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE ${TEST_DB_NAME}`);
  } catch (err) {
    if ((err as { code?: string }).code !== "42P04") throw err;
  }
  await admin.end();
  await migrate(db, { migrationsFolder: MIGRATIONS });
  await db.execute(
    `TRUNCATE import_batches, transaction_lines, transactions, cost_components, revenue_item_sources, revenue_items, expense_items, categories, people, sources, businesses CASCADE`,
  );

  const business = await ensureBusiness("csv-import-user");
  businessId = business.id;
  sourceId = (await getManualSource(businessId))!.id;
});

after(async () => {
  await pool.end();
});

// ── The file is read, and every row is accounted for ────────────────────────

test("a bank statement previews as ready rows with the junk reported", async () => {
  const csv = [
    "Transaction Date,Details,Paid In,Paid Out",
    "03/04/2026,Card payment Acme,250.00,",
    "04/04/2026,FACEBOOK ADS,,45.00",
    ",Closing balance,,1200.00",
    "05/04/2026,Rent April,,1200.00",
  ].join("\r\n");

  const preview = await csvImport.previewImport(businessId, {
    kind: "transactions", filename: "statement.csv", csv, sourceId,
  });

  assert.equal(preview.counts.ready, 3);
  assert.equal(preview.counts.failed, 1);
  assert.equal(preview.failed[0].reason, "No date found");
  assert.equal(preview.grouped, false);
  assert.equal(preview.unit, "rows");
  assert.equal(preview.mapping.moneyIn, "Paid In");
  assert.deepEqual(preview.ignoredHeaders, []);
});

test("a preview names the columns it is ignoring", async () => {
  const csv = "Date,Details,Amount,Balance\r\n03/04/2026,A,10.00,900.00";
  const preview = await csvImport.previewImport(businessId, {
    kind: "transactions", filename: "s.csv", csv, sourceId,
  });
  assert.deepEqual(preview.ignoredHeaders, ["Balance"]);
});

test("a Shopify-shaped export previews as orders, not rows", async () => {
  const csv = [
    "Name,Created at,Lineitem name,Lineitem quantity,Lineitem price,Taxes",
    "#1001,2026-04-03,T-shirt,2,20.00,4.00",
    "#1001,2026-04-03,Mug,1,10.00,",
    "#1002,2026-04-04,Sticker,3,5.00,1.00",
  ].join("\r\n");

  const preview = await csvImport.previewImport(businessId, {
    kind: "transactions", filename: "orders.csv", csv, sourceId,
    mapping: {
      orderId: "Name", date: "Created at", description: "Lineitem name",
      qty: "Lineitem quantity", amount: "Lineitem price", taxCollected: "Taxes",
    },
    dateOrder: "dmy", totalsAre: "whole_order",
  });

  assert.equal(preview.grouped, true);
  assert.equal(preview.unit, "orders");
  assert.equal(preview.sourceRowCount, 3);
  assert.equal(preview.counts.ready, 2);
  assert.equal(preview.ready[0].lineCount, 2);
  assert.equal(preview.needsTotalsAnswer, true, "a tax column plus grouping needs the question asked");
});

test("the previewed amount is quantity times price, not the sum of the cells", async () => {
  // The rule this whole screen turns on. Two at 20.00 plus one at 10.00 adds to
  // 3000 as cells and lands as 5000, because createTransaction multiplies.
  const csv = [
    "Name,Created at,Lineitem name,Lineitem quantity,Lineitem price,Taxes",
    "#1001,2026-04-03,T-shirt,2,20.00,4.00",
    "#1001,2026-04-03,Mug,1,10.00,",
    "#1002,2026-04-04,Sticker,3,5.00,1.00",
  ].join("\r\n");

  const preview = await csvImport.previewImport(businessId, {
    kind: "transactions", filename: "orders.csv", csv, sourceId,
    mapping: {
      orderId: "Name", date: "Created at", description: "Lineitem name",
      qty: "Lineitem quantity", amount: "Lineitem price", taxCollected: "Taxes",
    },
    dateOrder: "dmy", totalsAre: "whole_order",
  });

  assert.equal(preview.ready[0].amountCents, 5000, "2 x 20.00 plus 1 x 10.00");
  assert.equal(preview.ready[1].amountCents, 1500, "3 x 5.00");
  // The 4.00 of tax rides the header on its own field and is not in the figure.
  assert.equal(preview.ready[0].direction, "in");
});

test("a quantity the ledger would refuse fails here instead of at commit", async () => {
  // importRows accepts a signed quantity and createTransaction refuses one, so a
  // zero-quantity line item would otherwise preview as ready, show a 0 (or, at
  // "-1", a negative the contract says this field never carries) and then fail.
  const csv = [
    "Name,Created at,Lineitem name,Lineitem quantity,Lineitem price",
    "#4001,2026-06-05,Removed item,0,20.00",
    "#4001,2026-06-05,Kept item,1,10.00",
  ].join("\r\n");

  const preview = await csvImport.previewImport(businessId, {
    kind: "transactions", filename: "orders.csv", csv, sourceId,
    mapping: {
      orderId: "Name", date: "Created at", description: "Lineitem name",
      qty: "Lineitem quantity", amount: "Lineitem price",
    },
  });

  assert.equal(preview.counts.ready, 0);
  assert.equal(preview.counts.failed, 1);
  assert.equal(preview.failed[0].reason, 'Quantity "0" has to be more than zero');
  assert.deepEqual(preview.failed[0].rowNumbers, [1, 2], "the ledger writes an order or none of it");
});

test("an order whose rows disagree fails as one order, carrying its cells", async () => {
  const csv = [
    "Name,Created at,Lineitem name,Lineitem price",
    "#3001,2026-06-01,A,10.00",
    "#3001,2026-06-02,B,20.00",
  ].join("\r\n");

  const preview = await csvImport.previewImport(businessId, {
    kind: "transactions", filename: "orders.csv", csv, sourceId,
    mapping: { orderId: "Name", date: "Created at", description: "Lineitem name", amount: "Lineitem price" },
  });

  assert.equal(preview.counts.ready, 0);
  assert.equal(preview.counts.failed, 1, "one order, not two rows");
  assert.deepEqual(preview.failed[0].rowNumbers, [1, 2]);
  assert.match(preview.failed[0].reason, /disagree about the date/);
  assert.deepEqual(
    preview.failed[0].cells,
    ["#3001", "2026-06-01", "A", "10.00"],
    "the download needs the row as the file had it",
  );
});

test("an order with a line each way is fingerprinted the way the ledger will store it", async () => {
  // A signed Amount column is where the first row's direction and the header's
  // part company: grouping copies the first row's, and createTransaction stores
  // "in" if ANYTHING on the order earns. The duplicate key carries whichever one
  // the plan says, and the other side of that check reads transactions.direction
  // — so copying the first row's would fingerprint a sale that never existed.
  const csv = [
    "Name,Created at,Lineitem name,Lineitem price",
    "#5001,2026-10-04,Returned item,-5.00",
    "#5001,2026-10-04,Kept item,20.00",
  ].join("\r\n");

  const plan = await csvImport.buildPlan(businessId, {
    kind: "transactions", filename: "orders.csv", csv, sourceId,
    mapping: { orderId: "Name", date: "Created at", description: "Lineitem name", amount: "Lineitem price" },
  });

  assert.equal(plan.groups.length, 1, "one order, two lines");
  assert.equal(plan.groups[0].group.direction, "out", "the first row's — what copying would have used");
  assert.equal(plan.groups[0].direction, "in", "what createTransaction will actually store");
});

// ── The date question ───────────────────────────────────────────────────────

test("an ambiguous date column is reported as a guess", async () => {
  const csv = "Date,Details,Amount\r\n03/04/2026,A,10.00\r\n05/06/2026,B,20.00";
  const preview = await csvImport.previewImport(businessId, {
    kind: "transactions", filename: "s.csv", csv, sourceId,
  });
  assert.equal(preview.dateOrder, "dmy");
  assert.equal(preview.dateOrderCertain, false);
});

test("a day over 12 makes the date order certain", async () => {
  const csv = "Date,Details,Amount\r\n13/04/2026,A,10.00";
  const preview = await csvImport.previewImport(businessId, {
    kind: "transactions", filename: "s.csv", csv, sourceId,
  });
  assert.equal(preview.dateOrderCertain, true);
});

test("a settled column outranks the date order the request asked for", async () => {
  // The matching screen cannot guard against this itself, and that is why the
  // guard is here. Only this function, having just re-read the column, knows
  // whether THIS mapping settles the question — the screen's request went out
  // before there was any way to know, carrying the answer the owner gave about
  // the PREVIOUS column.
  //
  // Taken, that answer reads 17/07 as month 17 and fails the row; worse, the
  // response still comes back `dateOrderCertain: true`, which is exactly what
  // makes the screen take the [Change] control away. A file read the wrong way
  // round with the control that fixes it removed.
  const csv = "Date,Details,Amount\r\n17/07/2027,Date gate proof,77.77";
  const preview = await csvImport.previewImport(businessId, {
    kind: "transactions", filename: "s.csv", csv, sourceId, dateOrder: "mdy",
  });
  assert.equal(preview.dateOrderCertain, true);
  assert.equal(preview.dateOrder, "dmy", "the file proved it, so the answer is ignored");
  assert.equal(preview.counts.ready, 1);
  assert.equal(preview.ready[0].occurredOn, "2027-07-17");
});

test("an answer still decides a column the file leaves open", async () => {
  // The other side of the same gate: nothing in this column is over 12, so
  // nothing was proved and the owner's answer is what is in force — which is
  // also what `dateOrderCertain: false` promises the screen.
  const csv = "Date,Details,Amount\r\n03/04/2027,Date gate open,66.66";
  const preview = await csvImport.previewImport(businessId, {
    kind: "transactions", filename: "s.csv", csv, sourceId, dateOrder: "mdy",
  });
  assert.equal(preview.dateOrderCertain, false);
  assert.equal(preview.dateOrder, "mdy");
  assert.equal(preview.ready[0].occurredOn, "2027-03-04");
});

test("a date column the mapping names but the file does not have is no certainty at all", async () => {
  // The mapping check asks whether the date field is MAPPED — it cannot ask
  // whether the header it names exists, and a mapping saved against last month's
  // export names columns this file may not have. A missing column reads as no
  // cells, and "nothing contradicted me" is not the same as "the file settled
  // it". Every row fails anyway, but the matching screen reads this flag to
  // decide whether to ask the owner which way the dates run.
  const csv = "Date,Details,Amount\r\n13/04/2026,A,10.00";
  const preview = await csvImport.previewImport(businessId, {
    kind: "transactions", filename: "s.csv", csv, sourceId,
    mapping: { date: "Transaction Date", description: "Details", amount: "Amount" },
  });
  assert.equal(preview.dateOrderCertain, false, "nothing was read, so nothing was settled");
  assert.equal(preview.counts.ready, 0);
  assert.match(preview.failed[0].reason, /isn't in this file/);
});

// ── Refusals that must be one sentence, not three hundred row failures ───────

/** The whole message, not a fragment of it — the sentence IS the behaviour. */
const says = (message: string) => (err: unknown) =>
  err instanceof Error && err.message === message;

test("a mapping with no money column is refused up front", async () => {
  const csv = "Date,Details,Amount\r\n03/04/2026,A,10.00\r\n04/04/2026,B,20.00";
  await assert.rejects(
    () =>
      csvImport.previewImport(businessId, {
        kind: "transactions", filename: "s.csv", csv, sourceId,
        mapping: { date: "Date", description: "Details" },
      }),
    says("Tell us which column holds the amount."),
  );
});

test("a mapping with no date column names the date, not the amount", async () => {
  const csv = "Date,Details,Amount\r\n03/04/2026,A,10.00";
  await assert.rejects(
    () =>
      csvImport.previewImport(businessId, {
        kind: "transactions", filename: "s.csv", csv, sourceId,
        mapping: { description: "Details", amount: "Amount" },
      }),
    says("Tell us which column holds the date."),
  );
});

test("the refusal a dropdown can fix is marked as such, and no other refusal is", async () => {
  /*
   * The one thing the upload screen BRANCHES on, pinned on the side that
   * decides it.
   *
   * A file whose columns we cannot match is refused before a row is read, and
   * that refusal must not leave the owner where it was raised: the upload step
   * has no dropdown on it, so "Tell us which column holds the date" there is an
   * instruction with nothing to carry it out with. It sends them to the matching
   * step instead — but only for THIS refusal, because "that file is over 3 MB"
   * is not a thing any dropdown fixes and belongs where a different file can be
   * chosen.
   *
   * Telling the two apart used to be a string comparison against the sentence.
   * That held only while both halves quoted `mappingProblem` verbatim, and
   * nothing guarded it: wrap the message, prefix it, or reword the refusal, and
   * the fall-through stops firing with no error and no warning — just the dead
   * end quietly back. It is a CODE now, and this is the assertion that keeps it
   * one. Without it, changing this throw back to `invalid()` breaks the matching
   * step and every other test in this repo still passes.
   */
  const code = async (input: Parameters<typeof csvImport.previewImport>[1]) => {
    try {
      await csvImport.previewImport(businessId, input);
      return null;
    } catch (err) {
      assert.ok(err instanceof ServiceError, "a refusal, not a crash");
      return err.code;
    }
  };

  assert.equal(
    await code({
      kind: "transactions", filename: "s.csv", sourceId,
      csv: "Date,Details,Amount\r\n03/04/2026,A,10.00",
      mapping: { description: "Details", amount: "Amount" },
    }),
    IMPORT_MAPPING_UNUSABLE,
    "an unmatched file goes on to the matching step with its columns in hand",
  );

  // Every other way a file is turned away: no dropdown fixes any of them.
  assert.notEqual(
    await code({ kind: "transactions", filename: "statement.pdf", csv: "Date\r\n03/04/2026", sourceId }),
    IMPORT_MAPPING_UNUSABLE,
    "not a CSV — pick a different file",
  );
  assert.notEqual(
    await code({ kind: "transactions", filename: "s.csv", csv: "   ", sourceId }),
    IMPORT_MAPPING_UNUSABLE,
    "nothing in it — pick a different file",
  );
});

test("a contacts file with neither Name nor Email is refused once, not once per row", async () => {
  // Either column will do, so neither can be marked required on its own — and
  // nothing then stopped a file that is not a contacts list at all from being
  // read row by row. An orders export came back with one copy of "A person needs
  // a name or an email" per row and never named the column that was missing.
  // Same shape as the money check above, and for the same reason.
  const csv = [
    "Order ID,Total,Currency",
    "#1001,10.00,GBP",
    "#1002,20.00,GBP",
    "#1003,30.00,GBP",
  ].join("\r\n");
  await assert.rejects(
    () => csvImport.previewImport(businessId, { kind: "people", filename: "orders.csv", csv }),
    says("Tell us which column holds the name or the email."),
  );

  // Either column ON ITS OWN is still a contacts file. The refusal is for a file
  // that has NEITHER, and a check reading "and" where it meant "or" would have
  // turned away half the files this kind exists to take.
  const emailOnly = await csvImport.previewImport(businessId, {
    kind: "people", filename: "p.csv", csv: "Email\r\nonecolumn@example.com",
  });
  assert.equal(emailOnly.counts.ready, 1);
  const nameOnly = await csvImport.previewImport(businessId, {
    kind: "people", filename: "p.csv", csv: "Name\r\nOne Column Ltd",
  });
  assert.equal(nameOnly.counts.ready, 1);
});

test("a file with nothing in it, a file that is not a CSV, and a file over the cap are each refused", async () => {
  await assert.rejects(
    () => csvImport.previewImport(businessId, { kind: "transactions", filename: "s.csv", csv: "   ", sourceId }),
    says("That file has no rows"),
  );

  await assert.rejects(
    () =>
      csvImport.previewImport(businessId, {
        kind: "transactions", filename: "statement.pdf", csv: "Date,Details,Amount\r\n03/04/2026,A,10.00", sourceId,
      }),
    says("Only CSV files can be imported."),
  );

  const tooManyRows = ["Date,Details,Amount"]
    .concat(Array.from({ length: 5001 }, (_, i) => `03/04/2026,Row ${i},10.00`))
    .join("\r\n");
  await assert.rejects(
    () => csvImport.previewImport(businessId, { kind: "transactions", filename: "s.csv", csv: tooManyRows, sourceId }),
    says("That file has 5,001 rows. Imports are capped at 5,000 — try splitting it by month."),
  );

  // ── The size cap, at the boundary and in the unit it claims to count ──────
  //
  // ONE BYTE apart, not five megabytes apart: the assertion is that the edge is
  // where the sentence says it is. A cap tested only with something enormous
  // passes at any value, which is what the old fixture did.
  //
  // The number is spelled out here rather than imported from the service on
  // purpose. The cap and the sentence the owner reads have to say the same
  // thing, and a test that reads both from the same constant cannot notice when
  // they stop agreeing.
  const CAP = 3 * 1024 * 1024;
  const head = "Date,Details,Amount\r\n03/04/2026,x,10.00\r\n03/04/2026,";
  const tail = ",10.00";
  const pad = CAP - Buffer.byteLength(head + tail, "utf8");

  const atCap = head + "y".repeat(pad) + tail;
  assert.equal(Buffer.byteLength(atCap, "utf8"), CAP, "the fixture sits exactly ON the cap");
  const accepted = await csvImport.previewImport(businessId, {
    kind: "transactions", filename: "s.csv", csv: atCap, sourceId,
  });
  assert.equal(accepted.sourceRowCount, 2, "a file exactly at the cap is read, not refused");

  const oneOver = head + "y".repeat(pad + 1) + tail;
  assert.equal(Buffer.byteLength(oneOver, "utf8"), CAP + 1, "and this one is a single byte past it");
  await assert.rejects(
    () => csvImport.previewImport(businessId, { kind: "transactions", filename: "s.csv", csv: oneOver, sourceId }),
    says("That file is over 3 MB — try splitting it by month."),
  );

  // THE UNIT, which is the whole of round 2's finding. This file is comfortably
  // under the cap in CHARACTERS and well over it in BYTES, because Japanese is
  // three UTF-8 bytes to the character. Measured with `String.length` it is
  // accepted and then refused by the platform with no words at all; measured in
  // bytes — the unit the platform itself counts — it gets the sentence. Revert
  // the check to `.length` and this is the assertion that goes red.
  const japanese = `Date,Details,Amount\r\n03/04/2026,${"あ".repeat(1_200_000)},10.00`;
  assert.ok(japanese.length < CAP, "under the cap if you count characters");
  assert.ok(Buffer.byteLength(japanese, "utf8") > CAP, "over it if you count bytes");
  await assert.rejects(
    () => csvImport.previewImport(businessId, { kind: "transactions", filename: "s.csv", csv: japanese, sourceId }),
    says("That file is over 3 MB — try splitting it by month."),
  );

  // A header row and nothing under it is a file we can still describe: it has
  // columns, so the screen shows the mapping and zero rows rather than refusing.
  const headerOnly = await csvImport.previewImport(businessId, {
    kind: "transactions", filename: "s.csv", csv: "Date,Details,Amount", sourceId,
  });
  assert.deepEqual(headerOnly.counts, { ready: 0, skipped: 0, failed: 0 });
});

// ── Item-only files, and the catalog names behind them ──────────────────────

test("an Item column with no Description still labels every line", async () => {
  // parseTransactionRows accepts a description OR an item, so an Item-only
  // export gives every row description: "". Left alone, createTransaction would
  // refuse each line with "Unlinked lines need a label".
  const csv = "Date,Item,Money in\r\n20/04/2026,Blue Mug,12.50";
  const preview = await csvImport.previewImport(businessId, {
    kind: "transactions", filename: "s.csv", csv, sourceId,
  });
  assert.equal(preview.counts.ready, 1);
  assert.equal(preview.ready[0].description, "Blue Mug");

  const plan = await csvImport.buildPlan(businessId, {
    kind: "transactions", filename: "s.csv", csv, sourceId,
  });
  assert.equal(plan.groups[0].group.lines[0].label, "Blue Mug", "the line, not just the order");
});

test("a variant parent in the Item column is not a match", async () => {
  // createTransaction refuses a sale against a parent, so resolving one here
  // would have the preview promise what the commit will refuse.
  const parent = await catalog.createRevenueItem(businessId, {
    name: "Hoodie", type: "product", pricingModel: "fixed", unitPriceCents: 4000,
  });
  await catalog.addVariant(businessId, parent.id, { name: "Hoodie Large", unitPriceCents: 4000 });

  const csv = "Date,Details,Item,Money in\r\n21/04/2026,A hoodie sale,Hoodie,40.00";
  const plan = await csvImport.buildPlan(businessId, {
    kind: "transactions", filename: "s.csv", csv, sourceId,
  });
  assert.equal(plan.groups[0].group.lines[0].revenueItemId, null, "a parent groups, it does not sell");

  const leaf = "Date,Details,Item,Money in\r\n21/04/2026,A hoodie sale,Hoodie Large,40.00";
  const leafPlan = await csvImport.buildPlan(businessId, {
    kind: "transactions", filename: "s.csv", csv: leaf, sourceId,
  });
  assert.notEqual(leafPlan.groups[0].group.lines[0].revenueItemId, null, "the variant itself still resolves");
});

// ── Payouts: money already recorded as sales, arriving again ────────────────

test("a payout row is set aside with its reason, once sales exist", async () => {
  // Needs at least one recorded sale, or there is nothing to double-count.
  await ledger.createTransaction(businessId, {
    direction: "in", occurredAt: new Date("2026-04-01T00:00:00Z"), sourceId,
    lines: [{ label: "A sale", unitPriceCents: 5000 }],
  });
  const csv = "Date,Details,Money in\r\n03/04/2026,STRIPE PAYOUT,820.00";
  const preview = await csvImport.previewImport(businessId, {
    kind: "transactions", filename: "s.csv", csv, sourceId,
  });
  assert.equal(preview.counts.ready, 0);
  assert.equal(preview.counts.skipped, 1);
  assert.match(preview.skipped[0].skipReason ?? "", /payout/i);
});

test("the payout flag never touches money going out", async () => {
  // isPayoutLike is a string predicate and is direction-blind by design:
  // "AMAZON PAYMENTS UK LTD" paid OUT is an ordinary cost.
  const csv = "Date,Details,Money out\r\n22/04/2026,AMAZON PAYMENTS UK LTD,45.00";
  const preview = await csvImport.previewImport(businessId, {
    kind: "transactions", filename: "s.csv", csv, sourceId,
  });
  assert.equal(preview.counts.ready, 1);
  assert.equal(preview.counts.skipped, 0);
});

test("a payout from a channel this business connected is recognised", async () => {
  // The matcher compares whole folded WORDS, so a source stored as "Daraz.pk"
  // has to be passed as ["daraz", "pk"] or a statement reading "PAYOUT FROM
  // DARAZ" never matches it.
  await catalog.createSource(businessId, { name: "Daraz.pk", kind: "marketplace" });
  const csv = "Date,Details,Money in\r\n23/04/2026,PAYOUT FROM DARAZ,500.00";
  const preview = await csvImport.previewImport(businessId, {
    kind: "transactions", filename: "s.csv", csv, sourceId,
  });
  assert.equal(preview.counts.skipped, 1);
  assert.match(preview.skipped[0].skipReason ?? "", /payout/i);
});

// ── The duplicate flag ──────────────────────────────────────────────────────

test("a row matching one already in the ledger is unticked with its reason", async () => {
  await ledger.createTransaction(businessId, {
    direction: "out", occurredAt: new Date("2026-07-02T00:00:00Z"), sourceId,
    lines: [{ label: "Studio hire", unitPriceCents: 30000 }],
  });
  const csv = "Date,Details,Money out\r\n02/07/2026,Studio hire,300.00";
  const preview = await csvImport.previewImport(businessId, {
    kind: "transactions", filename: "s.csv", csv, sourceId,
  });
  assert.equal(preview.counts.ready, 0);
  assert.equal(preview.counts.skipped, 1);
  assert.match(preview.skipped[0].skipReason ?? "", /already/i);
});

test("a description that folds to nothing is still checked", async () => {
  // An Urdu bank statement, or a "-" placeholder: normalizeDescription reduces
  // both to "". That empty description is a legitimate key on BOTH sides —
  // dropping it here would let a whole file re-import and double the books with
  // nothing on screen to say so.
  await ledger.createTransaction(businessId, {
    direction: "out", occurredAt: new Date("2026-03-14T00:00:00Z"), sourceId,
    lines: [{ label: "بجلی کا بل", unitPriceCents: 125000 }],
  });
  await ledger.createTransaction(businessId, {
    direction: "out", occurredAt: new Date("2026-03-15T00:00:00Z"), sourceId,
    lines: [{ label: "-", unitPriceCents: 125000 }],
  });

  const csv = [
    "Date,Details,Money out",
    "14/03/2026,بجلی کا بل,1250.00",
    "15/03/2026,-,1250.00",
  ].join("\r\n");
  const preview = await csvImport.previewImport(businessId, {
    kind: "transactions", filename: "s.csv", csv, sourceId,
  });
  assert.equal(preview.counts.skipped, 2);
  assert.equal(preview.counts.ready, 0);
});

test("a multi-quantity row builds its duplicate key from quantity times price", async () => {
  // The ledger stores 2 x 20.00 as one line of qty 2 at 2000, and Task 10 keys
  // it on 4000. Summing the Amount cells here would key on 2000, the flag would
  // never fire, and re-importing would double the sale in silence.
  await ledger.createTransaction(businessId, {
    direction: "in", occurredAt: new Date("2026-08-09T00:00:00Z"), sourceId,
    lines: [{ label: "T-shirt", unitPriceCents: 2000, qty: "2" }],
  });
  const csv = "Date,Details,Quantity,Money in\r\n09/08/2026,T-shirt,2,20.00";
  const preview = await csvImport.previewImport(businessId, {
    kind: "transactions", filename: "s.csv", csv, sourceId,
  });
  assert.equal(preview.ready.length, 0);
  assert.equal(preview.counts.skipped, 1);
  assert.equal(preview.skipped[0].amountCents, 4000, "the figure shown is the figure keyed");
});

test("an order id already used on this channel is the harder flag, and wins", async () => {
  await ledger.createTransaction(businessId, {
    direction: "in", occurredAt: new Date("2026-09-01T00:00:00Z"), sourceId,
    origin: "import", externalRef: "#7001",
    lines: [{ label: "Old news", unitPriceCents: 999 }],
  });
  const csv = "Date,Details,Money in,Order ID\r\n01/09/2026,Something else,50.00,#7001";
  const preview = await csvImport.previewImport(businessId, {
    kind: "transactions", filename: "s.csv", csv, sourceId,
  });
  assert.equal(preview.counts.skipped, 1);
  assert.match(preview.skipped[0].skipReason ?? "", /already imported/i);
});

// ── The channel a row lands on ──────────────────────────────────────────────

test("a file with no channel column and no channel chosen fails, rather than previewing as verified", async () => {
  // Both duplicate checks above are keyed per channel, so a group with no
  // channel is compared against nothing at all — and nothing on the screen tells
  // "we checked and found nothing" apart from "we did not check". Previewing it
  // as ready would present unchecked rows as verified ones, and a second upload
  // of the same file would double the books in silence. Commit refuses this
  // group in exactly this sentence, so the preview refuses it in that sentence
  // too.
  const csv = [
    "Date,Details,Money out",
    "05/12/2026,Web hosting,30.00",
    "06/12/2026,Coffee beans,12.00",
  ].join("\r\n");

  const preview = await csvImport.previewImport(businessId, {
    kind: "transactions", filename: "s.csv", csv,
  });

  assert.deepEqual(preview.counts, { ready: 0, skipped: 0, failed: 2 });
  assert.equal(preview.ready.length, 0, "nothing unchecked reaches the ready list");
  assert.equal(csvImport.NO_CHANNEL_REASON, "No channel for this row", "the sentence commit uses");
  assert.equal(preview.failed[0].reason, csvImport.NO_CHANNEL_REASON);
  assert.equal(preview.failed[1].reason, csvImport.NO_CHANNEL_REASON);
  assert.deepEqual(
    preview.failed[0].cells,
    ["05/12/2026", "Web hosting", "30.00"],
    "the download needs the row as the file had it",
  );
});

test("a channel column naming one this business does not have yet still previews as ready", async () => {
  // The other half of the rule, and the reason it is not simply "no source id".
  // Commit CREATES this channel, and a channel created that second holds no rows
  // to duplicate — so there is nothing the checks could have found, and refusing
  // it would block an ordinary first import from a marketplace.
  const csv = "Date,Details,Money out,Channel\r\n07/12/2026,Web hosting,30.00,A Shop We Have Never Heard Of";
  const preview = await csvImport.previewImport(businessId, {
    kind: "transactions", filename: "s.csv", csv,
  });

  assert.deepEqual(preview.counts, { ready: 1, skipped: 0, failed: 0 });
  assert.equal(preview.mapping.channel, "Channel");
});

test("a channel named in Urdu is one we cannot look up, so its rows are not called checked", async () => {
  // normalizeDescription keeps only a-z and 0-9, so "دراز" folds to "" — and the
  // name index drops every source whose name does the same. That channel can
  // therefore never be found, however many times the file is uploaded: unlike a
  // channel we simply do not have yet, this one ALREADY HOLDS the sale the file
  // re-states, so calling the row ready would present an unchecked row as a
  // verified one and re-uploading would double a real sale in silence.
  //
  // Both rows below are the same sale on the same kind of channel. The only
  // difference is the script the channel's name is written in.
  const urdu = await catalog.createSource(businessId, { name: "دراز", kind: "marketplace" });
  const latin = await catalog.createSource(businessId, { name: "Gulberg Shop", kind: "marketplace" });
  for (const [day, on] of [["2026-11-23", urdu.id], ["2026-11-24", latin.id]] as const) {
    await ledger.createTransaction(businessId, {
      direction: "in", occurredAt: new Date(`${day}T00:00:00Z`), sourceId: on,
      lines: [{ label: "Silk scarf", unitPriceCents: 250000 }],
    });
  }

  const csv = [
    "Date,Details,Money in,Channel",
    "23/11/2026,Silk scarf,2500.00,دراز",
    "24/11/2026,Silk scarf,2500.00,Gulberg Shop",
  ].join("\r\n");
  const preview = await csvImport.previewImport(businessId, {
    kind: "transactions", filename: "s.csv", csv,
  });

  assert.deepEqual(preview.counts, { ready: 0, skipped: 1, failed: 1 });
  assert.equal(preview.ready.length, 0, "nothing unchecked reaches the ready list");
  assert.equal(preview.failed[0].reason, csvImport.NO_CHANNEL_REASON);
  assert.deepEqual(
    preview.failed[0].cells,
    ["23/11/2026", "Silk scarf", "2500.00", "دراز"],
    "the download needs the row as the file had it",
  );
  assert.match(
    preview.skipped[0].skipReason ?? "",
    /already/i,
    "the same sale on a channel we CAN look up is still checked, and still caught",
  );
});

test("a blank channel on the request is no channel at all", async () => {
  // The contract has sourceId optional (`z.string().optional()`), which admits
  // "". An empty id matches no source, so trusting it names a channel skips both
  // duplicate checks exactly as a missing one does. Blank falls through to the
  // file's own Channel column instead.
  const stall = await catalog.createSource(businessId, { name: "Karachi Stall", kind: "marketplace" });
  await ledger.createTransaction(businessId, {
    direction: "in", occurredAt: new Date("2026-11-25T00:00:00Z"), sourceId: stall.id,
    lines: [{ label: "Silk scarf", unitPriceCents: 250000 }],
  });

  const named = await csvImport.previewImport(businessId, {
    kind: "transactions", filename: "s.csv", sourceId: "",
    csv: "Date,Details,Money in,Channel\r\n25/11/2026,Silk scarf,2500.00,Karachi Stall",
  });
  assert.deepEqual(named.counts, { ready: 0, skipped: 1, failed: 0 }, "the Channel column decides instead");
  assert.match(named.skipped[0].skipReason ?? "", /already/i);

  const bare = await csvImport.previewImport(businessId, {
    kind: "transactions", filename: "s.csv", sourceId: "",
    csv: "Date,Details,Money in\r\n25/11/2026,Silk scarf,2500.00",
  });
  assert.deepEqual(bare.counts, { ready: 0, skipped: 0, failed: 1 });
  assert.equal(bare.failed[0].reason, csvImport.NO_CHANNEL_REASON);
});

test("the count of no-channel failures survives the cap the failure list does not", async () => {
  // The matching screen decides whether to make the owner pick one channel for
  // the whole file from this number, and it cannot be counted off `failed`: that
  // list stops at 200 and these failures are appended LAST, so they are the
  // first entries a long file loses. Counted off the list, 250 rows with no
  // channel anywhere look like 200 rows with no channel problem at all.
  const rows = Array.from({ length: 250 }, (_, i) => `03/10/2026,Uncharted ${i},10.00`);
  const csv = ["Date,Details,Money out", ...rows].join("\r\n");
  const preview = await csvImport.previewImport(businessId, {
    kind: "transactions", filename: "s.csv", csv,
  });

  assert.equal(preview.counts.failed, 250);
  assert.equal(preview.failed.length, 200, "the list is capped for display");
  assert.equal(preview.noChannelFailures, 250, "the evidence is not");
});

test("a failure for another reason is not counted as a channel failure", async () => {
  // Two rows carry Channel "Etsy" and a date this file cannot possibly mean; one
  // leaves Channel blank. Nothing is ready. If this count came back equal to
  // `counts.failed`, the screen would MAKE the owner pick one channel to get
  // past it — and the moment they fixed the dates on that same screen, both Etsy
  // rows would land under the picked channel instead, because a chosen channel
  // outranks the row's own. Wrong per-channel profit, silently.
  const csv = [
    "Date,Details,Money in,Channel",
    "31/02/2027,Handmade mug,20.00,Etsy",
    "31/02/2027,Handmade bowl,25.00,Etsy",
    "05/03/2027,Handmade plate,30.00,",
  ].join("\r\n");
  const preview = await csvImport.previewImport(businessId, {
    kind: "transactions", filename: "s.csv", csv,
  });

  assert.deepEqual(preview.counts, { ready: 0, skipped: 0, failed: 3 });
  assert.equal(preview.noChannelFailures, 1, "only the row that left the column blank");
});

// ── The response the browser gets ───────────────────────────────────────────

test("every field of the preview is present, and the lists are capped for display", async () => {
  const rows = Array.from({ length: 250 }, (_, i) => `03/10/2026,Row ${i},10.00`);
  const csv = ["Date,Details,Money out", ...rows].join("\r\n");
  const preview = await csvImport.previewImport(businessId, {
    kind: "transactions", filename: "s.csv", csv, sourceId,
  });

  assert.equal(preview.counts.ready, 250, "the counts stay exact");
  assert.equal(preview.ready.length, 200, "the list is capped for display only");

  assert.deepEqual(Object.keys(preview).sort(), [
    "counts", "dateOrder", "dateOrderCertain", "failed", "grouped", "headers",
    "ignoredHeaders", "kind", "mapping", "needsTotalsAnswer", "noChannelFailures",
    "ready", "skipped", "sourceRowCount", "unit",
  ]);
  assert.deepEqual(Object.keys(preview.ready[0]).sort(), [
    "amountCents", "description", "detail", "direction", "key", "lineCount",
    "occurredOn", "rowNumbers", "skipReason",
  ]);
  assert.deepEqual(preview.headers, ["Date", "Details", "Money out"]);
  assert.equal(preview.kind, "transactions");
});

test("a catalog preview carries every field too, with the money ones null", async () => {
  // The same check as above for a kind that is not money. Response validation
  // and zod's key-stripping are both gated on `NODE_ENV !== "production"`, so a
  // field left out here is supplied by the schema in this very test and simply
  // missing on a customer's screen — no assertion but this one can catch it.
  const preview = await csvImport.previewImport(businessId, {
    kind: "people", filename: "p.csv", csv: "Name,Email\r\nField Check Ltd,fields@example.com",
  });
  assert.deepEqual(Object.keys(preview).sort(), [
    "counts", "dateOrder", "dateOrderCertain", "failed", "grouped", "headers",
    "ignoredHeaders", "kind", "mapping", "needsTotalsAnswer", "noChannelFailures",
    "ready", "skipped", "sourceRowCount", "unit",
  ]);
  assert.equal(preview.noChannelFailures, 0, "a contact has no channel to be missing");
  assert.deepEqual(Object.keys(preview.ready[0]).sort(), [
    "amountCents", "description", "detail", "direction", "key", "lineCount",
    "occurredOn", "rowNumbers", "skipReason",
  ]);
  assert.equal(preview.kind, "people");
  assert.equal(preview.needsTotalsAnswer, false);
  assert.equal(preview.grouped, false);
  assert.equal(preview.unit, "rows");
});

// ── Commit: the rows become money ───────────────────────────────────────────

test("a committed order becomes one transaction with the right lines and tax", async () => {
  const csv = [
    "Name,Created at,Lineitem name,Lineitem quantity,Lineitem price,Taxes",
    "#2001,2026-05-03,T-shirt,2,20.00,4.00",
    "#2001,2026-05-03,Mug,1,10.00,",
  ].join("\r\n");
  const mapping = {
    orderId: "Name", date: "Created at", description: "Lineitem name",
    qty: "Lineitem quantity", amount: "Lineitem price", taxCollected: "Taxes",
  };

  const result = await csvImport.commitImport(businessId, {
    kind: "transactions", filename: "orders.csv", csv, sourceId, mapping,
    dateOrder: "dmy", totalsAre: "whole_order", includeKeys: [],
  });
  assert.equal(result.counts.created, 1);

  const [txn] = await db.select().from(transactionsTable)
    .where(and(eq(transactionsTable.businessId, businessId), eq(transactionsTable.externalRef, "#2001")));
  assert.ok(txn, "the order id becomes the external ref");
  assert.equal(txn.origin, "import");
  assert.equal(txn.taxCollectedCents, 400, "order-level tax lands once");
  assert.equal(txn.importBatchId, result.batch.id);

  const lines = await db.select().from(transactionLinesTable).where(eq(transactionLinesTable.transactionId, txn.id));
  assert.equal(lines.length, 2);
});

test("importing the same file twice moves no money", async () => {
  // The regression that matters most.
  const csv = "Date,Details,Money out\r\n11/05/2026,Studio hire,300.00";
  const first = await csvImport.previewImport(businessId, { kind: "transactions", filename: "s.csv", csv, sourceId });
  await csvImport.commitImport(businessId, {
    kind: "transactions", filename: "s.csv", csv, sourceId,
    mapping: first.mapping, dateOrder: first.dateOrder, includeKeys: [],
  });
  const after = await sumOut(businessId);

  const second = await csvImport.commitImport(businessId, {
    kind: "transactions", filename: "s.csv", csv, sourceId,
    mapping: first.mapping, dateOrder: first.dateOrder, includeKeys: [],
  });
  assert.equal(second.counts.created, 0);
  assert.equal(second.counts.skipped, 1);
  assert.equal(await sumOut(businessId), after, "the total must not move");
});

test("a duplicate the owner ticked back in is imported", async () => {
  const csv = "Date,Details,Money out\r\n12/05/2026,Taxi,15.00";
  const p1 = await csvImport.previewImport(businessId, { kind: "transactions", filename: "s.csv", csv, sourceId });
  await csvImport.commitImport(businessId, {
    kind: "transactions", filename: "s.csv", csv, sourceId,
    mapping: p1.mapping, dateOrder: p1.dateOrder, includeKeys: [],
  });
  const p2 = await csvImport.previewImport(businessId, { kind: "transactions", filename: "s.csv", csv, sourceId });
  assert.equal(p2.counts.skipped, 1);

  const forced = await csvImport.commitImport(businessId, {
    kind: "transactions", filename: "s.csv", csv, sourceId,
    mapping: p2.mapping, dateOrder: p2.dateOrder, includeKeys: [p2.skipped[0].key],
  });
  assert.equal(forced.counts.created, 1, "the owner was told and said yes");
});

test("an unknown item lands as a labelled line, and creates nothing", async () => {
  const before = await db.select().from(revenueItemsTable).where(eq(revenueItemsTable.businessId, businessId));
  const csv = "Date,Details,Money in,Item\r\n13/05/2026,Sale,90.00,Something We Do Not Stock";
  const p = await csvImport.previewImport(businessId, { kind: "transactions", filename: "s.csv", csv, sourceId });
  await csvImport.commitImport(businessId, {
    kind: "transactions", filename: "s.csv", csv, sourceId,
    mapping: p.mapping, dateOrder: p.dateOrder, includeKeys: [],
  });
  const after = await db.select().from(revenueItemsTable).where(eq(revenueItemsTable.businessId, businessId));
  assert.equal(after.length, before.length, "nothing is invented");

  const [line] = await db.select().from(transactionLinesTable).where(eq(transactionLinesTable.label, "Sale"));
  assert.ok(line);
  assert.equal(line.revenueItemId, null);
});

test("a failing row leaves the rest committed and is counted", async () => {
  const csv = [
    "Date,Details,Money out",
    "14/05/2026,Good one,10.00",
    ",Closing balance,999.00",
    "15/05/2026,Good two,20.00",
  ].join("\r\n");
  const p = await csvImport.previewImport(businessId, { kind: "transactions", filename: "s.csv", csv, sourceId });
  const result = await csvImport.commitImport(businessId, {
    kind: "transactions", filename: "s.csv", csv, sourceId,
    mapping: p.mapping, dateOrder: p.dateOrder, includeKeys: [],
  });
  assert.equal(result.counts.created, 2);
  assert.equal(result.counts.failed, 1);
});

test("a group the ledger itself refuses is counted, and the rest still land", async () => {
  // The test above fails a row the FILE could not be read into. This one fails
  // inside `createTransaction`'s own call chain, which is the branch the
  // per-group catch exists for: "Admin" is a seeded internal time category, and
  // `findOrCreateCategory` refuses to file money under one. The plan cannot
  // catch it — `loadBusinessIndex` leaves time categories out, so the name looks
  // simply unknown until commit tries to use it.
  const csv = [
    "Date,Details,Money out,Category",
    "17/05/2026,Printer paper,10.00,Stationery 2012",
    "18/05/2026,Van hire,80.00,Admin",
    "19/05/2026,Coffee,5.00,Stationery 2012",
  ].join("\r\n");
  const p = await csvImport.previewImport(businessId, { kind: "transactions", filename: "s.csv", csv, sourceId });
  assert.equal(p.counts.ready, 3, "the plan cannot see this one coming");

  const result = await csvImport.commitImport(businessId, {
    kind: "transactions", filename: "s.csv", csv, sourceId,
    mapping: p.mapping, dateOrder: p.dateOrder, includeKeys: [],
  });
  assert.equal(result.counts.failed, 1, "the refused order is counted");
  assert.equal(result.counts.created, 2, "and it does not take the other two with it");

  const [vanHire] = await db.select().from(transactionLinesTable)
    .where(eq(transactionLinesTable.label, "Van hire"));
  assert.equal(vanHire, undefined, "nothing of the refused order was written");

  // The category the OTHER two rows named did not exist either, and is created
  // once for the pair — the same find-or-create the Add dialog uses.
  const [paper] = await db.select().from(transactionLinesTable)
    .where(eq(transactionLinesTable.label, "Printer paper"));
  const [coffee] = await db.select().from(transactionLinesTable)
    .where(eq(transactionLinesTable.label, "Coffee"));
  assert.ok(paper.categoryId, "a free-typed category is created, as it is on the Add screen");
  assert.equal(paper.categoryId, coffee.categoryId, "and created once, not once per row");
});

test("tax collected on an import stays out of revenue", async () => {
  const before = await grossRevenue(businessId);
  const csv = "Date,Details,Money in,Tax\r\n16/05/2026,Sale with tax,100.00,20.00";
  const p = await csvImport.previewImport(businessId, { kind: "transactions", filename: "s.csv", csv, sourceId });
  await csvImport.commitImport(businessId, {
    kind: "transactions", filename: "s.csv", csv, sourceId,
    mapping: p.mapping, dateOrder: p.dateOrder, includeKeys: [],
  });
  assert.equal(await grossRevenue(businessId), before + 10000, "the 20.00 of tax is not revenue");
});

test("a negative tax, shipping or discount is refused in the preview, not at the write", async () => {
  // The row layer passes these three through SIGNED on purpose ("an abs() here
  // would hide a cell that says something odd"), while `assertCentsField`
  // refuses a negative outright. Left alone the owner would be shown a ready row
  // and then handed "tax_collected_cents must be non-negative integer cents".
  // Neither coercing the figure nor letting it reach the ledger is acceptable:
  // shipping charged IS gross revenue and the discount comes off net revenue, so
  // a flipped sign moves the ladder.
  for (const [column, header] of [
    ["Tax collected", "Tax"],
    ["Shipping charged", "Shipping"],
    ["Discount", "Discount"],
  ] as const) {
    const csv = `Date,Details,Money in,${header}\r\n24/05/2026,A sale,100.00,-5.00`;
    const preview = await csvImport.previewImport(businessId, { kind: "transactions", filename: "s.csv", csv, sourceId });
    assert.deepEqual(preview.counts, { ready: 0, skipped: 0, failed: 1 }, column);
    assert.equal(preview.failed[0].reason, `${column} can't be a negative amount`);
    assert.deepEqual(preview.failed[0].cells, ["24/05/2026", "A sale", "100.00", "-5.00"]);

    const before = await grossRevenue(businessId);
    const result = await csvImport.commitImport(businessId, {
      kind: "transactions", filename: "s.csv", csv, sourceId,
      mapping: preview.mapping, dateOrder: preview.dateOrder, includeKeys: [],
    });
    assert.deepEqual(result.counts, { created: 0, skipped: 0, failed: 1 }, column);
    assert.equal(await grossRevenue(businessId), before, "and no money moved");
  }
});

test("a file whose rows already exist is previewed as entirely skipped", async () => {
  const csv = "Date,Details,Money out\r\n07/04/2026,Rent April,1200.00";
  const first = await csvImport.previewImport(businessId, { kind: "transactions", filename: "s.csv", csv, sourceId });
  assert.equal(first.counts.ready, 1);

  await csvImport.commitImport(businessId, {
    kind: "transactions", filename: "s.csv", csv, sourceId,
    mapping: first.mapping, dateOrder: first.dateOrder, includeKeys: [],
  });

  const second = await csvImport.previewImport(businessId, { kind: "transactions", filename: "s.csv", csv, sourceId });
  assert.equal(second.counts.ready, 0);
  assert.equal(second.counts.skipped, 1);
  assert.match(second.skipped[0].skipReason ?? "", /already/i);
});

test("the previewed amount is the total the commit writes", async () => {
  const csv = [
    "Name,Created at,Lineitem name,Lineitem quantity,Lineitem price",
    "#9001,2026-11-03,T-shirt,2,20.00",
    "#9001,2026-11-03,Mug,1,10.00",
  ].join("\r\n");
  const mapping = {
    orderId: "Name", date: "Created at", description: "Lineitem name",
    qty: "Lineitem quantity", amount: "Lineitem price",
  };
  const preview = await csvImport.previewImport(businessId, {
    kind: "transactions", filename: "orders.csv", csv, sourceId, mapping,
  });
  assert.equal(preview.ready[0].amountCents, 5000);

  await csvImport.commitImport(businessId, {
    kind: "transactions", filename: "orders.csv", csv, sourceId, mapping,
    dateOrder: preview.dateOrder, includeKeys: [],
  });

  // Read the same number back from what actually landed. Through the domain's
  // own money math, not a float multiply, so the test cannot disagree with the
  // service for a reason that has nothing to do with the import.
  const { addCents, mulCentsQty } = await import("@workspace/domain");
  const [txn] = await db
    .select()
    .from(transactionsTable)
    .where(and(eq(transactionsTable.businessId, businessId), eq(transactionsTable.externalRef, "#9001")));
  const lines = await db
    .select()
    .from(transactionLinesTable)
    .where(eq(transactionLinesTable.transactionId, txn.id));
  const landed = lines.reduce((sum, line) => addCents(sum, mulCentsQty(line.unitPriceCents, line.qty)), 0);
  assert.equal(landed, preview.ready[0].amountCents, "the screen promised what the ledger wrote");
  // The per-unit reading, asserted on the stored row rather than inferred: a
  // line total would have stored 1000 a unit and shown the same 5000 total.
  const shirt = lines.find((line) => line.label === "T-shirt")!;
  assert.equal(shirt.qty, "2");
  assert.equal(shirt.unitPriceCents, 2000, "the file's price is the price of ONE");
});

test("a channel the file names is created once, and the file's second upload is caught", async () => {
  // The one case where a ready group has no source id: the plan sat both
  // duplicate checks out because there was nothing yet to duplicate. The channel
  // exists after this commit, so the SECOND upload must be caught — otherwise
  // "we could not have checked" quietly becomes "we never will".
  const csv = [
    "Date,Details,Money in,Channel",
    "04/07/2027,Scarf,25.00,Lahore Pop-up 2027",
    "05/07/2027,Shawl,35.00,lahore  pop-up 2027",
  ].join("\r\n");
  const p = await csvImport.previewImport(businessId, { kind: "transactions", filename: "c.csv", csv });
  assert.deepEqual(p.counts, { ready: 2, skipped: 0, failed: 0 });

  const first = await csvImport.commitImport(businessId, {
    kind: "transactions", filename: "c.csv", csv, mapping: p.mapping, dateOrder: p.dateOrder, includeKeys: [],
  });
  assert.equal(first.counts.created, 2);
  assert.equal(first.batch.sourceId, null, "no one channel to name when the file chose per row");

  const made = await db.select().from(dbModule.sourcesTable)
    .where(and(eq(dbModule.sourcesTable.businessId, businessId), eq(dbModule.sourcesTable.name, "Lahore Pop-up 2027")));
  assert.equal(made.length, 1, "two spellings of one name make one channel, not two");
  assert.equal(made[0].kind, "manual", "nothing syncs a channel a spreadsheet named");

  const rows = await db.select().from(transactionsTable).where(eq(transactionsTable.importBatchId, first.batch.id));
  assert.equal(rows.length, 2);
  assert.ok(rows.every((row) => row.sourceId === made[0].id), "both rows landed on the one channel");

  const before = await grossRevenue(businessId);
  const again = await csvImport.previewImport(businessId, { kind: "transactions", filename: "c.csv", csv });
  assert.equal(again.counts.skipped, 2, "now the channel exists, the checks run");
  const second = await csvImport.commitImport(businessId, {
    kind: "transactions", filename: "c.csv", csv,
    mapping: again.mapping, dateOrder: again.dateOrder, includeKeys: [],
  });
  assert.equal(second.counts.created, 0);
  assert.equal(await grossRevenue(businessId), before, "the total must not move");
});

test("an order id the database already owns is refused, counted, and takes nothing with it", async () => {
  // `unique(source_id, external_ref)` is the last line of defence, below every
  // check the plan makes, and the owner CAN tick past the plan's flag. What
  // comes back has to be one counted failure — not a 500, and not a second row.
  const csv = "Date,Details,Money in,Order ID\r\n06/07/2027,A repeat order,60.00,#R2027";
  const p1 = await csvImport.previewImport(businessId, { kind: "transactions", filename: "o.csv", csv, sourceId });
  await csvImport.commitImport(businessId, {
    kind: "transactions", filename: "o.csv", csv, sourceId,
    mapping: p1.mapping, dateOrder: p1.dateOrder, includeKeys: [],
  });

  const p2 = await csvImport.previewImport(businessId, { kind: "transactions", filename: "o.csv", csv, sourceId });
  assert.match(p2.skipped[0].skipReason ?? "", /already imported/i);

  const before = await grossRevenue(businessId);
  const forced = await csvImport.commitImport(businessId, {
    kind: "transactions", filename: "o.csv", csv, sourceId,
    mapping: p2.mapping, dateOrder: p2.dateOrder, includeKeys: [p2.skipped[0].key],
  });
  assert.deepEqual(forced.counts, { created: 0, skipped: 0, failed: 1 });
  assert.equal(forced.batch.failedCount, 1, "the batch row carries the same count");

  const rows = await db.select().from(transactionsTable)
    .where(and(eq(transactionsTable.businessId, businessId), eq(transactionsTable.externalRef, "#R2027")));
  assert.equal(rows.length, 1, "the index held");
  assert.equal(await grossRevenue(businessId), before);
});

test("a person, an unpaid row and a catalog item land the way the app records them", async () => {
  const item = await catalog.createRevenueItem(businessId, {
    name: "Probe Mug 2027", type: "product", pricingModel: "fixed", unitPriceCents: 1200,
  });
  const csv = [
    "Date,Details,Item,Money in,Person,Paid on,Reference",
    "07/07/2027,A mug sale,Probe Mug 2027,15.00,Ayesha Khan 2027,unpaid,INV-2027",
    "08/07/2027,Another mug,Probe Mug 2027,15.00,ayesha khan 2027,,INV-2028",
  ].join("\r\n");
  const p = await csvImport.previewImport(businessId, { kind: "transactions", filename: "r.csv", csv, sourceId });
  const result = await csvImport.commitImport(businessId, {
    kind: "transactions", filename: "r.csv", csv, sourceId,
    mapping: p.mapping, dateOrder: p.dateOrder, includeKeys: [],
  });
  assert.equal(result.counts.created, 2);

  const [unpaid] = await db.select().from(transactionsTable)
    .where(and(eq(transactionsTable.businessId, businessId), eq(transactionsTable.referenceNumber, "INV-2027")));
  const [paid] = await db.select().from(transactionsTable)
    .where(and(eq(transactionsTable.businessId, businessId), eq(transactionsTable.referenceNumber, "INV-2028")));
  // Owed money and settled money are different figures on every screen that
  // shows either, so blank and "unpaid" must not collapse into one value.
  assert.equal(unpaid.paidAt, null, '"unpaid" is money still owed');
  assert.deepEqual(paid.paidAt, new Date("2027-07-08T00:00:00.000Z"), "blank means paid on the day");

  assert.ok(unpaid.personId);
  assert.equal(paid.personId, unpaid.personId, "one person, however the file spelt the name");
  const [person] = await db.select().from(dbModule.peopleTable).where(eq(dbModule.peopleTable.id, unpaid.personId!));
  assert.deepEqual(
    person.firstTransactionAt,
    new Date("2027-07-07T00:00:00.000Z"),
    "a person born from an imported sale is dated by that sale, not by the upload",
  );

  const [line] = await db.select().from(transactionLinesTable).where(eq(transactionLinesTable.transactionId, unpaid.id));
  assert.equal(line.revenueItemId, item.id, "the Item column resolved to the catalog");
  assert.equal(line.unitPriceCents, 1500, "what the file says it sold for beats the catalog price");
  assert.ok(line.costSnapshot, "an imported sale freezes its costs like any other");
});

test("every field the commit response names is returned, and nothing else", async () => {
  const csv = "Date,Details,Money in\r\n26/05/2026,A tidy sale,40.00";
  const p = await csvImport.previewImport(businessId, { kind: "transactions", filename: "s.csv", csv, sourceId });
  const result = await csvImport.commitImport(businessId, {
    kind: "transactions", filename: "s.csv", csv, sourceId,
    mapping: p.mapping, dateOrder: p.dateOrder, includeKeys: [],
  });

  assert.deepEqual(Object.keys(result).sort(), ["batch", "counts", "failures"]);
  assert.deepEqual(Object.keys(result.counts).sort(), ["created", "failed", "skipped"]);
  // Present and empty, not absent. Production runs neither the response check
  // nor zod's defaults, so an omitted list is a missing key on a real screen
  // while every test here goes on passing.
  assert.deepEqual(result.failures, [], "nothing failed, and the field still says so");
  // Response validation and zod's key-stripping are both gated on NODE_ENV, so
  // a raw row here would ship its internal columns — mapping_json, created_by,
  // undone_by, business_id — straight to the browser in production.
  assert.deepEqual(Object.keys(result.batch).sort(), [
    "createdAt", "createdCount", "failedCount", "filename", "id", "kind",
    "skippedCount", "sourceId", "sourceRowCount", "status", "undoneAt",
  ]);
  assert.equal(result.batch.kind, "transactions");
  assert.equal(result.batch.status, "applied");
  assert.equal(result.batch.sourceId, sourceId);
  assert.equal(result.batch.sourceRowCount, 1);
  assert.equal(result.batch.createdCount, 1);
  assert.equal(result.batch.undoneAt, null);
  assert.equal(typeof result.batch.createdAt, "string", "an ISO string, not a Date");
});

test("a commit that fails rows says which rows and why, not just how many", async () => {
  // "18 rows didn't import and we won't tell you which" is a dead end. Two
  // heights of failure in one file: a row the FILE could not be read into, which
  // the check screen already showed, and a group the WRITE refused, which it
  // could not have — that one only became a failure at the moment money moved,
  // so this response is the ONLY place the owner can ever learn about it.
  const csv = [
    "Date,Details,Money out,Category",
    "20/05/2026,A good row,10.00,Stationery 2026",
    ",Closing balance,999.00,",
    "21/05/2026,Van hire again,80.00,Admin",
  ].join("\r\n");
  const p = await csvImport.previewImport(businessId, { kind: "transactions", filename: "f.csv", csv, sourceId });
  assert.equal(p.counts.failed, 1, "the plan can see the unreadable row");
  assert.equal(p.counts.ready, 2, "and cannot see the other one coming");

  const result = await csvImport.commitImport(businessId, {
    kind: "transactions", filename: "f.csv", csv, sourceId,
    mapping: p.mapping, dateOrder: p.dateOrder, includeKeys: [],
  });
  assert.equal(result.counts.created, 1);
  assert.equal(result.counts.failed, 2, "one from each height");
  assert.equal(result.failures.length, 2, "a reason for each, not a number for both");

  const readFailure = result.failures.find((f) => f.rowNumbers.includes(2))!;
  const writeFailure = result.failures.find((f) => f.rowNumbers.includes(3))!;
  assert.ok(readFailure.reason.length > 0, "the plan's own sentence, carried through");
  assert.match(
    writeFailure.reason,
    /internal time categories/,
    "the service's own words — the same ones the Add dialog gives for this refusal",
  );

  // The "Download these" button rebuilds a CSV from these cells, so a failure
  // carrying none of them hands the owner a blank line to correct.
  assert.deepEqual(readFailure.cells, ["", "Closing balance", "999.00", ""]);
  assert.deepEqual(
    writeFailure.cells,
    ["21/05/2026", "Van hire again", "80.00", "Admin"],
    "a row refused at the write comes back as downloadable as one refused at the read",
  );
});

test("the row the owner ticked back in is refused in the words it was flagged with", async () => {
  // The check screen said "This order is already imported", the owner ticked it
  // in anyway, and `unique(source_id, external_ref)` refused it. What they are
  // told at THAT point has to be the same sentence — not `duplicate key value
  // violates unique constraint "transactions_source_external_ref_uq"`, which is
  // the vocabulary this product exists in order not to speak.
  const csv = "Date,Details,Money in,Order ID\r\n09/07/2027,A second repeat,70.00,#R2028";
  const first = await csvImport.previewImport(businessId, { kind: "transactions", filename: "o.csv", csv, sourceId });
  await csvImport.commitImport(businessId, {
    kind: "transactions", filename: "o.csv", csv, sourceId,
    mapping: first.mapping, dateOrder: first.dateOrder, includeKeys: [],
  });

  const again = await csvImport.previewImport(businessId, { kind: "transactions", filename: "o.csv", csv, sourceId });
  const forced = await csvImport.commitImport(businessId, {
    kind: "transactions", filename: "o.csv", csv, sourceId,
    mapping: again.mapping, dateOrder: again.dateOrder, includeKeys: [again.skipped[0].key],
  });

  assert.deepEqual(forced.counts, { created: 0, skipped: 0, failed: 1 });
  assert.equal(forced.failures.length, 1);
  // Equal, not merely similar: both sides read one exported constant, so the
  // screen and the write cannot drift into two explanations of one fact.
  assert.equal(forced.failures[0].reason, again.skipped[0].skipReason);
  assert.deepEqual(forced.failures[0].cells, ["09/07/2027", "A second repeat", "70.00", "#R2028"]);
});

// ── A busy database is not a bad file ───────────────────────────────────────

test("every shape of `the database is not there` is pinned to what `pg` actually throws", async () => {
  // THE TEST THAT KEEPS `isDatabaseUnavailable` HONEST.
  //
  // `pg` raises its connection failures as a bare `new Error(message)` — no
  // `code`, no `name` beyond "Error", no own properties — so a message is the
  // only thing there is to match on. A matcher written from memory that never
  // matches would leave the bug in place while looking fixed, and nothing else
  // in this suite would notice.
  //
  // So nothing below is a hand-built error. Each shape is PROVOKED from the real
  // installed library and the matcher is asked about whatever it hands back.
  // Reword any of them in a future `pg` and this goes red, naming the new
  // wording — which is the point: half of these strings were carried by no test
  // at all, so a reword would have broken the matcher silently.
  //
  // Three of the four are a socket on THIS machine, deliberately, rather than a
  // blackholed remote address like TEST-NET-1: a reserved address is only
  // unroutable until a network decides to answer it with a refusal or an ICMP
  // unreachable, and then the probe pins whatever that produced instead of the
  // error it was written for. A socket we own behaves the same way everywhere,
  // and needs no network at all.

  /** A socket on this machine that behaves however the probe needs it to. */
  async function listening(onConnection: (socket: net.Socket) => void) {
    const server = net.createServer((socket) => {
      socket.on("error", () => {});
      onConnection(socket);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    return { port: (server.address() as net.AddressInfo).port, close: () => server.close() };
  }

  /** What `pool.connect()` throws against a port that will not complete a session. */
  async function connectFailure(port: number, connectionTimeoutMillis: number): Promise<unknown> {
    const probe = new pg.Pool({ connectionString: `postgres://u:p@127.0.0.1:${port}/x`, connectionTimeoutMillis });
    probe.on("error", () => {});
    let connected = false;
    let failure: unknown;
    try {
      const client = await probe.connect();
      connected = true;
      client.release();
    } catch (err) {
      failure = err;
    } finally {
      await probe.end().catch(() => {});
    }
    // Outside the try on purpose: an `assert.fail` inside it would be caught by
    // the catch above and returned as if it were the error under test.
    assert.ok(!connected, `127.0.0.1:${port} was supposed to be unreachable and answered instead`);
    return failure;
  }

  // 1. SATURATION — the pool is full and the queue wait ran out, which is the
  //    case `connectionTimeoutMillis` was added for. (pg-pool/index.js:224)
  //
  //    The window is a whole SECOND, and the hold is retried, because that one
  //    option governs two different waits in pg-pool and only the second is
  //    under test here. The first is opening a brand-new connection to a real
  //    Postgres, and it is slower and far less even than it looks: measured
  //    against this repo's own test database, 3 fresh connects out of 25 took
  //    longer than 100 ms. At the 100 ms this used to use, the HOLD lost that
  //    race about one run in eight and came back as the ESTABLISHMENT error —
  //    failing this test for the wrong reason, intermittently, which is the
  //    worst way for a test to fail.
  //
  //    The wait costs nothing in certainty. Once the single connection IS held
  //    the pool is full, so the second caller never opens a socket at all: it
  //    goes on the pending queue and is refused there (pg-pool/index.js:200),
  //    with no network in the path to race against.
  const full = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1, connectionTimeoutMillis: 1_000 });
  full.on("error", () => {});
  async function holdTheOnlyConnection() {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        return await full.connect();
      } catch {
        // A slow connect is not a result. Try again rather than report it.
      }
    }
    return null;
  }
  const held = await holdTheOnlyConnection();
  assert.ok(held, "the test database would not hand out a connection to hold");
  let queued = false;
  let saturation: unknown;
  try {
    const second = await full.connect();
    queued = true;
    second.release();
  } catch (err) {
    saturation = err;
  } finally {
    held.release();
    await full.end();
  }
  assert.ok(!queued, "a one-connection pool with its connection held must refuse the second caller");

  // 2. ESTABLISHMENT — a NEW connection could not finish being made in time: a
  //    cold Neon instance waking up, which `DEPLOY.md`'s free tier does after an
  //    idle spell. A socket that accepts and then says nothing reproduces it
  //    exactly. (pg-pool/index.js:276)
  const silent = await listening(() => {});
  const establishment = await connectFailure(silent.port, 50);
  silent.close();

  // 3. TERMINATED — the connection went away underneath us. A socket that
  //    accepts and hangs up cleanly is the same event as Neon going back to
  //    sleep mid-import. (pg/lib/client.js:180)
  const hangsUp = await listening((socket) => socket.end());
  const terminated = await connectFailure(hangsUp.port, 2_000);
  hangsUp.close();

  // 4. UNREACHABLE — nothing is listening at all. This one is not a message:
  //    Node gives socket failures a `syscall` and a string `code`, and the
  //    matcher keys on that SHAPE rather than on a list of code names someone
  //    remembered.
  const vacated = await listening(() => {});
  vacated.close();
  const refused = await connectFailure(vacated.port, 2_000);

  // The messages, asserted verbatim so a reword reports the NEW wording rather
  // than an unhelpful `false !== true`.
  assert.equal((saturation as Error).message, "timeout exceeded when trying to connect");
  assert.equal((establishment as Error).message, "Connection terminated due to connection timeout");
  assert.equal((terminated as Error).message, "Connection terminated unexpectedly");
  const socketError = refused as Error & { code?: unknown; syscall?: unknown };
  assert.equal(socketError.code, "ECONNREFUSED");
  assert.equal(typeof socketError.syscall, "string", "the property the matcher keys on");

  // And the behaviour all four exist for.
  for (const [name, error] of [
    ["saturation", saturation], ["establishment", establishment],
    ["terminated", terminated], ["unreachable", refused],
  ] as const) {
    assert.ok(
      csvImport.isDatabaseUnavailable(error),
      `the matcher missed a real ${name} error: ${JSON.stringify((error as Error).message)}`,
    );
    // Through a wrapper too: a layer between here and `pg` may carry the real
    // one as `cause`, the same pair `isDuplicateExternalRef` checks.
    assert.ok(csvImport.isDatabaseUnavailable(new Error("wrapped", { cause: error })), `${name}, wrapped`);
  }

  // ── The other half, which matters just as much ────────────────────────────
  //
  // The ordinary refusals must NOT be swept up as database trouble, or every bad
  // row would abort the whole import instead of being counted. These are what
  // actually reaches the commit loop's catch.
  //
  // The duplicate is a REAL `DatabaseError` from the real database rather than a
  // hand-made lookalike, because the matcher's socket check now rests on a claim
  // about that class: a Postgres error has no `syscall`, and its `code` is a
  // five-character SQLSTATE, not a libuv name. Asserted here rather than trusted.
  const client = await pool.connect();
  let duplicate: unknown;
  try {
    await client.query("begin");
    await client.query("create temp table pin_probe (i int primary key) on commit drop");
    await client.query("insert into pin_probe values (1), (1)");
  } catch (err) {
    duplicate = err;
  } finally {
    await client.query("rollback").catch(() => {});
    client.release();
  }
  assert.ok(duplicate instanceof Error, "the second insert was supposed to violate the primary key");
  const pgError = duplicate as Error & { code?: unknown; syscall?: unknown };
  assert.equal(pgError.code, "23505", "a real unique-violation, not one we built");
  assert.equal(pgError.syscall, undefined, "a Postgres error carries no syscall — what keeps the shape check safe");
  assert.equal(csvImport.isDatabaseUnavailable(duplicate), false);

  assert.equal(csvImport.isDatabaseUnavailable(new ServiceError("invalid", "Unlinked lines need a label")), false);
  assert.equal(csvImport.isDatabaseUnavailable(new TypeError("x is not a function")), false);
});

test("an import that runs out of database connections blames itself, not the owner's file", async () => {
  // The bug this exists for: `connectionTimeoutMillis` turned a hang into a
  // THROW, and the commit loop's blanket catch read that throw as "the ledger
  // refused this row". So under exactly the saturation the timeout was added to
  // bound, an owner was told "We could not import this row" about rows that were
  // perfectly fine — and it was written into their import history.
  //
  // Driven against the REAL shared pool with its REAL production timeout: every
  // connection is checked out, so the commit below cannot get one. That is the
  // genuine article rather than a simulation, which is why it costs the five
  // seconds `POOL_CONNECTION_TIMEOUT_MS` is set to.
  const csv = "Date,Details,Money in\r\n01/06/2026,A sale during a storm,25.00";
  const p = await csvImport.previewImport(businessId, { kind: "transactions", filename: "busy.csv", csv, sourceId });

  const max = pool.options.max ?? 10;
  const hogs: pg.PoolClient[] = [];
  let thrown: unknown;
  try {
    for (let i = 0; i < max; i += 1) hogs.push(await pool.connect());
    try {
      await csvImport.commitImport(businessId, {
        kind: "transactions", filename: "busy.csv", csv, sourceId,
        mapping: p.mapping, dateOrder: p.dateOrder, includeKeys: [],
      });
      assert.fail("a commit with no connection available must not report success");
    } catch (err) {
      thrown = err;
    }
  } finally {
    for (const hog of hogs) hog.release();
  }

  // It FAILED, loudly. The old behaviour returned a perfectly ordinary-looking
  // result whose `failures` list accused the file.
  assert.ok(thrown instanceof ServiceError, `expected a ServiceError, got ${String(thrown)}`);
  const error = thrown as InstanceType<typeof ServiceError>;
  assert.equal(error.code, "unavailable", "not `invalid` — the caller did nothing wrong");

  // And the sentence is the owner's, not the engine's. `pg`'s own wording would
  // reach a screen built for people who do not read logs.
  assert.doesNotMatch(error.message, /timeout|connect|pool|database/i, "no backend vocabulary");
  assert.match(error.message, /too busy/i, "it says whose fault it was");
  assert.match(error.message, /try again/i, "and what to do, which is the opposite of 'go fix your file'");
  assert.doesNotMatch(error.message, /could not import this row/i, "the accusation this fix removes");
});

// ── One import at a time, per business ──────────────────────────────────────

test("an import waits for the one already running, and another business's does not", async () => {
  // WHY THIS SHAPE, and not two commits fired off together: two calls raced with
  // `Promise.all` in this suite pass whether the lock is there or not — they
  // serialise on the connection pool before either writes, so the test proves
  // nothing about the lock. (The race itself is real. With the lock taken out,
  // a standalone script driving the same two calls lands the row TWICE.) A test
  // that cannot fail is worse than no test, so this one holds the lock itself
  // and watches what the commit does about it.
  //
  // The gap being guarded: `buildPlan` READS what this business already has and
  // the loop WRITES afterwards. This file carries no Order ID column on
  // purpose, which is the case with no database backstop behind it —
  // `unique(source_id, external_ref)` catches a second writer only when there
  // is a ref to catch, and a bank statement has none.
  const csv = "Date,Details,Money out\r\n14/08/2027,Two clicks at once,42.00";
  const p = await csvImport.previewImport(businessId, { kind: "transactions", filename: "d.csv", csv, sourceId });
  assert.equal(p.counts.ready, 1, "one ready row before the commit runs");

  // A connection of our own, standing in for the import that got there first.
  // The key is spelled out rather than imported: if someone changes how the
  // lock is keyed, this test stops blocking and says so, which is the direction
  // a coupling like this should fail in.
  const holder = await pool.connect();
  let settled = false;
  let waiting: Promise<Awaited<ReturnType<typeof csvImport.commitImport>>>;
  try {
    await holder.query("BEGIN");
    await holder.query("select pg_advisory_xact_lock(hashtext($1), hashtext($2))", [
      "profit-loop:csv-import",
      businessId,
    ]);

    waiting = csvImport.commitImport(businessId, {
      kind: "transactions", filename: "d.csv", csv, sourceId,
      mapping: p.mapping, dateOrder: p.dateOrder, includeKeys: [],
    });
    void waiting.then(
      () => { settled = true; },
      () => { settled = true; },
    );

    // Meanwhile, a DIFFERENT business is not held up by any of this. The lock is
    // keyed on the business; a global one would put every customer in a queue
    // behind whoever uploaded first.
    const other = await ensureBusiness("csv-import-second-owner");
    const otherSource = (await getManualSource(other.id))!.id;
    const elsewhere = await csvImport.commitImport(other.id, {
      kind: "transactions", filename: "d.csv", sourceId: otherSource, includeKeys: [],
      csv: "Date,Details,Money out\r\n14/08/2027,Somebody else's row,9.00",
    });
    assert.equal(elsewhere.counts.created, 1, "another business imports while this one waits");
    assert.equal(settled, false, "and the waiting import has not written anything yet");
  } finally {
    await holder.query("ROLLBACK");
    holder.release();
  }

  // Let go, and it goes through — the lock delays an import, it does not lose it.
  const result = await waiting!;
  assert.equal(result.counts.created, 1);

  const rows = await db
    .select()
    .from(transactionLinesTable)
    .where(eq(transactionLinesTable.label, "Two clicks at once"));
  assert.equal(rows.length, 1, "the ledger holds it once");
});

// ── The channel the request names ───────────────────────────────────────────

test("a channel that is not this business's is refused on the check screen, in the app's own words", async () => {
  // It used to be trusted for being merely non-blank, and the first thing to
  // notice was `createTransaction`, at the write, saying "Source not found".
  // This UI says Channel and has never said Source — and a row shown as ready
  // must not come apart at the moment the money moves.
  const csv = "Date,Details,Money out\r\n15/08/2027,A refused fee,10.00";
  const WORDS = "We can't find that channel — pick one from your list and try again";

  await assert.rejects(
    csvImport.previewImport(businessId, {
      kind: "transactions", filename: "c.csv", csv, sourceId: "src_not_a_channel",
    }),
    (error: Error) => {
      assert.equal(error.message, WORDS, "no backend vocabulary reaches the owner");
      return true;
    },
  );

  await assert.rejects(
    csvImport.commitImport(businessId, {
      kind: "transactions", filename: "c.csv", csv, sourceId: "src_not_a_channel", includeKeys: [],
    }),
    (error: Error) => {
      assert.equal(error.message, WORDS, "the write says the same thing the screen would have");
      return true;
    },
  );

  const rows = await db
    .select()
    .from(transactionLinesTable)
    .where(eq(transactionLinesTable.label, "A refused fee"));
  assert.equal(rows.length, 0, "and nothing was written on the way to being refused");

  // That commit threw from INSIDE the import lock. A transaction-scoped lock
  // lets go at the rollback, with no `finally` to forget — asserted rather than
  // assumed, because a lock left behind on a pooled connection would strand
  // every later import this business ever tried.
  const checker = await pool.connect();
  try {
    await checker.query("BEGIN");
    const { rows: attempt } = await checker.query(
      "select pg_try_advisory_xact_lock(hashtext($1), hashtext($2)) as got",
      ["profit-loop:csv-import", businessId],
    );
    assert.equal(attempt[0].got, true, "the refused commit let go of the import lock");
  } finally {
    await checker.query("ROLLBACK");
    checker.release();
  }
});

test("a padded channel id is the same channel, not a missing one", async () => {
  // The other half of trusting the field: spaces round a real id used to reach
  // `createTransaction` with the spaces still on, so the row previewed as ready
  // and failed at the write. Trimmed ONCE now, where the plan is built, so both
  // halves of the feature see the same id.
  const padded = ` ${sourceId} `;
  const csv = "Date,Details,Money out\r\n16/08/2027,A padded fee,11.00";
  const p = await csvImport.previewImport(businessId, {
    kind: "transactions", filename: "c.csv", csv, sourceId: padded,
  });
  assert.equal(p.counts.ready, 1);

  const result = await csvImport.commitImport(businessId, {
    kind: "transactions", filename: "c.csv", csv, sourceId: padded,
    mapping: p.mapping, dateOrder: p.dateOrder, includeKeys: [],
  });
  assert.equal(result.counts.created, 1);

  const [line] = await db
    .select()
    .from(transactionLinesTable)
    .where(eq(transactionLinesTable.label, "A padded fee"));
  const [txn] = await db.select().from(transactionsTable).where(eq(transactionsTable.id, line.transactionId));
  assert.equal(txn.sourceId, sourceId, "the ledger never sees the spaces");
});

// ── The three catalog kinds ─────────────────────────────────────────────────
//
// These move no money. They fill in the business's own description of itself —
// what it sells, what it spends on, who it deals with — through the same
// services the Add dialogs call, so forty items arrive the way one typed item
// does.

test("a revenue items template import creates items with their costs", async () => {
  const csv = [
    "Name,Kind,Pricing,Price,Direct cost,Category,Sold on,Unit,Notes",
    "Logo design,service,fixed,250.00,60.00,Design,Manual,job,",
    "Sticker pack,product,fixed,5.00,1.20,Merch,Manual,pack,",
  ].join("\r\n");
  const p = await csvImport.previewImport(businessId, { kind: "revenue_items", filename: "items.csv", csv });
  assert.equal(p.counts.ready, 2);
  assert.equal(p.grouped, false);
  assert.equal(p.unit, "rows");
  // An item is not a money event. A £0.00 figure with an in/out arrow beside a
  // price would paint money treatment across a list that is not money.
  assert.equal(p.ready[0].occurredOn, null);
  assert.equal(p.ready[0].direction, null);
  assert.equal(p.ready[0].lineCount, null);
  assert.equal(p.ready[0].amountCents, 25000, "the price the file gave");
  assert.equal(p.ready[0].detail, "Design", "the second identifying column");

  const result = await csvImport.commitImport(businessId, {
    kind: "revenue_items", filename: "items.csv", csv,
    mapping: p.mapping, dateOrder: p.dateOrder, includeKeys: [],
  });
  assert.equal(result.counts.created, 2);
  assert.deepEqual(result.failures, []);

  const items = await db.select().from(revenueItemsTable)
    .where(and(eq(revenueItemsTable.businessId, businessId), eq(revenueItemsTable.name, "Logo design")));
  assert.equal(items.length, 1);
  assert.equal(items[0].unitPriceCents, 25000);
  assert.equal(items[0].type, "service");
  assert.equal(items[0].pricingModel, "fixed");
  assert.equal(items[0].unitLabel, "job");
  assert.equal(items[0].importBatchId, result.batch.id);

  const costs = await catalog.listCostComponents(items[0].id);
  assert.equal(costs.filter((c) => c.valueCents === 6000).length, 1, "the direct cost is a cost component");
  // Effective-dated, never a column: the whole point of `setDirectCost`.
  assert.equal(costs[0].calcType, "fixed_per_unit");
  assert.equal(costs[0].effectiveTo, null);

  // "Sold on" is a channel list, resolved against the channels this business
  // already has rather than minting a second "Manual".
  const links = await db.select().from(revenueItemSourcesTable)
    .where(eq(revenueItemSourcesTable.revenueItemId, items[0].id));
  assert.equal(links.length, 1);
  assert.equal(links[0].sourceId, sourceId);
});

test("an item that already exists is skipped, not duplicated", async () => {
  const csv = "Name,Price\r\nLogo design,250.00";
  const p = await csvImport.previewImport(businessId, { kind: "revenue_items", filename: "i.csv", csv });
  assert.equal(p.counts.skipped, 1);
  assert.match(p.skipped[0].skipReason ?? "", /already/i);

  const result = await csvImport.commitImport(businessId, {
    kind: "revenue_items", filename: "i.csv", csv,
    mapping: p.mapping, dateOrder: p.dateOrder, includeKeys: [],
  });
  assert.equal(result.counts.created, 0, "the number an owner reads is the number of NEW records");
  assert.equal(result.counts.skipped, 1);
});

test("a name the owner ticks back in is skipped at the write, not called unreadable", async () => {
  // The test above stops at the PLAN's skip: `includeKeys: []` leaves the
  // duplicate set aside and `writeRecord` is never reached at all. But the owner
  // CAN tick it back in, and then the create is the only thing left to answer.
  // It refuses — and that refusal used to escape to `refuse()`, so the receipt
  // said "1 couldn't be read" about a row that was read perfectly and merely
  // already exists. `createOrAlreadyHad` turns it into the skip it always was.
  //
  // Expense items rather than revenue, for two reasons. Their clash is a
  // deterministic pre-check inside `createExpenseItem` (`findExpenseItemByName`)
  // rather than a unique-index violation translated after the fact, so the only
  // thing under test here is the COUNT. And the test above already covers
  // revenue, so this widens the kinds rather than repeating one.
  //
  // What is asserted is the STORED number. `skipped_count` and `failed_count`
  // are columns on the batch row, and the import history in Settings repeats
  // them back days later — a wrong count there is not a screen that can be
  // reloaded away.
  const csv = "Name,Purpose,Typical amount\r\nKiln firing,operational,75.00";
  const first = await csvImport.previewImport(businessId, { kind: "expense_items", filename: "k.csv", csv });
  const made = await csvImport.commitImport(businessId, {
    kind: "expense_items", filename: "k.csv", csv,
    mapping: first.mapping, dateOrder: first.dateOrder, includeKeys: [],
  });
  assert.equal(made.counts.created, 1);

  const again = await csvImport.previewImport(businessId, { kind: "expense_items", filename: "k.csv", csv });
  assert.equal(again.counts.skipped, 1);
  assert.match(again.skipped[0].skipReason ?? "", /already/i);

  const forced = await csvImport.commitImport(businessId, {
    kind: "expense_items", filename: "k.csv", csv,
    mapping: again.mapping, dateOrder: again.dateOrder, includeKeys: [again.skipped[0].key],
  });
  assert.deepEqual(forced.counts, { created: 0, skipped: 1, failed: 0 });
  assert.deepEqual(forced.failures, [], "a skip has no reason to print beside it");

  // Read back off the column rather than off the return value, because the
  // column is the one that outlives the request.
  const [stored] = await db.select().from(importBatchesTable)
    .where(eq(importBatchesTable.id, forced.batch.id));
  assert.equal(stored.createdCount, 0);
  assert.equal(stored.skippedCount, 1);
  assert.equal(stored.failedCount, 0, "nothing here was unreadable");

  // And through the call the history screen itself makes, which is where the
  // owner meets this number again.
  const listed = (await batches.listImportBatches(businessId)).find((b) => b.id === forced.batch.id);
  assert.equal(listed?.skippedCount, 1);
  assert.equal(listed?.failedCount, 0);

  // The catalogue is exactly as it was: the create that refused left nothing.
  const items = await db.select().from(expenseItemsTable)
    .where(and(eq(expenseItemsTable.businessId, businessId), eq(expenseItemsTable.name, "Kiln firing")));
  assert.equal(items.length, 1, "and no second copy of it");
});

test("an unknown enum value fails its row and names the accepted ones", async () => {
  const csv = "Name,Kind,Price\r\nMystery,banana,10.00";
  const p = await csvImport.previewImport(businessId, { kind: "revenue_items", filename: "i.csv", csv });
  assert.equal(p.counts.failed, 1);
  assert.match(p.failed[0].reason, /banana/);
  assert.match(p.failed[0].reason, /product/);
  assert.deepEqual(p.failed[0].cells, ["Mystery", "banana", "10.00"], "downloadable, so it can be fixed");
});

test("a negative price or cost is refused on the check screen, not at the write", async () => {
  // `createRevenueItem` and `addCostComponent` both demand non-negative cents,
  // in words the UI is never allowed to speak. Worse: the item is created
  // BEFORE its direct cost is written, so a negative cost used to leave the item
  // behind and still report the row as failed.
  const csv = "Name,Price,Direct cost\r\nUpside down,10.00,-2.00";
  const p = await csvImport.previewImport(businessId, { kind: "revenue_items", filename: "r.csv", csv });
  assert.equal(p.counts.failed, 1);
  assert.equal(p.failed[0].reason, "Direct cost can't be a negative amount");

  const result = await csvImport.commitImport(businessId, {
    kind: "revenue_items", filename: "r.csv", csv, mapping: p.mapping, dateOrder: p.dateOrder, includeKeys: [],
  });
  assert.equal(result.counts.created, 0);
  const rows = await db.select().from(revenueItemsTable)
    .where(and(eq(revenueItemsTable.businessId, businessId), eq(revenueItemsTable.name, "Upside down")));
  assert.equal(rows.length, 0, "and no half-made item was left behind");
});

test("expense items import with their nature and behaviour", async () => {
  const csv = "Name,Purpose,Cost nature,How often,Typical amount,Category\r\nOffice rent,operational,fixed,recurring,1200.00,Premises";
  const p = await csvImport.previewImport(businessId, { kind: "expense_items", filename: "e.csv", csv });
  const result = await csvImport.commitImport(businessId, {
    kind: "expense_items", filename: "e.csv", csv, mapping: p.mapping, dateOrder: p.dateOrder, includeKeys: [],
  });
  assert.equal(result.counts.created, 1);
  const [item] = await db.select().from(expenseItemsTable)
    .where(and(eq(expenseItemsTable.businessId, businessId), eq(expenseItemsTable.name, "Office rent")));
  assert.equal(item.costNature, "fixed");
  assert.equal(item.behavior, "recurring");
  assert.equal(item.defaultAmountCents, 120000);
  assert.equal(item.importBatchId, result.batch.id);
});

test("a blank Purpose cell files a cost as operational, not as marketing", async () => {
  // `expensePurposes[0]` is "marketing" and the column's documented default is
  // "operational". Taking the first of the values list would file every
  // unlabelled cost as ad spend, which distorts the one number owners look at
  // most.
  const csv = "Name,Purpose,Typical amount\r\nWindow cleaning,,50.00";
  const p = await csvImport.previewImport(businessId, { kind: "expense_items", filename: "e.csv", csv });
  assert.equal(p.counts.ready, 1);
  await csvImport.commitImport(businessId, {
    kind: "expense_items", filename: "e.csv", csv, mapping: p.mapping, dateOrder: p.dateOrder, includeKeys: [],
  });
  const [item] = await db.select().from(expenseItemsTable)
    .where(and(eq(expenseItemsTable.businessId, businessId), eq(expenseItemsTable.name, "Window cleaning")));
  assert.equal(item.type, "operational");
});

test("a blank Cost nature on a cogs row lands as variable, not as the column's example", async () => {
  // The one case the `blanks` set on a parsed row exists for. The Cost nature
  // column's example is "fixed"; `createExpenseItem` derives the nature from the
  // purpose instead, and cogs is variable. Applying the column default would
  // file every unlabelled cost of sale as a standing commitment, and cost nature
  // is what break-even reads. So a blank cell passes `undefined` and lets the
  // service answer.
  const csv = "Name,Purpose,Cost nature,Typical amount\r\nPacking boxes,cogs,,80.00";
  const p = await csvImport.previewImport(businessId, { kind: "expense_items", filename: "e.csv", csv });
  assert.equal(p.counts.ready, 1);
  const result = await csvImport.commitImport(businessId, {
    kind: "expense_items", filename: "e.csv", csv, mapping: p.mapping, dateOrder: p.dateOrder, includeKeys: [],
  });
  assert.equal(result.counts.created, 1);

  const [item] = await db.select().from(expenseItemsTable)
    .where(and(eq(expenseItemsTable.businessId, businessId), eq(expenseItemsTable.name, "Packing boxes")));
  assert.equal(item.type, "cogs");
  assert.equal(item.costNature, "variable", "the service's default for cogs, not the column's example");
});

test("people import through the same resolution the app already uses", async () => {
  const csv = "Name,Email,Kind\r\nAcme Ltd,hello@acme.com,customer\r\nBob,,vendor";
  const p = await csvImport.previewImport(businessId, { kind: "people", filename: "p.csv", csv });
  assert.equal(p.counts.ready, 2);
  assert.equal(p.ready[0].detail, "hello@acme.com", "the email has somewhere to go");
  assert.equal(p.ready[0].amountCents, null, "a list of customers is not money");

  const result = await csvImport.commitImport(businessId, {
    kind: "people", filename: "p.csv", csv, mapping: p.mapping, dateOrder: p.dateOrder, includeKeys: [],
  });
  assert.equal(result.counts.created, 2);
  const [bob] = await db.select().from(peopleTable)
    .where(and(eq(peopleTable.businessId, businessId), eq(peopleTable.displayName, "Bob")));
  // `needs_review` is its OWN boolean column, not a status value — people.ts
  // keeps `status` for active/archived.
  assert.equal(bob.needsReview, true, "a name-only person still needs confirming");
  assert.equal(bob.kind, "vendor");
  assert.equal(bob.status, "active");
  assert.equal(bob.importBatchId, result.batch.id);

  const [acme] = await db.select().from(peopleTable)
    .where(and(eq(peopleTable.businessId, businessId), eq(peopleTable.displayName, "Acme Ltd")));
  assert.equal(acme.needsReview, false, "an email is confirmation enough");
});

test("a person the business already has is skipped, not created again", async () => {
  const csv = "Name,Email,Kind\r\nBob,,vendor";
  const p = await csvImport.previewImport(businessId, { kind: "people", filename: "p.csv", csv });
  assert.equal(p.counts.skipped, 1);
  const result = await csvImport.commitImport(businessId, {
    kind: "people", filename: "p.csv", csv, mapping: p.mapping, dateOrder: p.dateOrder, includeKeys: [],
  });
  assert.equal(result.counts.created, 0);
  const bobs = await db.select().from(peopleTable)
    .where(and(eq(peopleTable.businessId, businessId), eq(peopleTable.displayName, "Bob")));
  assert.equal(bobs.length, 1);
});

test("one contact written two ways in one file is counted once on the check screen", async () => {
  // `findOrCreatePerson` matches on email FIRST and then on name, so these two
  // rows are one contact to the write. A file-local check keyed on the pair
  // together would have called them two, and the check screen would have
  // promised a second contact that the commit then reported as skipped.
  const csv = "Name,Email\r\nTwo Ways Ltd,twoways@example.com\r\nTwo Ways Ltd,";
  const p = await csvImport.previewImport(businessId, { kind: "people", filename: "p.csv", csv });
  assert.equal(p.counts.ready, 1);
  assert.equal(p.counts.skipped, 1);
  assert.match(p.skipped[0].skipReason ?? "", /more than once/i);

  const result = await csvImport.commitImport(businessId, {
    kind: "people", filename: "p.csv", csv, mapping: p.mapping, dateOrder: p.dateOrder, includeKeys: [],
  });
  assert.equal(result.counts.created, 1, "the screen promised one, and one is what landed");
  const rows = await db.select().from(peopleTable)
    .where(and(eq(peopleTable.businessId, businessId), eq(peopleTable.displayName, "Two Ways Ltd")));
  assert.equal(rows.length, 1);
});

test("a person row with neither name nor email fails", async () => {
  const csv = "Name,Email\r\n,";
  const p = await csvImport.previewImport(businessId, { kind: "people", filename: "p.csv", csv });
  // A wholly blank row is dropped, so give it something in an ignored column.
  const csv2 = "Name,Email,Kind\r\n,,customer";
  const p2 = await csvImport.previewImport(businessId, { kind: "people", filename: "p.csv", csv: csv2 });
  assert.equal(p.counts.ready + p.counts.failed, 0, "an entirely blank row is dropped");
  assert.equal(p2.counts.failed, 1);
  assert.match(p2.failed[0].reason, /name or an email/i);
});

// ── The channel rule belongs to transactions and to nothing else ─────────────

test("a people file with no channel imports every row: a person has no channel", async () => {
  // The only thing that used to keep a catalog file away from the transactions
  // channel rule was `buildPlan` refusing every non-transactions kind outright.
  // With that gone, an unscoped rule would fail every row of a customer list
  // with "No channel for this row", which is nonsense about a person.
  const csv = "Name,Email\r\nNo Channel Ltd,nochannel@example.com\r\nAlso Fine,alsofine@example.com";
  const p = await csvImport.previewImport(businessId, { kind: "people", filename: "p.csv", csv });
  assert.equal(p.counts.ready, 2, "no sourceId, no Channel column, and still ready");
  assert.equal(p.counts.failed, 0);
  assert.equal(
    p.failed.some((f) => /channel/i.test(f.reason)),
    false,
    "nothing was refused for a channel it could never have",
  );

  const result = await csvImport.commitImport(businessId, {
    kind: "people", filename: "p.csv", csv, mapping: p.mapping, dateOrder: p.dateOrder, includeKeys: [],
  });
  assert.equal(result.counts.created, 2);
  assert.equal(result.counts.failed, 0);
});

test("all four kinds preview on their own terms", async () => {
  // Read together, these five previews are the proof that the channel rule is
  // scoped: only the transactions file is asked for a channel, and only it is
  // refused for having none.
  const txnNoChannel = await csvImport.previewImport(businessId, {
    kind: "transactions", filename: "t.csv",
    csv: "Date,Details,Money in\r\n01/09/2027,A sale with nowhere to land,10.00",
  });
  assert.deepEqual(txnNoChannel.counts, { ready: 0, skipped: 0, failed: 1 });
  assert.equal(txnNoChannel.failed[0].reason, "No channel for this row");

  const txn = await csvImport.previewImport(businessId, {
    kind: "transactions", filename: "t.csv", sourceId,
    csv: "Date,Details,Money in\r\n01/09/2027,A sale with somewhere to land,10.00",
  });
  assert.deepEqual(txn.counts, { ready: 1, skipped: 0, failed: 0 });
  assert.equal(txn.unit, "rows");

  const revenue = await csvImport.previewImport(businessId, {
    kind: "revenue_items", filename: "r.csv",
    csv: "Name,Price\r\nFour Kinds Poster,12.00",
  });
  assert.deepEqual(revenue.counts, { ready: 1, skipped: 0, failed: 0 });

  const expense = await csvImport.previewImport(businessId, {
    kind: "expense_items", filename: "e.csv",
    csv: "Name,Typical amount\r\nFour Kinds Storage,30.00",
  });
  assert.deepEqual(expense.counts, { ready: 1, skipped: 0, failed: 0 });

  const people = await csvImport.previewImport(businessId, {
    kind: "people", filename: "p.csv",
    csv: "Name,Email\r\nFour Kinds Ltd,four@kinds.example",
  });
  assert.deepEqual(people.counts, { ready: 1, skipped: 0, failed: 0 });
});

test("a Sold on cell holding a dash means no channel, and leaves nothing behind", async () => {
  // "-" is how a spreadsheet says "none". It survives a trim, so it used to
  // reach the write as a channel name — and then folded to nothing when matched,
  // so the row previewed READY, the item and its cost were written, and only
  // then was the row refused with "No channel for this row": a sentence about
  // transactions, on a catalogue import. The item stayed in the table carrying
  // no batch id, which is a record undo cannot see and the owner was told had
  // failed.
  const csv = "Name,Price,Sold on\r\nDash Channel Poster,12.00,-";
  const p = await csvImport.previewImport(businessId, { kind: "revenue_items", filename: "r.csv", csv });
  assert.deepEqual(p.counts, { ready: 1, skipped: 0, failed: 0 });

  const result = await csvImport.commitImport(businessId, {
    kind: "revenue_items", filename: "r.csv", csv, mapping: p.mapping, dateOrder: p.dateOrder, includeKeys: [],
  });
  assert.deepEqual(result.counts, { created: 1, skipped: 0, failed: 0 });
  assert.deepEqual(result.failures, [], "nothing about a channel on a list of items");

  const items = await db.select().from(revenueItemsTable)
    .where(and(eq(revenueItemsTable.businessId, businessId), eq(revenueItemsTable.name, "Dash Channel Poster")));
  assert.equal(items.length, 1, "one item, not an orphan plus a failure");
  assert.equal(items[0].importBatchId, result.batch.id, "stamped, so undo can find it");

  const links = await db.select().from(revenueItemSourcesTable)
    .where(eq(revenueItemSourcesTable.revenueItemId, items[0].id));
  assert.equal(links.length, 0, "a dash names no channel, so none was linked");

  // And no channel was minted from the punctuation either.
  const madeUp = await db.select().from(sourcesTable).where(eq(sourcesTable.businessId, businessId));
  assert.equal(madeUp.some((s) => s.name.trim() === "-"), false);
});

test("a Sold on channel this business does not have is created as a manual one", async () => {
  const csv = "Name,Price,Sold on\r\nMarket stall tote,15.00,Weekend Market";
  const p = await csvImport.previewImport(businessId, { kind: "revenue_items", filename: "r.csv", csv });
  assert.equal(p.counts.ready, 1);
  const result = await csvImport.commitImport(businessId, {
    kind: "revenue_items", filename: "r.csv", csv, mapping: p.mapping, dateOrder: p.dateOrder, includeKeys: [],
  });
  assert.equal(result.counts.created, 1);

  const [channel] = await db.select().from(sourcesTable)
    .where(and(eq(sourcesTable.businessId, businessId), eq(sourcesTable.name, "Weekend Market")));
  assert.equal(channel.kind, "manual", "nobody connected it — the file named it");

  const [item] = await db.select().from(revenueItemsTable)
    .where(and(eq(revenueItemsTable.businessId, businessId), eq(revenueItemsTable.name, "Market stall tote")));
  const links = await db.select().from(revenueItemSourcesTable)
    .where(eq(revenueItemSourcesTable.revenueItemId, item.id));
  assert.equal(links.length, 1);
  assert.equal(links[0].sourceId, channel.id);
});

// ── History, and undoing an import ──────────────────────────────────────────
//
// Undo VOIDS. The rows stay, greyed, and leave every total — this app never
// hard-deletes money, and an undo that deleted would break the audit trail the
// whole product rests on. Catalogue rows are archived instead, and only the
// ones nothing has used yet.

test("undoing a transaction import voids its rows and restores every total", async () => {
  const before = await grossRevenue(businessId);
  const csv = "Date,Details,Money in\r\n20/06/2026,A sale,500.00\r\n21/06/2026,Another,300.00";
  const p = await csvImport.previewImport(businessId, { kind: "transactions", filename: "s.csv", csv, sourceId });
  const committed = await csvImport.commitImport(businessId, {
    kind: "transactions", filename: "s.csv", csv, sourceId, mapping: p.mapping, dateOrder: p.dateOrder, includeKeys: [],
  });
  assert.equal(committed.counts.created, 2);
  assert.equal(await grossRevenue(businessId), before + 80000);

  const undone = await batches.undoImportBatch(businessId, committed.batch.id, USER);
  assert.equal(undone.removed, 2);
  assert.equal(undone.kept, 0);
  assert.deepEqual(undone.keptNames, []);
  assert.equal(undone.batch.status, "undone");
  assert.ok(undone.batch.undoneAt, "the screen can say when");
  assert.equal(await grossRevenue(businessId), before, "the totals come back exactly");

  const rows = await db.select().from(transactionsTable)
    .where(eq(transactionsTable.importBatchId, committed.batch.id));
  assert.equal(rows.length, 2, "nothing is deleted");
  assert.ok(rows.every((r) => r.status === "void"), "voided, not gone");

  // Who undid it is recorded, and stays off the wire: `undoneBy` is an internal
  // column with no field on the contract's batch shape.
  const [stored] = await db.select().from(importBatchesTable)
    .where(eq(importBatchesTable.id, committed.batch.id));
  assert.equal(stored.status, "undone");
  assert.equal(stored.undoneBy, USER);
  assert.ok(stored.undoneAt instanceof Date);
});

test("undoing twice is refused rather than double-voiding", async () => {
  const csv = "Date,Details,Money in\r\n22/06/2026,Once,100.00";
  const p = await csvImport.previewImport(businessId, { kind: "transactions", filename: "s.csv", csv, sourceId });
  const c = await csvImport.commitImport(businessId, {
    kind: "transactions", filename: "s.csv", csv, sourceId, mapping: p.mapping, dateOrder: p.dateOrder, includeKeys: [],
  });
  await batches.undoImportBatch(businessId, c.batch.id, USER);
  await assert.rejects(() => batches.undoImportBatch(businessId, c.batch.id, USER), /already been undone/i);
});

test("undoing a catalog import keeps what is already in use and says so", async () => {
  const csv = "Name,Price\r\nUsed item,100.00\r\nUnused item,50.00";
  const p = await csvImport.previewImport(businessId, { kind: "revenue_items", filename: "i.csv", csv });
  const c = await csvImport.commitImport(businessId, {
    kind: "revenue_items", filename: "i.csv", csv, mapping: p.mapping, dateOrder: p.dateOrder, includeKeys: [],
  });
  assert.equal(c.counts.created, 2);
  const [used] = await db.select().from(revenueItemsTable)
    .where(and(eq(revenueItemsTable.businessId, businessId), eq(revenueItemsTable.name, "Used item")));
  await ledger.createTransaction(businessId, {
    direction: "in", occurredAt: new Date("2026-06-23T00:00:00Z"), sourceId,
    lines: [{ revenueItemId: used.id, qty: "1" }],
  });

  const undone = await batches.undoImportBatch(businessId, c.batch.id, USER);
  assert.equal(undone.removed, 1);
  assert.equal(undone.kept, 1);
  assert.deepEqual(undone.keptNames, ["Used item"]);

  const [stillThere] = await db.select().from(revenueItemsTable).where(eq(revenueItemsTable.id, used.id));
  assert.ok(stillThere, "an item with a sale against it is never removed");
  assert.equal(stillThere.status, "active", "and it is not quietly hidden either");

  const [unused] = await db.select().from(revenueItemsTable)
    .where(and(eq(revenueItemsTable.businessId, businessId), eq(revenueItemsTable.name, "Unused item")));
  assert.ok(unused, "archived, not deleted");
  assert.equal(unused.status, "archived");
});

test("an imported item a recurring schedule posts against is kept, not archived", async () => {
  // Why the reference check cannot stop at transaction lines. `runDueSchedules`
  // selects on the SCHEDULE's own status and never the item's, and
  // `createTransaction` resolves the item by business and id with no status
  // predicate — so archiving the item does not stop the posting. The schedule
  // goes on booking revenue every period against a row the owner can no longer
  // find in any picker: "a hidden product that goes on selling", which
  // `updateRevenueItem`'s own comment names as the worse bug.
  const csv = "Name,Price\r\nScheduled item,120.00\r\nPlain item,60.00";
  const p = await csvImport.previewImport(businessId, { kind: "revenue_items", filename: "sched.csv", csv });
  const c = await csvImport.commitImport(businessId, {
    kind: "revenue_items", filename: "sched.csv", csv, mapping: p.mapping, dateOrder: p.dateOrder, includeKeys: [],
  });
  assert.equal(c.counts.created, 2);

  const [scheduled] = await db.select().from(revenueItemsTable)
    .where(and(eq(revenueItemsTable.businessId, businessId), eq(revenueItemsTable.name, "Scheduled item")));
  await recurring.createSchedule(businessId, {
    direction: "in",
    revenueItemId: scheduled.id,
    sourceId,
    interval: "monthly",
    startDate: new Date("2026-07-01T00:00:00Z"),
  });

  const undone = await batches.undoImportBatch(businessId, c.batch.id, USER);
  assert.equal(undone.kept, 1);
  assert.deepEqual(undone.keptNames, ["Scheduled item"], "kept AND named, not silently skipped");

  const [stillSelling] = await db.select().from(revenueItemsTable).where(eq(revenueItemsTable.id, scheduled.id));
  assert.equal(stillSelling.status, "active", "the row its schedule posts against stays visible");

  // The control, in the same run: a fix that kept everything would be worse
  // than the bug, so the item nothing points at must still be put away.
  assert.equal(undone.removed, 1);
  const [plain] = await db.select().from(revenueItemsTable)
    .where(and(eq(revenueItemsTable.businessId, businessId), eq(revenueItemsTable.name, "Plain item")));
  assert.equal(plain.status, "archived", "an item with no references is still archived");
});

test("the same holds for an expense item a schedule pays out on", async () => {
  // The two catalogue halves are written out separately on purpose, which is
  // exactly where they can drift apart — so the expense branch is pinned too.
  const csv = "Name,Typical amount\r\nScheduled rent,900.00\r\nPlain cost,25.00";
  const p = await csvImport.previewImport(businessId, { kind: "expense_items", filename: "srent.csv", csv });
  const c = await csvImport.commitImport(businessId, {
    kind: "expense_items", filename: "srent.csv", csv, mapping: p.mapping, dateOrder: p.dateOrder, includeKeys: [],
  });
  assert.equal(c.counts.created, 2);

  const [rent] = await db.select().from(expenseItemsTable)
    .where(and(eq(expenseItemsTable.businessId, businessId), eq(expenseItemsTable.name, "Scheduled rent")));
  await recurring.createSchedule(businessId, {
    direction: "out",
    expenseItemId: rent.id,
    sourceId,
    interval: "monthly",
    startDate: new Date("2026-07-01T00:00:00Z"),
  });

  const undone = await batches.undoImportBatch(businessId, c.batch.id, USER);
  assert.equal(undone.kept, 1);
  assert.deepEqual(undone.keptNames, ["Scheduled rent"]);
  assert.equal(undone.removed, 1);

  const [stillPaying] = await db.select().from(expenseItemsTable).where(eq(expenseItemsTable.id, rent.id));
  assert.equal(stillPaying.status, "active");
  const [plain] = await db.select().from(expenseItemsTable)
    .where(and(eq(expenseItemsTable.businessId, businessId), eq(expenseItemsTable.name, "Plain cost")));
  assert.equal(plain.status, "archived");
});

test("an imported sale that was later refunded is kept, not half-voided", async () => {
  // `voidTransaction` refuses a sale that carries a live refund — the owner must
  // deal with the refund deliberately. Undo must not fall over on that: it keeps
  // the sale, names it, and finishes the rest, exactly as it does for a catalogue
  // row that is already in use.
  const csv = "Date,Details,Money in\r\n28/06/2026,Refunded later,200.00\r\n29/06/2026,Left alone,100.00";
  const p = await csvImport.previewImport(businessId, { kind: "transactions", filename: "s.csv", csv, sourceId });
  const c = await csvImport.commitImport(businessId, {
    kind: "transactions", filename: "s.csv", csv, sourceId, mapping: p.mapping, dateOrder: p.dateOrder, includeKeys: [],
  });
  assert.equal(c.counts.created, 2);

  const imported = await db.select().from(transactionsTable)
    .where(eq(transactionsTable.importBatchId, c.batch.id));
  const lines = await db.select().from(transactionLinesTable)
    .where(eq(transactionLinesTable.transactionId, imported[0].id));
  const refundedSale = lines[0].label === "Refunded later" ? imported[0] : imported[1];
  const [saleLine] = await db.select().from(transactionLinesTable)
    .where(eq(transactionLinesTable.transactionId, refundedSale.id));
  await ledger.createRefund(businessId, {
    transactionId: refundedSale.id,
    requests: [{ lineId: saleLine.id, qtyRefunded: "1", amountRefundedCents: 50_00 }],
  });

  const undone = await batches.undoImportBatch(businessId, c.batch.id, USER);
  assert.equal(undone.removed, 1);
  assert.equal(undone.kept, 1);
  assert.deepEqual(undone.keptNames, ["Refunded later"]);

  const after = await db.select().from(transactionsTable)
    .where(eq(transactionsTable.importBatchId, c.batch.id));
  assert.equal(after.length, 2);
  assert.equal(after.find((r) => r.id === refundedSale.id)!.status !== "void", true, "the refunded sale stands");
  assert.equal(after.find((r) => r.id !== refundedSale.id)!.status, "void");
});

test("undoing an expense import leaves the supplier it minted", async () => {
  // A deliberate decision, not an oversight: `createExpenseItem` resolves the
  // Supplier column through `findOrCreatePerson`, so the contact carries no
  // batch id. Undo leaves it — a supplier you now have is a supplier you want,
  // and a contact holds no money.
  const csv = "Name,Typical amount,Supplier\r\nUndo Storage,30.00,Undo Depot Ltd";
  const p = await csvImport.previewImport(businessId, { kind: "expense_items", filename: "e.csv", csv });
  const c = await csvImport.commitImport(businessId, {
    kind: "expense_items", filename: "e.csv", csv, mapping: p.mapping, dateOrder: p.dateOrder, includeKeys: [],
  });
  assert.equal(c.counts.created, 1);

  const undone = await batches.undoImportBatch(businessId, c.batch.id, USER);
  assert.equal(undone.removed, 1);
  const [item] = await db.select().from(expenseItemsTable)
    .where(and(eq(expenseItemsTable.businessId, businessId), eq(expenseItemsTable.name, "Undo Storage")));
  assert.equal(item.status, "archived");

  const [supplier] = await db.select().from(peopleTable)
    .where(and(eq(peopleTable.businessId, businessId), eq(peopleTable.displayName, "Undo Depot Ltd")));
  assert.ok(supplier, "the supplier stays — it was never the batch's to remove");
  assert.equal(supplier.status, "active");
});

test("undoing a revenue import leaves the channel it minted", async () => {
  // Same decision, same reason: a `Sold on` cell can mint a channel through
  // `createSource`, which carries no batch id. A channel is cheap and may
  // already be carrying other rows.
  const csv = "Name,Price,Sold on\r\nUndo Tote,15.00,Undo Bazaar";
  const p = await csvImport.previewImport(businessId, { kind: "revenue_items", filename: "r.csv", csv });
  const c = await csvImport.commitImport(businessId, {
    kind: "revenue_items", filename: "r.csv", csv, mapping: p.mapping, dateOrder: p.dateOrder, includeKeys: [],
  });
  assert.equal(c.counts.created, 1);

  await batches.undoImportBatch(businessId, c.batch.id, USER);
  const [channel] = await db.select().from(sourcesTable)
    .where(and(eq(sourcesTable.businessId, businessId), eq(sourcesTable.name, "Undo Bazaar")));
  assert.ok(channel, "the channel stays");
  assert.equal(channel.status, "active", "and is not quietly archived either — the decision is to leave it alone");
});

test("the history lists imports newest first with their counts", async () => {
  const csv = "Date,Details,Money in\r\n30/06/2026,Newest,10.00";
  const p = await csvImport.previewImport(businessId, { kind: "transactions", filename: "newest.csv", csv, sourceId });
  const newest = await csvImport.commitImport(businessId, {
    kind: "transactions", filename: "newest.csv", csv, sourceId, mapping: p.mapping, dateOrder: p.dateOrder, includeKeys: [],
  });

  const list = await batches.listImportBatches(businessId);
  assert.ok(list.length > 1);
  assert.equal(list[0].id, newest.batch.id, "the one just made is at the top");
  for (let i = 1; i < list.length; i += 1) {
    assert.ok(list[i - 1].createdAt >= list[i].createdAt, "newest first, all the way down");
  }
  assert.ok(list.every((b) => typeof b.createdCount === "number"));

  // Every field the contract names, spelled out — never the raw row.
  assert.deepEqual(Object.keys(list[0]).sort(), [
    "createdAt", "createdCount", "failedCount", "filename", "id", "kind",
    "skippedCount", "sourceId", "sourceRowCount", "status", "undoneAt",
  ]);
  assert.equal(list[0].filename, "newest.csv");
  assert.equal(list[0].kind, "transactions");
  assert.equal(list[0].sourceId, sourceId);
  assert.equal(list[0].createdCount, 1);
  assert.equal(list[0].undoneAt, null);
  assert.ok(list.some((b) => b.status === "undone"), "undone imports stay in the history");
});

test("a batch from another business cannot be undone, and its rows are untouched", async () => {
  const other = await ensureBusiness("csv-import-other-user");
  const otherSourceId = (await getManualSource(other.id))!.id;
  const csv = "Date,Details,Money in\r\n01/07/2026,Not yours,400.00";
  const p = await csvImport.previewImport(other.id, { kind: "transactions", filename: "o.csv", csv, sourceId: otherSourceId });
  const theirs = await csvImport.commitImport(other.id, {
    kind: "transactions", filename: "o.csv", csv, sourceId: otherSourceId, mapping: p.mapping, dateOrder: p.dateOrder, includeKeys: [],
  });

  await assert.rejects(() => batches.undoImportBatch(businessId, theirs.batch.id, USER), /not found/i);

  const rows = await db.select().from(transactionsTable)
    .where(eq(transactionsTable.importBatchId, theirs.batch.id));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, "completed", "another business's money is not touched");

  const mine = await batches.listImportBatches(businessId);
  assert.equal(mine.some((b) => b.id === theirs.batch.id), false, "nor listed");
});

test("undoing an import that is not there says so", async () => {
  await assert.rejects(() => batches.undoImportBatch(businessId, "imp_nope", USER), /not found/i);
});
