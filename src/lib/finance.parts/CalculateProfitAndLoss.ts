import type { Order, AdSpendEntry } from "../types";
import type { Expense } from "@/lib/legacyTypes";
import { type PeriodRange } from "../period";
import { type Pnl, isPaidExpense, expensesInRange, safeNumber, calculateOrderDeliveryCost, calculateOrderAdSpend, adDateInRange, isPackagingExpense, isPaymentFeeExpense, expenseAmountInRange, calculateExpenseAmountInRange, paidExpenseAmountInRange, saleOrdersInRange } from "./Pnl";
import { calculateCOGS, calculateAdSpendEntryTotal } from "./ComputeTimeSeries";
import { calculateRevenue, type CostBreakdown } from "./CalculateRevenueByOffer";

export function calculateCosts(
  orders: Order[],
  adSpend: AdSpendEntry[],
  expenses: Expense[],
  range: PeriodRange,
): CostBreakdown {
  const saleOrders = saleOrdersInRange(orders, range);
  const cogs = calculateCOGS(orders, range);
  const delivery = saleOrders.reduce((s, o) => s + calculateOrderDeliveryCost(o), 0);
  const orderAdCost = saleOrders.reduce((s, o) => s + calculateOrderAdSpend(o), 0);
  const standaloneAdSpend = adSpend
    .filter((a) => adDateInRange(a, range))
    .reduce((s, a) => s + calculateAdSpendEntryTotal(a), 0);
  const adCost = orderAdCost + standaloneAdSpend;
  const { fixedCosts, variableExpenses, customExpenses } = expensesInRange(expenses, range);
  const operatingExpenses = fixedCosts + variableExpenses + customExpenses;
  const activePeriodExpenses = expenses.filter((e) => expenseAmountInRange(e, range) > 0);
  const packagingCosts = activePeriodExpenses
    .filter(isPackagingExpense)
    .reduce((s, e) => s + expenseAmountInRange(e, range), 0);
  const paymentFees = activePeriodExpenses
    .filter(isPaymentFeeExpense)
    .reduce((s, e) => s + expenseAmountInRange(e, range), 0);
  const otherExpenses = Math.max(0, operatingExpenses - packagingCosts - paymentFees);

  return {
    cogs,
    delivery,
    deliveryCosts: delivery,
    packagingCosts,
    paymentFees,
    orderAdCost,
    standaloneAdSpend,
    adSpend: adCost,
    adCost,
    fixedCosts,
    variableExpenses,
    customExpenses,
    operatingExpenses,
    otherExpenses,
    totalCosts: cogs + delivery + adCost + operatingExpenses,
  };
}

export interface CostCategoryRow {
  label: string;
  amount: number;
}

export function calculateTopExpenseCategories(
  expenses: Expense[],
  range: PeriodRange,
  limit = 8,
): CostCategoryRow[] {
  const map = new Map<string, number>();
  for (const expense of expenses) {
    const amount = calculateExpenseAmountInRange(expense, range);
    if (amount <= 0) continue;
    const key =
      expense.category ||
      expense.name ||
      (expense.type === "FIXED" ? "Fixed expenses" : "Other expenses");
    map.set(key, (map.get(key) ?? 0) + amount);
  }
  return [...map.entries()]
    .map(([label, amount]) => ({ label, amount }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, limit);
}

export function calculateProfitAndLoss(
  orders: Order[],
  adSpend: AdSpendEntry[],
  expenses: Expense[],
  range: PeriodRange,
): Pnl {
  const revenue = calculateRevenue(orders, range);
  const costs = calculateCosts(orders, adSpend, expenses, range);
  const grossProfit = revenue.netRevenue - costs.cogs;
  const orderCosts = costs.cogs + costs.delivery + costs.orderAdCost;
  const orderProfit = revenue.netRevenue - orderCosts;
  const operatingProfit =
    grossProfit - costs.delivery - costs.fixedCosts - costs.variableExpenses - costs.customExpenses;
  const netProfit = operatingProfit - costs.adCost;
  const netProfitMargin = revenue.netRevenue > 0 ? (netProfit / revenue.netRevenue) * 100 : 0;

  return {
    grossSales: revenue.grossSales,
    grossRevenue: revenue.grossRevenue,
    refunds: revenue.refunds,
    discounts: revenue.discounts,
    revenue: revenue.netRevenue,
    netRevenue: revenue.netRevenue,
    cogs: costs.cogs,
    delivery: costs.delivery,
    packagingCosts: costs.packagingCosts,
    paymentFees: costs.paymentFees,
    otherExpenses: costs.otherExpenses,
    adCost: costs.adCost,
    orderAdCost: costs.orderAdCost,
    standaloneAdSpend: costs.standaloneAdSpend,
    orderCosts,
    fixedCosts: costs.fixedCosts,
    variableExpenses: costs.variableExpenses,
    customExpenses: costs.customExpenses,
    grossProfit,
    orderProfit,
    operatingProfit,
    netProfit,
    marginPct: netProfitMargin,
    grossMarginPct: revenue.netRevenue > 0 ? (grossProfit / revenue.netRevenue) * 100 : 0,
    operatingMarginPct:
      revenue.netRevenue > 0 ? (operatingProfit / revenue.netRevenue) * 100 : 0,
    netProfitMargin,
    orderCount: revenue.orderCount,
    completedOrderCount: revenue.completedOrderCount,
    pendingOrderCount: revenue.pendingOrderCount,
    refundedOrderCount: revenue.refundedOrderCount,
  };
}

export interface CashFlow {
  cashIn: number;
  cashOut: number;
  netCashFlow: number;
  cashBalanceEstimate: number;
  paidRevenue: number;
  unpaidRevenue: number;
  partiallyPaidRevenue: number;
  paidExpenses: number;
  unpaidExpenses: number;
}

export interface CashFlowAnalysis {
  cashFlow: CashFlow;
  ownerWithdrawals: number;
  ownerInvestment: number;
  paidSalaries: number;
  unpaidRevenue: number;
  totalCashIn: number;
  totalCashOut: number;
  availableCashEstimate: number;
  cashPressure: "Low" | "Medium" | "High";
  cashInRows: { label: string; help: string; amount: number; kind: "in" | "out" | "neutral" | "total" }[];
  cashOutRows: { label: string; help: string; amount: number; kind: "in" | "out" | "neutral" | "total" }[];
  positionRows: { label: string; help: string; amount: number; kind: "in" | "out" | "neutral" | "total" }[];
  warnings: { tone: "warn" | "bad" | "good"; text: string }[];
}

export function calculateCashFlow(
  orders: Order[],
  adSpend: AdSpendEntry[],
  expenses: Expense[],
  range: PeriodRange,
  openingCash = 0,
): CashFlow {
  const revenue = calculateRevenue(orders, range);
  const cashIn = revenue.paidRevenue;
  const costs = calculateCosts(orders, adSpend, expenses, range);
  const paidOperatingExpenses = expenses.reduce(
    (s, e) => s + paidExpenseAmountInRange(e, range),
    0,
  );
  const unpaidOperatingExpenses = expenses.reduce((s, e) => {
    if (isPaidExpense(e)) return s;
    return s + expenseAmountInRange(e, range);
  }, 0);
  const cashOut =
    costs.cogs + costs.delivery + costs.orderAdCost + costs.standaloneAdSpend + paidOperatingExpenses;
  const netCashFlow = cashIn - cashOut;
  return {
    cashIn,
    cashOut,
    netCashFlow,
    cashBalanceEstimate: safeNumber(openingCash) + netCashFlow,
    paidRevenue: revenue.paidRevenue,
    unpaidRevenue: revenue.unpaidRevenue,
    partiallyPaidRevenue: revenue.partiallyPaidRevenue,
    paidExpenses: paidOperatingExpenses,
    unpaidExpenses: unpaidOperatingExpenses,
  };
}
