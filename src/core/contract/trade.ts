import { z } from "zod";
import { defineEndpoint, moneyCents } from "./shared";

/**
 * The trade reports: what went to waste, and what the business owns.
 *
 * Both are READS over money the ledger already holds. Neither invents a figure
 * and neither adds to any total — waste is a slice of spending already counted,
 * and an asset is a purchase already spread across the months it covers.
 */

export const wasteRow = z.object({
  name: z.string(),
  /** What the wasted units cost, at the price they were bought at. */
  wastedCents: moneyCents,
  /** What was spent on that thing in total, for context. */
  boughtCents: moneyCents,
  /** Wasted units as a share of units bought. Null when nothing was bought. */
  ratePct: z.number().nullable(),
});

export const getWasteReport = defineEndpoint({
  method: "GET",
  path: "/reports/waste",
  query: z.object({ startDate: z.string().optional(), endDate: z.string().optional() }),
  response: z.object({
    totalWastedCents: moneyCents,
    totalBoughtCents: moneyCents,
    /** Null when nothing was wasted — "0% wasted" is a claim nobody measured. */
    shareOfSpendPct: z.number().nullable(),
    rows: z.array(wasteRow),
  }),
});

export const assetRow = z.object({
  /** The purchase it came from, so the drawer is one click away. */
  transactionId: z.string(),
  name: z.string(),
  purchasedAt: z.string(),
  purchaseCents: moneyCents,
  spreadMonths: z.number().int(),
  monthsUsed: z.number().int(),
  monthsLeft: z.number().int(),
  /** What has been charged to profit so far. */
  usedCents: moneyCents,
  /** What is still to come. Used plus remaining always equals the purchase. */
  remainingCents: moneyCents,
  usedPct: z.number(),
  fullyUsed: z.boolean(),
});

/**
 * What the business owns, derived from purchases spread over months.
 *
 * There is no assets table: every spread purchase already IS an asset record,
 * with a date, an amount and a life. A second table would be a copy of facts
 * the ledger holds, and the copy is what goes stale.
 */
export const getAssetsReport = defineEndpoint({
  method: "GET",
  path: "/reports/assets",
  query: z.object({
    /** Include things whose life is used up. Off by default. */
    includeFullyUsed: z.enum(["true", "false"]).optional(),
  }),
  response: z.object({
    items: z.array(assetRow),
    totalPurchaseCents: moneyCents,
    totalRemainingCents: moneyCents,
  }),
});
