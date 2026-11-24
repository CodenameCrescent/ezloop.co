import type { Order } from "../types";
import { type PeriodRange, type Period } from "../period";
import { safeNumber, calculateOrderGrossRevenue, calculateOrderDiscount, calculateOrderRefund, safeOrderRefund, calculateOrderNetRevenue, calculateOrderCOGS, calculateOrderQuantity, orderDateInRange, saleOrdersInRange, recordedOrdersInRange, refundedOrdersInRange } from "./Pnl";
import { bucketKey, bucketLabel, type RevenueBreakdown, type RevenueMoneyRow, type RevenueTrendPoint } from "./ComputeTimeSeries";

export function addRevenueRow(
  map: Map<string, RevenueMoneyRow>,
  label: string,
  input: Partial<RevenueMoneyRow>,
) {
  const row =
    map.get(label) ?? {
      label,
      gross: 0,
      discounts: 0,
      refunds: 0,
      net: 0,
      quantity: 0,
      orders: 0,
    };
  row.gross += input.gross ?? 0;
  row.discounts += input.discounts ?? 0;
  row.refunds += input.refunds ?? 0;
  row.net += input.net ?? 0;
  row.quantity += input.quantity ?? 0;
  row.orders += input.orders ?? 0;
  map.set(label, row);
}

export function filterRevenueOrders(
  orders: Order[],
  range: PeriodRange,
  status: "all" | "completed" | "pending" | "refunded" = "all",
): Order[] {
  return orders.filter((order) => {
    if (order.status === "cancelled") return false;
    if (status !== "all" && order.status !== status) return false;
    return orderDateInRange(order, range);
  });
}

export function calculateRevenueTrend(
  orders: Order[],
  range: PeriodRange,
  period: Period,
  status: "all" | "completed" | "pending" | "refunded" = "all",
): RevenueTrendPoint[] {
  const map = new Map<string, RevenueTrendPoint>();
  for (const order of filterRevenueOrders(orders, range, status)) {
    const date = new Date(order.date);
    if (Number.isNaN(date.getTime())) continue;
    const key = bucketKey(date, period);
    const row =
      map.get(key) ?? {
        label: bucketLabel(date, period),
        gross: 0,
        net: 0,
        refunds: 0,
        discounts: 0,
      };
    row.gross += calculateOrderGrossRevenue(order);
    row.discounts += calculateOrderDiscount(order);
    row.refunds += calculateOrderRefund(order);
    row.net += calculateOrderNetRevenue(order);
    map.set(key, row);
  }
  return [...map.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([, value]) => value);
}

export function calculateRevenueByOffer(
  orders: Order[],
  range: PeriodRange,
  status: "all" | "completed" | "pending" | "refunded" = "all",
): RevenueMoneyRow[] {
  const map = new Map<string, RevenueMoneyRow>();
  for (const order of filterRevenueOrders(orders, range, status)) {
    const orderGross = Math.max(1, calculateOrderGrossRevenue(order));
    const discount = calculateOrderDiscount(order);
    const refund = calculateOrderRefund(order);
    const items =
      order.items && order.items.length > 0
        ? order.items
        : [
            {
              id: order.id,
              productId: order.productId,
              productName: order.productName || "Unknown offer",
              quantity: 1,
              unitSellingPrice: calculateOrderGrossRevenue(order),
              unitCostPrice: calculateOrderCOGS(order),
            },
          ];

    for (const item of items) {
      const gross = safeNumber(item.unitSellingPrice) * Math.max(1, safeNumber(item.quantity));
      const share = gross / orderGross;
      const itemDiscount = discount * share;
      const itemRefund = refund * share;
      addRevenueRow(map, item.productName || "Unknown offer", {
        gross,
        discounts: itemDiscount,
        refunds: itemRefund,
        net: gross - itemDiscount - itemRefund,
        quantity: Math.max(1, safeNumber(item.quantity)),
        orders: 1,
      });
    }
  }
  return [...map.values()].sort((a, b) => b.net - a.net);
}

export function calculateRevenueBySource(
  orders: Order[],
  range: PeriodRange,
  status: "all" | "completed" | "pending" | "refunded" = "all",
): RevenueMoneyRow[] {
  const map = new Map<string, RevenueMoneyRow>();
  for (const order of filterRevenueOrders(orders, range, status)) {
    addRevenueRow(map, order.platform || order.source || "Manual", {
      gross: calculateOrderGrossRevenue(order),
      discounts: calculateOrderDiscount(order),
      refunds: calculateOrderRefund(order),
      net: calculateOrderNetRevenue(order),
      quantity: calculateOrderQuantity(order),
      orders: 1,
    });
  }
  return [...map.values()].sort((a, b) => b.net - a.net);
}

export function calculateRevenueByClientCustomer(
  orders: Order[],
  range: PeriodRange,
  status: "all" | "completed" | "pending" | "refunded" = "all",
): RevenueMoneyRow[] {
  const map = new Map<string, RevenueMoneyRow>();
  for (const order of filterRevenueOrders(orders, range, status)) {
    addRevenueRow(map, order.customer || "Unassigned", {
      gross: calculateOrderGrossRevenue(order),
      discounts: calculateOrderDiscount(order),
      refunds: calculateOrderRefund(order),
      net: calculateOrderNetRevenue(order),
      quantity: calculateOrderQuantity(order),
      orders: 1,
    });
  }
  return [...map.values()].sort((a, b) => b.net - a.net);
}

export function calculateRevenueByStatus(
  orders: Order[],
  range: PeriodRange,
  status: "all" | "completed" | "pending" | "refunded" = "all",
): RevenueMoneyRow[] {
  const map = new Map<string, RevenueMoneyRow>();
  for (const order of filterRevenueOrders(orders, range, status)) {
    addRevenueRow(map, order.status, {
      gross: calculateOrderGrossRevenue(order),
      discounts: calculateOrderDiscount(order),
      refunds: calculateOrderRefund(order),
      net: calculateOrderNetRevenue(order),
      quantity: calculateOrderQuantity(order),
      orders: 1,
    });
  }
  return [...map.values()].sort((a, b) => b.net - a.net);
}

export function calculateRevenueByPaymentStatus(
  orders: Order[],
  range: PeriodRange,
  status: "all" | "completed" | "pending" | "refunded" = "all",
): RevenueMoneyRow[] {
  const map = new Map<string, RevenueMoneyRow>();
  for (const order of filterRevenueOrders(orders, range, status)) {
    const label = order.paymentStatus === "partially_paid" ? "Partially paid" : order.paymentStatus;
    addRevenueRow(map, label, {
      gross: calculateOrderGrossRevenue(order),
      discounts: calculateOrderDiscount(order),
      refunds: calculateOrderRefund(order),
      net: calculateOrderNetRevenue(order),
      quantity: calculateOrderQuantity(order),
      orders: 1,
    });
  }
  return [...map.values()].sort((a, b) => b.net - a.net);
}

export function calculateManualVsIntegratedRevenue(
  orders: Order[],
  range: PeriodRange,
): RevenueMoneyRow[] {
  const map = new Map<string, RevenueMoneyRow>();
  for (const order of filterRevenueOrders(orders, range)) {
    const channel = `${order.platform ?? ""} ${order.source ?? ""}`.toLowerCase();
    const label =
      channel.includes("shopify") || channel.includes("csv") || channel.includes("import")
        ? "Integrated / imported"
        : "Manual";
    addRevenueRow(map, label, {
      gross: calculateOrderGrossRevenue(order),
      discounts: calculateOrderDiscount(order),
      refunds: calculateOrderRefund(order),
      net: calculateOrderNetRevenue(order),
      quantity: calculateOrderQuantity(order),
      orders: 1,
    });
  }
  return [...map.values()].sort((a, b) => b.net - a.net);
}

export function calculateRevenue(orders: Order[], range: PeriodRange): RevenueBreakdown {
  const recordedOrders = recordedOrdersInRange(orders, range);
  const saleOrders = saleOrdersInRange(orders, range);
  const refundOrders = refundedOrdersInRange(orders, range);
  const grossRevenue = recordedOrders.reduce((s, o) => s + safeNumber(o.sellingPrice), 0);
  const discounts = recordedOrders.reduce((s, o) => s + safeNumber(o.discount), 0);
  const refunds = refundOrders.reduce((s, o) => s + safeOrderRefund(o), 0);
  const shippingCollected = recordedOrders.reduce((s, o) => s + safeNumber(o.shippingCharged), 0);
  const taxCollected = recordedOrders.reduce((s, o) => s + safeNumber(o.taxAmount), 0);
  const netRevenue = grossRevenue - discounts - refunds;
  const paidRevenue = recordedOrders
    .filter((o) => o.paymentStatus === "paid")
    .reduce((s, o) => s + calculateOrderNetRevenue(o), 0);
  const unpaidRevenue = recordedOrders
    .filter((o) => o.paymentStatus === "unpaid")
    .reduce((s, o) => s + calculateOrderNetRevenue(o), 0);
  const partiallyPaidRevenue = recordedOrders
    .filter((o) => o.paymentStatus === "partially_paid")
    .reduce((s, o) => s + calculateOrderNetRevenue(o), 0);
  return {
    grossRevenue,
    grossSales: grossRevenue,
    refunds,
    discounts,
    shippingCollected,
    taxCollected,
    netRevenue,
    revenue: netRevenue,
    averageOrderValue: saleOrders.length > 0 ? netRevenue / saleOrders.length : 0,
    paidRevenue,
    unpaidRevenue,
    partiallyPaidRevenue,
    orderCount: saleOrders.length,
    completedOrderCount: saleOrders.filter((o) => o.status === "completed").length,
    pendingOrderCount: saleOrders.filter((o) => o.status === "pending").length,
    refundedOrderCount: refundOrders.length,
  };
}

export interface CostBreakdown {
  cogs: number;
  delivery: number;
  deliveryCosts: number;
  packagingCosts: number;
  paymentFees: number;
  orderAdCost: number;
  standaloneAdSpend: number;
  adSpend: number;
  adCost: number;
  fixedCosts: number;
  variableExpenses: number;
  customExpenses: number;
  operatingExpenses: number;
  otherExpenses: number;
  totalCosts: number;
}
