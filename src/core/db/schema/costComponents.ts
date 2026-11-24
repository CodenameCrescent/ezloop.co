import { bigint, boolean, check, index, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { revenueItemsTable } from "./revenueItems";
import { sourcesTable } from "./sources";

export const costCalcTypeValues = ["fixed_per_unit", "percent_of_price", "percent_of_subtotal"] as const;
export type CostCalcType = (typeof costCalcTypeValues)[number];

/**
 * Effective-dated cost/fee definitions for a revenue item. Versions are NEVER
 * mutated in place: an edit closes the open row (sets effective_to) and
 * inserts a new one. Historical profit reads frozen cost_snapshot JSON on
 * transaction lines, never these rows.
 */
export const costComponentsTable = pgTable(
  "cost_components",
  {
    id: text("id").primaryKey(),
    revenueItemId: text("revenue_item_id")
      .notNull()
      .references(() => revenueItemsTable.id),
    name: text("name").notNull(),
    calcType: text("calc_type").notNull(),
    /** Exactly one of value_cents / value_rate is set, per calc_type (CHECK below). */
    valueCents: bigint("value_cents", { mode: "number" }),
    /** Decimal string of percentage points, e.g. "20" = 20%. */
    valueRate: text("value_rate"),
    /**
     * Null = fee/cost kind follows the calc_type default (percent → fee,
     * fixed_per_unit → cost); set to override per component.
     */
    isFee: boolean("is_fee"),
    /** Null = applies on every source; set = only when the sale came from that source. */
    sourceId: text("source_id").references(() => sourcesTable.id),
    effectiveFrom: timestamp("effective_from", { withTimezone: true }).notNull(),
    effectiveTo: timestamp("effective_to", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Exactly one open (effective_to IS NULL) version per component identity.
    uniqueIndex("cost_components_open_uq")
      .on(t.revenueItemId, t.name, sql`coalesce(${t.sourceId}, '')`)
      .where(sql`${t.effectiveTo} IS NULL`),
    index("cost_components_item_idx").on(t.revenueItemId),
    check(
      "cost_components_value_check",
      sql`(calc_type = 'fixed_per_unit' AND value_cents IS NOT NULL AND value_rate IS NULL)
          OR (calc_type IN ('percent_of_price', 'percent_of_subtotal') AND value_rate IS NOT NULL AND value_cents IS NULL)`,
    ),
  ],
);

export type CostComponent = typeof costComponentsTable.$inferSelect;
