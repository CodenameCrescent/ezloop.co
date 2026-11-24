/**
 * TODO(R4): delete. Compatibility adapter: the analytics subsystem (People,
 * Insights, cohorts, transaction-customers) still speaks the old Persisted*
 * shapes. This maps the new cents-native contract responses into those shapes
 * over `@/lib/api-helpers/client` (NOT the removed legacy client), so those pages
 * work unchanged until R4 rebuilds them on the typed hooks. Money crosses
 * cents→rupees exactly once, here.
 */
import {
  listExpenseItems as listExpenseItemsEndpoint,
  listRevenueItems as listRevenueItemsEndpoint,
  listTransactions as listTransactionsEndpoint,
  type EndpointResponse,
} from "@workspace/api-contract";
import * as api from "@/lib/api-helpers/client";
import type { AdSpendEntry, Order, OrderItem, Product } from "./types";
import type { Expense } from "./legacyTypes";
import type { NormalizedTransaction, TransactionSource, TransactionType } from "./transactions";

const WIDE_RANGE = () => {
  const end = new Date();
  end.setHours(23, 59, 59, 999);
  const start = new Date(end.getFullYear() - 3, 0, 1);
  return { startDate: start.toISOString(), endDate: end.toISOString() };
};
const toRupees = (cents: number) => cents / 100;

type Summary = EndpointResponse<typeof listTransactionsEndpoint>["items"][number];
type RevenueItem = EndpointResponse<typeof listRevenueItemsEndpoint>["items"][number];
type ExpenseItemApi = EndpointResponse<typeof listExpenseItemsEndpoint>["items"][number];

// ── Old shapes (subset the analytics code reads) ────────────────────────────
export interface TransactionLineItem {
  offerId: string | null;
  name: string;
  quantity: number;
  unitPrice: number;
  unitCost: number;
}

export interface PersistedTransaction {
  id: string;
  transactionType: TransactionType;
  amount: number;
  date: string;
  category: string | null;
  source: TransactionSource;
  offerId: string | null;
  linkedRevenueItemId: string | null;
  linkedExpenseItemId: string | null;
  clientCustomerId: string | null;
  campaignId: string | null;
  notes: string | null;
  paymentStatus: "paid" | "unpaid" | "partially_paid" | null;
  originLabel: string | null;
  provider: string | null;
  connectionId: string | null;
  connectionName: string | null;
  externalId: string | null;
  metadataJson: unknown | null;
  lineItems: TransactionLineItem[] | null;
  sourceRecordType: string | null;
  sourceRecordId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PersistedOffer {
  id: string;
  name: string;
  offerType: string;
  price: number;
  status: string;
  productCost: number;
  directCost: number;
  category: string | null;
}

export interface PersistedExpenseItem {
  id: string;
  name: string;
  type: string;
  amount: number | null;
  status: string;
  metadataJson: unknown | null;
}

export type ClientCustomerType = "customer" | "client" | "both";
export interface PersistedClientCustomer {
  id: string;
  type: ClientCustomerType;
  name: string;
  phone: string | null;
  email: string | null;
  companyName: string | null;
  notes: string | null;
  legacyCustomerKey: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface ClientCustomerInput {
  name: string;
  type?: ClientCustomerType;
  phone?: string | null;
  email?: string | null;
  companyName?: string | null;
  notes?: string | null;
  legacyCustomerKey?: string | null;
}

// ── new → old mapping ───────────────────────────────────────────────────────
function summaryToPersisted(t: Summary): PersistedTransaction {
  const transactionType: TransactionType = t.adjustmentType ? "refund" : t.direction === "in" ? "revenue" : "expense";
  const directCost = ((t.netRevenueCents ?? 0) - (t.contributionProfitCents ?? 0)) / 100;
  const first = t.lines[0];
  return {
    id: t.id,
    transactionType,
    amount: toRupees(t.amountCents),
    date: t.occurredAt,
    category: t.lines.find((l) => l.categoryName)?.categoryName ?? null,
    source: (t.origin === "integration" ? "integration" : "manual") as TransactionSource,
    offerId: first?.revenueItemId ?? null,
    linkedRevenueItemId: first?.revenueItemId ?? null,
    linkedExpenseItemId: first?.expenseItemId ?? null,
    clientCustomerId: t.personId,
    campaignId: null,
    notes: t.notes,
    paymentStatus: t.status === "pending" ? "unpaid" : "paid",
    originLabel: t.sourceName,
    provider: t.sourceName === "Manual" ? "manual" : t.sourceName,
    connectionId: null,
    connectionName: null,
    externalId: t.externalRef,
    metadataJson: {
      ...(t.personName ? { customerName: t.personName } : {}),
      netRevenue: toRupees(t.netRevenueCents ?? 0),
      grossProfit: toRupees(t.contributionProfitCents ?? 0),
      profit: toRupees(t.contributionProfitCents ?? 0),
      totalDirectCost: directCost,
      ...(t.adjustmentType ? { profitImpact: toRupees(t.contributionProfitCents ?? 0) } : {}),
    },
    lineItems: t.lines.map((l) => ({
      offerId: l.revenueItemId,
      name: l.itemName ?? l.label ?? "Item",
      quantity: Number(l.qty),
      unitPrice: toRupees(l.unitPriceCents),
      unitCost: toRupees(l.costSnapshot?.total_per_unit_cents ?? 0),
    })),
    sourceRecordType: "transaction",
    sourceRecordId: t.id,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
  };
}

const OFFER_TYPE: Record<string, string> = {
  product: "physical_product",
  service: "service",
  subscription: "subscription",
  rental: "custom",
  commission: "custom",
  royalty: "custom",
  other: "custom",
};

function revenueItemToOffer(item: RevenueItem): PersistedOffer {
  const productCost = item.openComponents
    .filter((c) => c.calcType === "fixed_per_unit" && c.sourceId === null)
    .reduce((sum, c) => sum + (c.valueCents ?? 0), 0);
  return {
    id: item.id,
    name: item.name,
    offerType: OFFER_TYPE[item.type] ?? "custom",
    price: toRupees(item.unitPriceCents ?? 0),
    status: item.status === "active" ? "active" : "archived",
    productCost: toRupees(productCost),
    directCost: 0,
    category: item.categoryName,
  };
}

// ── fetchers ────────────────────────────────────────────────────────────────
export async function listTransactions(): Promise<PersistedTransaction[]> {
  // The contract caps a page at 200 (requesting more 400s); walk nextCursor so the
  // analytics subsystem sees the whole window instead of silently truncating.
  const range = WIDE_RANGE();
  const out: PersistedTransaction[] = [];
  let cursor: string | undefined;
  do {
    const res = await api.listTransactions({
      query: { ...range, limit: 200, ...(cursor ? { cursor } : {}) },
    });
    for (const summary of res.items) out.push(summaryToPersisted(summary));
    cursor = res.nextCursor ?? undefined;
  } while (cursor);
  return out;
}

export async function listOffers(): Promise<PersistedOffer[]> {
  const res = await api.listRevenueItems({ query: WIDE_RANGE() });
  return res.items.map(revenueItemToOffer);
}

export async function listExpenseItems(): Promise<PersistedExpenseItem[]> {
  const res = await api.listExpenseItems({ query: WIDE_RANGE() });
  return res.items.map((e) => ({
    id: e.id,
    name: e.name,
    type: e.type,
    amount: e.defaultAmountCents == null ? null : toRupees(e.defaultAmountCents),
    status: e.status,
    metadataJson: { behavior: e.behavior, vendorName: e.vendorName },
  }));
}

export function listClientCustomers() {
  return api.listClientCustomers();
}
export function createClientCustomer(data: ClientCustomerInput) {
  return api.createClientCustomer({ body: data });
}
export function updateClientCustomer(id: string, data: Partial<ClientCustomerInput>) {
  return api.updateClientCustomer({ params: { id }, body: data });
}
export function deleteClientCustomer(id: string) {
  return api.deleteClientCustomer({ params: { id } });
}

export function offerToProduct(offer: PersistedOffer): Product {
  return {
    id: offer.id,
    name: offer.name,
    category: offer.offerType === "physical_product" ? null : `offer_type:${offer.offerType}`,
    defaultCostPrice: offer.productCost || offer.directCost,
    defaultSellingPrice: offer.price,
    packagingCost: 0,
    defaultShippingCost: 0,
    imageColor: "217 91% 62%",
    supplier: null,
    status: offer.status === "active" ? "active" : "inactive",
    notes: null,
  };
}

function isRevenueType(type: TransactionType) {
  return type === "revenue" || type === "manual_sale" || type === "client_payment" || type === "subscription_payment";
}

/** Old finance adapter: PersistedTransaction[] → legacy orders/expenses/adSpend. */
export function transactionsToLegacyData(
  transactions: PersistedTransaction[],
): { orders: Order[]; expenses: Expense[]; adSpend: AdSpendEntry[] } {
  const orders: Order[] = [];
  const expenses: Expense[] = [];
  const adSpend: AdSpendEntry[] = [];

  for (const t of transactions) {
    const amount = Math.abs(Number(t.amount) || 0);
    if (isRevenueType(t.transactionType) || t.transactionType === "refund") {
      const isRefund = t.transactionType === "refund";
      const items: OrderItem[] = (t.lineItems ?? []).map((l, i) => ({
        id: `${t.id}:${i}`,
        productId: l.offerId ?? "",
        productName: l.name,
        quantity: l.quantity,
        unitSellingPrice: isRefund ? 0 : l.unitPrice,
        unitCostPrice: isRefund ? 0 : l.unitCost,
      }));
      const costPrice = isRefund ? 0 : (t.lineItems ?? []).reduce((s, l) => s + l.quantity * l.unitCost, 0);
      const first = items[0];
      orders.push({
        id: t.id,
        customer: t.clientCustomerId,
        phone: null,
        source: t.source,
        platform: t.originLabel ?? "Manual",
        externalId: t.externalId,
        paymentStatus: t.paymentStatus ?? "paid",
        sellingPrice: isRefund ? 0 : amount,
        costPrice,
        discount: 0,
        refundAmount: isRefund ? amount : 0,
        taxAmount: 0,
        shippingCharged: 0,
        deliveryCost: 0,
        adCost: 0,
        date: t.date,
        status: isRefund ? "refunded" : t.paymentStatus === "unpaid" ? "pending" : "completed",
        notes: t.notes,
        items,
        productName: first?.productName ?? t.category ?? "Sale",
        productId: first?.productId ?? "",
      });
      continue;
    }
    expenses.push({
      id: t.id,
      name: t.category ?? "Cost / expense",
      amount,
      type: "VARIABLE",
      frequency: null,
      date: t.date,
      status: "active",
      paymentStatus: t.paymentStatus === "unpaid" ? "unpaid" : "paid",
      category: t.category,
      vendor: null,
      attachmentName: null,
      orderId: null,
      note: t.notes,
    });
  }
  return { orders, expenses, adSpend };
}

export function persistedTransactionToNormalized(row: PersistedTransaction): NormalizedTransaction {
  const outflow = row.transactionType === "expense" || row.transactionType === "refund";
  return {
    id: row.id,
    sourceRecordId: row.sourceRecordId ?? row.id,
    sourceRecordType: (row.sourceRecordType ?? "transaction") as NormalizedTransaction["sourceRecordType"],
    transactionType: row.transactionType,
    amount: outflow ? -Math.abs(row.amount) : Math.abs(row.amount),
    date: row.date,
    category: row.category ?? "Uncategorized",
    source: row.source,
    offerId: row.linkedRevenueItemId ?? row.offerId,
    offerName: null,
    linkedExpenseItemId: row.linkedExpenseItemId,
    originLabel: row.originLabel,
    provider: row.provider,
    connectionId: row.connectionId,
    connectionName: row.connectionName,
    clientCustomerId: row.clientCustomerId,
    clientCustomerName:
      row.metadataJson && typeof row.metadataJson === "object" && "customerName" in row.metadataJson
        ? String((row.metadataJson as Record<string, unknown>).customerName ?? "") || null
        : null,
    campaignId: row.campaignId,
    campaignName: row.campaignId,
    paymentStatus: row.paymentStatus,
    notes: row.notes,
    raw: row as never,
  };
}

export function apiErrorMessage(error: unknown, fallback: string): string {
  const data = (error as { data?: { error?: { message?: string } } } | null)?.data;
  return data?.error?.message ?? (error instanceof Error ? error.message : fallback);
}
