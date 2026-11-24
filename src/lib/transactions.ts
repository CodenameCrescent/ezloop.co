import type { PaymentStatus } from "./types";

export const TRANSACTION_TYPES = [
  "revenue",
  "expense",
  "refund",
  "fee",
  "adjustment",
  "client_payment",
  "subscription_payment",
  "manual_sale",
  "ad_spend",
] as const;

export type TransactionType = (typeof TRANSACTION_TYPES)[number];

export const TRANSACTION_SOURCES = [
  "manual",
  "shopify",
  "csv",
  "integration",
  "import",
] as const;

export type TransactionSource = (typeof TRANSACTION_SOURCES)[number];

export type TransactionRecordType = "transaction";

export interface NormalizedTransaction {
  id: string;
  sourceRecordId: string;
  sourceRecordType: TransactionRecordType;
  transactionType: TransactionType;
  amount: number;
  date: string;
  category: string;
  source: TransactionSource;
  offerId?: string | null;
  offerName?: string | null;
  linkedExpenseItemId?: string | null;
  originLabel?: string | null;
  provider?: string | null;
  connectionId?: string | null;
  connectionName?: string | null;
  clientCustomerId?: string | null;
  clientCustomerName?: string | null;
  campaignId?: string | null;
  campaignName?: string | null;
  paymentStatus?: PaymentStatus | "paid" | "unpaid" | null;
  notes?: string | null;
  raw: unknown;
}

export const TRANSACTION_TYPE_LABELS: Record<TransactionType, string> = {
  revenue: "Revenue",
  expense: "Cost / expense",
  refund: "Refund",
  fee: "Fee",
  adjustment: "Adjustment",
  client_payment: "Client payment",
  subscription_payment: "Subscription payment",
  manual_sale: "Manual sale",
  ad_spend: "Ad spend",
};

export function isRevenueTransaction(type: TransactionType) {
  return (
    type === "revenue" ||
    type === "manual_sale" ||
    type === "client_payment" ||
    type === "subscription_payment"
  );
}
