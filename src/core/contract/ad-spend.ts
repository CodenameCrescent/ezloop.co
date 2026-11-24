import { z } from "zod";
import { defineEndpoint, moneyCents } from "./shared";

/**
 * Ad spend endpoints.
 *
 * These read and write the ORDINARY LEDGER — there is no ad-spend table. A
 * logged spend is an expense transaction on a source of kind `ad_platform`, so
 * it reaches True profit like every other cost. See
 * `api-server/src/services/adSpend.ts` for why that matters.
 *
 * The vocabulary here is the owner's, not the schema's (CLAUDE.md): "platform",
 * "spent on", "campaign" — never sourceId, occurredAt or externalRef.
 */

export const adSpendEntry = z.object({
  id: z.string(),
  spentOn: z.string(),
  platform: z.string(),
  sourceId: z.string(),
  campaign: z.string().nullable(),
  amountCents: moneyCents,
  currency: z.string(),
  paidAt: z.string().nullable(),
  origin: z.string(),
  status: z.string(),
  notes: z.string().nullable(),
});
export type AdSpendEntryShape = z.infer<typeof adSpendEntry>;

export const adSpendPlatformTotal = z.object({
  sourceId: z.string(),
  platform: z.string(),
  amountCents: moneyCents,
  entryCount: z.number().int(),
});

export const adPlatform = z.object({
  id: z.string(),
  name: z.string(),
  defaultCurrency: z.string(),
  status: z.string(),
});
export type AdPlatformShape = z.infer<typeof adPlatform>;

export const listAdSpend = defineEndpoint({
  method: "GET",
  path: "/ad-spend",
  query: z.object({
    startDate: z.string().optional(),
    endDate: z.string().optional(),
  }),
  response: z.object({
    entries: z.array(adSpendEntry),
    byPlatform: z.array(adSpendPlatformTotal),
    totalCents: moneyCents,
    /**
     * Basis points, so it stays an integer. NULL when the period has no
     * revenue: a share of nothing is unanswerable, not zero, and the screen
     * says so rather than printing a confident 0%.
     */
    shareOfRevenueBps: z.number().int().nullable(),
    /** Gross revenue the share was taken against, so the screen can show its working. */
    grossRevenueCents: moneyCents,
  }),
});

export const listAdPlatforms = defineEndpoint({
  method: "GET",
  path: "/ad-spend/platforms",
  response: z.array(adPlatform),
});

export const logAdSpend = defineEndpoint({
  method: "POST",
  path: "/ad-spend",
  body: z.object({
    /** Display name — a preset ("Meta Ads") or the owner's own wording. */
    platform: z.string().min(1).max(255),
    /** The day the money was spent. */
    spentOn: z.string(),
    amountCents: moneyCents.positive(),
    /** Omit for "paid on the day"; null for spend invoiced and not yet settled. */
    paidAt: z.string().nullish(),
    campaign: z.string().max(255).nullish(),
    currency: z.string().max(8).optional(),
    notes: z.string().max(2000).nullish(),
  }),
  response: z.object({ id: z.string() }),
});

export const voidAdSpend = defineEndpoint({
  method: "POST",
  path: "/ad-spend/:id/void",
  params: z.object({ id: z.string() }),
  response: z.object({ id: z.string(), status: z.string() }),
});
