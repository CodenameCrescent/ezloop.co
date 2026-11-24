import type { Product, Order, AdSpendEntry } from "../types";
import type { Expense } from "@/lib/legacyTypes";
import { type PeriodRange, buildPeriodRangeFromDates } from "../period";
import { type Pnl, expensesInRange, monthlyFixedCost, safeNumber, calculateOrderCOGS, calculateOrderDeliveryCost, calculateOrderAdSpend, orderRevenue, activeOrders } from "./Pnl";
import { calculateAdSpendEntryTotal } from "./ComputeTimeSeries";
import { type DashboardSummary, type DashboardAlert } from "./GetDashboardHealthStatus";

export function getDashboardAlerts(input: {
  today: DashboardSummary;
  month: DashboardSummary;
  products?: Product[];
  expenses?: Expense[];
}): DashboardAlert[] {
  const products = input.products ?? [];
  const expenses = input.expenses ?? [];
  const alerts: DashboardAlert[] = [];
  const unpaidOrderRevenue =
    input.month.overview.revenue.unpaidRevenue + input.month.overview.revenue.partiallyPaidRevenue;
  const unpaidExpenses = input.month.overview.cashFlow.unpaidExpenses;
  const missingCostProducts = products.filter(
    (product) => product.status !== "inactive" && safeNumber(product.defaultCostPrice) <= 0,
  ).length;

  if (input.today.trueProfit < 0) {
    alerts.push({
      id: "negative-profit",
      title: "Negative true profit",
      body: "Today’s recorded costs are higher than what the business kept.",
      tone: "bad",
      actionLabel: "View Profit & Loss",
      actionHref: "/money/profit-loss",
    });
  }

  if (input.today.netRevenue > 0 && input.today.marginPct < 15) {
    alerts.push({
      id: "low-margin",
      title: "Margin is tight",
      body: "You are making sales, but not keeping much after costs.",
      tone: "warn",
      actionLabel: "View Profit & Loss",
      actionHref: "/money/profit-loss",
    });
  }

  if (expenses.length === 0 || input.month.overview.costs.operatingExpenses === 0) {
    alerts.push({
      id: "missing-expenses",
      title: "No spending recorded",
      body: "Add rent, salaries, ads, software, and other costs to calculate true profit.",
      tone: "warn",
      actionLabel: "Add Transaction",
      actionHref: "/record/transactions",
    });
  }

  if (unpaidOrderRevenue > 0) {
    alerts.push({
      id: "unpaid-orders",
      title: "Money still owed to you",
      body: "Some sales have not been paid for yet.",
      tone: "warn",
      actionLabel: "View Revenue",
      actionHref: "/setup/revenue",
    });
  }

  if (unpaidExpenses > 0) {
    alerts.push({
      id: "unpaid-expenses",
      title: "Unpaid expenses",
      body: "Upcoming unpaid costs may reduce available cash.",
      tone: "warn",
      actionLabel: "View Expenses",
      actionHref: "/setup/expenses",
    });
  }

  if (input.today.orderCount === 0 && products.length > 0) {
    alerts.push({
      id: "no-transactions-today",
      title: "No transactions today",
      body: "Add what you sold today to see revenue, margin, and true profit.",
      tone: "neutral",
      actionLabel: "Add Transaction",
      actionHref: "/record/transactions",
    });
  }

  if (missingCostProducts > 0) {
    alerts.push({
      id: "missing-offer-costs",
      title: "Some things you sell have no cost",
      body: "Without what they cost you, their profit looks bigger than it is.",
      tone: "warn",
      actionLabel: "View Revenue",
      actionHref: "/setup/revenue",
    });
  }

  return alerts.slice(0, 3);
}

// ─── Breakeven & Runway ─────────────────────────────────────────────────────

export interface Breakeven {
  monthlyFixedCost: number;
  /** Avg monthly gross profit over the period. Used as "monthly contribution margin". */
  monthlyGrossProfit: number;
  grossMarginPct: number;
  /** Avg gross profit per order over the period. */
  avgGrossPerOrder: number;
  /** Monthly revenue needed to cover fixed costs. */
  breakevenRevenue: number;
  /** Monthly orders needed. */
  breakevenOrders: number;
  currentMonthlyRevenue: number;
  currentMonthlyNetProfit: number;
  gap: number;
  hitsBreakeven: boolean;
  /** "On track" / "Tight" / "At risk" based on monthly net profit vs fixed cost. */
  status: "on-track" | "tight" | "at-risk";
}

export function computeBreakeven(
  pnl: Pnl,
  expenses: Expense[],
  range: PeriodRange,
): Breakeven {
  const monthly = monthlyFixedCost(expenses);
  const gmPct = pnl.grossMarginPct;
  const dailyRev = range.days > 0 ? pnl.revenue / range.days : 0;
  const dailyGross = range.days > 0 ? pnl.grossProfit / range.days : 0;
  const dailyNet = range.days > 0 ? pnl.netProfit / range.days : 0;
  const monthlyGrossProfit = dailyGross * 30;
  const currentMonthlyRevenue = dailyRev * 30;
  const currentMonthlyNetProfit = dailyNet * 30;
  const avgGrossPerOrder = pnl.orderCount > 0 ? pnl.grossProfit / pnl.orderCount : 0;

  const breakevenRevenue =
    gmPct > 0 ? monthly / (gmPct / 100) : Infinity;
  const breakevenOrders =
    avgGrossPerOrder > 0 ? monthly / avgGrossPerOrder : Infinity;

  // Status: ratio of monthly net profit to monthly fixed cost.
  let status: Breakeven["status"] = "at-risk";
  if (monthly === 0) {
    status = currentMonthlyNetProfit >= 0 ? "on-track" : "at-risk";
  } else {
    const ratio = currentMonthlyNetProfit / monthly;
    if (ratio >= 0.5) status = "on-track";
    else if (ratio >= 0) status = "tight";
    else status = "at-risk";
  }

  return {
    monthlyFixedCost: monthly,
    monthlyGrossProfit,
    grossMarginPct: gmPct,
    avgGrossPerOrder,
    breakevenRevenue,
    breakevenOrders,
    currentMonthlyRevenue,
    currentMonthlyNetProfit,
    gap: breakevenRevenue - currentMonthlyRevenue,
    hitsBreakeven: gmPct > 0 && currentMonthlyRevenue >= breakevenRevenue,
    status,
  };
}

// ─── Monthly trend (last N months, UTC-bucketed) ────────────────────────────

export interface MonthlyPnlPoint {
  monthKey: string;
  label: string;
  revenue: number;
  grossProfit: number;
  netProfit: number;
  marginPct: number;
  /** Gross profit ÷ monthly fixed cost. > 1 means fixed costs are covered. */
  fixedCoverageRatio: number;
  monthlyFixed: number;
  orderCount: number;
}

export function computeMonthlySeries(
  orders: Order[],
  adSpend: AdSpendEntry[],
  expenses: Expense[],
  range?: PeriodRange,
  now: Date = new Date(),
): MonthlyPnlPoint[] {
  // Derive month buckets from the selected range when provided, otherwise
  // fall back to the trailing 6 months. Always include the current month
  // so the latest data point is visible.
  let firstYear: number;
  let firstMonth0: number;
  let monthsBack: number;
  if (range) {
    firstYear = range.start.getFullYear();
    firstMonth0 = range.start.getMonth();
    const lastYear = range.end.getFullYear();
    const lastMonth0 = range.end.getMonth();
    monthsBack = Math.max(
      1,
      (lastYear - firstYear) * 12 + (lastMonth0 - firstMonth0) + 1,
    );
  } else {
    monthsBack = 6;
    firstYear = now.getFullYear();
    firstMonth0 = now.getMonth() - (monthsBack - 1);
  }

  type Bucket = {
    key: string;
    label: string;
    year: number;
    month0: number;
    startMs: number;
    endMs: number;
  };
  const buckets: Bucket[] = [];
  for (let i = 0; i < monthsBack; i++) {
    const startMs = new Date(firstYear, firstMonth0 + i, 1).getTime();
    const endMs = new Date(firstYear, firstMonth0 + i + 1, 1).getTime();
    const d = new Date(startMs);
    const y = d.getFullYear();
    const m0 = d.getMonth();
    buckets.push({
      key: `${y}-${String(m0 + 1).padStart(2, "0")}`,
      label: new Date(y, m0, 1).toLocaleDateString("en-US", {
        month: "short",
        year: "2-digit",
      }),
      year: y,
      month0: m0,
      startMs,
      endMs,
    });
  }
  void monthsBack;

  const live = activeOrders(orders);

  return buckets.map((b) => {
    const inMonth = (d: Date) => {
      const t = d.getTime();
      return t >= b.startMs && t < b.endMs;
    };
    const monthOrders = live.filter((o) => inMonth(new Date(o.date)));
    const revenue = monthOrders.reduce((s, o) => s + orderRevenue(o), 0);
    const cogs = monthOrders.reduce((s, o) => s + calculateOrderCOGS(o), 0);
    const delivery = monthOrders.reduce((s, o) => s + calculateOrderDeliveryCost(o), 0);
    const orderAd = monthOrders.reduce((s, o) => s + calculateOrderAdSpend(o), 0);
    const standaloneAd = adSpend
      .filter((a) => inMonth(new Date(a.date)))
      .reduce((s, a) => s + calculateAdSpendEntryTotal(a), 0);
    const adCost = orderAd + standaloneAd;

    // Use this bucket's start date so getDaysInMonth/getDaysInYear returns
    // the actual days in that specific month — fixes the ±10% pro-ration error.
    const bucketRange = buildPeriodRangeFromDates(
      new Date(b.startMs),
      new Date(b.endMs - 1),
      b.label,
    );
    const { fixedCosts, variableExpenses, customExpenses } = expensesInRange(
      expenses,
      bucketRange,
    );
    const monthlyFixed = fixedCosts;
    const otherOpEx = variableExpenses + customExpenses;

    const grossProfit = revenue - cogs;
    const netProfit = grossProfit - delivery - fixedCosts - otherOpEx - adCost;

    return {
      monthKey: b.key,
      label: b.label,
      revenue,
      grossProfit,
      netProfit,
      marginPct: revenue > 0 ? (netProfit / revenue) * 100 : 0,
      monthlyFixed,
      fixedCoverageRatio: monthlyFixed > 0 ? grossProfit / monthlyFixed : 0,
      orderCount: monthOrders.length,
    };
  });
}

// ─── Product profitability (period-scoped) ──────────────────────────────────

export interface ProductProfitabilityRow {
  productId: string;
  productName: string;
  imageColor: string;
  revenue: number;
  trueProfit: number; // rev - cogs - delivery - allocated ad
  marginPct: number;
  orderCount: number;
  isUnprofitable: boolean;
}
