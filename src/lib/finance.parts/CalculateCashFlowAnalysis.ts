import type { Order, AdSpendEntry, Product } from "../types";
import type { Expense } from "@/lib/legacyTypes";
import { type PeriodRange } from "../period";
import { safeNumber, safeOrderRevenue, adDateInRange, saleOrdersInRange } from "./Pnl";
import { calculateExpenseTotalByTerms } from "./ComputeTimeSeries";
import { calculateCosts, calculateProfitAndLoss, type CashFlowAnalysis, calculateCashFlow } from "./CalculateProfitAndLoss";

export function calculateCashFlowAnalysis(
  orders: Order[],
  adSpend: AdSpendEntry[],
  expenses: Expense[],
  range: PeriodRange,
  openingCash = 0,
): CashFlowAnalysis {
  const cashFlow = calculateCashFlow(orders, adSpend, expenses, range, openingCash);
  const pnl = calculateProfitAndLoss(orders, adSpend, expenses, range);
  const costs = calculateCosts(orders, adSpend, expenses, range);
  const unpaidRevenue = cashFlow.unpaidRevenue + cashFlow.partiallyPaidRevenue;
  const ownerWithdrawals = calculateExpenseTotalByTerms(expenses, range, [
    "owner withdrawal",
    "withdrawal",
    "drawings",
    "owner draw",
  ]);
  const ownerInvestment = calculateExpenseTotalByTerms(expenses, range, [
    "owner investment",
    "capital injection",
    "owner capital",
  ]);
  const paidSalaries = calculateExpenseTotalByTerms(expenses, range, [
    "salary",
    "staff",
    "payroll",
    "wage",
  ]);
  const availableCashEstimate = cashFlow.cashBalanceEstimate;
  const totalCashIn = cashFlow.cashIn + ownerInvestment;
  const totalCashOut = cashFlow.cashOut + ownerWithdrawals;
  const cashPressure =
    availableCashEstimate < 0
      ? "High"
      : cashFlow.unpaidExpenses > Math.max(1, cashFlow.cashIn) * 0.25 ||
          unpaidRevenue > Math.max(1, cashFlow.cashIn) * 0.3
        ? "Medium"
        : "Low";

  const warnings = [
    pnl.netProfit > 0 && unpaidRevenue > 0
      ? {
          tone: "warn" as const,
          text: "You are profitable on paper, but some cash is still unpaid.",
        }
      : null,
    cashFlow.unpaidExpenses > 0
      ? {
          tone: cashPressure === "High" ? ("bad" as const) : ("warn" as const),
          text: "Your upcoming unpaid expenses may reduce available cash.",
        }
      : null,
    availableCashEstimate >= 0 && unpaidRevenue === 0 && cashFlow.unpaidExpenses === 0
      ? {
          tone: "good" as const,
          text: "Your tracked cash position looks stable for this period.",
        }
      : null,
  ].filter(Boolean) as CashFlowAnalysis["warnings"];

  const cashInRows: CashFlowAnalysis["cashInRows"] = [
    {
      label: "Paid revenue",
      help: "Revenue transactions marked as paid",
      amount: cashFlow.paidRevenue,
      kind: "in",
    },
    {
      label: "Owner investment",
      help: "Only shown if recorded with an owner investment note",
      amount: ownerInvestment,
      kind: ownerInvestment > 0 ? "in" : "neutral",
    },
    {
      label: "Other revenue",
      help: "Will expand after the full Transactions migration",
      amount: 0,
      kind: "neutral",
    },
    {
      label: "Total cash in",
      help: "Actual tracked money received",
      amount: totalCashIn,
      kind: "total",
    },
  ];

  const cashOutRows: CashFlowAnalysis["cashOutRows"] = [
    {
      label: "Paid expenses",
      help: "Manual expenses marked paid",
      amount: cashFlow.paidExpenses,
      kind: "out",
    },
    {
      label: "Delivery costs",
      help: "Delivery costs from revenue transactions",
      amount: costs.delivery,
      kind: "out",
    },
    {
      label: "Ads",
      help: "Transaction-level and standalone marketing spend",
      amount: costs.adSpend,
      kind: "out",
    },
    {
      label: "Salaries",
      help: "Paid staff, payroll, wage, or salary expenses",
      amount: paidSalaries,
      kind: paidSalaries > 0 ? "out" : "neutral",
    },
    {
      label: "Owner withdrawals",
      help: "Owner draw or withdrawal expenses if recorded",
      amount: ownerWithdrawals,
      kind: ownerWithdrawals > 0 ? "out" : "neutral",
    },
    {
      label: "Total cash out",
      help: "Actual tracked money leaving the business",
      amount: totalCashOut,
      kind: "total",
    },
  ];

  const positionRows: CashFlowAnalysis["positionRows"] = [
    {
      label: "Opening cash buffer",
      help: "Cash buffer set in app settings",
      amount: openingCash,
      kind: "neutral",
    },
    {
      label: "Net cash flow",
      help: "Cash in minus cash out for this period",
      amount: cashFlow.netCashFlow,
      kind: "total",
    },
    {
      label: "Available cash estimate",
      help: "Estimated cash after tracked movement",
      amount: availableCashEstimate,
      kind: "total",
    },
  ];

  return {
    cashFlow,
    ownerWithdrawals,
    ownerInvestment,
    paidSalaries,
    unpaidRevenue,
    totalCashIn,
    totalCashOut,
    availableCashEstimate,
    cashPressure,
    cashInRows,
    cashOutRows,
    positionRows,
    warnings,
  };
}

export interface ProductPerformanceRow {
  productId: string;
  productName: string;
  imageColor: string;
  revenue: number;
  cogs: number;
  delivery: number;
  adSpend: number;
  grossProfit: number;
  netProfit: number;
  trueProfit: number;
  marginPct: number;
  orderCount: number;
  unitsSold: number;
  isUnprofitable: boolean;
}

export function calculateProductPerformance(
  products: Product[],
  orders: Order[],
  adSpend: AdSpendEntry[],
  range: PeriodRange,
): ProductPerformanceRow[] {
  const saleOrders = saleOrdersInRange(orders, range);
  const totalRevenue = saleOrders.reduce((s, o) => s + safeOrderRevenue(o), 0);
  const standaloneAdInPeriod = adSpend
    .filter((a) => adDateInRange(a, range))
    .reduce((s, a) => s + safeNumber(a.totalSpend), 0);
  const productMap = new Map(products.map((p) => [p.id, p]));
  const byProduct = new Map<
    string,
    {
      productName: string;
      imageColor: string;
      revenue: number;
      cogs: number;
      delivery: number;
      adSpend: number;
      orderIds: Set<string>;
      unitsSold: number;
    }
  >();

  for (const order of saleOrders) {
    const items: Order["items"] = order.items?.length
      ? order.items
      : [
          {
            id: `${order.id}-legacy-item`,
            productId: order.productId,
            productName: order.productName,
            quantity: 1,
            unitSellingPrice: order.sellingPrice,
            unitCostPrice: order.costPrice,
          },
        ];
    const orderGross = items.reduce(
      (s, it) => s + safeNumber(it.quantity) * safeNumber(it.unitSellingPrice),
      0,
    );

    for (const item of items) {
      if (!item.productId) continue;
      const itemRevenue = safeNumber(item.quantity) * safeNumber(item.unitSellingPrice);
      const itemCogs = safeNumber(item.quantity) * safeNumber(item.unitCostPrice);
      const share = orderGross > 0 ? itemRevenue / orderGross : 1 / Math.max(1, items.length);
      const allocatedRevenue =
        safeNumber(order.sellingPrice) > 0
          ? safeOrderRevenue(order) * (itemRevenue / safeNumber(order.sellingPrice))
          : itemRevenue;
      const allocatedStandalone =
        totalRevenue > 0 ? standaloneAdInPeriod * (allocatedRevenue / totalRevenue) : 0;
      const product = productMap.get(item.productId);
      const cur =
        byProduct.get(item.productId) ??
        {
          productName: product?.name ?? item.productName ?? "Unknown product",
          imageColor: product?.imageColor ?? "210 8% 50%",
          revenue: 0,
          cogs: 0,
          delivery: 0,
          adSpend: 0,
          orderIds: new Set<string>(),
          unitsSold: 0,
        };
      cur.revenue += allocatedRevenue;
      cur.cogs += itemCogs;
      cur.delivery += safeNumber(order.deliveryCost) * share;
      cur.adSpend += safeNumber(order.adCost) * share + allocatedStandalone;
      cur.orderIds.add(order.id);
      cur.unitsSold += safeNumber(item.quantity);
      byProduct.set(item.productId, cur);
    }
  }

  return [...byProduct.entries()]
    .map(([productId, m]) => {
      const grossProfit = m.revenue - m.cogs - m.delivery;
      const netProfit = grossProfit - m.adSpend;
      return {
        productId,
        productName: m.productName,
        imageColor: m.imageColor,
        revenue: m.revenue,
        cogs: m.cogs,
        delivery: m.delivery,
        adSpend: m.adSpend,
        grossProfit,
        netProfit,
        trueProfit: netProfit,
        marginPct: m.revenue > 0 ? (netProfit / m.revenue) * 100 : 0,
        orderCount: m.orderIds.size,
        unitsSold: m.unitsSold,
        isUnprofitable: netProfit < 0,
      };
    })
    .sort((a, b) => b.netProfit - a.netProfit);
}

export interface ProductProfit {
  productId: string;
  productName: string;
  imageColor: string;
  totalProfit: number;
  totalRevenue: number;
  totalAdCost: number;
  totalCostBase: number;
  orderCount: number;
  marginPct: number;
  avgProfitPerOrder: number;
  unitsSold: number;
}
