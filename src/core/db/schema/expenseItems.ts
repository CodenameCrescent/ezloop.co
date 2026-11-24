import { bigint, index, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { businessesTable } from "./businesses";
import { categoriesTable } from "./categories";
import { importBatchesTable } from "./imports";
import { peopleTable } from "./people";

/**
 * Every `type` a stored row may carry. "fixed" and "variable" are LEGACY: they
 * describe behaviour, not purpose, and conflating the two axes is what kept
 * break-even at zero. They still read, so history renders untouched, but the
 * write path rejects them — see `expenseItemPurposeValues`.
 */
export const expenseItemTypeValues = [
  "fixed",
  "variable",
  "marketing",
  "operational",
  "maintenance",
  "payroll",
  "cogs",
  "custom",
] as const;
export type ExpenseItemType = (typeof expenseItemTypeValues)[number];

/** What a NEW expense item may say it is for. Purpose only; never behaviour. */
export const expenseItemPurposeValues = [
  "marketing",
  "operational",
  "maintenance",
  "payroll",
  "cogs",
  "custom",
] as const;
export type ExpenseItemPurpose = (typeof expenseItemPurposeValues)[number];

/** Does this cost grow with sales? The flag break-even reads. */
export const costNatureValues = ["fixed", "variable", "semi_variable"] as const;
export type CostNature = (typeof costNatureValues)[number];

export const expenseBehaviorValues = ["one_time", "recurring", "usage_based"] as const;
export type ExpenseBehavior = (typeof expenseBehaviorValues)[number];

/** Catalog: something the business spends money on, defined once. Never moves money by itself. */
export const expenseItemsTable = pgTable(
  "expense_items",
  {
    id: text("id").primaryKey(),
    businessId: text("business_id")
      .notNull()
      .references(() => businessesTable.id),
    name: text("name").notNull(),
    /** What the money is FOR — a grouping label that never changes math. */
    type: text("type").notNull(),
    /**
     * How the cost BEHAVES — the axis break-even reads. Separate from `type` on
     * purpose: an agency retainer is marketing AND fixed, which one list could
     * not say. Defaults to variable so a row can never silently invent a
     * standing monthly commitment.
     */
    costNature: text("cost_nature").notNull().default("variable"),
    categoryId: text("category_id").references(() => categoriesTable.id),
    /** The vendor as a real Person (R4). Migrated from the old vendor_name strings. */
    vendorPersonId: text("vendor_person_id").references(() => peopleTable.id),
    /**
     * What ONE of it costs, and what one of it IS.
     *
     * Together these turn "Rs 50,000 of cement" into "200 bags at Rs 250" —
     * which is the shape a builder already thinks in, and the only shape that
     * makes waste and cost-per-unit answerable. `default_amount_cents` was
     * already the per-unit rate (a line is qty x unit price), so only the word
     * for the unit was missing. Mirrors `revenue_items.unit_label`.
     *
     * Null unit means the item is not counted in anything in particular — rent
     * is Rs 50,000, not 1 rent — and the entry form just asks for an amount.
     */
    unitLabel: text("unit_label"),
    defaultAmountCents: bigint("default_amount_cents", { mode: "number" }),
    currency: text("currency").notNull().default("PKR"),
    behavior: text("behavior").notNull().default("one_time"),
    status: text("status").notNull().default("active"),
    notes: text("notes"),
    /** Set when this row arrived from a CSV import; drives undo. */
    importBatchId: text("import_batch_id").references(() => importBatchesTable.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("expense_items_business_name_uq").on(t.businessId, t.name),
    index("expense_items_business_idx").on(t.businessId),
    index("expense_items_import_batch_idx").on(t.importBatchId),
  ],
);

export type ExpenseItem = typeof expenseItemsTable.$inferSelect;
