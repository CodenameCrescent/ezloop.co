import {
  pgTable,
  text,
  doublePrecision,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const expensesTable = pgTable(
  "expenses",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    name: text("name").notNull(),
    amount: doublePrecision("amount").notNull(),
    type: text("type").notNull(), // FIXED | VARIABLE | ONE_TIME | RECURRING | CUSTOM
    frequency: text("frequency"), // Monthly | Weekly | Yearly (for recurring expenses)
    date: timestamp("date", { withTimezone: true }).notNull(),
    status: text("status").notNull().default("active"), // active | paused
    paymentStatus: text("payment_status").notNull().default("paid"), // paid | unpaid
    category: text("category"),
    vendor: text("vendor"),
    attachmentName: text("attachment_name"),
    orderId: text("order_id"), // optional link (for VARIABLE)
    note: text("note"),
  },
  (t) => ({
    userIdx: index("expenses_user_idx").on(t.userId),
    typeIdx: index("expenses_type_idx").on(t.type),
  }),
);

export const insertExpenseSchema = createInsertSchema(expensesTable).omit({
  id: true,
  userId: true,
});
export type InsertExpense = z.infer<typeof insertExpenseSchema>;
export type Expense = typeof expensesTable.$inferSelect;
