import { z } from "zod";
import { defineEndpoint } from "./shared";

export const sourceKind = z.enum([
  "ecommerce_store",
  "marketplace",
  "payment_processor",
  "ad_platform",
  "accounting",
  "bank",
  "manual",
]);

export const sourceStatus = z.enum(["active", "paused", "disconnected"]);

export const source = z.object({
  id: z.string(),
  name: z.string(),
  kind: sourceKind,
  platformFeePercent: z.string().nullable(),
  defaultCurrency: z.string(),
  status: sourceStatus,
  lastSyncedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type SourceShape = z.infer<typeof source>;

export const listSources = defineEndpoint({
  method: "GET",
  path: "/sources",
  response: z.array(source),
});

export const createSource = defineEndpoint({
  method: "POST",
  path: "/sources",
  body: z.object({
    name: z.string().min(1).max(255),
    kind: sourceKind,
    platformFeePercent: z.string().nullish(),
    defaultCurrency: z.string().max(8).optional(),
  }),
  response: source,
});

export const updateSource = defineEndpoint({
  method: "PATCH",
  path: "/sources/:id",
  params: z.object({ id: z.string() }),
  body: z.object({
    name: z.string().min(1).max(255).optional(),
    platformFeePercent: z.string().nullish(),
    status: sourceStatus.optional(),
  }),
  response: source,
});
