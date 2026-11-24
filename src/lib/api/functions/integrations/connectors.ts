import { db, integrationsTable, type Integration, type IntegrationKind } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { runShopifySync, type ShopifySyncOutcome } from "./shopify";

/**
 * What can be connected, and what happens when you press Sync.
 *
 * This file used to fabricate money: `importStorefrontOrders` invented eight to
 * twelve orders from a list of sample customers, and `importAdsSpend` invented
 * fourteen days of daily spend. Both wrote to legacy tables that migration 0001
 * dropped, so both had been failing at runtime for months — but the deeper
 * problem was that they were never right to begin with. Inventing an owner's
 * numbers is the exact failure DECISIONS.md names: a figure that looks
 * meaningful and is not. A connector that cannot reach a real API says so.
 */

export interface ConnectorMeta {
  kind: IntegrationKind;
  displayName: string;
  category: "storefront" | "ads";
  /** True once this connector posts real money through the domain services. */
  live: boolean;
}

export const CONNECTORS: Record<IntegrationKind, ConnectorMeta> = {
  shopify: { kind: "shopify", displayName: "Shopify", category: "storefront", live: true },
  daraz: { kind: "daraz", displayName: "Daraz", category: "storefront", live: false },
  meta_ads: { kind: "meta_ads", displayName: "Meta Ads", category: "ads", live: false },
  google_ads: { kind: "google_ads", displayName: "Google Ads", category: "ads", live: false },
  tiktok_ads: { kind: "tiktok_ads", displayName: "TikTok Ads", category: "ads", live: false },
};

export interface SyncResult {
  ok: boolean;
  message: string;
  outcome?: ShopifySyncOutcome;
}

/** A sentence an owner can act on, from the numbers the sync actually did. */
function describe(outcome: ShopifySyncOutcome): string {
  if (outcome.ordersSeen === 0) return "No new orders since the last sync.";

  const parts: string[] = [];
  if (outcome.imported > 0) parts.push(`${outcome.imported} new ${outcome.imported === 1 ? "order" : "orders"}`);
  if (outcome.refunded > 0) parts.push(`${outcome.refunded} ${outcome.refunded === 1 ? "refund" : "refunds"}`);
  if (outcome.cancelled > 0) parts.push(`${outcome.cancelled} cancelled`);
  if (parts.length === 0) return `Checked ${outcome.ordersSeen} orders — everything was already up to date.`;

  let message = `Brought in ${parts.join(", ")}.`;
  if (outcome.unmappedLines > 0) {
    // Named plainly, because it is the one thing the owner has to DO. Those
    // sales are in the books and correct; only their costs are unknown.
    message += ` ${outcome.unmappedLines} ${outcome.unmappedLines === 1 ? "line is" : "lines are"} not linked to anything you sell yet, so their costs are missing.`;
  }
  return message;
}

/**
 * Run a connector's sync for one business.
 *
 * Ownership has already been checked by the route: this takes the verified
 * integration row, never a user id and a kind to go looking with.
 */
export async function runIntegrationSync(businessId: string, kind: IntegrationKind): Promise<SyncResult> {
  const meta = CONNECTORS[kind];

  const [integration] = await db
    .select()
    .from(integrationsTable)
    .where(and(eq(integrationsTable.businessId, businessId), eq(integrationsTable.kind, kind)));

  if (!integration) {
    return { ok: false, message: `${meta.displayName} is not connected to this business.` };
  }

  if (!meta.live) {
    return {
      ok: false,
      message: `${meta.displayName} can be connected, but bringing its figures in automatically is not built yet. Add them by hand for now.`,
    };
  }

  return runShopify(integration);
}

async function runShopify(integration: Integration): Promise<SyncResult> {
  try {
    const outcome = await runShopifySync(integration.id);
    return { ok: true, message: describe(outcome), outcome };
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
}
