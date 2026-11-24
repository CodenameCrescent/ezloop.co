import type { Product, Order, AdSpendEntry } from "../types";
import type { Expense } from "@/lib/legacyTypes";
import { type PeriodRange, buildPeriodRangeFromDates, dateInputValueUtc } from "../period";
import { type Pnl } from "./Pnl";
import { rangeFromData, type RevenueBreakdown } from "./ComputeTimeSeries";
import { calculateRevenue, type CostBreakdown } from "./CalculateRevenueByOffer";
import { calculateCosts, calculateProfitAndLoss, type CashFlow, calculateCashFlow } from "./CalculateProfitAndLoss";
import { type ProductPerformanceRow, calculateProductPerformance, type ProductProfit } from "./CalculateCashFlowAnalysis";

export function calculateProductProfit(
  product: Product,
  orders: Order[],
  adSpend: AdSpendEntry[] = [],
  range?: PeriodRange,
): ProductProfit {
  const actualRange = range ?? rangeFromData({ orders, adSpend });
  const row = calculateProductPerformance([product], orders, adSpend, actualRange).find(
    (item) => item.productId === product.id,
  );
  if (!row) {
    return {
      productId: product.id,
      productName: product.name,
      imageColor: product.imageColor,
      totalProfit: 0,
      totalRevenue: 0,
      totalAdCost: 0,
      totalCostBase: 0,
      orderCount: 0,
      marginPct: 0,
      avgProfitPerOrder: 0,
      unitsSold: 0,
    };
  }
  const totalCostBase = row.cogs + row.delivery;
  return {
    productId: row.productId,
    productName: row.productName,
    imageColor: row.imageColor,
    totalProfit: row.netProfit,
    totalRevenue: row.revenue,
    totalAdCost: row.adSpend,
    totalCostBase,
    orderCount: row.orderCount,
    marginPct: row.marginPct,
    avgProfitPerOrder: row.orderCount > 0 ? row.netProfit / row.orderCount : 0,
    unitsSold: row.unitsSold,
  };
}

export interface BusinessOverview {
  revenue: RevenueBreakdown;
  costs: CostBreakdown;
  profitAndLoss: Pnl;
  cashFlow: CashFlow;
  productPerformance: ProductPerformanceRow[];
}

export function calculateBusinessOverview(input: {
  orders: Order[];
  adSpend?: AdSpendEntry[];
  expenses?: Expense[];
  products?: Product[];
  range: PeriodRange;
  openingCash?: number;
}): BusinessOverview {
  const orders = input.orders ?? [];
  const adSpend = input.adSpend ?? [];
  const expenses = input.expenses ?? [];
  const products = input.products ?? [];
  const revenue = calculateRevenue(orders, input.range);
  const costs = calculateCosts(orders, adSpend, expenses, input.range);
  const profitAndLoss = calculateProfitAndLoss(orders, adSpend, expenses, input.range);
  const cashFlow = calculateCashFlow(
    orders,
    adSpend,
    expenses,
    input.range,
    input.openingCash ?? 0,
  );
  return {
    revenue,
    costs,
    profitAndLoss,
    cashFlow,
    productPerformance: calculateProductPerformance(products, orders, adSpend, input.range),
  };
}

// ─── Dashboard command center ────────────────────────────────────────────────

export type DashboardProfitStatus = "profitable" | "break-even" | "loss";
export type DashboardHealthTone = "good" | "warn" | "bad" | "neutral";
export type DashboardHealthStatus =
  | "Healthy"
  | "Watch Closely"
  | "Needs Attention"
  | "Not Enough Data";


export interface DashboardSummary {
  range: PeriodRange;
  overview: BusinessOverview;
  netRevenue: number;
  trueProfit: number;
  totalCosts: number;
  orderCount: number;
  completedOrderCount: number;
  pendingOrderCount: number;
  refundedOrderCount: number;
  marginPct: number;
  profitStatus: DashboardProfitStatus;
}

export interface DashboardTrendPoint {
  date: string;
  label: string;
  netRevenue: number;
  totalCosts: number;
  trueProfit: number;
  orders: number;
}

export interface DashboardHealth {
  status: DashboardHealthStatus;
  tone: DashboardHealthTone;
  description: string;
  actionLabel: string;
  actionHref: string;
}

export interface DashboardAlert {
  id: string;
  title: string;
  body: string;
  tone: DashboardHealthTone;
  actionLabel: string;
  actionHref: string;
}

export interface DashboardCalculationInput {
  orders?: Order[];
  adSpend?: AdSpendEntry[];
  expenses?: Expense[];
  products?: Product[];
  openingCash?: number;
  now?: Date;
}

export function dashboardDateOnly(now: Date): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

export function dashboardRangeForDay(day: Date, label: string): PeriodRange {
  return buildPeriodRangeFromDates(day, day, label);
}

export function dashboardSummary(input: DashboardCalculationInput, range: PeriodRange): DashboardSummary {
  const overview = calculateBusinessOverview({
    orders: input.orders ?? [],
    adSpend: input.adSpend ?? [],
    expenses: input.expenses ?? [],
    products: input.products ?? [],
    range,
    openingCash: input.openingCash ?? 0,
  });
  const trueProfit = overview.profitAndLoss.netProfit;
  const netRevenue = overview.revenue.netRevenue;
  const profitStatus: DashboardProfitStatus =
    Math.abs(trueProfit) < 1 ? "break-even" : trueProfit > 0 ? "profitable" : "loss";

  return {
    range,
    overview,
    netRevenue,
    trueProfit,
    totalCosts: overview.costs.totalCosts,
    orderCount: overview.revenue.orderCount,
    completedOrderCount: overview.revenue.completedOrderCount,
    pendingOrderCount: overview.revenue.pendingOrderCount,
    refundedOrderCount: overview.revenue.refundedOrderCount,
    marginPct: overview.profitAndLoss.netProfitMargin,
    profitStatus,
  };
}

export function getLast7DaysBusinessTrend(input: DashboardCalculationInput): DashboardTrendPoint[] {
  const today = dashboardDateOnly(input.now ?? new Date());
  return Array.from({ length: 7 }, (_, index) => {
    const day = new Date(today);
    day.setDate(today.getDate() - (6 - index));
    const summary = dashboardSummary(input, dashboardRangeForDay(day, "Day"));
    return {
      date: dateInputValueUtc(day),
      label: day.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
      netRevenue: summary.netRevenue,
      totalCosts: summary.totalCosts,
      trueProfit: summary.trueProfit,
      orders: summary.orderCount,
    };
  });
}

export function getLast12MonthsBusinessTrend(input: DashboardCalculationInput): DashboardTrendPoint[] {
  const today = dashboardDateOnly(input.now ?? new Date());
  return Array.from({ length: 12 }, (_, index) => {
    const start = new Date(today.getFullYear(), today.getMonth() - (11 - index), 1);
    const end = new Date(start.getFullYear(), start.getMonth() + 1, 0);
    if (end > today) end.setTime(today.getTime());
    const summary = dashboardSummary(input, buildPeriodRangeFromDates(start, end, "Year"));
    return {
      date: dateInputValueUtc(start),
      label: start.toLocaleDateString(undefined, { month: "short", year: "2-digit" }),
      netRevenue: summary.netRevenue,
      totalCosts: summary.totalCosts,
      trueProfit: summary.trueProfit,
      orders: summary.orderCount,
    };
  });
}

export function getLast6YearsBusinessTrend(input: DashboardCalculationInput): DashboardTrendPoint[] {
  const today = dashboardDateOnly(input.now ?? new Date());
  return Array.from({ length: 6 }, (_, index) => {
    const year = today.getFullYear() - (5 - index);
    const start = new Date(year, 0, 1);
    const end = new Date(year, 11, 31);
    if (end > today) end.setTime(today.getTime());
    const summary = dashboardSummary(input, buildPeriodRangeFromDates(start, end, "Year"));
    return {
      date: dateInputValueUtc(start),
      label: String(year),
      netRevenue: summary.netRevenue,
      totalCosts: summary.totalCosts,
      trueProfit: summary.trueProfit,
      orders: summary.orderCount,
    };
  });
}

export function getDashboardHealthStatus(input: {
  today: DashboardSummary;
  month: DashboardSummary;
  products?: Product[];
  expenses?: Expense[];
}): DashboardHealth {
  const products = input.products ?? [];
  const expenses = input.expenses ?? [];
  const hasData = products.length > 0 && (input.today.orderCount > 0 || input.month.orderCount > 0);
  if (!hasData) {
    return {
      status: "Not Enough Data",
      tone: "neutral",
      description: "Add offers and transactions so Profit Loop can judge today clearly.",
      actionLabel: "Add Transaction",
      actionHref: "/record/transactions",
    };
  }

  const costsHigherThanRevenue = input.today.totalCosts > input.today.netRevenue && input.today.netRevenue > 0;
  if (input.today.trueProfit < 0 || costsHigherThanRevenue || (input.today.netRevenue > 0 && input.today.marginPct < 5)) {
    return {
      status: "Needs Attention",
      tone: "bad",
      description: "Today’s sales are not keeping enough after costs. Review the profit breakdown before scaling.",
      actionLabel: "View Profit & Loss",
      actionHref: "/money/profit-loss",
    };
  }

  const weakMargin = input.today.netRevenue > 0 && input.today.marginPct < 15;
  const noExpenses = expenses.length === 0 || input.month.overview.costs.operatingExpenses === 0;
  const cashPressure = input.month.overview.cashFlow.netCashFlow < 0;
  if (weakMargin || noExpenses || cashPressure) {
    return {
      status: "Watch Closely",
      tone: "warn",
      description: weakMargin
        ? "Your business is profitable today, but the margin is tight. Review costs to protect profit."
        : cashPressure
          ? "Profit and cash are not moving together cleanly. Check cash flow before spending more."
          : "Your profit may be overstated until monthly expenses are recorded.",
      actionLabel: weakMargin || noExpenses ? "View Profit & Loss" : "View Cash Flow",
      actionHref: weakMargin || noExpenses ? "/money/profit-loss" : "/money/cash-flow",
    };
  }

  return {
    status: "Healthy",
    tone: "good",
    description: "Today is profitable, margin is healthy, and current costs are under control.",
    actionLabel: "View Profit & Loss",
    actionHref: "/money/profit-loss",
  };
}
