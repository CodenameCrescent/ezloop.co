import { z } from "zod";
import { defineEndpoint, moneyCents } from "./shared";
import { catalogStatus } from "./revenue-items";

/**
 * What a stored row's `type` may be. "fixed" and "variable" are legacy: they
 * answer "how does it behave", which is now `costNature`'s job. Reads tolerate
 * them so a row written before the split still renders; writes do not.
 */
export const expenseItemType = z.enum([
  "fixed",
  "variable",
  "marketing",
  "operational",
  "maintenance",
  "payroll",
  "cogs",
  "custom",
]);

/** What a NEW expense item may say it is for. Purpose only — never behaviour. */
export const expenseItemPurpose = z.enum([
  "marketing",
  "operational",
  "maintenance",
  "payroll",
  "cogs",
  "custom",
]);

/** Does this cost grow with sales? The flag break-even reads. */
export const costNature = z.enum(["fixed", "variable", "semi_variable"]);

export const expenseBehavior = z.enum(["one_time", "recurring", "usage_based"]);

export const expenseItemStats = z.object({
  /** All money out for this item in the period — standalone spend AND cost consumed inside jobs. */
  spentCents: moneyCents,
  /** The part of spentCents spent inside sales; a cost of those jobs, not a period expense. */
  jobCostCents: moneyCents,
  /** This item's share of all period expenses (0–100). */
  shareOfExpensesPct: z.number(),
  transactionCount: z.number().int(),
});

export const expenseItem = z.object({
  id: z.string(),
  name: z.string(),
  /** What the money is for — a grouping label only. */
  type: expenseItemType,
  /** How the cost behaves. Orthogonal to `type`: marketing can be fixed. */
  costNature,
  categoryId: z.string().nullable(),
  categoryName: z.string().nullable(),
  vendorName: z.string().nullable(),
  defaultAmountCents: moneyCents.nullable(),
  /** What one of it IS — "bag", "day", "tonne". Null when it is not counted. */
  unitLabel: z.string().nullable(),
  currency: z.string(),
  behavior: expenseBehavior,
  status: catalogStatus,
  notes: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ExpenseItemShape = z.infer<typeof expenseItem>;

export const listExpenseItems = defineEndpoint({
  method: "GET",
  path: "/expense-items",
  query: z.object({
    startDate: z.string().optional(),
    endDate: z.string().optional(),
    status: catalogStatus.optional(),
  }),
  response: z.object({
    items: z.array(expenseItem.extend({ stats: expenseItemStats })),
    totalExpensesCents: moneyCents,
  }),
});

export const expenseItemBody = z.object({
  name: z.string().min(1).max(255),
  /** Purpose only — the legacy "fixed"/"variable" values are rejected here. */
  type: expenseItemPurpose,
  /** Omitted, the server fills in the purpose's usual nature. */
  costNature: costNature.optional(),
  behavior: expenseBehavior.optional(),
  defaultAmountCents: moneyCents.nullish(),
  /**
   * What one of it is. With it set, entry asks for a quantity and the amount
   * above is read as the rate — "200 bags at Rs 250" rather than "Rs 50,000".
   */
  unitLabel: z.string().max(40).nullish(),
  categoryId: z.string().nullish(),
  categoryName: z.string().max(255).nullish(),
  vendorName: z.string().max(255).nullish(),
  notes: z.string().max(2000).nullish(),
});

export const createExpenseItem = defineEndpoint({
  method: "POST",
  path: "/expense-items",
  body: expenseItemBody,
  response: expenseItem,
});

export const updateExpenseItem = defineEndpoint({
  method: "PATCH",
  path: "/expense-items/:id",
  params: z.object({ id: z.string() }),
  body: expenseItemBody.partial().extend({ status: catalogStatus.optional() }),
  response: expenseItem,
});

export const expenseItemPerSource = z.object({
  sourceId: z.string(),
  sourceName: z.string(),
  spentCents: moneyCents,
  transactionCount: z.number().int(),
});

export const expenseItemRecentTxn = z.object({
  id: z.string(),
  occurredAt: z.string(),
  sourceName: z.string(),
  amountCents: moneyCents,
  status: z.string(),
});

/** Detail view for the expense-item drawer — parity with getRevenueItem. */
export const getExpenseItem = defineEndpoint({
  method: "GET",
  path: "/expense-items/:id",
  params: z.object({ id: z.string() }),
  query: z.object({ startDate: z.string().optional(), endDate: z.string().optional() }),
  response: z.object({
    item: expenseItem,
    stats: expenseItemStats,
    perSource: z.array(expenseItemPerSource),
    recentTransactions: z.array(expenseItemRecentTxn),
  }),
});
