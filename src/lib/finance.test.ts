import test from "node:test";
import assert from "node:assert/strict";
import { buildPeriodRangeFromDates } from "./period";
import {
  calculateAdSpend,
  calculateBreakEvenROAS,
  calculateCashFlowAnalysis,
  calculateCashFlow,
  calculateCOGS,
  calculateCosts,
  calculateDiscounts,
  calculateGrossProfit,
  calculateGrossRevenue,
  calculateMarkup,
  calculateNetProfit,
  calculateNetRevenue,
  calculateOperatingExpenses,
  calculateProfitAndLoss,
  calculateProfitMargin,
  calculateRefunds,
  calculateRevenueByOffer,
  calculateRevenueBySource,
  calculateRevenueTrend,
  calculateTopExpenseCategories,
  calculateUnifiedExpenses,
} from "./finance";
import type { AdSpendEntry, Order } from "./types";

const range = buildPeriodRangeFromDates(
  new Date("2026-01-01T00:00:00.000Z"),
  new Date("2026-01-31T23:59:59.999Z"),
  "January",
);

function order(patch: Partial<Order>): Order {
  return {
    id: "ord_base",
    customer: "Customer",
    phone: null,
    source: "manual",
    platform: "Manual",
    externalId: null,
    paymentStatus: "paid",
    sellingPrice: 0,
    costPrice: 0,
    discount: 0,
    refundAmount: 0,
    taxAmount: 0,
    shippingCharged: 0,
    deliveryCost: 0,
    adCost: 0,
    date: "2026-01-10T12:00:00.000Z",
    status: "completed",
    notes: null,
    items: [],
    productName: "Offer",
    productId: "prod_1",
    ...patch,
  };
}

function expense(patch: Record<string, unknown>) {
  return {
    id: "exp_base",
    userId: "user_1",
    name: "Expense",
    amount: 0,
    type: "VARIABLE",
    frequency: null,
    date: "2026-01-10T00:00:00.000Z",
    status: "active",
    paymentStatus: "paid",
    category: null,
    vendor: null,
    attachmentName: null,
    orderId: null,
    note: null,
    ...patch,
  } as never;
}

const orders = [
  order({
    id: "ord_paid",
    sellingPrice: 100,
    costPrice: 40,
    discount: 10,
    deliveryCost: 5,
    adCost: 10,
    paymentStatus: "paid",
  }),
  order({
    id: "ord_refunded",
    sellingPrice: 50,
    costPrice: 20,
    refundAmount: 50,
    status: "refunded",
    paymentStatus: "unpaid",
  }),
  order({
    id: "ord_cancelled",
    sellingPrice: 999,
    costPrice: 999,
    status: "cancelled",
  }),
];

const adSpend: AdSpendEntry[] = [
  {
    id: "ad_1",
    date: "2026-01-12T00:00:00.000Z",
    totalSpend: 20,
    productId: null,
    platform: "Meta",
    campaign: "Test",
    source: "manual",
  },
];

const expenses = [
  expense({
    id: "exp_fixed",
    name: "Rent",
    amount: 310,
    type: "FIXED",
    frequency: "Monthly",
    date: "2026-01-01T00:00:00.000Z",
  }),
  expense({ id: "exp_variable", name: "Courier", amount: 25, type: "VARIABLE", paymentStatus: "unpaid" }),
  expense({ id: "exp_custom", name: "One-off", amount: 15, type: "CUSTOM" }),
  expense({ id: "exp_paused", name: "Paused", amount: 999, type: "VARIABLE", status: "paused" }),
];

test("calculates gross revenue, discounts, refunds, and net revenue", () => {
  assert.equal(calculateGrossRevenue(orders, range), 150);
  assert.equal(calculateDiscounts(orders, range), 10);
  assert.equal(calculateRefunds(orders, range), 50);
  assert.equal(calculateNetRevenue(orders, range), 90);
});

test("calculates costs without counting cancelled or refunded order COGS", () => {
  assert.equal(calculateCOGS(orders, range), 40);
  assert.equal(calculateAdSpend(orders, adSpend, range), 30);
  assert.equal(calculateOperatingExpenses(expenses, range), 350);

  const costs = calculateCosts(orders, adSpend, expenses, range);
  assert.equal(costs.cogs, 40);
  assert.equal(costs.delivery, 5);
  assert.equal(costs.orderAdCost, 10);
  assert.equal(costs.standaloneAdSpend, 20);
  assert.equal(costs.adCost, 30);
  assert.equal(costs.totalCosts, 425);
});

test("calculates gross profit, net profit, margins, and markup", () => {
  assert.equal(calculateGrossProfit(orders, range), 50);
  assert.equal(calculateNetProfit(orders, adSpend, expenses, range), -335);
  assert.equal(calculateProfitMargin(-335, 90), -372.22222222222223);
  assert.equal(calculateProfitMargin(10, 0), 0);
  assert.equal(calculateMarkup(50, 50), 100);
  assert.equal(calculateMarkup(50, 0), 0);
});

test("keeps profit and cash flow separate", () => {
  const pnl = calculateProfitAndLoss(orders, adSpend, expenses, range);
  const cashFlow = calculateCashFlow(orders, adSpend, expenses, range);

  assert.equal(pnl.orderCosts, 55);
  assert.equal(pnl.orderProfit, 35);
  assert.equal(pnl.netProfit, -335);
  assert.equal(cashFlow.cashIn, 90);
  assert.equal(cashFlow.cashOut, 400);
  assert.equal(cashFlow.netCashFlow, -310);
  assert.notEqual(cashFlow.netCashFlow, pnl.netProfit);
});

test("calculates break-even ROAS and handles empty arrays safely", () => {
  assert.equal(
    calculateBreakEvenROAS({
      product: {
        defaultSellingPrice: 100,
        defaultCostPrice: 60,
        packagingCost: 0,
        defaultShippingCost: 0,
      },
    }),
    2.5,
  );
  assert.equal(calculateGrossRevenue([], range), 0);
  assert.equal(calculateNetRevenue([], range), 0);
  assert.equal(calculateCOGS([], range), 0);
});

test("centralizes Money revenue and cost grouping helpers", () => {
  const trend = calculateRevenueTrend(orders, range, "daily");
  const byOffer = calculateRevenueByOffer(orders, range);
  const bySource = calculateRevenueBySource(orders, range);
  const topExpenses = calculateTopExpenseCategories(expenses, range);

  assert.equal(trend.reduce((sum, row) => sum + row.net, 0), 90);
  assert.equal(byOffer[0].label, "Offer");
  assert.equal(byOffer[0].net, 90);
  assert.equal(bySource[0].label, "Manual");
  assert.equal(bySource[0].net, 90);
  assert.equal(topExpenses[0].label, "Rent");
  assert.equal(topExpenses[0].amount, 310);
});


test("calculateUnifiedExpenses counts expense transactions plus ad spend only, within range", () => {
  const unifiedExpenses = [
    expense({ id: "u1", amount: 100, type: "VARIABLE", date: "2026-01-05T00:00:00.000Z" }),
    expense({ id: "u2", amount: 50, type: "CUSTOM", date: "2026-01-20T00:00:00.000Z" }),
    // Outside the range — must not count.
    expense({ id: "u3", amount: 999, type: "VARIABLE", date: "2026-02-10T00:00:00.000Z" }),
  ];
  const unifiedAdSpend: AdSpendEntry[] = [
    { id: "a1", date: "2026-01-12T00:00:00.000Z", totalSpend: 30 },
    { id: "a2", date: "2026-03-01T00:00:00.000Z", totalSpend: 500 },
  ];

  assert.equal(calculateUnifiedExpenses(unifiedExpenses, unifiedAdSpend, range), 180);
  // No range = everything counts.
  assert.equal(calculateUnifiedExpenses(unifiedExpenses, unifiedAdSpend), 1679);
  // Empty inputs are safe.
  assert.equal(calculateUnifiedExpenses([], []), 0);
});
