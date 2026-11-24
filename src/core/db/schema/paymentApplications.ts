import { bigint, check, date, index, pgTable, text, timestamp, type AnyPgColumn } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { businessesTable } from "./businesses";
import { transactionsTable } from "./transactions";

/**
 * How a bill got settled.
 *
 * APPEND-ONLY, like everything else that touches money here: a row is written
 * and never edited. Balances are DERIVED — what is left of an advance is its
 * amount less the sum of what has been drawn from it, computed on read.
 *
 * ── One truth about paid-ness ───────────────────────────────────────────────
 *
 * `transactions.paid_at` remains the single answer to "is this settled". When
 * applications reach a bill's full amount the server sets it. These rows only
 * ever explain HOW something was settled; they never become a second, competing
 * answer to WHETHER it was.
 *
 * ── Why `applied_from_transaction_id` is nullable ───────────────────────────
 *
 * A row whose `applied_from` names an advance is a drawdown. A row with it null
 * would be an ordinary part-payment in cash — which is NOT built, deliberately:
 * the owner asked for advances and not for general partial payments, and
 * building the second under cover of the first is how scope quietly doubles.
 *
 * The column is nullable anyway because the shape is the same either way, so if
 * part-payments are ever wanted they are this table plus a screen, not a
 * migration and a second concept. Nothing today writes a null.
 */
export const paymentApplicationsTable = pgTable(
  "payment_applications",
  {
    id: text("id").primaryKey(),
    businessId: text("business_id")
      .notNull()
      .references(() => businessesTable.id),
    /** The bill or invoice being settled. */
    transactionId: text("transaction_id")
      .notNull()
      .references(() => transactionsTable.id),
    /** The advance it was settled from. Null would mean a plain cash payment. */
    appliedFromTransactionId: text("applied_from_transaction_id").references(
      (): AnyPgColumn => transactionsTable.id,
    ),
    amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
    appliedOn: date("applied_on").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("payment_applications_transaction_idx").on(t.transactionId),
    index("payment_applications_source_idx").on(t.appliedFromTransactionId),
    index("payment_applications_business_idx").on(t.businessId),
    // Zero settles nothing and a negative is a refund, which has its own path.
    check("payment_applications_amount_check", sql`amount_cents > 0`),
    // An advance cannot settle itself.
    check(
      "payment_applications_not_self_check",
      sql`applied_from_transaction_id IS NULL OR applied_from_transaction_id <> transaction_id`,
    ),
  ],
);

export type PaymentApplication = typeof paymentApplicationsTable.$inferSelect;
