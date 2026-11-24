import { pgTable, text, doublePrecision, timestamp, index, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const transactionTypeValues = [
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

export const transactionSourceValues = ["manual", "shopify", "csv", "integration", "import"] as const;
export const transactionPaymentStatusValues = ["paid", "unpaid", "partially_paid"] as const;

export const transactionsTable = pgTable(
  "transactions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    transactionType: text("transaction_type").notNull(),
    amount: doublePrecision("amount").notNull().default(0),
    date: timestamp("date", { withTimezone: true }).notNull(),
    category: text("category"),
    source: text("source").notNull().default("manual"),
    offerId: text("offer_id"),
    linkedRevenueItemId: text("linked_revenue_item_id"),
    linkedExpenseItemId: text("linked_expense_item_id"),
    clientCustomerId: text("client_customer_id"),
    campaignId: text("campaign_id"),
    notes: text("notes"),
    paymentStatus: text("payment_status"),
    originLabel: text("origin_label"),
    provider: text("provider"),
    connectionId: text("connection_id"),
    connectionName: text("connection_name"),
    externalId: text("external_id"),
    metadataJson: jsonb("metadata_json"),
    lineItemsJson: jsonb("line_items_json"),
    sourceRecordType: text("source_record_type"),
    sourceRecordId: text("source_record_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index("transactions_user_idx").on(t.userId),
    userDateIdx: index("transactions_user_date_idx").on(t.userId, t.date),
    userTypeIdx: index("transactions_user_type_idx").on(t.userId, t.transactionType),
    offerIdx: index("transactions_offer_idx").on(t.offerId),
    revenueItemIdx: index("transactions_revenue_item_idx").on(t.linkedRevenueItemId),
    expenseItemIdx: index("transactions_expense_item_idx").on(t.linkedExpenseItemId),
    sourceRecordIdx: index("transactions_source_record_idx").on(
      t.userId,
      t.sourceRecordType,
      t.sourceRecordId,
    ),
  }),
);

export const insertTransactionSchema = createInsertSchema(transactionsTable).omit({
  id: true,
  userId: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertTransaction = z.infer<typeof insertTransactionSchema>;
export type Transaction = typeof transactionsTable.$inferSelect;
