import { getDaysInYear, getDaysInMonth } from "date-fns";
import type { Product, Order, AdSpendEntry } from "../types";
import type { Expense } from "@/lib/legacyTypes";
import { startOfDayUtc, endOfDayUtc, addDaysUtc, type PeriodRange, inRange, buildPeriodRangeFromDates } from "../period";

// ─── P&L (waterfall) ────────────────────────────────────────────────────────

export interface Pnl {
  /** Gross sales = sum of unit selling prices, before discounts. */
  grossSales: number;
  grossRevenue: number;
  refunds: number;
  discounts: number;
  /** Net revenue = grossSales − discounts (matches existing app definition). */
  revenue: number;
  netRevenue: number;
  cogs: number;
  delivery: number;
  packagingCosts: number;
  paymentFees: number;
  otherExpenses: number;
  /** Order-level + standalone ad spend in the period. */
  adCost: number;
  orderAdCost: number;
  standaloneAdSpend: number;
  /** Order-only costs = COGS + delivery + order-level ad cost. */
  orderCosts: number;
  /** Recurring fixed costs pro-rated over the window. */
  fixedCosts: number;
  /** VARIABLE expenses dated in the window. */
  variableExpenses: number;
  /** CUSTOM expenses dated in the window. */
  customExpenses: number;
  /** Revenue − COGS − Delivery. */
  grossProfit: number;
  /** Revenue minus order-only costs. */
  orderProfit: number;
  /** Gross − Fixed − Variable − Custom. (Per spec, ads sit BELOW operating.) */
  operatingProfit: number;
  /** Operating − Ad spend. */
  netProfit: number;
  marginPct: number;
  grossMarginPct: number;
  operatingMarginPct: number;
  netProfitMargin: number;
  orderCount: number;
  completedOrderCount: number;
  pendingOrderCount: number;
  refundedOrderCount: number;
}

// refDate drives getDaysInMonth/getDaysInYear so monthly charges in February
// (28 days) are correctly divided by 28, not the hardcoded 30.
export function dailyShareOfFixed(e: Expense, refDate: Date): number {
  const freq = (e.frequency ?? "Monthly").toLowerCase();
  if (freq === "yearly") return e.amount / getDaysInYear(refDate);
  if (freq === "weekly") return e.amount / 7;
  return e.amount / getDaysInMonth(refDate); // monthly default
}

export function isRecurringExpense(e: Expense): boolean {
  return e.type === "FIXED" || e.type === "RECURRING";
}

export function isPaidExpense(e: Expense): boolean {
  return (e.paymentStatus ?? "paid") === "paid";
}

export function expenseStartDate(e: Expense): Date | null {
  const d = new Date(e.date);
  return Number.isNaN(d.getTime()) ? null : startOfDayUtc(d);
}

export function fixedExpensePeriodEnd(e: Expense, start: Date): Date {
  const freq = (e.frequency ?? "Monthly").toLowerCase();
  if (freq === "yearly") {
    return endOfDayUtc(new Date(start.getFullYear(), 11, 31));
  }
  if (freq === "weekly") return endOfDayUtc(addDaysUtc(start, 6));
  return endOfDayUtc(new Date(start.getFullYear(), start.getMonth() + 1, 0));
}

export function recurringExpenseAmountInRange(e: Expense, range: PeriodRange): number {
  // Legacy compatibility only: do not pass Business -> Expenses setup items here.
  // Profit Loop financial truth should come from actual expense transactions.
  const expenseStart = expenseStartDate(e);
  if (!expenseStart || expenseStart.getTime() > range.end.getTime()) return 0;
  const expenseEnd = e.type === "FIXED" ? fixedExpensePeriodEnd(e, expenseStart) : range.end;
  if (expenseEnd.getTime() < range.start.getTime()) return 0;

  let day = startOfDayUtc(
    new Date(Math.max(expenseStart.getTime(), range.start.getTime())),
  );
  const end = new Date(Math.min(expenseEnd.getTime(), range.end.getTime()));
  let total = 0;
  while (day.getTime() <= end.getTime()) {
    total += dailyShareOfFixed(e, day);
    day = addDaysUtc(day, 1);
  }
  return total;
}

export function expensesInRange(
  expenses: Expense[],
  range: PeriodRange,
): { fixedCosts: number; variableExpenses: number; customExpenses: number } {
  let fixedCosts = 0;
  let variable = 0;
  let custom = 0;
  for (const e of expenses) {
    if (e.status !== "active") continue;
    if (isRecurringExpense(e)) {
      fixedCosts += recurringExpenseAmountInRange(e, range);
    } else {
      const d = new Date(e.date);
      if (!inRange(d, range.start, range.end)) continue;
      if (e.type === "CUSTOM" || e.type === "ONE_TIME") custom += e.amount;
      else variable += e.amount;
    }
  }
  return {
    fixedCosts,
    variableExpenses: variable,
    customExpenses: custom,
  };
}

/** Monthly fixed cost from active recurring expenses (rent, salaries, software). */
export function monthlyFixedCost(expenses: Expense[], refDate: Date = new Date()): number {
  const monthStart = new Date(refDate.getFullYear(), refDate.getMonth(), 1);
  const monthEnd = new Date(refDate.getFullYear(), refDate.getMonth() + 1, 0);
  const monthRange = buildPeriodRangeFromDates(monthStart, monthEnd, "Month");
  return expenses.reduce((sum, e) => {
    if (e.status !== "active" || !isRecurringExpense(e)) return sum;
    return sum + recurringExpenseAmountInRange(e, monthRange);
  }, 0);
}

export function safeFinancialNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function safeNumber(value: unknown): number {
  return safeFinancialNumber(value);
}

export interface ProductUnitEconomics {
  sellingPrice: number;
  productCost: number;
  grossProfit: number;
  grossMarginPct: number;
}

export function calculateProductUnitEconomics(
  product: Pick<
    Product,
    "defaultSellingPrice" | "defaultCostPrice" | "packagingCost" | "defaultShippingCost"
  >,
): ProductUnitEconomics {
  const sellingPrice = Math.max(0, safeNumber(product.defaultSellingPrice));
  const productCost =
    Math.max(0, safeNumber(product.defaultCostPrice)) +
    Math.max(0, safeNumber(product.packagingCost)) +
    Math.max(0, safeNumber(product.defaultShippingCost));
  const grossProfit = sellingPrice - productCost;

  return {
    sellingPrice,
    productCost,
    grossProfit,
    grossMarginPct: sellingPrice > 0 ? (grossProfit / sellingPrice) * 100 : 0,
  };
}

export function calculateOrderGrossRevenue(order: Order): number {
  return safeNumber(order.sellingPrice);
}

export function calculateOrderDiscount(order: Order): number {
  return safeNumber(order.discount);
}

export function safeOrderRevenue(o: Order): number {
  return calculateOrderGrossRevenue(o) - calculateOrderDiscount(o);
}

export function calculateOrderRefund(order: Order): number {
  if (safeNumber(order.refundAmount) > 0) return safeNumber(order.refundAmount);
  return order.status === "refunded" ? Math.max(0, safeOrderRevenue(order)) : 0;
}

export function safeOrderRefund(o: Order): number {
  return calculateOrderRefund(o);
}

export function calculateOrderNetRevenue(order: Order): number {
  return order.status === "cancelled" ? 0 : safeOrderRevenue(order) - safeOrderRefund(order);
}

export function calculateOrderCOGS(order: Order): number {
  return safeNumber(order.costPrice);
}

export function calculateOrderDeliveryCost(order: Order): number {
  return safeNumber(order.deliveryCost);
}

export function calculateOrderAdSpend(order: Order): number {
  return safeNumber(order.adCost);
}

export function calculateOrderTotalCost(order: Order): number {
  return (
    calculateOrderCOGS(order) +
    calculateOrderDeliveryCost(order) +
    calculateOrderAdSpend(order)
  );
}

export function calculateOrderProfit(order: Order): number {
  if (order.status === "cancelled" || order.status === "refunded") return 0;
  return calculateOrderNetRevenue(order) - calculateOrderTotalCost(order);
}

export function calculateOrderQuantity(order: Order): number {
  const itemQuantity =
    order.items?.reduce((sum, item) => sum + Math.max(0, safeNumber(item.quantity)), 0) ?? 0;
  return itemQuantity > 0 ? itemQuantity : 1;
}

export function orderRevenue(order: Order): number {
  return calculateOrderNetRevenue(order);
}

export function orderDateInRange(o: Order, range: PeriodRange): boolean {
  return inRange(new Date(o.date), range.start, range.end);
}

export function adDateInRange(a: AdSpendEntry, range: PeriodRange): boolean {
  return inRange(new Date(a.date), range.start, range.end);
}

export function expenseText(e: Expense): string {
  return `${e.name ?? ""} ${e.category ?? ""} ${e.note ?? ""}`.toLowerCase();
}

export function isPackagingExpense(e: Expense): boolean {
  return /packag|parcel|box|mailer/.test(expenseText(e));
}

export function isPaymentFeeExpense(e: Expense): boolean {
  return /payment|gateway|stripe|paddle|paypal|cod fee|transaction fee|bank fee/.test(
    expenseText(e),
  );
}

export function expenseAmountInRange(e: Expense, range: PeriodRange): number {
  if (e.status !== "active") return 0;
  if (isRecurringExpense(e)) return recurringExpenseAmountInRange(e, range);
  const d = new Date(e.date);
  return inRange(d, range.start, range.end) ? safeNumber(e.amount) : 0;
}

export function calculateExpenseAmountInRange(e: Expense, range: PeriodRange): number {
  return expenseAmountInRange(e, range);
}

export function paidExpenseAmountInRange(e: Expense, range: PeriodRange): number {
  if (!isPaidExpense(e)) return 0;
  return expenseAmountInRange(e, range);
}

export function saleOrdersInRange(orders: Order[], range: PeriodRange): Order[] {
  return orders.filter(
    (o) =>
      o.status !== "cancelled" &&
      o.status !== "refunded" &&
      orderDateInRange(o, range),
  );
}

export function recordedOrdersInRange(orders: Order[], range: PeriodRange): Order[] {
  return orders.filter((o) => o.status !== "cancelled" && orderDateInRange(o, range));
}

export function refundedOrdersInRange(orders: Order[], range: PeriodRange): Order[] {
  return orders.filter((o) => o.status === "refunded" && orderDateInRange(o, range));
}

export function activeOrders(orders: Order[]): Order[] {
  return orders.filter((o) => o.status !== "cancelled" && o.status !== "refunded");
}

export function saleOrders(orders: Order[], range?: PeriodRange): Order[] {
  const rows = activeOrders(orders);
  return range ? rows.filter((o) => orderDateInRange(o, range)) : rows;
}

export function validAdSpend(adSpend: AdSpendEntry[], range?: PeriodRange): AdSpendEntry[] {
  return range ? adSpend.filter((a) => adDateInRange(a, range)) : adSpend;
}
