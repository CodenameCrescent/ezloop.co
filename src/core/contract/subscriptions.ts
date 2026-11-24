import { z } from "zod";
import { defineEndpoint, moneyCents } from "./shared";
import { recurInterval } from "./recurring";

export const subscriptionStatus = z.enum(["trialing", "active", "past_due", "paused", "canceled"]);

export const subscription = z.object({
  id: z.string(),
  personId: z.string(),
  personName: z.string(),
  itemName: z.string(),
  status: subscriptionStatus,
  mrrCents: moneyCents,
  interval: recurInterval,
  startedAt: z.string(),
  trialEndsAt: z.string().nullable(),
  canceledAt: z.string().nullable(),
});
export type SubscriptionShape = z.infer<typeof subscription>;

export const listSubscriptions = defineEndpoint({
  method: "GET",
  path: "/subscriptions",
  response: z.array(subscription),
});

/**
 * MRR / movement / churn / NRR for the period, each with a plain-English
 * sentence. The event stream is the source; lib/domain computes the numbers.
 */
export const getSubscriptionSummary = defineEndpoint({
  method: "GET",
  path: "/subscriptions/summary",
  query: z.object({ startDate: z.string().optional(), endDate: z.string().optional() }),
  response: z.object({
    mrrCents: moneyCents,
    activeCount: z.number().int(),
    movement: z.object({
      newMrrCents: moneyCents,
      expansionCents: moneyCents,
      contractionCents: moneyCents,
      churnedCents: moneyCents,
      netCents: moneyCents,
    }),
    churnRatePct: z.number(),
    churnedCount: z.number().int(),
    netRevenueRetentionPct: z.number(),
    sentences: z.object({ mrr: z.string(), churn: z.string(), movement: z.string() }),
  }),
});

export const createSubscription = defineEndpoint({
  method: "POST",
  path: "/subscriptions",
  body: z.object({
    revenueItemId: z.string(),
    personId: z.string().nullish(),
    personName: z.string().nullish(),
    sourceId: z.string().nullish(),
    amountCents: moneyCents.nullish(),
    interval: recurInterval.optional(),
    intervalCount: z.number().int().min(1).optional(),
    startDate: z.string(),
    trialEndsAt: z.string().nullish(),
    postingMode: z.enum(["auto_post", "confirm_first"]).optional(),
  }),
  response: subscription,
});

export const cancelSubscription = defineEndpoint({
  method: "POST",
  path: "/subscriptions/:id/cancel",
  params: z.object({ id: z.string() }),
  body: z.object({ reason: z.string().max(500).nullish() }),
  response: subscription,
});

export const changeSubscriptionPlan = defineEndpoint({
  method: "POST",
  path: "/subscriptions/:id/change-plan",
  params: z.object({ id: z.string() }),
  body: z.object({ amountCents: moneyCents }),
  response: subscription,
});
