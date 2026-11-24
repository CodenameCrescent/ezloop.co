import {
  pgTable,
  text,
  doublePrecision,
  integer,
  boolean,
  timestamp,
  index,
  jsonb,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const expenseItemTypeValues = [
  "fixed",
  "variable",
  "marketing",
  "payroll",
  "software",
  "inventory_supplier",
  "shipping",
  "tax",
  "maintenance",
  "operational",
  "custom",
] as const;

export const expenseItemAmountModeValues = ["fixed", "flexible", "imported", "rate_based"] as const;

export const expenseItemRateUnitValues = [
  "per_order",
  "per_sale",
  "per_unit",
  "per_transaction",
  "per_delivery",
  "percentage",
  "custom",
] as const;

export const expenseItemFrequencyValues = [
  "one_time",
  "daily",
  "weekly",
  "monthly",
  "yearly",
  "per_order",
  "per_sale",
  "per_unit",
  "per_transaction",
  "flexible",
  "imported",
] as const;

export const expenseItemScheduleModeValues = [
  "none",
  "specific_date",
  "monthly_day",
  "weekly_day",
  "daily",
  "per_transaction",
  "auto_sync",
  "imported",
] as const;

export const expenseItemStatusValues = ["active", "inactive"] as const;

export const expenseItemsTable = pgTable(
  "expense_items",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    name: text("name").notNull(),
    type: text("type").notNull().default("fixed"),
    originLabel: text("origin_label").notNull().default("Manual"),
    provider: text("provider").notNull().default("manual"),
    connectionId: text("connection_id"),
    connectionName: text("connection_name"),
    externalId: text("external_id"),
    amountMode: text("amount_mode").notNull().default("fixed"),
    amount: doublePrecision("amount"),
    rateUnit: text("rate_unit"),
    rateLabel: text("rate_label"),
    frequency: text("frequency").notNull().default("monthly"),
    scheduleMode: text("schedule_mode").notNull().default("monthly_day"),
    dueDate: timestamp("due_date", { withTimezone: true }),
    monthlyDay: integer("monthly_day"),
    weeklyDay: text("weekly_day"),
    nextDueDate: timestamp("next_due_date", { withTimezone: true }),
    lastPaidDate: timestamp("last_paid_date", { withTimezone: true }),
    autoSync: boolean("auto_sync").notNull().default(false),
    status: text("status").notNull().default("active"),
    notes: text("notes"),
    metadataJson: jsonb("metadata_json"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index("expense_items_user_idx").on(t.userId),
    userStatusIdx: index("expense_items_user_status_idx").on(t.userId, t.status),
    userTypeIdx: index("expense_items_user_type_idx").on(t.userId, t.type),
    sourceIdx: index("expense_items_source_idx").on(t.userId, t.provider, t.connectionId, t.externalId),
  }),
);

export const insertExpenseItemSchema = createInsertSchema(expenseItemsTable).omit({
  id: true,
  userId: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertExpenseItem = z.infer<typeof insertExpenseItemSchema>;
export type ExpenseItem = typeof expenseItemsTable.$inferSelect;
