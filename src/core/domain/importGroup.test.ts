import test from "node:test";
import assert from "node:assert/strict";
import { groupTransactionRows, willGroup } from "./importGroup";
import type { ParsedTxnRow } from "./importRows";

function row(over: Partial<ParsedTxnRow> & { rowNumber: number }): ParsedTxnRow {
  return {
    orderId: null, occurredOn: "2026-04-03", paidOn: { mode: "follows" },
    description: "Thing", amountCents: 1000, direction: "in",
    itemName: null, qty: "1", categoryName: null, channelName: null, personName: null,
    taxCollectedCents: 0, shippingChargedCents: 0, discountCents: 0,
    reference: null, notes: null, ...over,
  };
}
const groupOf = (o: ReturnType<typeof groupTransactionRows>[number]) => {
  assert.equal(o.ok, true, o.ok === false ? o.reason : "");
  return o.ok === true ? o.group : (undefined as never);
};

test("rows with no order id each stand alone", () => {
  const out = groupTransactionRows([row({ rowNumber: 1 }), row({ rowNumber: 2 })], { totalsAre: "whole_order" });
  assert.equal(out.length, 2);
  assert.equal(groupOf(out[0]).lines.length, 1);
  assert.equal(willGroup([row({ rowNumber: 1 }), row({ rowNumber: 2 })]), false);
});

test("three rows sharing an id become one order with three lines", () => {
  const out = groupTransactionRows([
    row({ rowNumber: 1, orderId: "#1001", description: "T-shirt", amountCents: 2000 }),
    row({ rowNumber: 2, orderId: "#1001", description: "Mug", amountCents: 1000 }),
    row({ rowNumber: 3, orderId: "#1001", description: "Sticker", amountCents: 500 }),
  ], { totalsAre: "whole_order" });
  assert.equal(out.length, 1);
  const g = groupOf(out[0]);
  assert.equal(g.orderId, "#1001");
  assert.equal(g.lines.length, 3);
  assert.deepEqual(g.rowNumbers, [1, 2, 3]);
  assert.equal(g.lines.reduce((sum, l) => sum + l.amountCents, 0), 3500);
});

test("rows for one order need not be adjacent", () => {
  const out = groupTransactionRows([
    row({ rowNumber: 1, orderId: "#1001", amountCents: 2000 }),
    row({ rowNumber: 2, orderId: "#1002", amountCents: 700 }),
    row({ rowNumber: 3, orderId: "#1001", amountCents: 1000 }),
  ], { totalsAre: "whole_order" });
  assert.equal(out.length, 2);
  assert.equal(groupOf(out[0]).orderId, "#1001", "first appearance sets the order");
  assert.equal(groupOf(out[0]).lines.length, 2);
});

test("an order-level value present on only the first row is used for the order", () => {
  const out = groupTransactionRows([
    row({ rowNumber: 1, orderId: "#1", taxCollectedCents: 400, personName: "Acme" }),
    row({ rowNumber: 2, orderId: "#1", taxCollectedCents: 0, personName: null }),
  ], { totalsAre: "whole_order" });
  const g = groupOf(out[0]);
  assert.equal(g.taxCollectedCents, 400);
  assert.equal(g.personName, "Acme");
});

test("an order-level value repeated on every row is counted once, not summed", () => {
  // Summing would treble the tax on a three-item order.
  const out = groupTransactionRows([
    row({ rowNumber: 1, orderId: "#1", taxCollectedCents: 400 }),
    row({ rowNumber: 2, orderId: "#1", taxCollectedCents: 400 }),
    row({ rowNumber: 3, orderId: "#1", taxCollectedCents: 400 }),
  ], { totalsAre: "whole_order" });
  assert.equal(groupOf(out[0]).taxCollectedCents, 400);
});

test("per-item totals are summed instead", () => {
  const out = groupTransactionRows([
    row({ rowNumber: 1, orderId: "#1", taxCollectedCents: 100 }),
    row({ rowNumber: 2, orderId: "#1", taxCollectedCents: 250 }),
  ], { totalsAre: "per_item" });
  assert.equal(groupOf(out[0]).taxCollectedCents, 350);
});

test("two different non-blank values for one header field refuse the group", () => {
  const out = groupTransactionRows([
    row({ rowNumber: 1, orderId: "#1", occurredOn: "2026-04-03" }),
    row({ rowNumber: 2, orderId: "#1", occurredOn: "2026-05-09" }),
  ], { totalsAre: "whole_order" });
  assert.equal(out[0].ok, false);
  const reason = out[0].ok === false ? out[0].reason : "";
  assert.match(reason, /2026-04-03/);
  assert.match(reason, /2026-05-09/);
  assert.deepEqual(out[0].ok === false ? out[0].rowNumbers : [], [1, 2]);
});

test("a conflicting whole-order total refuses the group too", () => {
  const out = groupTransactionRows([
    row({ rowNumber: 1, orderId: "#1", shippingChargedCents: 500 }),
    row({ rowNumber: 2, orderId: "#1", shippingChargedCents: 900 }),
  ], { totalsAre: "whole_order" });
  assert.equal(out[0].ok, false);
});

test("lines keep their own direction and the header takes the first row's", () => {
  const out = groupTransactionRows([
    row({ rowNumber: 1, orderId: "#1", direction: "in", amountCents: 5000 }),
    row({ rowNumber: 2, orderId: "#1", direction: "out", amountCents: 300, description: "Platform fee" }),
  ], { totalsAre: "whole_order" });
  const g = groupOf(out[0]);
  assert.equal(g.direction, "in");
  assert.equal(g.lines[1].direction, "out");
});

test("the group description is the first line's, so the list reads sensibly", () => {
  const out = groupTransactionRows([
    row({ rowNumber: 1, orderId: "#1", description: "T-shirt" }),
    row({ rowNumber: 2, orderId: "#1", description: "Mug" }),
  ], { totalsAre: "whole_order" });
  assert.equal(groupOf(out[0]).description, "T-shirt");
});

test("willGroup is true only when an id actually repeats", () => {
  assert.equal(willGroup([row({ rowNumber: 1, orderId: "#1" }), row({ rowNumber: 2, orderId: "#2" })]), false);
  assert.equal(willGroup([row({ rowNumber: 1, orderId: "#1" }), row({ rowNumber: 2, orderId: "#1" })]), true);
});

// ---------------------------------------------------------------------------
// The shapes a real export throws at this that the cases above do not: the
// order-level value written last instead of first, an id that is blank rather
// than absent, interleaved orders, and the money in a refusal read back in the
// owner's own units.
// ---------------------------------------------------------------------------

test("an order-level value present on only the LAST row is still the order's", () => {
  // Some exports write the totals against the final line of the order. First
  // non-blank means first non-blank, not first row.
  const out = groupTransactionRows([
    row({ rowNumber: 1, orderId: "#1", taxCollectedCents: 0, personName: null }),
    row({ rowNumber: 2, orderId: "#1", taxCollectedCents: 400, personName: "Acme" }),
  ], { totalsAre: "whole_order" });
  const g = groupOf(out[0]);
  assert.equal(g.taxCollectedCents, 400);
  assert.equal(g.personName, "Acme");
});

test("a blank order id groups nothing, whether it is empty or absent", () => {
  // A file with an Order ID column that is simply not filled in must not
  // collapse three unrelated bank rows into one order.
  const rows = [
    row({ rowNumber: 1, orderId: "" }),
    row({ rowNumber: 2, orderId: null }),
    row({ rowNumber: 3, orderId: "   " }),
  ];
  const out = groupTransactionRows(rows, { totalsAre: "whole_order" });
  assert.equal(out.length, 3);
  assert.deepEqual(out.map((o) => groupOf(o).orderId), [null, null, null]);
  assert.equal(willGroup(rows), false);
});

test("one row with an order id is still an order", () => {
  const out = groupTransactionRows([row({ rowNumber: 4, orderId: "#7" })], { totalsAre: "whole_order" });
  const g = groupOf(out[0]);
  assert.equal(g.orderId, "#7");
  assert.equal(g.lines.length, 1);
  assert.deepEqual(g.rowNumbers, [4]);
});

test("interleaved orders keep their own rows, in the order the file wrote them", () => {
  const out = groupTransactionRows([
    row({ rowNumber: 1, orderId: "#1001" }),
    row({ rowNumber: 2, orderId: "#1002" }),
    row({ rowNumber: 3, orderId: "#1001" }),
    row({ rowNumber: 4, orderId: "#1002" }),
  ], { totalsAre: "whole_order" });
  assert.equal(out.length, 2);
  assert.deepEqual(groupOf(out[0]).rowNumbers, [1, 3]);
  assert.deepEqual(groupOf(out[1]).rowNumbers, [2, 4]);
  assert.equal(groupOf(out[1]).orderId, "#1002");
});

test("a blank per-item total adds nothing rather than refusing", () => {
  const out = groupTransactionRows([
    row({ rowNumber: 1, orderId: "#1", taxCollectedCents: 100 }),
    row({ rowNumber: 2, orderId: "#1", taxCollectedCents: 0 }),
    row({ rowNumber: 3, orderId: "#1", taxCollectedCents: 250 }),
  ], { totalsAre: "per_item" });
  assert.equal(groupOf(out[0]).taxCollectedCents, 350);
});

test("per-item mode never refuses a total, however the rows differ", () => {
  // The caller has said these are per-item figures, so two different numbers
  // are two items' tax, not a disagreement.
  const out = groupTransactionRows([
    row({ rowNumber: 1, orderId: "#1", shippingChargedCents: 500 }),
    row({ rowNumber: 2, orderId: "#1", shippingChargedCents: 900 }),
  ], { totalsAre: "per_item" });
  assert.equal(groupOf(out[0]).shippingChargedCents, 1400);
});

test("a refusal names the field and both values", () => {
  const out = groupTransactionRows([
    row({ rowNumber: 1, orderId: "#1", personName: "Acme" }),
    row({ rowNumber: 2, orderId: "#1", personName: "Globex" }),
  ], { totalsAre: "whole_order" });
  const reason = out[0].ok === false ? out[0].reason : "";
  assert.match(reason, /person/);
  assert.match(reason, /Acme/);
  assert.match(reason, /Globex/);
});

test("a refused amount is quoted the way the file writes money, not in cents", () => {
  // The owner reads this sentence next to their spreadsheet, where the cell
  // says 5.00. Handing them "500" sends them looking for a number they never
  // wrote.
  const out = groupTransactionRows([
    row({ rowNumber: 1, orderId: "#1", shippingChargedCents: 500 }),
    row({ rowNumber: 2, orderId: "#1", shippingChargedCents: 900 }),
  ], { totalsAre: "whole_order" });
  const reason = out[0].ok === false ? out[0].reason : "";
  assert.match(reason, /"5\.00"/);
  assert.match(reason, /"9\.00"/);
});

test("rows agreeing on when they were paid keep the paid date", () => {
  const out = groupTransactionRows([
    row({ rowNumber: 1, orderId: "#1", paidOn: { mode: "on", iso: "2026-04-10" } }),
    row({ rowNumber: 2, orderId: "#1", paidOn: { mode: "follows" } }),
  ], { totalsAre: "whole_order" });
  assert.deepEqual(groupOf(out[0]).paidOn, { mode: "on", iso: "2026-04-10" });
});

test("one row saying unpaid and another saying a date refuses", () => {
  // Owed money and settled money are different figures on every screen that
  // shows either, so this one is not picked for the owner.
  const out = groupTransactionRows([
    row({ rowNumber: 1, orderId: "#1", paidOn: { mode: "unpaid" } }),
    row({ rowNumber: 2, orderId: "#1", paidOn: { mode: "on", iso: "2026-04-10" } }),
  ], { totalsAre: "whole_order" });
  assert.equal(out[0].ok, false);
  const reason = out[0].ok === false ? out[0].reason : "";
  assert.match(reason, /unpaid/);
  assert.match(reason, /2026-04-10/);
});

test("rows that all say follows leave the group following its own date", () => {
  const out = groupTransactionRows([
    row({ rowNumber: 1, orderId: "#1" }),
    row({ rowNumber: 2, orderId: "#1" }),
  ], { totalsAre: "whole_order" });
  assert.deepEqual(groupOf(out[0]).paidOn, { mode: "follows" });
});

test("fifty rows of one order are one order with fifty lines", () => {
  const rows = Array.from({ length: 50 }, (_, i) => row({ rowNumber: i + 1, orderId: "#9", amountCents: 100 }));
  const out = groupTransactionRows(rows, { totalsAre: "whole_order" });
  assert.equal(out.length, 1);
  const g = groupOf(out[0]);
  assert.equal(g.lines.length, 50);
  assert.equal(g.lines.reduce((sum, l) => sum + l.amountCents, 0), 5000);
});

test("every row lands somewhere: a line in a group, or a row number on a refusal", () => {
  // A grouper that loses a line loses money.
  const rows = [
    row({ rowNumber: 1, orderId: "#1001" }),
    row({ rowNumber: 2 }),
    row({ rowNumber: 3, orderId: "#1001" }),
    row({ rowNumber: 4, orderId: "#1002", occurredOn: "2026-04-03" }),
    row({ rowNumber: 5, orderId: "#1002", occurredOn: "2026-06-01" }),
    row({ rowNumber: 6, orderId: "" }),
  ];
  const out = groupTransactionRows(rows, { totalsAre: "whole_order" });
  const accounted = out.flatMap((o) => (o.ok ? o.group.lines.map((l) => l.rowNumber) : o.rowNumbers));
  assert.deepEqual(accounted.slice().sort((a, b) => a - b), [1, 2, 3, 4, 5, 6]);
  assert.equal(new Set(accounted).size, rows.length, "and lands there exactly once");
});

test("an empty file makes no orders", () => {
  assert.deepEqual(groupTransactionRows([], { totalsAre: "whole_order" }), []);
  assert.equal(willGroup([]), false);
});

test("lines carry the row's item, category and quantity through unchanged", () => {
  const out = groupTransactionRows([
    row({ rowNumber: 1, orderId: "#1", description: "T-shirt", itemName: "Tee", categoryName: "Apparel", qty: "2", amountCents: 2000 }),
  ], { totalsAre: "whole_order" });
  assert.deepEqual(groupOf(out[0]).lines[0], {
    rowNumber: 1, label: "T-shirt", itemName: "Tee", categoryName: "Apparel",
    qty: "2", amountCents: 2000, direction: "in",
  });
});
