import { index, pgTable, text, timestamp, type AnyPgColumn } from "drizzle-orm/pg-core";
import { businessesTable } from "./businesses";

/**
 * Which pickers a category shows up in. `time` is for the internal buckets
 * that absorb labour (Admin, Sales & pitching, …) — they are ordinary
 * categories, tagged so they stay out of the money pickers rather than being
 * given a third category table of their own.
 */
export const categoryAppliesToValues = ["revenue", "expense", "both", "time"] as const;
export type CategoryAppliesTo = (typeof categoryAppliesToValues)[number];

/** User-defined label tree used ONLY for grouping — never changes behavior (CLAUDE.md). */
export const categoriesTable = pgTable(
  "categories",
  {
    id: text("id").primaryKey(),
    businessId: text("business_id")
      .notNull()
      .references(() => businessesTable.id),
    name: text("name").notNull(),
    parentId: text("parent_id").references((): AnyPgColumn => categoriesTable.id),
    appliesTo: text("applies_to").notNull().default("both"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("categories_business_idx").on(t.businessId)],
);

export type Category = typeof categoriesTable.$inferSelect;
