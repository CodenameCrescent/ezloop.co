import { isRevenueTransaction } from "@/lib/transactions";
import type { PersistedClientCustomer, PersistedTransaction, TransactionLineItem } from "@/lib/workbenchApi";

export type TransactionCustomerStatus = "New" | "Active" | "Repeat" | "At-risk" | "Lost";

export interface TransactionCustomer {
  id: string;
  name: string;
  firstPurchaseDate: Date;
  lastPurchaseDate: Date;
  totalOrders: number;
  repeatPurchaseCount: number;
  averageDaysBetweenPurchases: number;
  totalRevenue: number;
  totalProfit: number;
  revenueLtv: number;
  profitLtv: number;
  status: TransactionCustomerStatus;
  bestProductOrService: string;
  suggestedNextOffer: string;
  acquisitionSource: string;
  campaignName: string | null;
  cohortMonth: string;
  productJourney: string[];
}

function metadataObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringMeta(metadata: Record<string, unknown>, key: string) {
  const value = metadata[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberMeta(metadata: Record<string, unknown>, key: string) {
  const value = Number(metadata[key]);
  return Number.isFinite(value) ? value : null;
}

function lineItemsFrom(transaction: PersistedTransaction): TransactionLineItem[] {
  if (transaction.lineItems && transaction.lineItems.length > 0) return transaction.lineItems;
  const metadata = metadataObject(transaction.metadataJson);
  const value = metadata.lineItems;
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const row = item as Record<string, unknown>;
      return {
        offerId: typeof row.offerId === "string" ? row.offerId : null,
        name: typeof row.name === "string" ? row.name : "Revenue item",
        quantity: Number(row.quantity) || 1,
        unitPrice: Number(row.unitPrice) || 0,
        unitCost: Number(row.unitCost) || 0,
      } satisfies TransactionLineItem;
    })
    .filter((item): item is TransactionLineItem => Boolean(item));
}

function customerNameFor(transaction: PersistedTransaction, peopleById?: Map<string, PersistedClientCustomer>) {
  const metadata = metadataObject(transaction.metadataJson);
  const linked = transaction.clientCustomerId ? peopleById?.get(transaction.clientCustomerId) : undefined;
  return stringMeta(metadata, "customerName") ?? linked?.name ?? transaction.clientCustomerId ?? null;
}

/**
 * Stable identity for grouping: the persistent person id when the transaction is linked
 * to one, otherwise the lowercased display name (legacy free-text customers).
 */
export function customerKeyFor(transaction: PersistedTransaction, peopleById?: Map<string, PersistedClientCustomer>) {
  const rawId = (transaction.clientCustomerId ?? "").trim();
  if (rawId) return rawId;
  const name = customerNameFor(transaction, peopleById);
  return name ? name.trim().toLowerCase() : null;
}

function sourceFor(transaction: PersistedTransaction) {
  const metadata = metadataObject(transaction.metadataJson);
  return (
    stringMeta(metadata, "firstTouchSource") ??
    stringMeta(metadata, "utmSource") ??
    stringMeta(metadata, "campaignSource") ??
    transaction.originLabel ??
    transaction.provider ??
    transaction.source ??
    "Manual"
  );
}

function campaignFor(transaction: PersistedTransaction) {
  const metadata = metadataObject(transaction.metadataJson);
  return stringMeta(metadata, "campaignName") ?? stringMeta(metadata, "utmCampaign") ?? transaction.campaignId ?? null;
}

function monthKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function daysBetween(a: Date, b: Date) {
  return Math.abs(Math.round((b.getTime() - a.getTime()) / 86_400_000));
}

function customerStatus(totalOrders: number, recencyDays: number, averageGap: number): TransactionCustomerStatus {
  if (recencyDays >= 180) return "Lost";
  if (totalOrders > 1 && averageGap > 0 && recencyDays > averageGap * 1.6) return "At-risk";
  if (totalOrders > 1) return "Repeat";
  if (recencyDays <= 60) return "New";
  return "Active";
}

export function deriveTransactionCustomers(
  transactions: PersistedTransaction[],
  now: Date = new Date(),
  people: PersistedClientCustomer[] = [],
): TransactionCustomer[] {
  const peopleById = new Map(people.map((person) => [person.id, person]));
  // All revenue-like types count as purchases (manual sales, client payments,
  // subscription payments) — not just plain "revenue" transactions.
  const revenueTransactions = transactions
    .filter((transaction) => isRevenueTransaction(transaction.transactionType))
    .map((transaction) => ({
      transaction,
      key: customerKeyFor(transaction, peopleById),
      customerName: customerNameFor(transaction, peopleById),
      date: new Date(transaction.date),
    }))
    .filter((entry) => entry.key && entry.customerName && !Number.isNaN(entry.date.getTime()))
    .sort((a, b) => a.date.getTime() - b.date.getTime());

  const buckets = new Map<string, typeof revenueTransactions>();
  for (const entry of revenueTransactions) {
    const list = buckets.get(entry.key!) ?? [];
    list.push(entry);
    buckets.set(entry.key!, list);
  }

  // Refunds reduce a customer's lifetime value instead of disappearing.
  const refundsByKey = new Map<string, { revenue: number; profit: number }>();
  for (const transaction of transactions) {
    if (transaction.transactionType !== "refund") continue;
    const key = customerKeyFor(transaction, peopleById);
    if (!key) continue;
    const metadata = metadataObject(transaction.metadataJson);
    const amount = Math.abs(Number(transaction.amount) || 0);
    const profitImpact = numberMeta(metadata, "profitImpact");
    const bucket = refundsByKey.get(key) ?? { revenue: 0, profit: 0 };
    bucket.revenue += amount;
    // profitImpact is negative (profit lost); fall back to the full refund amount.
    bucket.profit += profitImpact !== null ? Math.abs(profitImpact) : amount;
    refundsByKey.set(key, bucket);
  }

  return [...buckets.entries()]
    .map(([key, list]) => {
      const first = list[0];
      const last = list[list.length - 1];
      const refunds = refundsByKey.get(key) ?? { revenue: 0, profit: 0 };
      const totalRevenue =
        list.reduce((sum, entry) => {
          const metadata = metadataObject(entry.transaction.metadataJson);
          return sum + (numberMeta(metadata, "netRevenue") ?? Math.abs(Number(entry.transaction.amount) || 0));
        }, 0) - refunds.revenue;
      const totalProfit =
        list.reduce((sum, entry) => {
          const metadata = metadataObject(entry.transaction.metadataJson);
          const profit = numberMeta(metadata, "grossProfit") ?? numberMeta(metadata, "profit");
          if (profit !== null) return sum + profit;
          const directCost = numberMeta(metadata, "totalDirectCost") ?? 0;
          return sum + Math.abs(Number(entry.transaction.amount) || 0) - directCost;
        }, 0) - refunds.profit;
      const gaps = list.slice(1).map((entry, index) => daysBetween(list[index].date, entry.date));
      const averageDaysBetweenPurchases = gaps.length > 0 ? gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length : 0;
      const productCounts = new Map<string, number>();
      const productJourney: string[] = [];
      for (const entry of list) {
        const lineItems = lineItemsFrom(entry.transaction);
        const names = lineItems.length > 0 ? lineItems.map((item) => item.name) : [entry.transaction.category ?? "Revenue item"];
        for (const name of names) {
          productCounts.set(name, (productCounts.get(name) ?? 0) + 1);
          productJourney.push(name);
        }
      }
      const bestProductOrService = [...productCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "-";
      const suggestedNextOffer = productJourney.length > 1 ? productJourney[productJourney.length - 1] : "Create a repeat-purchase offer";
      const recencyDays = daysBetween(last.date, now);
      return {
        id: `txc:${key}`,
        name: first.customerName!,
        firstPurchaseDate: first.date,
        lastPurchaseDate: last.date,
        totalOrders: list.length,
        repeatPurchaseCount: Math.max(0, list.length - 1),
        averageDaysBetweenPurchases,
        totalRevenue,
        totalProfit,
        revenueLtv: totalRevenue,
        profitLtv: totalProfit,
        status: customerStatus(list.length, recencyDays, averageDaysBetweenPurchases),
        bestProductOrService,
        suggestedNextOffer,
        acquisitionSource: sourceFor(first.transaction),
        campaignName: campaignFor(first.transaction),
        cohortMonth: monthKey(first.date),
        productJourney,
      };
    })
    .sort((a, b) => b.profitLtv - a.profitLtv);
}
