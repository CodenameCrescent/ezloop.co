/**
 * Acquisition cohorts. A customer's cohort is the calendar month of their FIRST
 * transaction; the grid tracks, for each month since, the average CUMULATIVE
 * contribution profit per customer in that cohort — the "does this cohort pay
 * us back" curve. Pure and fixture-tested.
 */

export interface CohortEvent {
  occurredAt: Date | string;
  contributionProfitCents: number;
}

export interface CohortCustomer {
  id: string;
  firstTransactionAt: Date | string | null;
  events: CohortEvent[];
}

export interface CohortRow {
  cohortMonth: string; // "YYYY-MM"
  size: number;
  /** cumulativeContributionPerCustomer[k] = avg cumulative contribution through month k. */
  cumulativeContributionPerCustomer: number[];
}

export interface CohortGrid {
  cohorts: CohortRow[];
  maxOffset: number;
}

function d(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function monthKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function monthDiff(from: Date, to: Date): number {
  return (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + (to.getUTCMonth() - from.getUTCMonth());
}

export function buildCohortGrid(customers: CohortCustomer[], now: Date = new Date(), maxOffsetCap = 12): CohortGrid {
  interface Acc {
    size: number;
    contributionByOffset: Map<number, number>;
    maxOffset: number;
  }
  const cohortMap = new Map<string, Acc>();
  let maxOffsetSeen = 0;

  for (const customer of customers) {
    if (!customer.firstTransactionAt) continue;
    const first = d(customer.firstTransactionAt);
    if (Number.isNaN(first.getTime())) continue;
    const key = monthKey(first);
    const acc = cohortMap.get(key) ?? { size: 0, contributionByOffset: new Map(), maxOffset: 0 };
    acc.size += 1;
    for (const event of customer.events) {
      const at = d(event.occurredAt);
      if (Number.isNaN(at.getTime())) continue;
      const offset = Math.min(maxOffsetCap, Math.max(0, monthDiff(first, at)));
      acc.contributionByOffset.set(offset, (acc.contributionByOffset.get(offset) ?? 0) + event.contributionProfitCents);
      acc.maxOffset = Math.max(acc.maxOffset, offset);
      maxOffsetSeen = Math.max(maxOffsetSeen, offset);
    }
    cohortMap.set(key, acc);
  }

  const nowDate = d(now);
  const cohorts: CohortRow[] = [...cohortMap.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([cohortMonth, acc]) => {
      const [year, month] = cohortMonth.split("-").map(Number);
      const monthsSinceStart = Math.max(0, monthDiff(new Date(Date.UTC(year, month - 1, 1)), nowDate));
      const columns = Math.min(maxOffsetCap, monthsSinceStart) + 1;
      const cumulative: number[] = [];
      let running = 0;
      for (let offset = 0; offset < columns; offset += 1) {
        running += acc.contributionByOffset.get(offset) ?? 0;
        cumulative.push(acc.size > 0 ? Math.round(running / acc.size) : 0);
      }
      return { cohortMonth, size: acc.size, cumulativeContributionPerCustomer: cumulative };
    });

  return { cohorts, maxOffset: Math.min(maxOffsetCap, maxOffsetSeen) };
}

// ── Retention (Lifetimely-style: did the cohort come back?) ─────────────────

export interface RetentionRow {
  cohortMonth: string; // "YYYY-MM"
  size: number;
  /** activePctByOffset[k] = % of the cohort with ≥1 purchase in month k after their first (0–100). */
  activePctByOffset: number[];
}

export interface RetentionGrid {
  cohorts: RetentionRow[];
  maxOffset: number;
}

/**
 * Purchase retention per acquisition cohort: for each month offset, the share
 * of the cohort that bought AGAIN in that month. Offset 0 reflects the first-
 * purchase month itself (≈100% whenever events exist for it).
 */
export function buildRetentionGrid(customers: CohortCustomer[], now: Date = new Date(), maxOffsetCap = 12): RetentionGrid {
  interface Acc {
    size: number;
    /** offset → set of customer ids active in that offset month. */
    activeByOffset: Map<number, Set<string>>;
  }
  const cohortMap = new Map<string, Acc>();
  let maxOffsetSeen = 0;

  for (const customer of customers) {
    if (!customer.firstTransactionAt) continue;
    const first = d(customer.firstTransactionAt);
    if (Number.isNaN(first.getTime())) continue;
    const key = monthKey(first);
    const acc = cohortMap.get(key) ?? { size: 0, activeByOffset: new Map() };
    acc.size += 1;
    for (const event of customer.events) {
      const at = d(event.occurredAt);
      if (Number.isNaN(at.getTime())) continue;
      const offset = Math.min(maxOffsetCap, Math.max(0, monthDiff(first, at)));
      const set = acc.activeByOffset.get(offset) ?? new Set<string>();
      set.add(customer.id);
      acc.activeByOffset.set(offset, set);
      maxOffsetSeen = Math.max(maxOffsetSeen, offset);
    }
    cohortMap.set(key, acc);
  }

  const nowDate = d(now);
  const cohorts: RetentionRow[] = [...cohortMap.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([cohortMonth, acc]) => {
      const [year, month] = cohortMonth.split("-").map(Number);
      const monthsSinceStart = Math.max(0, monthDiff(new Date(Date.UTC(year, month - 1, 1)), nowDate));
      const columns = Math.min(maxOffsetCap, monthsSinceStart) + 1;
      const activePctByOffset: number[] = [];
      for (let offset = 0; offset < columns; offset += 1) {
        const active = acc.activeByOffset.get(offset)?.size ?? 0;
        activePctByOffset.push(acc.size > 0 ? Math.round((active / acc.size) * 1000) / 10 : 0);
      }
      return { cohortMonth, size: acc.size, activePctByOffset };
    });

  return { cohorts, maxOffset: Math.min(maxOffsetCap, maxOffsetSeen) };
}

// ── Repeat purchase behaviour ───────────────────────────────────────────────

export interface RepeatStats {
  customersWithPurchase: number;
  repeatCustomers: number;
  /** repeatCustomers / customersWithPurchase × 100, one decimal. */
  repeatRatePct: number;
  /** Median whole days between the first and second purchase; null if nobody repeated. */
  medianDaysToSecondPurchase: number | null;
}

export function computeRepeatStats(customers: CohortCustomer[]): RepeatStats {
  let withPurchase = 0;
  let repeat = 0;
  const gaps: number[] = [];

  for (const customer of customers) {
    const times = customer.events
      .map((e) => d(e.occurredAt).getTime())
      .filter((t) => !Number.isNaN(t))
      .sort((a, b) => a - b);
    if (times.length === 0) continue;
    withPurchase += 1;
    if (times.length >= 2) {
      repeat += 1;
      gaps.push(Math.round((times[1] - times[0]) / 86_400_000));
    }
  }

  gaps.sort((a, b) => a - b);
  const median =
    gaps.length === 0
      ? null
      : gaps.length % 2 === 1
        ? gaps[(gaps.length - 1) / 2]
        : Math.round((gaps[gaps.length / 2 - 1] + gaps[gaps.length / 2]) / 2);

  return {
    customersWithPurchase: withPurchase,
    repeatCustomers: repeat,
    repeatRatePct: withPurchase > 0 ? Math.round((repeat / withPurchase) * 1000) / 10 : 0,
    medianDaysToSecondPurchase: median,
  };
}
