import { bigint, check, date, index, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { businessesTable } from "./businesses";
import { categoriesTable } from "./categories";
import { expenseItemsTable } from "./expenseItems";
import { projectsTable } from "./projects";
import { revenueItemsTable } from "./revenueItems";

export const budgetScopeValues = ["period", "project"] as const;
export type BudgetScope = (typeof budgetScopeValues)[number];

export const budgetStatusValues = ["draft", "active", "closed"] as const;
export type BudgetStatus = (typeof budgetStatusValues)[number];

/**
 * A plan for a span of time, or for one project.
 *
 * Replaces the six hardcoded categories that used to live in a settings JSON
 * blob in whole rupees, compared against actuals found by SEARCHING EXPENSE
 * NAMES FOR WORDS. See `lib/domain/budget.ts` for what was wrong with that; the
 * short version is that money which matched nothing simply disappeared from the
 * comparison.
 */
export const budgetsTable = pgTable(
  "budgets",
  {
    id: text("id").primaryKey(),
    businessId: text("business_id")
      .notNull()
      .references(() => businessesTable.id),
    name: text("name").notNull(),
    scope: text("scope").notNull().default("period"),
    /** Set only when scope is `project`. */
    projectId: text("project_id").references(() => projectsTable.id),
    periodStart: date("period_start").notNull(),
    periodEnd: date("period_end").notNull(),
    /**
     * The goal. Null when the owner is only capping spending and has not said
     * what they want to be left with — a real and common way to use a budget.
     */
    targetProfitCents: bigint("target_profit_cents", { mode: "number" }),
    status: text("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("budgets_business_idx").on(t.businessId, t.status),
    index("budgets_project_idx").on(t.projectId),
    check("budgets_period_order_check", sql`period_end >= period_start`),
    // A project budget names its project; a period budget must not.
    check(
      "budgets_scope_project_check",
      sql`(scope = 'project' AND project_id IS NOT NULL) OR (scope = 'period' AND project_id IS NULL)`,
    ),
  ],
);

export type Budget = typeof budgetsTable.$inferSelect;

export const budgetSideValues = ["in", "out"] as const;
export type BudgetSideValue = (typeof budgetSideValues)[number];

export const budgetBasisValues = ["total", "per_month"] as const;
export type BudgetBasisValue = (typeof budgetBasisValues)[number];

/**
 * One thing the plan has an opinion about.
 *
 * A line claims an expense item, a revenue item, a category, or an exact label —
 * exactly one, by CHECK. The label option is not a fallback: it is the same
 * right the ledger gives a one-off entry, so an owner can budget for "Skip hire"
 * without first creating a catalogue entry for it. Fast entry with zero setup is
 * a product requirement, and a budget nobody can start is a budget nobody keeps.
 */
export const budgetLinesTable = pgTable(
  "budget_lines",
  {
    id: text("id").primaryKey(),
    budgetId: text("budget_id")
      .notNull()
      .references(() => budgetsTable.id),
    /** Costs and revenue are budgeted separately; they are never one number. */
    side: text("side").notNull(),
    expenseItemId: text("expense_item_id").references(() => expenseItemsTable.id),
    revenueItemId: text("revenue_item_id").references(() => revenueItemsTable.id),
    categoryId: text("category_id").references(() => categoriesTable.id),
    /** Matched EXACTLY. The old budget searched names for words; this does not. */
    label: text("label"),
    amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
    basis: text("basis").notNull().default("total"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("budget_lines_budget_idx").on(t.budgetId),
    // Exactly one thing claimed. Two would make the line ambiguous about what it
    // is budgeting; none would make it unmatchable and permanently read Rs 0.
    check(
      "budget_lines_one_match_check",
      sql`(
        (CASE WHEN expense_item_id IS NOT NULL THEN 1 ELSE 0 END) +
        (CASE WHEN revenue_item_id IS NOT NULL THEN 1 ELSE 0 END) +
        (CASE WHEN category_id IS NOT NULL THEN 1 ELSE 0 END) +
        (CASE WHEN label IS NOT NULL THEN 1 ELSE 0 END)
      ) = 1`,
    ),
    // A revenue item can only be budgeted on the income side, and an expense
    // item only on the cost side. The other way round is not a preference.
    check(
      "budget_lines_side_match_check",
      sql`(side = 'in' AND expense_item_id IS NULL) OR (side = 'out' AND revenue_item_id IS NULL)`,
    ),
    check("budget_lines_amount_check", sql`amount_cents >= 0`),
  ],
);

export type BudgetLine = typeof budgetLinesTable.$inferSelect;
