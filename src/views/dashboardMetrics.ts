import { calculateOrderGrossRevenue, calculateOrderNetRevenue } from "@/lib/finance";
import type { Order } from "@/lib/types";

export type LeaderRow = {
  id: string;
  label: string;
  amount: number;
};

export function buildTopRevenues(orders: Order[]): LeaderRow[] {
  const map = new Map<string, LeaderRow>();
  const add = (label: string, amount: number) => {
    const current = map.get(label) ?? { id: label, label, amount: 0 };
    current.amount += amount;
    map.set(label, current);
  };
  for (const order of orders) {
    if (order.status === "cancelled") continue;
    const netRevenue = Math.max(0, calculateOrderNetRevenue(order));
    if (netRevenue <= 0) continue;
    if (!order.items || order.items.length === 0) {
      add(order.productName || "Other Revenue", netRevenue);
      continue;
    }
    // Multi-item cart sales split their net revenue across every item proportionally
    // to that item's raw subtotal share, instead of dumping the whole sale under one label.
    const orderGross = Math.max(1, calculateOrderGrossRevenue(order));
    for (const item of order.items) {
      const gross = item.unitSellingPrice * Math.max(1, item.quantity);
      const share = gross / orderGross;
      add(item.productName || "Other Revenue", netRevenue * share);
    }
  }
  return [...map.values()].sort((a, b) => b.amount - a.amount).slice(0, 4);
}
