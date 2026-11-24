import { pgTable, text, boolean, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * What belongs to the PERSON, not to a set of books.
 *
 * This table used to hold everything: the business name, the currency, the
 * margin thresholds, the budget. All of those describe one business and moved to
 * `businesses` and `business_settings` when a user could own several — see
 * migration 0022. What is left is the short list that is genuinely account-wide,
 * and the test for adding anything here is that answer: would an owner want the
 * same value in every one of their businesses? If not, it belongs next door.
 *
 * The Paddle columns are KEEP (CLAUDE.md) and were not touched by the split:
 * billing is per account, which is the one thing here that was never in doubt.
 */
export const userSettingsTable = pgTable("user_settings", {
  userId: text("user_id").primaryKey(),
  plan: text("plan").notNull().default("Free"),
  locale: text("locale").notNull().default("en-IN"),
  toastsEnabled: boolean("toasts_enabled").notNull().default(true),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  paddleCustomerId: text("paddle_customer_id"),
  paddleSubscriptionId: text("paddle_subscription_id"),
}, (table) => [
  index("user_settings_paddle_customer_idx").on(table.paddleCustomerId),
]);

export const insertUserSettingsSchema = createInsertSchema(userSettingsTable).omit({
  userId: true,
  updatedAt: true,
});
export type InsertUserSettings = z.infer<typeof insertUserSettingsSchema>;
export type UserSettings = typeof userSettingsTable.$inferSelect;
