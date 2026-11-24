import type { TransactionStatus } from "./types";

/**
 * Two questions that are not the same question:
 *
 *   "Did I make money in July?"  → accrual, measured by when it HAPPENED.
 *   "Did I have money in July?"  → cash,    measured by when it was PAID.
 *
 * A bill dated July and paid in August belongs in July's profit and August's
 * cash at the same time. Before there was only one date, so the two answers
 * were forced to agree and one of them was always wrong.
 *
 * This module owns the rule; the server translates it into a query, and the
 * ladder in ./profit stays basis-agnostic — it totals whatever it is handed.
 */

export const ACCOUNTING_BASES = ["accrual", "cash"] as const;
export type AccountingBasis = (typeof ACCOUNTING_BASES)[number];

/** Plain English. The UI never invents its own words for these. */
export const BASIS_LABELS: Record<AccountingBasis, { label: string; help: string }> = {
  accrual: {
    label: "When it happened",
    help: "Counts money on the date the sale or bill happened, even if it has not been paid yet. This is your profit.",
  },
  cash: {
    label: "When it was paid",
    help: "Counts money only once it actually moved. This is what landed in, or left, your account.",
  },
};

export function isAccountingBasis(value: unknown): value is AccountingBasis {
  return typeof value === "string" && (ACCOUNTING_BASES as readonly string[]).includes(value);
}

/** The two dates every money event carries. `paidAt` null means not paid yet. */
export interface DatedTransaction {
  occurredAt: Date;
  paidAt: Date | null;
  status: TransactionStatus;
}

/**
 * Statuses that describe a REAL money event. `pending` is absent on purpose: it
 * now means only "the owner has not confirmed this happened" (an unconfirmed
 * recurring post), never "unpaid" — unpaid is `paidAt === null`.
 */
export const REAL_STATUSES = new Set<TransactionStatus>([
  "completed",
  "refunded",
  "partially_refunded",
  "disputed",
]);

/** Does this transaction count at all under this basis? */
export function countsInBasis(basis: AccountingBasis, txn: DatedTransaction): boolean {
  if (!REAL_STATUSES.has(txn.status)) return false;
  // Cash only counts money that actually moved.
  return basis === "accrual" || txn.paidAt !== null;
}

/**
 * The date this basis files the transaction under, or null when the basis
 * cannot place it (an unpaid row has no cash date — it has not happened yet in
 * cash terms, which is different from happening at zero).
 */
export function basisDateOf(basis: AccountingBasis, txn: DatedTransaction): Date | null {
  return basis === "accrual" ? txn.occurredAt : txn.paidAt;
}

/** Is this transaction still waiting for its money? */
export function isUnpaid(txn: DatedTransaction): boolean {
  return REAL_STATUSES.has(txn.status) && txn.paidAt === null;
}

/**
 * How the owner sees a row's payment state. Deliberately three words, not a
 * status enum: partial payment (paying half a bill) has no storage yet, so
 * claiming to model it would be a lie. It arrives with allocation in a later
 * phase.
 */
export type PaymentState = "paid" | "unpaid" | "not_confirmed";

export function paymentStateOf(txn: DatedTransaction): PaymentState {
  if (!REAL_STATUSES.has(txn.status)) return "not_confirmed";
  return txn.paidAt === null ? "unpaid" : "paid";
}

export const PAYMENT_STATE_LABELS: Record<PaymentState, string> = {
  paid: "Paid",
  unpaid: "Not paid yet",
  not_confirmed: "Not confirmed",
};
