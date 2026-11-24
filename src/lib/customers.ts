import { calculateOrderNetRevenue } from "./finance";
import { type RfmSegment, type Customer, UNKNOWN } from "./customers.parts/DeriveCustomers";
export { normalizeName, normalizePhone, deriveCustomers } from "./customers.parts/DeriveCustomers";
export type { RfmSegment, CustomerMergeRecord, CustomerMergeHistoryEntry, Customer } from "./customers.parts/DeriveCustomers";

export const SEGMENT_META: Record<
  RfmSegment,
  { label: string; color: string; ring: string; description: string }
> = {
  champion: {
    label: "Champion",
    color: "text-emerald-300",
    ring: "border-emerald-500/40 bg-emerald-500/10",
    description: "Bought recently, often, and spent a lot.",
  },
  loyal: {
    label: "Loyal",
    color: "text-sky-300",
    ring: "border-sky-500/40 bg-sky-500/10",
    description: "Buys regularly. Backbone of revenue.",
  },
  potential: {
    label: "Potential",
    color: "text-violet-300",
    ring: "border-violet-500/40 bg-violet-500/10",
    description: "Bought recently but only a few times — nurture them.",
  },
  new: {
    label: "New",
    color: "text-cyan-300",
    ring: "border-cyan-500/40 bg-cyan-500/10",
    description: "First-time buyer in the recent window.",
  },
  at_risk: {
    label: "At Risk",
    color: "text-amber-300",
    ring: "border-amber-500/40 bg-amber-500/10",
    description: "Used to buy often but hasn't lately.",
  },
  lost: {
    label: "Lost",
    color: "text-red-300",
    ring: "border-red-500/40 bg-red-500/10",
    description: "Long gone. Re-activation needed.",
  },
};

export const SEGMENT_ORDER: RfmSegment[] = [
  "champion",
  "loyal",
  "potential",
  "new",
  "at_risk",
  "lost",
];

// ─── Period helpers ─────────────────────────────────────────────────────────

export interface PeriodRange {
  start: Date;
  end: Date;
  priorStart: Date;
  priorEnd: Date;
}

export function buildPeriodRange(days: number, now: Date = new Date()): PeriodRange {
  const end = new Date(now);
  const start = new Date(end);
  start.setDate(end.getDate() - days);
  const priorEnd = new Date(start);
  const priorStart = new Date(priorEnd);
  priorStart.setDate(priorEnd.getDate() - days);
  return { start, end, priorStart, priorEnd };
}

export function inRange(d: Date, start: Date, end: Date): boolean {
  const t = d.getTime();
  return t >= start.getTime() && t <= end.getTime();
}

// ─── Period KPI aggregation ─────────────────────────────────────────────────

export interface PeriodKpis {
  activeCustomers: number;
  newCustomers: number;
  repeatPurchaseRate: number; // % of customers active in period with >=2 lifetime orders
  avgLifetimeValue: number; // across active-in-period customers
  revenueFromRepeat: number;
  revenueFromNew: number;
  pctRevenueFromRepeat: number;
}

export function computePeriodKpis(
  customers: Customer[],
  range: PeriodRange,
): PeriodKpis {
  const active = customers.filter((c) =>
    c.orders.some((o) => {
      if (o.status === "cancelled" || o.status === "refunded") return false;
      const d = new Date(o.date);
      return inRange(d, range.start, range.end);
    }),
  );
  const newOnes = customers.filter((c) =>
    inRange(c.firstOrderDate, range.start, range.end),
  );
  const repeatActive = active.filter((c) => c.ordersCount >= 2);
  const totalLtv = active.reduce((s, c) => s + c.totalRevenue, 0);

  let revenueFromRepeat = 0;
  let revenueFromNew = 0;
  for (const c of customers) {
    for (const o of c.orders) {
      if (o.status === "cancelled" || o.status === "refunded") continue;
      const d = new Date(o.date);
      if (!inRange(d, range.start, range.end)) continue;
      const orderRev = calculateOrderNetRevenue(o);
      // An order is "new" only if it's the customer's very first live order
      // AND that first order falls in this period. Compared by ID so we don't
      // depend on millisecond-level Date equality.
      if (o.id === c.firstOrderId && inRange(c.firstOrderDate, range.start, range.end)) {
        revenueFromNew += orderRev;
      } else {
        revenueFromRepeat += orderRev;
      }
    }
  }
  const totalRev = revenueFromNew + revenueFromRepeat;

  return {
    activeCustomers: active.length,
    newCustomers: newOnes.length,
    repeatPurchaseRate: active.length === 0 ? 0 : (repeatActive.length / active.length) * 100,
    avgLifetimeValue: active.length === 0 ? 0 : totalLtv / active.length,
    revenueFromRepeat,
    revenueFromNew,
    pctRevenueFromRepeat: totalRev === 0 ? 0 : (revenueFromRepeat / totalRev) * 100,
  };
}

// ─── Source / Platform aggregation ──────────────────────────────────────────

export interface SourceStat {
  name: string;
  customers: number;
  revenue: number;
  profit: number;
  orders: number;
  avgLtv: number;
  repeatRate: number; // % of these customers with >=2 orders
  avgOrders: number;
}

export function aggregateBySource(
  customers: Customer[],
  field: "acquisitionSource" | "acquisitionPlatform",
): SourceStat[] {
  const map = new Map<string, Customer[]>();
  for (const c of customers) {
    const key = c[field] ?? UNKNOWN;
    const list = map.get(key) ?? [];
    list.push(c);
    map.set(key, list);
  }
  const out: SourceStat[] = [];
  for (const [name, list] of map.entries()) {
    const revenue = list.reduce((s, c) => s + c.totalRevenue, 0);
    const profit = list.reduce((s, c) => s + c.totalProfit, 0);
    const orders = list.reduce((s, c) => s + c.ordersCount, 0);
    const repeat = list.filter((c) => c.ordersCount >= 2).length;
    out.push({
      name,
      customers: list.length,
      revenue,
      profit,
      orders,
      avgLtv: revenue / list.length,
      repeatRate: (repeat / list.length) * 100,
      avgOrders: orders / list.length,
    });
  }
  return out.sort((a, b) => b.revenue - a.revenue);
}

// ─── Pareto (top-X drives Y%) ──────────────────────────────────────────────

export function paretoConcentration(customers: Customer[]): {
  topPctOfCustomers: number;
  pctOfProfit: number;
  topCount: number;
} {
  const sorted = [...customers].sort((a, b) => b.totalProfit - a.totalProfit);
  const totalProfit = sorted.reduce((s, c) => s + c.totalProfit, 0);
  if (totalProfit <= 0 || sorted.length === 0) {
    return { topPctOfCustomers: 20, pctOfProfit: 0, topCount: 0 };
  }
  const topCount = Math.max(1, Math.ceil(sorted.length * 0.2));
  const top = sorted.slice(0, topCount);
  const topProfit = top.reduce((s, c) => s + c.totalProfit, 0);
  return {
    topPctOfCustomers: (topCount / sorted.length) * 100,
    pctOfProfit: (topProfit / totalProfit) * 100,
    topCount,
  };
}

// ─── Cohort retention (monthly) ─────────────────────────────────────────────

export interface CohortRow {
  cohortMonth: string; // "yyyy-MM"
  cohortLabel: string; // "MMM yy"
  size: number;
  /** retention[i] = % of cohort that purchased again in month i (i=0 is 100%) */
  retention: (number | null)[];
}

export function computeCohorts(
  customers: Customer[],
  monthsBack: number = 6,
  now: Date = new Date(),
): CohortRow[] {
  const monthKey = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  const monthLabel = (d: Date) =>
    d.toLocaleDateString("en-US", { month: "short", year: "2-digit" });

  // Build list of cohort months from oldest to newest.
  const cohortMonths: { key: string; label: string; date: Date }[] = [];
  for (let i = monthsBack - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    cohortMonths.push({ key: monthKey(d), label: monthLabel(d), date: d });
  }
  const cohortIndex = new Map(cohortMonths.map((c, i) => [c.key, i]));

  // Group customers by cohort = month of first order.
  const cohortCustomers = new Map<string, Customer[]>();
  for (const c of customers) {
    const key = monthKey(c.firstOrderDate);
    if (!cohortIndex.has(key)) continue;
    const list = cohortCustomers.get(key) ?? [];
    list.push(c);
    cohortCustomers.set(key, list);
  }

  return cohortMonths.map((cm, i) => {
    const list = cohortCustomers.get(cm.key) ?? [];
    const size = list.length;
    const maxOffset = monthsBack - 1 - i;
    const retention: (number | null)[] = [];
    for (let off = 0; off < monthsBack; off++) {
      if (off > maxOffset) {
        retention.push(null); // future month, not measurable yet
        continue;
      }
      const targetMonth = monthKey(
        new Date(cm.date.getFullYear(), cm.date.getMonth() + off, 1),
      );
      if (size === 0) {
        retention.push(null);
        continue;
      }
      let active = 0;
      for (const c of list) {
        const hasOrderInMonth = c.orders.some((o) => {
          if (o.status === "cancelled" || o.status === "refunded") return false;
          return monthKey(new Date(o.date)) === targetMonth;
        });
        if (hasOrderInMonth) active += 1;
      }
      retention.push((active / size) * 100);
    }
    return {
      cohortMonth: cm.key,
      cohortLabel: cm.label,
      size,
      retention,
    };
  });
}

// ─── Common quick-pick lists for source / platform ──────────────────────────

export const COMMON_SOURCES = [
  "Meta Ads",
  "Google Ads",
  "TikTok Ads",
  "Organic",
  "WhatsApp",
  "Direct",
  "Referral",
  "Influencer",
];

export const COMMON_PLATFORMS = [
  "Own Store",
  "Shopify",
  "Amazon",
  "Daraz",
  "Instagram Shop",
  "Facebook Shop",
  "WhatsApp",
];
