import type { Order, Product, AdSpendEntry } from "./types";
import type { Expense } from "@/lib/legacyTypes";
import { buildPeriodRange, type PeriodRange } from "./period";
import { type Pnl, expensesInRange, safeNumber, calculateProductUnitEconomics, calculateOrderGrossRevenue, calculateOrderDiscount, calculateOrderRefund, safeOrderRefund, calculateOrderNetRevenue, calculateOrderAdSpend, calculateOrderTotalCost, calculateOrderProfit, orderDateInRange, activeOrders, saleOrders, validAdSpend } from "./finance.parts/Pnl";
import { rangeFromData, calculateCOGS, calculateAdSpendEntryTotal, computeTimeSeries } from "./finance.parts/ComputeTimeSeries";
import { calculateProfitAndLoss, calculateCashFlow } from "./finance.parts/CalculateProfitAndLoss";
import { type DashboardSummary, type DashboardCalculationInput, dashboardDateOnly, dashboardRangeForDay, dashboardSummary } from "./finance.parts/GetDashboardHealthStatus";
import { type MonthlyPnlPoint, computeMonthlySeries } from "./finance.parts/ComputeMonthlySeries";
export { expensesInRange, monthlyFixedCost, safeFinancialNumber, calculateProductUnitEconomics, calculateOrderGrossRevenue, calculateOrderDiscount, calculateOrderRefund, calculateOrderNetRevenue, calculateOrderCOGS, calculateOrderDeliveryCost, calculateOrderAdSpend, calculateOrderTotalCost, calculateOrderProfit, calculateOrderQuantity, orderRevenue, calculateExpenseAmountInRange, activeOrders } from "./finance.parts/Pnl";
export type { Pnl, ProductUnitEconomics } from "./finance.parts/Pnl";
export { calculateCOGS, calculateUnifiedExpenses, calculateProfitMargin, calculateExpenseTotalByTerms, calculateAdSpendEntryTotal, calculateTrueProfitPerTransaction, computeSummary, computeTimeSeries, computeExpenseStats } from "./finance.parts/ComputeTimeSeries";
export type { FinanceSummary, TimePoint, ExpenseStats, RevenueBreakdown, RevenueMoneyRow, RevenueTrendPoint } from "./finance.parts/ComputeTimeSeries";
export { filterRevenueOrders, calculateRevenueTrend, calculateRevenueByOffer, calculateRevenueBySource, calculateRevenueByClientCustomer, calculateRevenueByStatus, calculateRevenueByPaymentStatus, calculateManualVsIntegratedRevenue, calculateRevenue } from "./finance.parts/CalculateRevenueByOffer";
export type { CostBreakdown } from "./finance.parts/CalculateRevenueByOffer";
export { calculateCosts, calculateTopExpenseCategories, calculateProfitAndLoss, calculateCashFlow } from "./finance.parts/CalculateProfitAndLoss";
export type { CostCategoryRow, CashFlow, CashFlowAnalysis } from "./finance.parts/CalculateProfitAndLoss";
export { calculateCashFlowAnalysis, calculateProductPerformance } from "./finance.parts/CalculateCashFlowAnalysis";
export type { ProductPerformanceRow, ProductProfit } from "./finance.parts/CalculateCashFlowAnalysis";
export { calculateProductProfit, calculateBusinessOverview, getLast7DaysBusinessTrend, getLast12MonthsBusinessTrend, getLast6YearsBusinessTrend, getDashboardHealthStatus } from "./finance.parts/GetDashboardHealthStatus";
export type { BusinessOverview, DashboardProfitStatus, DashboardHealthTone, DashboardHealthStatus, DashboardSummary, DashboardTrendPoint, DashboardHealth, DashboardAlert, DashboardCalculationInput } from "./finance.parts/GetDashboardHealthStatus";
export { getDashboardAlerts, computeBreakeven, computeMonthlySeries } from "./finance.parts/ComputeMonthlySeries";
export type { Breakeven, MonthlyPnlPoint, ProductProfitabilityRow } from "./finance.parts/ComputeMonthlySeries";
export { productProfitability, channelPlatformMatrix, computeCostDriverDeltas } from "./finance.parts/ChannelPlatformMatrix";
export type { ChannelPlatformCell, CostDriverDelta } from "./finance.parts/ChannelPlatformMatrix";

export function orderExpenses(order: Order): number {
  return calculateOrderTotalCost(order);
}

export function orderProfit(order: Order): number {
  return calculateOrderProfit(order);
}

function recordedOrders(orders: Order[], range?: PeriodRange): Order[] {
  const rows = orders.filter((o) => o.status !== "cancelled");
  return range ? rows.filter((o) => orderDateInRange(o, range)) : rows;
}

export function calculateGrossRevenue(orders: Order[], range?: PeriodRange): number {
  return recordedOrders(orders, range).reduce(
    (sum, order) => sum + calculateOrderGrossRevenue(order),
    0,
  );
}

export function calculateDiscounts(orders: Order[], range?: PeriodRange): number {
  return recordedOrders(orders, range).reduce(
    (sum, order) => sum + calculateOrderDiscount(order),
    0,
  );
}

export function calculateRefunds(orders: Order[], range?: PeriodRange): number {
  return recordedOrders(orders, range).reduce(
    (sum, order) => sum + calculateOrderRefund(order),
    0,
  );
}

export function calculateNetRevenue(orders: Order[], range?: PeriodRange): number {
  return calculateGrossRevenue(orders, range) - calculateDiscounts(orders, range) - calculateRefunds(orders, range);
}

export function calculateGrossProfit(orders: Order[], range?: PeriodRange): number {
  return calculateNetRevenue(orders, range) - calculateCOGS(orders, range);
}

export function calculateOperatingExpenses(expenses: Expense[], range?: PeriodRange): number {
  if (!range) {
    return expenses
      .filter((expense) => expense.status === "active")
      .reduce((sum, expense) => sum + safeNumber(expense.amount), 0);
  }
  const { fixedCosts, variableExpenses, customExpenses } = expensesInRange(expenses, range);
  return fixedCosts + variableExpenses + customExpenses;
}

export function calculateAdSpend(
  orders: Order[] = [],
  adSpend: AdSpendEntry[] = [],
  range?: PeriodRange,
): number {
  const orderAdCost = saleOrders(orders, range).reduce(
    (sum, order) => sum + calculateOrderAdSpend(order),
    0,
  );
  const standaloneAdSpend = validAdSpend(adSpend, range).reduce(
    (sum, entry) => sum + safeNumber(entry.totalSpend),
    0,
  );
  return orderAdCost + standaloneAdSpend;
}

export function calculateNetProfit(
  orders: Order[],
  adSpend: AdSpendEntry[] = [],
  expenses: Expense[] = [],
  range?: PeriodRange,
): number {
  const actualRange = range ?? rangeFromData({ orders, adSpend, expenses });
  return calculateProfitAndLoss(orders, adSpend, expenses, actualRange).netProfit;
}

export function calculateMarkup(profit: number, cost: number): number {
  const denominator = safeNumber(cost);
  return denominator > 0 ? (safeNumber(profit) / denominator) * 100 : 0;
}

export function calculatePercentDelta(current: number, previous: number): number | null {
  if (!Number.isFinite(previous) || previous === 0) return null;
  return ((safeNumber(current) - previous) / Math.abs(previous)) * 100;
}

export function calculateCashIn(orders: Order[], range?: PeriodRange): number {
  return recordedOrders(orders, range)
    .filter((order) => order.paymentStatus === "paid")
    .reduce((sum, order) => sum + calculateOrderNetRevenue(order), 0);
}

export function calculateCashOut(
  orders: Order[] = [],
  adSpend: AdSpendEntry[] = [],
  expenses: Expense[] = [],
  range?: PeriodRange,
): number {
  const actualRange = range ?? rangeFromData({ orders, adSpend, expenses });
  return calculateCashFlow(orders, adSpend, expenses, actualRange).cashOut;
}

export function calculateOutstandingRevenue(orders: Order[]): number {
  return orders.reduce((sum, order) => {
    if (order.status === "cancelled") return sum;
    const net = Math.max(0, calculateOrderNetRevenue(order));
    if (order.paymentStatus === "unpaid") return sum + net;
    if (order.paymentStatus === "partially_paid") return sum + net * 0.5;
    return sum;
  }, 0);
}

export function calculateMarketingSpendTotals(entries: AdSpendEntry[]): {
  totalSpend: number;
  linkedSpend: number;
  platformCount: number;
} {
  const totalSpend = entries.reduce((sum, row) => sum + calculateAdSpendEntryTotal(row), 0);
  const linkedSpend = entries
    .filter((row) => row.productId)
    .reduce((sum, row) => sum + calculateAdSpendEntryTotal(row), 0);
  const platformCount = new Set(entries.map((row) => row.platform || "Other")).size;
  return { totalSpend, linkedSpend, platformCount };
}

export function calculateROAS(revenue: number, adSpend: number): number {
  const spend = safeNumber(adSpend);
  return spend > 0 ? safeNumber(revenue) / spend : 0;
}

export function calculateBreakEvenROAS(input: {
  grossMarginRatio?: number;
  grossMarginPct?: number;
  product?: Pick<
    Product,
    "defaultSellingPrice" | "defaultCostPrice" | "packagingCost" | "defaultShippingCost"
  >;
}): number {
  let ratio = safeNumber(input.grossMarginRatio);
  if (ratio <= 0 && input.grossMarginPct != null) ratio = safeNumber(input.grossMarginPct) / 100;
  if (ratio <= 0 && input.product) {
    ratio = calculateProductUnitEconomics(input.product).grossMarginPct / 100;
  }
  return ratio > 0 ? 1 / ratio : Infinity;
}

export function calculateBreakEvenTransactionCount(adBudget: number, profitPerTransaction: number): number {
  const profit = safeNumber(profitPerTransaction);
  return profit > 0 ? Math.ceil(safeNumber(adBudget) / profit) : 0;
}

export function calculateSafeAdSpend(profitPerTransaction: number, expectedTransactions: number): number {
  return Math.max(0, safeNumber(profitPerTransaction) * safeNumber(expectedTransactions));
}

export function calculatePriceForTargetMargin(cost: number, targetMarginPct: number): number {
  const margin = Math.min(99, Math.max(0, safeNumber(targetMarginPct)));
  return margin < 99 ? safeNumber(cost) / (1 - margin / 100) : 0;
}

export function calculateRevenueForTargetProfit(
  fixedCost: number,
  targetProfit: number,
  grossMarginPct: number,
): number {
  const ratio = Math.max(0, safeNumber(grossMarginPct) / 100);
  return ratio > 0 ? (safeNumber(fixedCost) + safeNumber(targetProfit)) / ratio : Infinity;
}

export interface RevenueStats {
  totalRevenue: number;
  avgDailyRevenue: number;
  highestDay: number;
  lowestDay: number;
  orderCount: number;
}

export function computeRevenueStats(orders: Order[], adSpend: AdSpendEntry[]): RevenueStats {
  const timeSeries = computeTimeSeries(orders, adSpend, "daily");
  const totalRevenue = timeSeries.reduce((sum, point) => sum + point.revenue, 0);
  const activeDays = timeSeries.filter((point) => point.revenue > 0).length || 1;
  const revenues = timeSeries.map((point) => point.revenue);
  const positiveRevenues = revenues.filter((revenue) => revenue > 0);
  return {
    totalRevenue,
    avgDailyRevenue: totalRevenue / activeDays,
    highestDay: revenues.length ? Math.max(...revenues) : 0,
    lowestDay: positiveRevenues.length ? Math.min(...positiveRevenues) : 0,
    orderCount: activeOrders(orders).length,
  };
}

export interface OrderSalesSummary {
  totalOrders: number;
  completedOrders: number;
  pendingOrders: number;
  refundedOrders: number;
  grossSales: number;
  netSales: number;
}

export function calculateOrderSalesSummary(orders: Order[]): OrderSalesSummary {
  const recordedOrders = orders.filter((o) => o.status !== "cancelled");
  const grossSales = recordedOrders.reduce((sum, order) => sum + safeNumber(order.sellingPrice), 0);
  const discounts = recordedOrders.reduce((sum, order) => sum + safeNumber(order.discount), 0);
  const refunds = recordedOrders.reduce((sum, order) => sum + safeOrderRefund(order), 0);

  return {
    totalOrders: orders.length,
    completedOrders: orders.filter((o) => o.status === "completed").length,
    pendingOrders: orders.filter((o) => o.status === "pending").length,
    refundedOrders: orders.filter((o) => o.status === "refunded").length,
    grossSales,
    netSales: grossSales - discounts - refunds,
  };
}

export function calculateCostTrend(
  orders: Order[],
  adSpend: AdSpendEntry[],
  expenses: Expense[],
  range: PeriodRange,
): { label: string; totalCosts: number; cogs: number; operatingExpenses: number; adSpend: number }[] {
  return computeMonthlySeries(orders, adSpend, expenses, range).map((point) => ({
    label: point.label,
    totalCosts: Math.max(0, point.revenue - point.netProfit),
    cogs: Math.max(0, point.revenue - point.grossProfit),
    operatingExpenses: Math.max(0, point.grossProfit - point.netProfit),
    adSpend: 0,
  }));
}

export function computePnl(
  orders: Order[],
  adSpend: AdSpendEntry[],
  expenses: Expense[],
  range: PeriodRange,
): Pnl {
  return calculateProfitAndLoss(orders, adSpend, expenses, range);
}

export function getTodayBusinessSummary(input: DashboardCalculationInput): DashboardSummary {
  const today = dashboardDateOnly(input.now ?? new Date());
  return dashboardSummary(input, dashboardRangeForDay(today, "Today"));
}

export function getMonthBusinessSummary(input: DashboardCalculationInput): DashboardSummary {
  const now = input.now ?? new Date();
  const normalizedNow = dashboardDateOnly(now);
  return dashboardSummary(input, buildPeriodRange("this-month", undefined, undefined, normalizedNow));
}

export function getBusinessSummaryForRange(
  input: DashboardCalculationInput,
  range: PeriodRange,
): DashboardSummary {
  return dashboardSummary(input, range);
}

export interface Runway {
  monthlyNetProfit: number;
  monthlyBurn: number;
  cashBuffer: number;
  /** null = profitable (infinite runway). */
  runwayMonths: number | null;
}

export function computeRunway(
  pnl: Pnl,
  range: PeriodRange,
  cashBuffer: number,
): Runway {
  const monthlyNetProfit = (pnl.netProfit / range.days) * 30;
  const monthlyBurn = monthlyNetProfit < 0 ? -monthlyNetProfit : 0;
  let runwayMonths: number | null = null;
  if (monthlyBurn > 0) {
    runwayMonths = cashBuffer > 0 ? cashBuffer / monthlyBurn : 0;
  }
  return { monthlyNetProfit, monthlyBurn, cashBuffer, runwayMonths };
}

// ─── Best/worst month ───────────────────────────────────────────────────────

export interface BestWorstMonths {
  best?: MonthlyPnlPoint;
  worst?: MonthlyPnlPoint;
}

export function bestWorstMonth(series: MonthlyPnlPoint[]): BestWorstMonths {
  const meaningful = series.filter((m) => m.orderCount > 0);
  if (meaningful.length === 0) return {};
  let best = meaningful[0];
  let worst = meaningful[0];
  for (const m of meaningful) {
    if (m.netProfit > best.netProfit) best = m;
    if (m.netProfit < worst.netProfit) worst = m;
  }
  return { best, worst };
}
