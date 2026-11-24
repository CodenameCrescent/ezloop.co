import { index, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { businessesTable } from "./businesses";

export const sourceKindValues = [
  "ecommerce_store",
  "marketplace",
  "payment_processor",
  "ad_platform",
  "accounting",
  "bank",
  "manual",
] as const;
export type SourceKind = (typeof sourceKindValues)[number];

export const sourceStatusValues = ["active", "paused", "disconnected"] as const;
export type SourceStatus = (typeof sourceStatusValues)[number];

/** A channel money flows through: a store, a marketplace account, "Manual", a bank. */
export const sourcesTable = pgTable(
  "sources",
  {
    id: text("id").primaryKey(),
    businessId: text("business_id")
      .notNull()
      .references(() => businessesTable.id),
    name: text("name").notNull(),
    kind: text("kind").notNull(),
    /** Decimal string, e.g. "20" for a 20% platform cut. Informational; fees post via CostComponents. */
    platformFeePercent: text("platform_fee_percent"),
    defaultCurrency: text("default_currency").notNull().default("PKR"),
    status: text("status").notNull().default("active"),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("sources_business_name_uq").on(t.businessId, t.name),
    index("sources_business_idx").on(t.businessId),
  ],
);

export type Source = typeof sourcesTable.$inferSelect;
