import { format, startOfWeek, startOfMonth } from "date-fns";
import type { Order, AdSpendEntry } from "../types";
import type { Expense } from "@/lib/legacyTypes";
import { type PeriodRange, buildPeriodRangeFromDates, isDateInPeriodRange, type Period } from "../period";
import { type Pnl, safeNumber, calculateOrderNetRevenue, calculateOrderCOGS, calculateOrderDeliveryCost, calculateOrderAdSpend, calculateOrderTotalCost, expenseText, calculateExpenseAmountInRange, activeOrders, saleOrders, validAdSpend } from "./Pnl";

export function rangeFromData(input: {
  orders?: Order[];
  adSpend?: AdSpendEntry[];
  expenses?: Expense[];
  label?: string;
}): PeriodRange {
  const dates = [
    ...(input.orders ?? []).map((row) => new Date(row.date)),
    ...(input.adSpend ?? []).map((row) => new Date(row.date)),
    ...(input.expenses ?? []).map((row) => new Date(row.date)),
  ].filter((date) => !Number.isNaN(date.getTime()));
  if (dates.length === 0) {
    const now = new Date();
    return buildPeriodRangeFromDates(now, now, input.label ?? "All Time");
  }
  const first = new Date(Math.min(...dates.map((date) => date.getTime())));
  const last = new Date(Math.max(...dates.map((date) => date.getTime())));
  return buildPeriodRangeFromDates(first, last, input.label ?? "All Time");
}

export function calculateCOGS(orders: Order[], range?: PeriodRange): number {
  return saleOrders(orders, range).reduce((sum, order) => sum + calculateOrderCOGS(order), 0);
}

/**
 * The app-wide "Expenses" number: actual money-out transactions only — expense, fee,
 * and adjustment records (the store's `expenses` array) plus ad spend records.
 * Product costs embedded in sales (COGS/delivery) are NOT expenses — they surface
 * separately as "Product Costs". Refunds are a revenue reduction, never an expense.
 * Every page labeled "Expenses" must use this so the number reconciles everywhere.
 */
export function calculateUnifiedExpenses(
  expenses: Expense[],
  adSpend: AdSpendEntry[],
  range?: PeriodRange,
): number {
  const inRange = (date: string) => !range || isDateInPeriodRange(date, range);
  const expenseTotal = expenses.reduce(
    (sum, expense) => (inRange(expense.date) ? sum + Math.abs(safeNumber(expense.amount)) : sum),
    0,
  );
  const adTotal = adSpend.reduce(
    (sum, entry) => (inRange(entry.date) ? sum + Math.abs(safeNumber(entry.totalSpend)) : sum),
    0,
  );
  return expenseTotal + adTotal;
}

export function calculateProfitMargin(
  profitOrPnl: number | Pick<Pnl, "netProfit" | "netRevenue">,
  revenue?: number,
): number {
  const profit = typeof profitOrPnl === "number" ? profitOrPnl : profitOrPnl.netProfit;
  const denominator = typeof profitOrPnl === "number" ? safeNumber(revenue) : profitOrPnl.netRevenue;
  return denominator > 0 ? (profit / denominator) * 100 : 0;
}




export function calculateExpenseTotalByTerms(
  expenses: Expense[],
  range: PeriodRange,
  terms: string[],
): number {
  return expenses.reduce((sum, expense) => {
    if (!terms.some((term) => expenseText(expense).includes(term))) return sum;
    return sum + calculateExpenseAmountInRange(expense, range);
  }, 0);
}

export function calculateAdSpendEntryTotal(entry: AdSpendEntry): number {
  return safeNumber(entry.totalSpend);
}

export function calculateTrueProfitPerTransaction(input: {
  sellingPrice: number;
  costPrice?: number;
  deliveryCost?: number;
  adCost?: number;
  discount?: number;
  refund?: number;
}): { profit: number; marginPct: number } {
  const revenue =
    safeNumber(input.sellingPrice) - safeNumber(input.discount) - safeNumber(input.refund);
  const costs =
    safeNumber(input.costPrice) + safeNumber(input.deliveryCost) + safeNumber(input.adCost);
  const profit = revenue - costs;
  return {
    profit,
    marginPct: calculateProfitMargin(profit, revenue),
  };
}

export interface FinanceSummary {
  totalRevenue: number;
  totalCogs: number;
  totalDelivery: number;
  totalOrderAdCost: number;
  totalAdSpend: number;
  totalExpenses: number;
  netProfit: number;
  profitMarginPct: number;
  orderCount: number;
}

export function computeSummary(
  orders: Order[],
  adSpend: AdSpendEntry[],
  range?: PeriodRange,
): FinanceSummary {
  const active = saleOrders(orders, range);
  const totalRevenue = active.reduce((sum, order) => sum + calculateOrderNetRevenue(order), 0);
  const totalCogs = active.reduce((sum, order) => sum + calculateOrderCOGS(order), 0);
  const totalDelivery = active.reduce((sum, order) => sum + calculateOrderDeliveryCost(order), 0);
  const totalOrderAdCost = active.reduce((sum, order) => sum + calculateOrderAdSpend(order), 0);
  const totalAdSpend = validAdSpend(adSpend, range).reduce(
    (sum, entry) => sum + calculateAdSpendEntryTotal(entry),
    0,
  );
  const totalExpenses = totalCogs + totalDelivery + totalOrderAdCost + totalAdSpend;
  const netProfit = totalRevenue - totalExpenses;
  return {
    totalRevenue,
    totalCogs,
    totalDelivery,
    totalOrderAdCost,
    totalAdSpend,
    totalExpenses,
    netProfit,
    profitMarginPct: calculateProfitMargin(netProfit, totalRevenue),
    orderCount: active.length,
  };
}

export function bucketKey(date: Date, period: Period): string {
  if (period === "daily") return format(date, "yyyy-MM-dd");
  if (period === "weekly") return format(startOfWeek(date, { weekStartsOn: 1 }), "yyyy-MM-dd");
  return format(startOfMonth(date), "yyyy-MM");
}

export function bucketLabel(date: Date, period: Period): string {
  if (period === "daily") return format(date, "MMM d");
  if (period === "weekly") return "Wk " + format(startOfWeek(date, { weekStartsOn: 1 }), "MMM d");
  return format(startOfMonth(date), "MMM yy");
}

export interface TimePoint {
  label: string;
  revenue: number;
  expenses: number;
  profit: number;
  cogs: number;
  delivery: number;
  adCost: number;
}

export function computeTimeSeries(
  orders: Order[],
  adSpend: AdSpendEntry[],
  period: Period,
): TimePoint[] {
  const map = new Map<string, TimePoint>();

  const ensure = (date: Date) => {
    const key = bucketKey(date, period);
    if (!map.has(key)) {
      map.set(key, {
        label: bucketLabel(date, period),
        revenue: 0,
        expenses: 0,
        profit: 0,
        cogs: 0,
        delivery: 0,
        adCost: 0,
      });
    }
    return map.get(key)!;
  };

  for (const order of activeOrders(orders)) {
    const date = new Date(order.date);
    if (Number.isNaN(date.getTime())) continue;
    const point = ensure(date);
    const revenue = calculateOrderNetRevenue(order);
    const costs = calculateOrderTotalCost(order);
    point.revenue += revenue;
    point.expenses += costs;
    point.profit += revenue - costs;
    point.cogs += calculateOrderCOGS(order);
    point.delivery += calculateOrderDeliveryCost(order);
    point.adCost += calculateOrderAdSpend(order);
  }

  for (const entry of adSpend) {
    const date = new Date(entry.date);
    if (Number.isNaN(date.getTime())) continue;
    const spend = calculateAdSpendEntryTotal(entry);
    const point = ensure(date);
    point.expenses += spend;
    point.profit -= spend;
    point.adCost += spend;
  }

  return [...map.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([, value]) => value);
}

export interface ExpenseStats {
  totalExpenses: number;
  avgDailyExpense: number;
  burnRate: number;
  highestCategory: string;
  cogs: number;
  delivery: number;
  adCost: number;
}

export function computeExpenseStats(orders: Order[], adSpend: AdSpendEntry[]): ExpenseStats {
  const summary = computeSummary(orders, adSpend);
  const timeSeries = computeTimeSeries(orders, adSpend, "daily");
  const activeDays = timeSeries.filter((point) => point.expenses > 0).length || 1;
  const allDays = timeSeries.length || 1;
  const adCost = summary.totalOrderAdCost + summary.totalAdSpend;
  const highestCategory =
    summary.totalCogs >= summary.totalDelivery && summary.totalCogs >= adCost
      ? "COGS"
      : summary.totalDelivery >= adCost
        ? "Delivery"
        : "Ad Spend";
  return {
    totalExpenses: summary.totalExpenses,
    avgDailyExpense: summary.totalExpenses / activeDays,
    burnRate: summary.totalExpenses / allDays,
    highestCategory,
    cogs: summary.totalCogs,
    delivery: summary.totalDelivery,
    adCost,
  };
}

export interface RevenueBreakdown {
  grossRevenue: number;
  grossSales: number;
  refunds: number;
  discounts: number;
  shippingCollected: number;
  taxCollected: number;
  netRevenue: number;
  revenue: number;
  averageOrderValue: number;
  paidRevenue: number;
  unpaidRevenue: number;
  partiallyPaidRevenue: number;
  orderCount: number;
  completedOrderCount: number;
  pendingOrderCount: number;
  refundedOrderCount: number;
}

export interface RevenueMoneyRow {
  label: string;
  gross: number;
  discounts: number;
  refunds: number;
  net: number;
  quantity: number;
  orders: number;
}

export interface RevenueTrendPoint {
  label: string;
  gross: number;
  net: number;
  refunds: number;
  discounts: number;
}
