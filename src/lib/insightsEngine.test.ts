import test from "node:test";
import assert from "node:assert/strict";
import type { Expense } from "@/lib/legacyTypes";
import { buildPeriodRangeFromDates } from "./period";
import { generateInsights } from "./insightsEngine";
import type { AdSpendEntry, Order, Product } from "./types";

const range = buildPeriodRangeFromDates(
  new Date("2026-01-01T00:00:00.000Z"),
  new Date("2026-01-31T23:59:59.999Z"),
  "January",
);

function product(patch: Partial<Product> = {}): Product {
  return {
    id: "prod_1",
    name: "Service Package A",
    sku: null,
    category: "offer_type:service",
    defaultCostPrice: 0,
    defaultSellingPrice: 0,
    packagingCost: 0,
    defaultShippingCost: 0,
    imageColor: "210 8% 50%",
    supplier: null,
    lowStockAlertLevel: 0,
    status: "active",
    notes: null,
    ...patch,
  };
}

function order(patch: Partial<Order>): Order {
  const productId = patch.productId ?? "prod_1";
  const productName = patch.productName ?? "Service Package A";
  const sellingPrice = patch.sellingPrice ?? 100;
  const costPrice = patch.costPrice ?? 40;
  return {
    id: "ord_base",
    customer: "Customer",
    phone: null,
    source: "manual",
    platform: "Manual",
    externalId: null,
    paymentStatus: "paid",
    sellingPrice,
    costPrice,
    discount: 0,
    refundAmount: 0,
    taxAmount: 0,
    shippingCharged: 0,
    deliveryCost: 0,
    adCost: 0,
    date: "2026-01-10T12:00:00.000Z",
    status: "completed",
    notes: null,
    items: [
      {
        id: "item_1",
        productId,
        productName,
        quantity: 1,
        unitSellingPrice: sellingPrice,
        unitCostPrice: costPrice,
      },
    ],
    productName,
    productId,
    ...patch,
  };
}

function expense(patch: Partial<Expense>): Expense {
  return {
    id: "exp_base",
    name: "Rent",
    amount: 100,
    type: "VARIABLE",
    frequency: null,
    date: "2026-01-10T00:00:00.000Z",
    status: "active",
    paymentStatus: "paid",
    category: "Rent",
    vendor: null,
    attachmentName: null,
    orderId: null,
    note: null,
    ...patch,
  };
}

function adSpend(patch: Partial<AdSpendEntry>): AdSpendEntry {
  return {
    id: "ad_base",
    date: "2026-01-10T00:00:00.000Z",
    totalSpend: 100,
    platform: "Meta",
    campaign: "Campaign A",
    productId: "prod_1",
    source: "manual",
    ...patch,
  };
}

test("returns a neutral empty-state insight when there is no business data", () => {
  const insights = generateInsights({
    orders: [],
    products: [],
    adSpend: [],
    expenses: [],
    range,
  });

  assert.equal(insights.length, 1);
  assert.equal(insights[0].id, "summary-not-enough-data");
  assert.equal(insights[0].severity, "neutral");
});

test("detects revenue up while profit goes down", () => {
  const insights = generateInsights({
    orders: [
      order({
        id: "prior",
        date: "2025-12-10T12:00:00.000Z",
        sellingPrice: 100,
        costPrice: 20,
      }),
      order({
        id: "current",
        date: "2026-01-10T12:00:00.000Z",
        sellingPrice: 200,
        costPrice: 190,
      }),
    ],
    products: [product()],
    adSpend: [],
    expenses: [],
    range,
  });

  assert.ok(insights.some((insight) => insight.id === "summary-revenue-up-profit-down"));
});

test("detects high revenue offers with weak margin", () => {
  const insights = generateInsights({
    orders: [
      order({
        id: "low_margin",
        sellingPrice: 1000,
        costPrice: 930,
      }),
    ],
    products: [product()],
    adSpend: [],
    expenses: [],
    range,
  });

  assert.ok(insights.some((insight) => insight.id.startsWith("offers-high-revenue-low-margin")));
});

test("detects cost category spikes against the prior period", () => {
  const insights = generateInsights({
    orders: [],
    products: [],
    adSpend: [],
    expenses: [
      expense({ id: "prior_rent", amount: 100, date: "2025-12-10T00:00:00.000Z" }),
      expense({ id: "current_rent", amount: 250, date: "2026-01-10T00:00:00.000Z" }),
    ],
    range,
  });

  assert.ok(insights.some((insight) => insight.id === "costs-spike-rent"));
});

test("detects ad spend pressure when ads grow faster than revenue and profit", () => {
  const insights = generateInsights({
    orders: [
      order({ id: "prior", date: "2025-12-10T12:00:00.000Z", sellingPrice: 1000, costPrice: 300 }),
      order({ id: "current", date: "2026-01-10T12:00:00.000Z", sellingPrice: 1050, costPrice: 300 }),
    ],
    products: [product()],
    adSpend: [
      adSpend({ id: "prior_ad", date: "2025-12-10T00:00:00.000Z", totalSpend: 50 }),
      adSpend({ id: "current_ad", date: "2026-01-10T00:00:00.000Z", totalSpend: 300 }),
    ],
    expenses: [],
    range,
  });

  assert.ok(insights.some((insight) => insight.id === "ads-spend-pressure"));
});

test("detects healthy offer winners", () => {
  const insights = generateInsights({
    orders: [order({ id: "winner", sellingPrice: 500, costPrice: 100 })],
    products: [product()],
    adSpend: [],
    expenses: [],
    range,
  });

  assert.ok(insights.some((insight) => insight.id.startsWith("offers-winner")));
});
