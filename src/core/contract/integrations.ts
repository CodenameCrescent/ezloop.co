import { z } from "zod";
import { defineEndpoint } from "./shared";

export const integrationKind = z.enum(["shopify", "daraz", "meta_ads", "google_ads", "tiktok_ads"]);
export type IntegrationKindShape = z.infer<typeof integrationKind>;

/**
 * The kinds whose Sync actually brings money in. Mirrors `live` in the server's
 * connector registry (`api-server/src/integrations/connectors.ts`), and a test
 * there fails if the two disagree. The screens offer Connect only for these, so
 * nobody is told an account is "connected" when nothing will ever arrive.
 */
export const LIVE_INTEGRATION_KINDS: readonly IntegrationKindShape[] = ["shopify"];

export const integration = z.object({
  id: z.string(),
  kind: integrationKind,
  displayName: z.string(),
  externalAccount: z.string().nullable(),
  connectedAt: z.string(),
  lastSyncedAt: z.string().nullable(),
});
export type IntegrationShape = z.infer<typeof integration>;

export const listIntegrations = defineEndpoint({
  method: "GET",
  path: "/integrations",
  response: z.array(integration),
});

export const connectIntegration = defineEndpoint({
  method: "POST",
  path: "/integrations/:kind/connect",
  params: z.object({ kind: integrationKind }),
  body: z.object({
    externalAccount: z.string().nullish(),
    accessToken: z.string().nullish(),
  }),
  response: integration,
});

/** Sync is being rebuilt on the new ledger (R5) — the endpoint answers honestly until then. */
export const syncIntegration = defineEndpoint({
  method: "POST",
  path: "/integrations/:kind/sync",
  params: z.object({ kind: integrationKind }),
  body: z.object({}).optional(),
  response: z.object({ ok: z.boolean(), message: z.string() }),
});

export const disconnectIntegration = defineEndpoint({
  method: "DELETE",
  path: "/integrations/:kind",
  params: z.object({ kind: integrationKind }),
  response: z.object({ ok: z.boolean() }),
});
