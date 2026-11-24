import { bigint, index, jsonb, pgTable, text, timestamp, uniqueIndex, type AnyPgColumn } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { businessesTable } from "./businesses";
import { categoriesTable } from "./categories";
import { importBatchesTable } from "./imports";
import { sourcesTable } from "./sources";

export const revenueItemTypeValues = [
  "product",
  "service",
  "subscription",
  "rental",
  "commission",
  "royalty",
  "other",
] as const;
export type RevenueItemType = (typeof revenueItemTypeValues)[number];

export const pricingModelValues = ["fixed", "per_unit", "hourly", "variable", "tiered"] as const;
export type PricingModel = (typeof pricingModelValues)[number];

export const catalogStatusValues = ["active", "archived"] as const;

/** Default cadence for subscription/rental items; pre-fills the recurring schedule, never moves money itself. */
export const billingCycleValues = ["daily", "weekly", "monthly", "quarterly", "yearly"] as const;
export type BillingCycle = (typeof billingCycleValues)[number];

/** One tier of a tiered price: applies up to `upToQty` units (decimal string); null = this tier and above. */
export type PricingTier = { upToQty: string | null; unitPriceCents: number };

/** Default unit label per item type when the user doesn't pick one. */
export const defaultUnitLabelByType: Record<RevenueItemType, string> = {
  product: "unit",
  service: "hour",
  subscription: "month",
  rental: "month",
  commission: "unit",
  royalty: "unit",
  other: "unit",
};

/** Catalog: something the business sells, defined once with its economics. Never moves money by itself. */
export const revenueItemsTable = pgTable(
  "revenue_items",
  {
    id: text("id").primaryKey(),
    businessId: text("business_id")
      .notNull()
      .references(() => businessesTable.id),
    /** Variant tree: null = root item; set = this row is a variant of its parent. Only leaves are sellable. */
    parentId: text("parent_id").references((): AnyPgColumn => revenueItemsTable.id),
    name: text("name").notNull(),
    type: text("type").notNull(),
    categoryId: text("category_id").references(() => categoriesTable.id),
    pricingModel: text("pricing_model").notNull(),
    /** Null allowed only when pricing_model = 'variable' (enforced in the service layer). */
    unitPriceCents: bigint("unit_price_cents", { mode: "number" }),
    currency: text("currency").notNull().default("PKR"),
    unitLabel: text("unit_label").notNull(),
    /** Only for subscription/rental types; a default the recurring schedule is pre-filled from. */
    defaultBillingCycle: text("default_billing_cycle"),
    /** Only when pricing_model = 'tiered': ordered PricingTier[] (integer cents inside). */
    tiersJson: jsonb("tiers_json").$type<PricingTier[]>(),
    status: text("status").notNull().default("active"),
    notes: text("notes"),
    /** Set when this row arrived from a CSV import; drives undo. */
    importBatchId: text("import_batch_id").references(() => importBatchesTable.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Names are unique among roots per business, and among siblings per parent.
    uniqueIndex("revenue_items_business_root_name_uq")
      .on(t.businessId, t.name)
      .where(sql`${t.parentId} IS NULL`),
    uniqueIndex("revenue_items_parent_name_uq")
      .on(t.parentId, t.name)
      .where(sql`${t.parentId} IS NOT NULL`),
    index("revenue_items_business_idx").on(t.businessId),
    index("revenue_items_parent_idx").on(t.parentId),
    index("revenue_items_import_batch_idx").on(t.importBatchId),
  ],
);

export type RevenueItem = typeof revenueItemsTable.$inferSelect;

/** Where a catalog item is listed (future integration hook — no logic yet). */
export const revenueItemSourcesTable = pgTable(
  "revenue_item_sources",
  {
    id: text("id").primaryKey(),
    revenueItemId: text("revenue_item_id")
      .notNull()
      .references(() => revenueItemsTable.id),
    sourceId: text("source_id")
      .notNull()
      .references(() => sourcesTable.id),
    externalId: text("external_id"),
    priceOverrideCents: bigint("price_override_cents", { mode: "number" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("revenue_item_sources_uq").on(t.revenueItemId, t.sourceId)],
);

export type RevenueItemSource = typeof revenueItemSourcesTable.$inferSelect;
