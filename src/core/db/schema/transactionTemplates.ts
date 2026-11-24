import { jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { businessesTable } from "./businesses";

/**
 * Reusable Quick-Add drafts. `payload` is the createTransaction body shape
 * minus `occurredAt` (validated against the contract at save AND at use).
 * Templates are convenience only — they never move money themselves; using
 * one still posts through the ordinary createTransaction path.
 */
export const transactionTemplatesTable = pgTable("transaction_templates", {
  id: text("id").primaryKey(),
  businessId: text("business_id")
    .notNull()
    .references(() => businessesTable.id),
  name: text("name").notNull(),
  payload: jsonb("payload").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type TransactionTemplate = typeof transactionTemplatesTable.$inferSelect;
