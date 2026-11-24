import type { Expense } from "@/lib/legacyTypes";
import type { AdSpendEntry, Order, Product } from "./types";
import { buildPeriodRangeFromDates, type PeriodRange } from "./period";
import { calculateCashFlow, calculateCosts, calculatePercentDelta, calculateProductPerformance, calculateProfitAndLoss, calculateTopExpenseCategories, type CostBreakdown, type CostCategoryRow, type Pnl, type ProductPerformanceRow } from "./finance";
import { deriveCustomers, type CustomerMergeRecord } from "./customers";
import type { PersistedTransaction } from "./workbenchApi";
import { deriveTransactionCustomers } from "./transactionCustomers";
import { type GeneratedInsight, pushUnique, addCostAndCustomerInsights } from "./insightsEngine.parts/AddCostAndCustomerInsights";
export type { InsightCategory, InsightSeverity, GeneratedInsight } from "./insightsEngine.parts/AddCostAndCustomerInsights";

export interface GenerateInsightsInput {
  orders: Order[];
  products: Product[];
  adSpend: AdSpendEntry[];
  expenses: Expense[];
  customerMerges?: CustomerMergeRecord[];
  transactions?: PersistedTransaction[];
  range: PeriodRange;
  now?: Date;
}

function pct(value: number | null): string {
  return value === null ? "no prior baseline" : `${Math.abs(value).toFixed(1)}%`;
}

export function generateInsights(input: GenerateInsightsInput): GeneratedInsight[] {
  const { orders, products, adSpend, expenses, customerMerges = [], transactions = [], range } = input;
  const priorRange = buildPeriodRangeFromDates(range.priorStart, range.priorEnd, "Prior period");
  const currentPnl = calculateProfitAndLoss(orders, adSpend, expenses, range);
  const priorPnl = calculateProfitAndLoss(orders, adSpend, expenses, priorRange);
  const currentCosts = calculateCosts(orders, adSpend, expenses, range);
  const priorCosts = calculateCosts(orders, adSpend, expenses, priorRange);
  const cashFlow = calculateCashFlow(orders, adSpend, expenses, range);
  const offerPerformance = calculateProductPerformance(products, orders, adSpend, range);
  const customers = deriveCustomers(orders, input.now ?? new Date(), customerMerges);
  const transactionCustomers = deriveTransactionCustomers(transactions, input.now ?? new Date());
  const currentExpenseCategories = calculateTopExpenseCategories(expenses, range, 12);
  const priorExpenseCategories = calculateTopExpenseCategories(expenses, priorRange, 12);
  const insights: GeneratedInsight[] = [];

  const hasAnyData = orders.length > 0 || expenses.length > 0 || adSpend.length > 0 || transactions.length > 0;
  if (!hasAnyData) {
    return [
      {
        id: "summary-not-enough-data",
        type: "summary",
        title: "Not enough data yet",
        plainEnglishMessage: "Add transactions first to generate insights.",
        severity: "neutral",
        priority: 10,
        relatedMetrics: { records: 0 },
        recommendedActionHint: "Add your first transaction in Workbench.",
        actionHref: "/record/transactions",
      },
    ];
  }

  const revenueDelta = calculatePercentDelta(currentPnl.netRevenue, priorPnl.netRevenue);
  const profitDelta = calculatePercentDelta(currentPnl.netProfit, priorPnl.netProfit);
  addProfitAndOfferInsights({ currentPnl, priorPnl, insights, revenueDelta, profitDelta, currentCosts, offerPerformance, currentExpenseCategories, priorExpenseCategories });
  addCostAndCustomerInsights({ currentCosts, currentPnl, priorCosts, priorPnl, revenueDelta, insights, cashFlow, customers, transactionCustomers, transactions });

  if (insights.length === 0) {
    insights.push({
      id: "summary-no-strong-signals",
      type: "summary",
      title: "No strong insight signal yet",
      plainEnglishMessage:
        "Profit Loop has data, but there is not enough movement yet to call out a clear positive or warning.",
      severity: "neutral",
      priority: 20,
      relatedMetrics: {
        netRevenue: currentPnl.netRevenue,
        netProfit: currentPnl.netProfit,
        netMarginPct: currentPnl.marginPct,
      },
      recommendedActionHint: "Add more transactions over time to improve insight quality.",
      actionHref: "/record/transactions",
    });
  }

  return insights.sort((a, b) => b.priority - a.priority);
}

function addProfitAndOfferInsights({ currentPnl, priorPnl, insights, revenueDelta, profitDelta, currentCosts, offerPerformance, currentExpenseCategories, priorExpenseCategories }: { currentPnl: Pnl; priorPnl: Pnl; insights: GeneratedInsight[]; revenueDelta: number | null; profitDelta: number | null; currentCosts: CostBreakdown; offerPerformance: ProductPerformanceRow[]; currentExpenseCategories: CostCategoryRow[]; priorExpenseCategories: CostCategoryRow[] }) {
  if (
    currentPnl.netRevenue > priorPnl.netRevenue &&
    currentPnl.netRevenue > 0 &&
    currentPnl.netProfit < priorPnl.netProfit
  ) {
    pushUnique(insights, {
      id: "summary-revenue-up-profit-down",
      type: "summary",
      title: "You sold more, but kept less",
      plainEnglishMessage:
        "You sold more, but kept less. Revenue increased, but profit dropped because costs grew faster than sales.",
      severity: currentPnl.netProfit < 0 ? "critical" : "warning",
      priority: currentPnl.netProfit < 0 ? 96 : 88,
      relatedMetrics: {
        currentRevenue: currentPnl.netRevenue,
        priorRevenue: priorPnl.netRevenue,
        revenueChangePct: revenueDelta,
        currentNetProfit: currentPnl.netProfit,
        priorNetProfit: priorPnl.netProfit,
        profitChangePct: profitDelta,
      },
      recommendedActionHint: "Review the biggest cost increases before scaling revenue.",
      actionHref: "/insights/profit-leaks",
    });
  }

  if (currentPnl.netProfit < 0) {
    pushUnique(insights, {
      id: "profit-leak-negative-net-profit",
      type: "profit_leaks",
      title: "Profit leak found",
      plainEnglishMessage: "Profit leak found: recorded costs are higher than the money kept from revenue.",
      severity: "critical",
      priority: 94,
      relatedMetrics: {
        netRevenue: currentPnl.netRevenue,
        totalCosts: currentCosts.totalCosts,
        netProfit: currentPnl.netProfit,
        netMarginPct: currentPnl.marginPct,
      },
      recommendedActionHint: "Fix the largest cost driver before increasing spend.",
      actionHref: "/money/profit-loss",
    });
  } else if (currentPnl.netRevenue > 0 && currentPnl.marginPct < 10) {
    pushUnique(insights, {
      id: "profit-leak-thin-margin",
      type: "profit_leaks",
      title: "Profit is thin",
      plainEnglishMessage: "Profit leak found: the business is making revenue, but the true margin is weak.",
      severity: "warning",
      priority: 78,
      relatedMetrics: {
        netRevenue: currentPnl.netRevenue,
        netProfit: currentPnl.netProfit,
        netMarginPct: currentPnl.marginPct,
      },
      recommendedActionHint: "Check pricing, delivery costs, discounts, and ads.",
      actionHref: "/money/profit-loss",
    });
  }

  const topRevenueOffers = [...offerPerformance].sort((a, b) => b.revenue - a.revenue);
  const highRevenueThreshold = Math.max(currentPnl.netRevenue * 0.2, 1);
  const highRevenueLowMargin = topRevenueOffers.find(
    (offer) => offer.revenue >= highRevenueThreshold && offer.marginPct < 15,
  );
  if (highRevenueLowMargin) {
    pushUnique(insights, {
      id: `offers-high-revenue-low-margin-${highRevenueLowMargin.productId}`,
      type: "offers",
      title: "High revenue, weak margin offer",
      plainEnglishMessage:
        "This offer brings sales, but does not give strong profit. Check pricing, costs, discounts, or ads before scaling it.",
      severity: highRevenueLowMargin.trueProfit < 0 ? "critical" : "warning",
      priority: highRevenueLowMargin.trueProfit < 0 ? 90 : 80,
      relatedMetrics: {
        offerName: highRevenueLowMargin.productName,
        revenue: highRevenueLowMargin.revenue,
        trueProfit: highRevenueLowMargin.trueProfit,
        marginPct: highRevenueLowMargin.marginPct,
      },
      relatedOfferId: highRevenueLowMargin.productId,
      recommendedActionHint: "Improve this offer's margin before pushing more traffic to it.",
      actionHref: "/money/profit-loss",
    });
  }

  const offerWinner = topRevenueOffers.find(
    (offer) =>
      offer.revenue >= Math.max(currentPnl.netRevenue * 0.1, 1) &&
      offer.trueProfit > 0 &&
      offer.marginPct >= 30,
  );
  if (offerWinner) {
    pushUnique(insights, {
      id: `offers-winner-${offerWinner.productId}`,
      type: "offers",
      title: "Healthy offer",
      plainEnglishMessage: "This offer looks healthy. It has strong profit compared to its revenue.",
      severity: "positive",
      priority: 64,
      relatedMetrics: {
        offerName: offerWinner.productName,
        revenue: offerWinner.revenue,
        trueProfit: offerWinner.trueProfit,
        marginPct: offerWinner.marginPct,
      },
      relatedOfferId: offerWinner.productId,
      recommendedActionHint: "Consider giving this offer more attention if demand stays steady.",
      actionHref: "/plan/action-plan",
    });
  }

  for (const currentCategory of currentExpenseCategories.slice(0, 5)) {
    const priorCategory = priorExpenseCategories.find(
      (item) => item.label.toLowerCase() === currentCategory.label.toLowerCase(),
    );
    const priorAmount = priorCategory?.amount ?? 0;
    const deltaPct = calculatePercentDelta(currentCategory.amount, priorAmount);
    const absoluteIncrease = currentCategory.amount - priorAmount;
    if (currentCategory.amount > 0 && absoluteIncrease > 0 && (deltaPct === null || deltaPct >= 20)) {
      pushUnique(insights, {
        id: `costs-spike-${currentCategory.label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
        type: "costs",
        title: `${currentCategory.label} cost increased`,
        plainEnglishMessage:
          deltaPct === null
            ? `Your ${currentCategory.label} cost is now recorded at a higher level than the prior period. This is putting pressure on profit.`
            : `Your ${currentCategory.label} cost increased by ${pct(deltaPct)}. This is putting pressure on profit.`,
        severity: deltaPct !== null && deltaPct >= 50 ? "critical" : "warning",
        priority: deltaPct !== null && deltaPct >= 50 ? 86 : 74,
        relatedMetrics: {
          category: currentCategory.label,
          currentCost: currentCategory.amount,
          priorCost: priorAmount,
          costChangePct: deltaPct,
        },
        recommendedActionHint: "Review whether this cost is temporary, necessary, or negotiable.",
        actionHref: "/setup/expenses",
      });
      break;
    }
  }
}
