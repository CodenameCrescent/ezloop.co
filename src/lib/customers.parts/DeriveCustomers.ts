import type { Order } from "../types";
import { profitOf } from "../calcUtils";
import { calculateOrderNetRevenue } from "../finance";

export type RfmSegment =
  | "champion"
  | "loyal"
  | "potential"
  | "new"
  | "at_risk"
  | "lost";

export interface CustomerMergeRecord {
  /** Server-side merge id (used for undo). */
  id: string;
  /** Surviving primary customer key. */
  primaryKey: string;
  primaryLabel: string;
  /** Source customer key that was folded into primary. */
  mergedKey: string;
  mergedLabel: string;
  createdAt: string;
}

export interface CustomerMergeHistoryEntry {
  /** Merge id — used to undo. */
  mergeId: string;
  /** Original key of the merged-in customer. */
  mergedKey: string;
  /** Display label of the merged-in customer at the time of merge. */
  mergedLabel: string;
  createdAt: string;
}

export interface Customer {
  /** Stable key — phone if present, otherwise normalized name. After merges,
   * always the surviving (primary) key. */
  id: string;
  name: string;
  phone: string | null;
  orders: Order[];
  ordersCount: number;
  totalRevenue: number;
  totalProfit: number;
  avgOrderValue: number;
  /** ID of the customer's first live order — used as a stable "first-touch" marker. */
  firstOrderId: string;
  firstOrderDate: Date;
  lastOrderDate: Date;
  recencyDays: number;
  /** RFM scores 1-5 (5 = best). */
  rScore: number;
  fScore: number;
  mScore: number;
  segment: RfmSegment;
  /** Source of the FIRST order — first-touch acquisition. */
  acquisitionSource: string | null;
  acquisitionPlatform: string | null;
  /** Aggregated counts of each source/platform across this customer's orders. */
  sourceMix: Record<string, number>;
  platformMix: Record<string, number>;
  /** Customers that have been merged into this one (manual merges only). */
  mergedFrom: CustomerMergeHistoryEntry[];
}

export const UNKNOWN = "Unknown";
export const GUEST = "Guest checkout";

export function normalizeName(s: string | null | undefined): string {
  if (!s) return "";
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

export function normalizePhone(s: string | null | undefined): string {
  if (!s) return "";
  // Keep only digits — last 10 digits make the match (handles +92 vs 0).
  const digits = s.replace(/\D+/g, "");
  return digits.length > 10 ? digits.slice(-10) : digits;
}

/**
 * Group orders into customers. Matching priority: phone first (normalized),
 * then normalized name. Excludes orders with no name AND no phone.
 *
 * `now` lets you compute recency relative to a fixed point (test-friendly).
 */
/**
 * Walk the merge parent map until we reach a fixed point. Path-compresses
 * for cheap repeated lookups.
 */
export function findRoot(key: string, parent: Map<string, string>): string {
  let cur = key;
  const path: string[] = [];
  while (parent.has(cur) && parent.get(cur) !== cur) {
    path.push(cur);
    cur = parent.get(cur)!;
  }
  for (const p of path) parent.set(p, cur);
  return cur;
}

export function classifySegment(c: Customer): RfmSegment {
  const r = c.rScore;
  const f = c.fScore;
  // True one-time first-touch buyers in the recent window.
  if (c.ordersCount === 1 && r >= 4) return "new";
  if (r >= 4 && f >= 4) return "champion";
  if (f >= 4) return "loyal";
  if (r >= 4 && f <= 2) return "potential";
  if (r <= 2 && f >= 3) return "at_risk";
  if (r <= 2) return "lost";
  return "loyal";
}

export function deriveCustomers(
  orders: Order[],
  now: Date = new Date(),
  merges: CustomerMergeRecord[] = [],
): Customer[] {
  // Build union-find parent map: mergedKey -> primaryKey.
  const parent = new Map<string, string>();
  for (const m of merges) {
    // Initialise both as their own root if unseen.
    if (!parent.has(m.primaryKey)) parent.set(m.primaryKey, m.primaryKey);
    if (!parent.has(m.mergedKey)) parent.set(m.mergedKey, m.mergedKey);
    const a = findRoot(m.primaryKey, parent);
    const b = findRoot(m.mergedKey, parent);
    if (a !== b) parent.set(b, a);
  }
  const resolveKey = (k: string) => (parent.size === 0 ? k : findRoot(k, parent));

  // Build phone → key and name → key index, with phone winning ties.
  const phoneKey = new Map<string, string>();
  const nameKey = new Map<string, string>();

  // Filter to identifiable orders (exclude cancelled + refunded for cohort math
  // but keep them in per-customer list for transparency).
  const identifiable = orders.filter((o) => {
    const ph = normalizePhone(o.phone);
    const nm = normalizeName(o.customer);
    return ph !== "" || nm !== "";
  });

  // Sort by date ascending so first-touch attribution is correct.
  const sorted = [...identifiable].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
  );

  const buckets = new Map<string, Order[]>();

  for (const o of sorted) {
    const ph = normalizePhone(o.phone);
    const nm = normalizeName(o.customer);

    let key: string | null = null;
    if (ph && phoneKey.has(ph)) key = phoneKey.get(ph)!;
    else if (nm && nameKey.has(nm)) key = nameKey.get(nm)!;

    if (!key) {
      // New customer — prefer phone as the key, else name.
      key = ph ? `p:${ph}` : `n:${nm}`;
    }
    // Apply manual merges so all rows route to the surviving primary key.
    key = resolveKey(key);
    if (ph && !phoneKey.has(ph)) phoneKey.set(ph, key);
    if (nm && !nameKey.has(nm)) nameKey.set(nm, key);

    const list = buckets.get(key) ?? [];
    list.push(o);
    buckets.set(key, list);
  }

  // Build raw customer records.
  const raw: Customer[] = [];
  for (const [key, list] of buckets.entries()) {
    // For headline metrics exclude cancelled / refunded orders.
    const live = list.filter(
      (o) => o.status !== "cancelled" && o.status !== "refunded",
    );
    if (live.length === 0) continue; // never had a real order

    const sortedAsc = [...live].sort(
      (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
    );
    const first = sortedAsc[0];
    const last = sortedAsc[sortedAsc.length - 1];

    const totalRevenue = live.reduce((s, o) => s + calculateOrderNetRevenue(o), 0);
    const totalProfit = live.reduce((s, o) => s + profitOf(o), 0);

    // Mixes count over LIVE orders.
    const sourceMix: Record<string, number> = {};
    const platformMix: Record<string, number> = {};
    for (const o of live) {
      const s = o.source ?? UNKNOWN;
      const p = o.platform ?? UNKNOWN;
      sourceMix[s] = (sourceMix[s] ?? 0) + 1;
      platformMix[p] = (platformMix[p] ?? 0) + 1;
    }

    const lastT = new Date(last.date).getTime();
    const recencyDays = Math.max(
      0,
      Math.floor((now.getTime() - lastT) / 86400000),
    );

    // Display name + phone — prefer the most recent non-empty values.
    const displayName =
      [...sortedAsc].reverse().find((o) => (o.customer ?? "").trim() !== "")
        ?.customer ?? GUEST;
    const displayPhone =
      [...sortedAsc].reverse().find((o) => (o.phone ?? "").trim() !== "")
        ?.phone ?? null;

    // Collect merge history rows whose surviving root is this customer.
    const mergedFrom: CustomerMergeHistoryEntry[] = [];
    for (const m of merges) {
      if (resolveKey(m.primaryKey) === key && m.mergedKey !== key) {
        mergedFrom.push({
          mergeId: m.id,
          mergedKey: m.mergedKey,
          mergedLabel: m.mergedLabel,
          createdAt: m.createdAt,
        });
      }
    }

    raw.push({
      id: key,
      name: displayName,
      phone: displayPhone,
      orders: [...list].sort(
        (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
      ),
      ordersCount: live.length,
      totalRevenue,
      totalProfit,
      avgOrderValue: totalRevenue / live.length,
      firstOrderId: first.id,
      firstOrderDate: new Date(first.date),
      lastOrderDate: new Date(last.date),
      recencyDays,
      rScore: 0,
      fScore: 0,
      mScore: 0,
      segment: "new",
      acquisitionSource: first.source ?? null,
      acquisitionPlatform: first.platform ?? null,
      sourceMix,
      platformMix,
      mergedFrom,
    });
  }

  // ─── RFM scoring (quintiles within current customer base) ─────────────────
  if (raw.length === 0) return raw;

  const rValues = raw.map((c) => c.recencyDays).sort((a, b) => a - b); // ascending: small recency = good
  const fValues = raw.map((c) => c.ordersCount).sort((a, b) => a - b);
  const mValues = raw.map((c) => c.totalRevenue).sort((a, b) => a - b);

  function quintile(value: number, sorted: number[], inverse = false): number {
    const n = sorted.length;
    if (n === 0) return 3;
    if (n === 1) return 5; // single customer is automatically "best".
    // Find rank position (0..n-1) — last index whose value is <= this one
    // so ties land in the same bucket.
    let rank = 0;
    for (let i = 0; i < n; i++) {
      if (sorted[i] <= value) rank = i;
      else break;
    }
    let pct = rank / (n - 1); // 0..1, safe since n >= 2
    if (inverse) pct = 1 - pct;
    return Math.max(1, Math.min(5, Math.round(pct * 4) + 1));
  }

  for (const c of raw) {
    c.rScore = quintile(c.recencyDays, rValues, true); // small = better
    c.fScore = quintile(c.ordersCount, fValues, false);
    c.mScore = quintile(c.totalRevenue, mValues, false);
    c.segment = classifySegment(c);
  }

  return raw;
}
