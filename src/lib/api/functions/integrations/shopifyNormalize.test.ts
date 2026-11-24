/**
 * What a Shopify payload MEANS, tested without a database.
 *
 * Every case here is a decision that would otherwise only be discovered against
 * a live store with real money in it.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  lineExternalId,
  lineLabel,
  moneyToCents,
  normalizeOrder,
  normalizeRefunds,
  paidAtOf,
  processingFeeCents,
  type ShopifyOrder,
} from "./shopifyNormalize";

const baseOrder = (over: Partial<ShopifyOrder> = {}): ShopifyOrder => ({
  id: 5001,
  name: "#1001",
  created_at: "2026-03-04T10:00:00Z",
  financial_status: "paid",
  currency: "PKR",
  line_items: [{ id: 1, variant_id: 900, product_id: 800, title: "Ceramic mug", quantity: 2, price: "2500.00" }],
  ...over,
});

test("money arrives as a decimal string and becomes integer minor units", () => {
  assert.equal(moneyToCents("2500.00"), 250_000);
  assert.equal(moneyToCents("0.01"), 1);
  assert.equal(moneyToCents(""), 0);
  assert.equal(moneyToCents(null), 0);
  assert.equal(moneyToCents("not money"), 0);
  // Rounded, never truncated: a lost half-paisa per line stops a backfill
  // reconciling against the platform's own totals.
  assert.equal(moneyToCents("10.005"), 1001);
});

test("a discount Shopify pinned to a line stays on that line", () => {
  const order = normalizeOrder(
    baseOrder({
      total_discounts: "500.00",
      line_items: [
        {
          id: 1,
          variant_id: 900,
          product_id: 800,
          title: "Ceramic mug",
          quantity: 2,
          price: "2500.00",
          discount_allocations: [{ amount: "500.00" }],
        },
      ],
    }),
  );
  assert.equal(order.lines[0].lineDiscountCents, 50_000);
  // Nothing left over, so nothing lands at order level — subtracting it in both
  // places would take the discount off twice.
  assert.equal(order.orderDiscountCents, 0);
});

test("a discount Shopify did not pin to a line becomes an order discount", () => {
  const order = normalizeOrder(baseOrder({ total_discounts: "300.00" }));
  assert.equal(order.lines[0].lineDiscountCents, 0);
  assert.equal(order.orderDiscountCents, 30_000);
});

test("allocations larger than the header figure never make a negative discount", () => {
  const order = normalizeOrder(
    baseOrder({
      total_discounts: "100.00",
      line_items: [
        {
          id: 1,
          variant_id: 900,
          product_id: 800,
          title: "Mug",
          quantity: 1,
          price: "2500.00",
          discount_allocations: [{ amount: "400.00" }],
        },
      ],
    }),
  );
  // A negative order discount would read as revenue appearing from nowhere.
  assert.equal(order.orderDiscountCents, 0);
});

test("tax collected is carried as its own field, never as revenue", () => {
  const order = normalizeOrder(baseOrder({ total_tax: "425.00" }));
  assert.equal(order.taxCollectedCents, 42_500);
  const revenue = order.lines.reduce((sum, l) => sum + Number(l.qty) * l.unitPriceCents, 0);
  assert.equal(revenue, 500_000, "tax is not part of what was sold");
});

test("unpaid means unpaid, and refunded still means it was paid", () => {
  assert.equal(paidAtOf(baseOrder({ financial_status: "pending" })), null);
  assert.equal(paidAtOf(baseOrder({ financial_status: "authorized" })), null);
  assert.ok(paidAtOf(baseOrder({ financial_status: "paid" })));
  // The refund is its own money event. Calling the sale unpaid because it was
  // later refunded would lose the fact that the money did arrive.
  assert.ok(paidAtOf(baseOrder({ financial_status: "refunded" })));
  assert.ok(paidAtOf(baseOrder({ financial_status: "partially_refunded" })));
});

test("the paid date is when Shopify processed it, not when we read it", () => {
  const paid = paidAtOf(baseOrder({ processed_at: "2026-03-05T12:00:00Z" }));
  assert.equal(paid?.toISOString(), "2026-03-05T12:00:00.000Z");
});

test("a variant is matched before a product", () => {
  assert.equal(
    lineExternalId({ id: 1, variant_id: 900, product_id: 800, title: "x", quantity: 1, price: "1" }),
    "variant:900",
  );
  // One mug in three sizes is three variants with three costs; collapsing them
  // onto the product would give every size the same margin.
  assert.equal(
    lineExternalId({ id: 1, variant_id: null, product_id: 800, title: "x", quantity: 1, price: "1" }),
    "product:800",
  );
  assert.equal(
    lineExternalId({ id: 1, variant_id: null, product_id: null, title: "x", quantity: 1, price: "1" }),
    null,
  );
});

test("a variant name joins the label, but Shopify's placeholder does not", () => {
  const item = { id: 1, variant_id: 1, product_id: 1, quantity: 1, price: "1" };
  assert.equal(lineLabel({ ...item, title: "Mug", variant_title: "Large" }), "Mug — Large");
  assert.equal(lineLabel({ ...item, title: "Mug", variant_title: "Default Title" }), "Mug");
  assert.equal(lineLabel({ ...item, title: "Mug", variant_title: null }), "Mug");
});

test("a test order is flagged, not imported", () => {
  assert.equal(normalizeOrder(baseOrder({ test: true })).isTest, true);
  assert.equal(normalizeOrder(baseOrder()).isTest, false);
});

test("the external ref is stable, because it is what stops a double import", () => {
  assert.equal(normalizeOrder(baseOrder()).externalRef, "shopify-order-5001");
  assert.equal(normalizeOrder(baseOrder()).externalRef, normalizeOrder(baseOrder()).externalRef);
});

test("a refund is worth what the processor actually gave back", () => {
  const refunds = normalizeRefunds(
    baseOrder({
      refunds: [
        {
          id: 77,
          created_at: "2026-03-10T10:00:00Z",
          note: "Cracked",
          refund_line_items: [{ quantity: 1, subtotal: "2500.00" }],
          // Less than the goods were worth: a restocking fee was kept. The
          // ledger has to hold the money that really moved.
          transactions: [{ amount: "2200.00", kind: "refund", status: "success" }],
        },
      ],
    }),
  );
  assert.equal(refunds.length, 1);
  assert.equal(refunds[0].amountCents, 220_000);
  assert.equal(refunds[0].restocked, true);
  assert.equal(refunds[0].externalRef, "shopify-refund-77");
});

test("a failed refund transaction is not money that moved", () => {
  const refunds = normalizeRefunds(
    baseOrder({
      refunds: [
        {
          id: 78,
          created_at: "2026-03-10T10:00:00Z",
          transactions: [{ amount: "2200.00", kind: "refund", status: "failure" }],
        },
      ],
    }),
  );
  assert.deepEqual(refunds, []);
});

test("a restock-only refund posts nothing, because nothing financial happened", () => {
  const refunds = normalizeRefunds(
    baseOrder({
      refunds: [{ id: 79, created_at: "2026-03-10T10:00:00Z", refund_line_items: [{ quantity: 1, subtotal: "0.00" }] }],
    }),
  );
  assert.deepEqual(refunds, []);
});

test("the processing fee is read from the processor, and is zero when unknown", () => {
  assert.equal(
    processingFeeCents([
      {
        id: 1,
        kind: "sale",
        status: "success",
        amount: "2500.00",
        receipt: { charges: { data: [{ balance_transaction: { fee: "72.50" } }] } },
      },
    ]),
    7_250,
  );
  // Not on Shopify Payments: no fee is reported, so no fee is claimed. A
  // percentage guess dressed as a measurement is what the money-truth rule
  // exists to forbid.
  assert.equal(processingFeeCents([{ id: 1, kind: "sale", status: "success", amount: "2500.00" }]), 0);
  // A refund transaction is not a sale and carries no acquiring fee.
  assert.equal(processingFeeCents([{ id: 2, kind: "refund", status: "success", amount: "100.00", fee: "5.00" }]), 0);
});
