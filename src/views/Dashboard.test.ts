import test from "node:test";
import assert from "node:assert/strict";
import { buildTopRevenues } from "./dashboardMetrics";
import type { Order, OrderItem } from "../lib/types";

function item(patch: Partial<OrderItem> = {}): OrderItem {
  return {
    id: "item_1",
    productId: "off_1",
    productName: "Item",
    quantity: 1,
    unitSellingPrice: 100,
    unitCostPrice: 40,
    ...patch,
  };
}

function order(patch: Partial<Order> = {}): Order {
  const items = patch.items ?? [item()];
  return {
    id: "ord_1",
    customer: null,
    phone: null,
    source: "manual",
    platform: "Manual",
    externalId: null,
    paymentStatus: "paid",
    sellingPrice: items.reduce((s, i) => s + i.quantity * i.unitSellingPrice, 0),
    costPrice: items.reduce((s, i) => s + i.quantity * i.unitCostPrice, 0),
    discount: 0,
    refundAmount: 0,
    taxAmount: 0,
    shippingCharged: 0,
    deliveryCost: 0,
    adCost: 0,
    date: "2026-01-01T00:00:00.000Z",
    status: "completed",
    notes: null,
    items,
    productName: items.length > 1 ? `${items[0].productName} +${items.length - 1}` : items[0].productName,
    productId: items[0].productId,
    ...patch,
  };
}

test("a multi-item cart order splits net revenue across every item's label", () => {
  const cart = order({
    id: "ord_cart",
    items: [
      item({ productId: "off_wallet", productName: "Wallet", quantity: 2, unitSellingPrice: 300 }),
      item({ productId: "off_keychain", productName: "Keychain", quantity: 1, unitSellingPrice: 200 }),
      item({ productId: "off_belt", productName: "Belt", quantity: 1, unitSellingPrice: 100 }),
    ],
  });

  const rows = buildTopRevenues([cart]);
  const byLabel = new Map(rows.map((r) => [r.label, r.amount]));

  // Gross is 600 + 200 + 100 = 900, matching sellingPrice, so shares are exact fractions of it.
  assert.ok(Math.abs((byLabel.get("Wallet") ?? 0) - 600) < 0.01);
  assert.ok(Math.abs((byLabel.get("Keychain") ?? 0) - 200) < 0.01);
  assert.ok(Math.abs((byLabel.get("Belt") ?? 0) - 100) < 0.01);

  // No single label should hold the combined "+N" total.
  assert.equal(byLabel.has("Wallet +2"), false);
  for (const amount of byLabel.values()) {
    assert.notEqual(amount, 900);
  }
});

test("a plain single-item order behaves exactly as before", () => {
  const single = order({ items: [item({ productId: "off_wallet", productName: "Wallet", unitSellingPrice: 300 })] });

  const rows = buildTopRevenues([single]);

  assert.equal(rows.length, 1);
  assert.equal(rows[0].label, "Wallet");
  assert.equal(rows[0].amount, 300);
});
