import test from "node:test";
import assert from "node:assert/strict";
import { parseCatalogRows, parseTransactionRows } from "./importRows";

// ---------------------------------------------------------------------------
// Task 3: whole rows. A row that cannot be read fails BY ITSELF, keeping its
// place in the owner's spreadsheet, so a footer line cannot cost them the other
// 299 rows.
// ---------------------------------------------------------------------------

const table = (headers: string[], ...rows: string[][]) => ({ headers, rows });
const ok = (o: ReturnType<typeof parseTransactionRows>[number]) => {
  assert.equal(o.ok, true, o.ok === false ? o.failure.reason : "");
  return o.ok === true ? o.row : (undefined as never);
};

test("a signed amount column sets the direction from its sign", () => {
  const out = parseTransactionRows(
    table(["Date", "Details", "Amount"], ["03/04/2026", "Sale to Acme", "250.00"], ["04/04/2026", "Facebook Ads", "-45.00"]),
    { date: "Date", description: "Details", amount: "Amount" },
    { dateOrder: "dmy" },
  );
  assert.equal(ok(out[0]).direction, "in");
  assert.equal(ok(out[0]).amountCents, 25000);
  assert.equal(ok(out[1]).direction, "out");
  assert.equal(ok(out[1]).amountCents, 4500, "the amount is stored positive");
});

test("a money-in / money-out pair sets the direction from which column is filled", () => {
  const out = parseTransactionRows(
    table(["Date", "Details", "Paid in", "Paid out"],
      ["03/04/2026", "Card payment", "250.00", ""],
      ["04/04/2026", "Rent", "", "1200.00"]),
    { date: "Date", description: "Details", moneyIn: "Paid in", moneyOut: "Paid out" },
    { dateOrder: "dmy" },
  );
  assert.equal(ok(out[0]).direction, "in");
  assert.equal(ok(out[1]).direction, "out");
  assert.equal(ok(out[1]).amountCents, 120000);
});

test("a negative under Money out still means money out", () => {
  // Some banks write -45.00 in a column already headed "Money out". Reading
  // the sign there would flip it into income.
  const out = parseTransactionRows(
    table(["Date", "Details", "Money out"], ["03/04/2026", "Rent", "-1200.00"]),
    { date: "Date", description: "Details", moneyOut: "Money out" },
    { dateOrder: "dmy" },
  );
  assert.equal(ok(out[0]).direction, "out");
  assert.equal(ok(out[0]).amountCents, 120000);
});

test("both money columns filled on one row is a failure, not a guess", () => {
  const out = parseTransactionRows(
    table(["Date", "Details", "In", "Out"], ["03/04/2026", "Odd", "10.00", "20.00"]),
    { date: "Date", description: "Details", moneyIn: "In", moneyOut: "Out" },
    { dateOrder: "dmy" },
  );
  assert.equal(out[0].ok, false);
  assert.match(out[0].ok === false ? out[0].failure.reason : "", /both/i);
});

test("a Type column beats the sign of the amount", () => {
  const out = parseTransactionRows(
    table(["Date", "Details", "Amount", "Type"], ["03/04/2026", "Refund", "45.00", "Purchase"]),
    { date: "Date", description: "Details", amount: "Amount", type: "Type" },
    { dateOrder: "dmy" },
  );
  assert.equal(ok(out[0]).direction, "out");
});

test("a zero amount is refused: it is never a real money event", () => {
  const out = parseTransactionRows(
    table(["Date", "Details", "Amount"], ["03/04/2026", "Balance brought forward", "0.00"]),
    { date: "Date", description: "Details", amount: "Amount" },
    { dateOrder: "dmy" },
  );
  assert.equal(out[0].ok, false);
  assert.match(out[0].ok === false ? out[0].failure.reason : "", /no amount/i);
});

test("a row with no label and no item is refused", () => {
  // The ledger requires a label or a catalogue link on every line.
  const out = parseTransactionRows(
    table(["Date", "Details", "Amount"], ["03/04/2026", "", "45.00"]),
    { date: "Date", description: "Details", amount: "Amount" },
    { dateOrder: "dmy" },
  );
  assert.equal(out[0].ok, false);
  assert.match(out[0].ok === false ? out[0].failure.reason : "", /description|item/i);
});

test("an unreadable date fails only its own row and keeps the numbering", () => {
  const out = parseTransactionRows(
    table(["Date", "Details", "Amount"],
      ["03/04/2026", "Good", "10.00"],
      ["", "Footer total", "999.00"],
      ["05/04/2026", "Also good", "20.00"]),
    { date: "Date", description: "Details", amount: "Amount" },
    { dateOrder: "dmy" },
  );
  assert.equal(out[0].ok, true);
  assert.equal(out[1].ok, false);
  assert.equal(out[1].ok === false ? out[1].failure.rowNumber : 0, 2);
  assert.deepEqual(out[1].ok === false ? out[1].failure.cells : [], ["", "Footer total", "999.00"]);
  assert.equal(out[2].ok, true);
  assert.equal(ok(out[2]).rowNumber, 3);
});

test("paid-on is blank-follows, a date, or the word unpaid", () => {
  const out = parseTransactionRows(
    table(["Date", "Details", "Amount", "Paid on"],
      ["03/04/2026", "A", "10.00", ""],
      ["03/04/2026", "B", "10.00", "10/04/2026"],
      ["03/04/2026", "C", "10.00", "unpaid"]),
    { date: "Date", description: "Details", amount: "Amount", paidOn: "Paid on" },
    { dateOrder: "dmy" },
  );
  assert.deepEqual(ok(out[0]).paidOn, { mode: "follows" });
  assert.deepEqual(ok(out[1]).paidOn, { mode: "on", iso: "2026-04-10" });
  assert.deepEqual(ok(out[2]).paidOn, { mode: "unpaid" });
});

test("tax, shipping and discount default to zero when unmapped", () => {
  const out = parseTransactionRows(
    table(["Date", "Details", "Amount"], ["03/04/2026", "A", "10.00"]),
    { date: "Date", description: "Details", amount: "Amount" },
    { dateOrder: "dmy" },
  );
  assert.equal(ok(out[0]).taxCollectedCents, 0);
  assert.equal(ok(out[0]).shippingChargedCents, 0);
  assert.equal(ok(out[0]).discountCents, 0);
});

test("a mapped header that is not in the file fails every row once, clearly", () => {
  const out = parseTransactionRows(
    table(["Date", "Amount"], ["03/04/2026", "10.00"]),
    { date: "Date", description: "Missing Column", amount: "Amount" },
    { dateOrder: "dmy" },
  );
  assert.equal(out[0].ok, false);
  assert.match(out[0].ok === false ? out[0].failure.reason : "", /Missing Column/);
});

test("a fully blank row is dropped, not failed", () => {
  const out = parseTransactionRows(
    table(["Date", "Details", "Amount"], ["03/04/2026", "A", "10.00"], ["", "", ""]),
    { date: "Date", description: "Details", amount: "Amount" },
    { dateOrder: "dmy" },
  );
  assert.equal(out.length, 1, "every export ends with a blank line");
});

// ---------------------------------------------------------------------------
// Task 13: catalog rows. Same rule — a row that cannot be read fails by itself
// — applied to the three kinds that describe the business rather than move its
// money.
// ---------------------------------------------------------------------------

const okRow = (o: ReturnType<typeof parseCatalogRows>[number]) => {
  assert.equal(o.ok, true, o.ok === false ? o.failure.reason : "");
  return o.ok === true ? o.row : (undefined as never);
};

test("an unknown enum value fails its row and names the accepted ones", () => {
  const out = parseCatalogRows(
    table(["Name", "Kind"], ["Mystery", "banana"]),
    { name: "Name", type: "Kind" },
    "revenue_items",
  );
  assert.equal(out[0].ok, false);
  const reason = out[0].ok === false ? out[0].failure.reason : "";
  assert.match(reason, /banana/, "the owner's own cell, quoted back");
  assert.match(reason, /product/, "and every value we would have taken");
  assert.match(reason, /Kind/, "named by the column's own label, not its field");
});

test("a blank required cell fails its row", () => {
  const out = parseCatalogRows(
    table(["Name", "Price"], ["", "10.00"]),
    { name: "Name", price: "Price" },
    "revenue_items",
  );
  assert.equal(out[0].ok, false);
  assert.match(out[0].ok === false ? out[0].failure.reason : "", /name/i);
  assert.deepEqual(out[0].ok === false ? out[0].failure.cells : [], ["", "10.00"]);
});

test("a blank enum cell takes the column's example, not the first of its values", () => {
  // `expensePurposes` starts at "marketing" and the documented default is
  // "operational". Filing every unlabelled cost as ad spend would distort the
  // one number owners look at most.
  const out = parseCatalogRows(
    table(["Name", "Purpose"], ["Window cleaning", ""]),
    { name: "Name", type: "Purpose" },
    "expense_items",
  );
  assert.equal(okRow(out[0]).values.type, "operational");
});

test("an enum cell is read the way an owner writes it", () => {
  const out = parseCatalogRows(
    table(["Name", "How often"], ["Rent", "One Time"]),
    { name: "Name", behavior: "How often" },
    "expense_items",
  );
  assert.equal(okRow(out[0]).values.behavior, "one_time", "capitals and a space, not a refusal");
});

test("money lands as minor units and a blank price is not a price of zero", () => {
  const out = parseCatalogRows(
    table(["Name", "Price", "Direct cost"], ["Logo design", "250.00", ""]),
    { name: "Name", price: "Price", directCost: "Direct cost" },
    "revenue_items",
  );
  assert.equal(okRow(out[0]).moneyCents.price, 25000);
  assert.equal(okRow(out[0]).moneyCents.directCost, undefined);
});

test("a mapped header that is not in the file fails every row once, clearly", () => {
  const out = parseCatalogRows(
    table(["Name"], ["Logo design"]),
    { name: "Name", price: "Missing Column" },
    "revenue_items",
  );
  assert.equal(out[0].ok, false);
  assert.match(out[0].ok === false ? out[0].failure.reason : "", /Missing Column/);
});

test("a fully blank catalog row is dropped, not failed", () => {
  const out = parseCatalogRows(
    table(["Name", "Price"], ["Logo design", "10.00"], ["", ""]),
    { name: "Name", price: "Price" },
    "revenue_items",
  );
  assert.equal(out.length, 1);
  assert.equal(okRow(out[0]).rowNumber, 1);
});


// ---------------------------------------------------------------------------
// Final review, Finding 7: two readers of "is this a quantity" disagreed, and
// the disagreement reached the owner as a false sentence. `QUANTITY` here
// accepts a leading `+` and a bare leading `.`; `parseQty` in the ledger accepts
// neither, and `isSellableQty` mirrors the ledger — so ".5" was refused with
// "Quantity \".5\" has to be more than zero" about half a unit that was
// perfectly sellable. Normalising makes them agree, and leaves that sentence
// true of everything that can still reach it.
// ---------------------------------------------------------------------------

const qtyOf = (cell: string) => {
  const out = parseTransactionRows(
    table(["Date", "Details", "Amount", "Qty"], ["03/04/2026", "Sale", "10.00", cell]),
    { date: "Date", description: "Details", amount: "Amount", qty: "Qty" },
    { dateOrder: "dmy" },
  );
  return out[0];
};

test("a quantity a spreadsheet wrote as \".5\" or \"+2\" is read as the number it is", () => {
  // The ledger's own rule, restated: `parseQty` takes ^\d+(\.\d+)?$ and nothing
  // else, so these are the exact strings it will accept.
  assert.equal(ok(qtyOf(".5")).qty, "0.5");
  assert.equal(ok(qtyOf("+2")).qty, "2");
  assert.equal(ok(qtyOf("+.75")).qty, "0.75");
  assert.equal(ok(qtyOf("2.5")).qty, "2.5", "an ordinary quantity is untouched");
  assert.equal(ok(qtyOf("")).qty, "1", "a blank cell still means one");
});

test("normalising a quantity never changes what it is worth, so the bad ones still fail", () => {
  // The sign survives: these reach `isSellableQty` as negatives and zero, which
  // is exactly what "has to be more than zero" says about them.
  assert.equal(ok(qtyOf("-.5")).qty, "-0.5");
  assert.equal(ok(qtyOf("-1")).qty, "-1");
  assert.equal(ok(qtyOf("0")).qty, "0");
  // And a cell needing a GUESS is still quoted back untouched rather than coerced.
  const junk = qtyOf("1,000");
  assert.equal(junk.ok, false);
  assert.match(junk.ok === false ? junk.failure.reason : "", /Quantity isn't a number: "1,000"/);
});
