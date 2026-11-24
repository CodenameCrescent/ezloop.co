import type { Order, Product, ProductMetrics, DecisionCategory } from "./types";
import { calculateProductProfit } from "./finance";

export function computeProductMetrics(
  product: Product,
  orders: Order[],
): ProductMetrics {
  const productProfit = calculateProductProfit(product, orders);
  const totalRevenue = productProfit.totalRevenue;
  const totalAdCost = productProfit.totalAdCost;
  const totalCostBase = productProfit.totalCostBase;
  const totalProfit = productProfit.totalProfit;
  const marginPct = productProfit.marginPct;
  const orderCount = productProfit.orderCount;
  const avgProfitPerOrder = productProfit.avgProfitPerOrder;

  const profitScore = Math.max(0, Math.min(40, (totalProfit / 5000) * 40));
  const marginScore = Math.max(
    0,
    Math.min(30, (Math.max(0, marginPct) / 60) * 30),
  );
  const adRatio =
    totalAdCost > 0 ? totalProfit / totalAdCost : totalProfit > 0 ? 5 : 0;
  const adScore = Math.max(0, Math.min(20, (adRatio / 4) * 20));
  const volumeScore = Math.max(0, Math.min(10, (orderCount / 20) * 10));
  let score = Math.round(profitScore + marginScore + adScore + volumeScore);
  if (totalProfit <= 0) score = Math.min(score, 30);
  if (orderCount === 0) score = 0;

  let category: DecisionCategory;
  if (totalProfit <= 0 || score < 45) {
    category = "stop";
  } else if (score >= 75 && marginPct > 30) {
    category = "scale";
  } else {
    category = "optimize";
  }

  const flags: string[] = [];
  if (totalAdCost > totalProfit && totalAdCost > 0) {
    flags.push("Ad spend exceeds profit");
  }
  if (marginPct < 15 && orderCount > 0) {
    flags.push("Low margin");
  }
  if (orderCount === 0) {
    flags.push("No sales yet");
  }

  let reason = "";
  if (orderCount === 0) {
    reason = "No orders recorded yet — needs traffic.";
  } else if (category === "scale") {
    reason = `Strong ${marginPct.toFixed(0)}% margin and healthy profit. Increase budget.`;
  } else if (category === "optimize") {
    if (marginPct < 25) {
      reason = "Margins are tight — reduce cost or raise price.";
    } else if (adRatio < 2) {
      reason = "Profit is decent but ad efficiency is weak.";
    } else {
      reason = "Steady performer — small tweaks could unlock scale.";
    }
  } else {
    if (totalProfit < 0) {
      reason = "Losing money — ad cost is eating the margin.";
    } else if (marginPct < 10) {
      reason = "Very low margin and low score. Consider stopping.";
    } else {
      reason = "Underperforming — not worth the spend right now.";
    }
  }

  return {
    productId: product.id,
    productName: product.name,
    imageColor: product.imageColor,
    totalProfit,
    totalRevenue,
    totalAdCost,
    totalCostBase,
    orderCount,
    marginPct,
    avgProfitPerOrder,
    score,
    category,
    reason,
    flags,
  };
}

export function computeAllMetrics(
  products: Product[],
  orders: Order[],
): ProductMetrics[] {
  return products
    .map((p) => computeProductMetrics(p, orders))
    .sort((a, b) => b.score - a.score);
}

export function businessHealthScore(metrics: ProductMetrics[]): {
  score: number;
  label: string;
} {
  if (metrics.length === 0) return { score: 0, label: "No data" };
  const active = metrics.filter((m) => m.orderCount > 0);
  if (active.length === 0) return { score: 0, label: "No data" };
  const avg =
    active.reduce((s, m) => s + m.score, 0) / active.length;
  const score = Math.round(avg);
  let label: string;
  if (score >= 80) label = "Excellent";
  else if (score >= 65) label = "Good";
  else if (score >= 45) label = "Fair";
  else label = "At Risk";
  return { score, label };
}
