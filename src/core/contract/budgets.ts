import { z } from "zod";
import { defineEndpoint, moneyCents } from "./shared";

/**
 * Budgets: what you planned, against what actually happened.
 *
 * Replaces the six hardcoded categories that lived in a settings blob, whose
 * "actual spend" was found by searching expense names for words — so money that
 * matched nothing quietly vanished from the comparison. Everything here matches
 * by id, and what matches nothing is shown.
 */
export const budgetScope = z.enum(["period", "project"]);
export const budgetStatus = z.enum(["draft", "active", "closed"]);
export const budgetSide = z.enum(["in", "out"]);
export const budgetBasis = z.enum(["total", "per_month"]);

/** What a budget line claims. Exactly one, enforced by the database too. */
export const budgetLineMatch = z.object({
  expenseItemId: z.string().nullish(),
  revenueItemId: z.string().nullish(),
  categoryId: z.string().nullish(),
  /** Matched EXACTLY — never as a substring. */
  label: z.string().max(255).nullish(),
});

export const budgetLine = z.object({
  id: z.string(),
  side: budgetSide,
  expenseItemId: z.string().nullable(),
  revenueItemId: z.string().nullable(),
  categoryId: z.string().nullable(),
  label: z.string().nullable(),
  /** Resolved for display, so the screen never has to look a name up itself. */
  name: z.string(),
  amountCents: moneyCents,
  basis: budgetBasis,
  /** The amount across the WHOLE span, after applying the basis. */
  budgetedCents: moneyCents,
  actualCents: moneyCents,
  remainingCents: moneyCents,
  overByCents: moneyCents,
  /** Null when nothing is budgeted — there is nothing to be a share of. */
  pctUsed: z.number().nullable(),
  over: z.boolean(),
});

/** Straight-line pacing against a profit goal. Null throughout without a goal. */
export const budgetPace = z.object({
  monthsTotal: z.number().int(),
  monthsElapsed: z.number().int(),
  monthsRemaining: z.number().int(),
  targetProfitCents: moneyCents,
  profitSoFarCents: moneyCents,
  expectedByNowCents: moneyCents,
  /** Positive is ahead, negative is behind. */
  aheadByCents: moneyCents,
  onTrack: z.boolean(),
  neededPerRemainingMonthCents: moneyCents.nullable(),
  /**
   * Sales needed to reach the target, from `revenueForTargetProfit`. Null when
   * the period has no working margin to compute one from.
   */
  revenueNeededCents: moneyCents.nullable(),
});

export const budget = z.object({
  id: z.string(),
  name: z.string(),
  scope: budgetScope,
  projectId: z.string().nullable(),
  projectName: z.string().nullable(),
  periodStart: z.string(),
  periodEnd: z.string(),
  targetProfitCents: moneyCents.nullable(),
  status: budgetStatus,
  monthsTotal: z.number().int(),
});
export type BudgetShape = z.infer<typeof budget>;
export type BudgetLineShape = z.infer<typeof budgetLine>;

export const budgetDetail = z.object({
  budget,
  lines: z.array(budgetLine),
  totals: z.object({
    in: z.object({ budgetedCents: moneyCents, actualCents: moneyCents }),
    out: z.object({ budgetedCents: moneyCents, actualCents: moneyCents }),
  }),
  /**
   * Real money no line claimed. Shown, never dropped — this is the whole reason
   * the old screen could read "under budget" for a business that was not.
   */
  unbudgeted: z.object({
    inCents: moneyCents,
    outCents: moneyCents,
    count: z.number().int(),
  }),
  pace: budgetPace.nullable(),
});

export const listBudgets = defineEndpoint({
  method: "GET",
  path: "/budgets",
  query: z.object({ status: budgetStatus.optional() }),
  response: z.object({ items: z.array(budget) }),
});

export const getBudget = defineEndpoint({
  method: "GET",
  path: "/budgets/:id",
  params: z.object({ id: z.string() }),
  response: budgetDetail,
});

export const budgetBody = z.object({
  name: z.string().min(1).max(255),
  scope: budgetScope.optional(),
  projectId: z.string().nullish(),
  periodStart: z.string(),
  periodEnd: z.string(),
  targetProfitCents: moneyCents.nullish(),
  status: budgetStatus.optional(),
  lines: z
    .array(
      budgetLineMatch.extend({
        side: budgetSide,
        amountCents: moneyCents,
        basis: budgetBasis.optional(),
      }),
    )
    .max(200)
    .optional(),
});

export const createBudget = defineEndpoint({
  method: "POST",
  path: "/budgets",
  body: budgetBody,
  response: budget,
});

/** Lines are REPLACED wholesale when supplied — a budget is edited as a whole. */
export const updateBudget = defineEndpoint({
  method: "PATCH",
  path: "/budgets/:id",
  params: z.object({ id: z.string() }),
  body: budgetBody.partial(),
  response: budget,
});

/**
 * A first draft, built from what the business actually spends.
 *
 * The single most important thing on this screen: a blank budget form never
 * gets filled in. Uses the MEDIAN month rather than the mean, so one machine
 * purchase does not become a monthly cement budget — the average is returned
 * alongside so the owner can see the difference and judge it.
 */
export const suggestBudget = defineEndpoint({
  method: "GET",
  path: "/budgets/suggestion",
  query: z.object({
    /** How far back to look. Defaults to six months. */
    months: z.coerce.number().int().min(1).max(36).optional(),
  }),
  response: z.object({
    monthsConsidered: z.number().int(),
    lines: z.array(
      z.object({
        side: budgetSide,
        expenseItemId: z.string().nullable(),
        revenueItemId: z.string().nullable(),
        categoryId: z.string().nullable(),
        label: z.string().nullable(),
        name: z.string(),
        /** The suggestion: a typical month. */
        medianMonthCents: moneyCents,
        /** Shown beside it, because a big gap between the two is worth seeing. */
        meanMonthCents: moneyCents,
        monthsSeen: z.number().int(),
      }),
    ),
  }),
});
