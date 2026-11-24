/**
 * TODO(R4): delete. Types the not-yet-rebuilt pages (Dashboard, Insights,
 * Cash Flow, Budget) still import — formerly from the generated client. They are
 * fed by the client-side ledger→legacy adapter (ledgerAdapter.ts) until those
 * pages are rebuilt on the typed hooks.
 */
export interface Expense {
  id: string;
  name: string;
  amount: number;
  type: string;
  frequency?: string | null;
  date: string;
  status: string;
  paymentStatus: string;
  category?: string | null;
  vendor?: string | null;
  attachmentName?: string | null;
  orderId?: string | null;
  note?: string | null;
}

export interface CustomerMerge {
  id: string;
  primaryKey: string;
  primaryLabel: string;
  mergedKey: string;
  mergedLabel: string;
  createdAt: string;
}
