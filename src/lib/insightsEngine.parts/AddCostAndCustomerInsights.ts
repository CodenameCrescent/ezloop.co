import { type CostBreakdown, type Pnl, type CashFlow, calculatePercentDelta } from "../finance";
import { type Customer } from "../customers";
import type { PersistedTransaction } from "../workbenchApi";
import { type TransactionCustomer } from "../transactionCustomers";

export type InsightCategory =
  | "summary"
  | "revenue"
  | "costs"
  | "profit_leaks"
  | "offers"
  | "clients_customers"
  | "ads";

export type InsightSeverity = "positive" | "neutral" | "warning" | "critical";

export interface GeneratedInsight {
  id: string;
  type: InsightCategory;
  title: string;
  plainEnglishMessage: string;
  severity: InsightSeverity;
  priority: number;
  relatedMetrics: Record<string, number | string | null>;
  relatedOfferId?: string | null;
  relatedClientId?: string | null;
  relatedCampaignId?: string | null;
  recommendedActionHint?: string;
  actionHref?: string;
}

export function metricPct(value: number, denominator: number): number {
  return denominator > 0 ? (value / denominator) * 100 : 0;
}

export function pushUnique(insights: GeneratedInsight[], insight: GeneratedInsight) {
  if (!insights.some((item) => item.id === insight.id)) insights.push(insight);
}

export function addCostAndCustomerInsights({ currentCosts, currentPnl, priorCosts, priorPnl, revenueDelta, insights, cashFlow, customers, transactionCustomers, transactions }: { currentCosts: CostBreakdown; currentPnl: Pnl; priorCosts: CostBreakdown; priorPnl: Pnl; revenueDelta: number | null; insights: GeneratedInsight[]; cashFlow: CashFlow; customers: Customer[]; transactionCustomers: TransactionCustomer[]; transactions: PersistedTransaction[] }) {

  const adShare = metricPct(currentCosts.adCost, currentPnl.netRevenue);
  const priorAdShare = metricPct(priorCosts.adCost, priorPnl.netRevenue);
  const adSpendDelta = calculatePercentDelta(currentCosts.adCost, priorCosts.adCost);
  const adShareWorse = currentCosts.adCost > 0 && adShare > Math.max(priorAdShare + 5, 20);
  const adsOutrunningBusiness =
    currentCosts.adCost > priorCosts.adCost &&
    (revenueDelta === null || adSpendDelta === null || adSpendDelta > Math.max(revenueDelta, 0)) &&
    currentPnl.netProfit <= priorPnl.netProfit;
  if (adShareWorse || adsOutrunningBusiness) {
    pushUnique(insights, {
      id: "ads-spend-pressure",
      type: "ads",
      title: "Ad spend pressure",
      plainEnglishMessage:
        "Ads are taking a bigger share of revenue this period. Check whether campaigns are creating true profit, not just sales.",
      severity: currentCosts.adCost > currentPnl.netProfit && currentPnl.netProfit > 0 ? "warning" : "critical",
      priority: adShare > 35 ? 88 : 76,
      relatedMetrics: {
        adSpend: currentCosts.adCost,
        priorAdSpend: priorCosts.adCost,
        adSpendChangePct: adSpendDelta,
        adShareOfRevenuePct: adShare,
        priorAdShareOfRevenuePct: priorAdShare,
      },
      recommendedActionHint: "Compare each campaign against true profit before raising budget.",
      actionHref: "/insights/ads",
    });
  }

  if (cashFlow.cashIn > 0 && cashFlow.cashOut >= cashFlow.cashIn * 0.9) {
    pushUnique(insights, {
      id: "summary-weak-cash-flow",
      type: "summary",
      title: "Cash is tight",
      plainEnglishMessage: "Cash is tight. Money going out is close to or higher than money coming in.",
      severity: cashFlow.cashOut > cashFlow.cashIn ? "critical" : "warning",
      priority: cashFlow.cashOut > cashFlow.cashIn ? 92 : 72,
      relatedMetrics: {
        cashIn: cashFlow.cashIn,
        cashOut: cashFlow.cashOut,
        netCashFlow: cashFlow.netCashFlow,
        unpaidRevenue: cashFlow.unpaidRevenue + cashFlow.partiallyPaidRevenue,
      },
      recommendedActionHint: "Collect unpaid revenue and delay avoidable spending where possible.",
      actionHref: "/money/cash-flow",
    });
  }

  const topCustomer = customers
    .filter((customer) => customer.totalRevenue > 0)
    .sort((a, b) => b.totalRevenue - a.totalRevenue)[0];
  if (topCustomer) {
    pushUnique(insights, {
      id: `clients-top-${topCustomer.id}`,
      type: "clients_customers",
      title: "Highest-value relationship",
      plainEnglishMessage:
        "This client or customer is your highest recorded relationship by revenue. Keep the relationship warm if profit is also healthy.",
      severity: "positive",
      priority: 52,
      relatedMetrics: {
        clientCustomerName: topCustomer.name,
        revenue: topCustomer.totalRevenue,
        profit: topCustomer.totalProfit,
        orders: topCustomer.ordersCount,
      },
      relatedClientId: topCustomer.id,
      recommendedActionHint: "Look for ways to retain or repeat this relationship.",
      actionHref: "/setup/people",
    });
  }

  const topTransactionCustomer = transactionCustomers[0];
  if (topTransactionCustomer) {
    pushUnique(insights, {
      id: `clients-profit-ltv-${topTransactionCustomer.id}`,
      type: "clients_customers",
      title: "Highest profit customer",
      plainEnglishMessage: `${topTransactionCustomer.name} has ${topTransactionCustomer.totalOrders} recorded order${topTransactionCustomer.totalOrders === 1 ? "" : "s"} and strong profit LTV from transactions.`,
      severity: "positive",
      priority: 66,
      relatedMetrics: {
        customerName: topTransactionCustomer.name,
        revenueLtv: topTransactionCustomer.revenueLtv,
        profitLtv: topTransactionCustomer.profitLtv,
        repeatPurchaseCount: topTransactionCustomer.repeatPurchaseCount,
      },
      recommendedActionHint: "Look for what this customer bought first and create a repeat-purchase path for similar buyers.",
      actionHref: "/setup/people",
    });
  }

  if (transactionCustomers.length >= 3) {
    const oneTimeCustomers = transactionCustomers.filter((customer) => customer.totalOrders === 1).length;
    const oneTimeRate = (oneTimeCustomers / transactionCustomers.length) * 100;
    if (oneTimeRate >= 60) {
      pushUnique(insights, {
        id: "clients-one-time-buyer-pressure",
        type: "clients_customers",
        title: "Too many one-time buyers",
        plainEnglishMessage: `${oneTimeRate.toFixed(0)}% of customers bought only once. Create a follow-up offer or bundle to bring them back.`,
        severity: "warning",
        priority: 82,
        relatedMetrics: {
          customers: transactionCustomers.length,
          oneTimeCustomers,
          oneTimeRate,
        },
        recommendedActionHint: "Build a simple repeat-purchase offer for your most common first product.",
        actionHref: "/setup/people",
      });
    }
  }

  const weakCostTransaction = transactions.find((transaction) => {
    const metadata = transaction.metadataJson;
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return false;
    const accuracy = (metadata as Record<string, unknown>).costAccuracy;
    return accuracy === "Estimated" || accuracy === "Needs update" || accuracy === "Default margin";
  });
  if (weakCostTransaction) {
    const metadata = weakCostTransaction.metadataJson as Record<string, unknown>;
    pushUnique(insights, {
      id: `profit-leak-cost-accuracy-${weakCostTransaction.id}`,
      type: "profit_leaks",
      title: "Cost accuracy needs review",
      plainEnglishMessage:
        metadata.costAccuracy === "Needs update"
          ? "A revenue transaction has unknown cost. Profit may look better than reality until you update it."
          : "A revenue transaction uses estimated/default cost. Update it later for accurate profit.",
      severity: metadata.costAccuracy === "Needs update" ? "critical" : "warning",
      priority: metadata.costAccuracy === "Needs update" ? 89 : 70,
      relatedMetrics: {
        transactionId: weakCostTransaction.id,
        costAccuracy: String(metadata.costAccuracy),
        finalCostUsed: Number(metadata.finalCostUsed) || null,
      },
      recommendedActionHint: "Open the transaction and replace the estimate with exact cost when you know it.",
      actionHref: "/record/transactions",
    });
  }

  const refundTransaction = transactions.find((transaction) => transaction.transactionType === "refund");
  if (refundTransaction) {
    const metadata = refundTransaction.metadataJson && typeof refundTransaction.metadataJson === "object" && !Array.isArray(refundTransaction.metadataJson)
      ? refundTransaction.metadataJson as Record<string, unknown>
      : {};
    pushUnique(insights, {
      id: `profit-leak-refund-${refundTransaction.id}`,
      type: "profit_leaks",
      title: "Refund reduced profit",
      plainEnglishMessage:
        metadata.refundDateMode === "original_sale_date"
          ? "A refund was assigned back to the original sale date, so today's profit is not affected."
          : "A refund was processed in this period and reduced profit.",
      severity: "warning",
      priority: 76,
      relatedMetrics: {
        refundAmount: Number(metadata.refundAmount) || Math.abs(Number(refundTransaction.amount) || 0),
        profitImpact: Number(metadata.profitImpact) || null,
      },
      recommendedActionHint: "Review refund reasons and decide whether the issue is product quality, pricing, or fulfillment.",
      actionHref: "/record/transactions",
    });
  }

  if (currentPnl.netRevenue > 0 && currentPnl.netProfit >= priorPnl.netProfit && currentPnl.marginPct >= 20) {
    pushUnique(insights, {
      id: "summary-business-healthy",
      type: "summary",
      title: "Business health looks steady",
      plainEnglishMessage:
        "The business is keeping a healthy share of revenue after recorded costs in this period.",
      severity: "positive",
      priority: 40,
      relatedMetrics: {
        netRevenue: currentPnl.netRevenue,
        netProfit: currentPnl.netProfit,
        netMarginPct: currentPnl.marginPct,
      },
      recommendedActionHint: "Keep tracking costs so this margin remains real.",
      actionHref: "/money/profit-loss",
    });
  }
}
