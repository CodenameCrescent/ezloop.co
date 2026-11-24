import type { Product, Order, AdSpendEntry } from "../types";
import { type PeriodRange, inRange } from "../period";
import { type Pnl, calculateOrderProfit, orderRevenue, activeOrders } from "./Pnl";
import { calculateProductPerformance } from "./CalculateCashFlowAnalysis";
import { type ProductProfitabilityRow } from "./ComputeMonthlySeries";

/**
 * Per-product true profit, period-filtered. Uses order-level adCost plus
 * a revenue-weighted allocation of standalone ad spend in the period —
 * matching how the rest of the app attributes campaign spend.
 */
export function productProfitability(
  products: Product[],
  orders: Order[],
  adSpend: AdSpendEntry[],
  range: PeriodRange,
): ProductProfitabilityRow[] {
  return calculateProductPerformance(products, orders, adSpend, range)
    .map((row) => ({
      productId: row.productId,
      productName: row.productName,
      imageColor: row.imageColor,
      revenue: row.revenue,
      trueProfit: row.trueProfit,
      marginPct: row.marginPct,
      orderCount: row.orderCount,
      isUnprofitable: row.isUnprofitable,
    }))
    .sort((a, b) => a.trueProfit - b.trueProfit);
}

// ─── Channel × Platform matrix ──────────────────────────────────────────────

export interface ChannelPlatformCell {
  source: string;
  platform: string;
  orders: number;
  revenue: number;
  profit: number;
  marginPct: number;
}

export const UNKNOWN_TAG = "Untagged";

export function channelPlatformMatrix(
  orders: Order[],
  range: PeriodRange,
): { rows: string[]; cols: string[]; cells: ChannelPlatformCell[] } {
  const live = activeOrders(orders).filter((o) =>
    inRange(new Date(o.date), range.start, range.end),
  );
  const map = new Map<string, ChannelPlatformCell>();
  const rowSet = new Set<string>();
  const colSet = new Set<string>();

  for (const o of live) {
    const src = (o.source ?? "").trim() || UNKNOWN_TAG;
    const plat = (o.platform ?? "").trim() || UNKNOWN_TAG;
    rowSet.add(src);
    colSet.add(plat);
    const key = `${src}|||${plat}`;
    const cell = map.get(key) ?? {
      source: src,
      platform: plat,
      orders: 0,
      revenue: 0,
      profit: 0,
      marginPct: 0,
    };
    const rev = orderRevenue(o);
    cell.orders += 1;
    cell.revenue += rev;
    cell.profit += calculateOrderProfit(o);
    map.set(key, cell);
  }

  for (const cell of map.values()) {
    cell.marginPct = cell.revenue > 0 ? (cell.profit / cell.revenue) * 100 : 0;
  }

  const sortGroup = (a: string, b: string) => {
    if (a === UNKNOWN_TAG) return 1;
    if (b === UNKNOWN_TAG) return -1;
    return a.localeCompare(b);
  };

  return {
    rows: [...rowSet].sort(sortGroup),
    cols: [...colSet].sort(sortGroup),
    cells: [...map.values()],
  };
}

// ─── Cost driver deltas ─────────────────────────────────────────────────────

export interface CostDriverDelta {
  label: string;
  current: number;
  prior: number;
  absDelta: number;
  pctDelta: number | null;
  pctOfRevenue: number;
}

export function computeCostDriverDeltas(
  current: Pnl,
  prior: Pnl,
): CostDriverDelta[] {
  const items: { label: string; cur: number; prior: number }[] = [
    { label: "COGS", cur: current.cogs, prior: prior.cogs },
    { label: "Delivery", cur: current.delivery, prior: prior.delivery },
    { label: "Ad Spend", cur: current.adCost, prior: prior.adCost },
    { label: "Fixed Costs", cur: current.fixedCosts, prior: prior.fixedCosts },
    {
      label: "Variable",
      cur: current.variableExpenses,
      prior: prior.variableExpenses,
    },
    {
      label: "Custom",
      cur: current.customExpenses,
      prior: prior.customExpenses,
    },
    { label: "Discounts", cur: current.discounts, prior: prior.discounts },
  ];
  const rev = current.revenue;
  return items
    .map(({ label, cur, prior }) => {
      const absDelta = cur - prior;
      const pctDelta =
        prior === 0 ? (cur === 0 ? 0 : null) : ((cur - prior) / prior) * 100;
      return {
        label,
        current: cur,
        prior,
        absDelta,
        pctDelta,
        pctOfRevenue: rev > 0 ? (cur / rev) * 100 : 0,
      };
    })
    .sort((a, b) => b.absDelta - a.absDelta);
}
