/**
 * Server code used only by `/api/webhooks/shopify`. Shared code stays in
 * `src/lib/api/functions`. Server-only: nothing in components, views or the
 * client helpers may import this file.
 */
import crypto from "node:crypto";
import { integrationsTable } from "@workspace/db";
import { shopifyFetch, type ShopifyOrder } from "@/lib/api/functions/integrations/shopify";
import { logger } from "@/lib/api/functions/lib/logger";
import { decryptToken } from "@/lib/api/functions/lib/tokenCrypto";

// ── shopify-webhooks ──────────────────────────────────────────────

/**
 * Topics that carry a whole order payload.
 *
 * All of them go down the same road, because they ARE the same road: the order
 * as Shopify currently sees it. `importShopifyOrder` decides what changed by
 * reading the ledger, so a cancellation and a refund need no special handler
 * here — and cannot drift from what the manual sync would have done.
 */
export const ORDER_TOPICS = new Set([
  "orders/create",
  "orders/updated",
  "orders/cancelled",
  "orders/paid",
  "refunds/create",
]);

/**
 * Fetch the order a refund belongs to.
 *
 * The refund webhook does not carry the sale, and the ledger cannot post a
 * refund without knowing what it reverses. One read, and a null on any failure
 * so a store we cannot reach costs an acknowledgement rather than a retry loop.
 */
export async function fetchOrderForRefund(
  integration: typeof integrationsTable.$inferSelect,
  orderId: number,
): Promise<ShopifyOrder | null> {
  const store = (integration.externalAccount ?? "")
    .replace(/^https?:\/\//, "")
    .replace(/\/$/, "")
    .replace(/\.myshopify\.com$/, "");
  if (!store || !integration.accessToken) return null;
  try {
    const resp = await shopifyFetch(
      `https://${store}.myshopify.com/admin/api/2024-10/orders/${orderId}.json`,
      {
        headers: {
          "X-Shopify-Access-Token": decryptToken(integration.accessToken),
          "Content-Type": "application/json",
        },
      },
    );
    if (!resp.ok) return null;
    const json = (await resp.json()) as { order?: ShopifyOrder };
    return json.order ?? null;
  } catch (err) {
    logger.warn({ err, orderId }, "shopify webhook: could not fetch the refunded order");
    return null;
  }
}

export function verifyShopifyWebhookHmac(rawBody: Buffer, hmacHeader: string, secret: string): boolean {
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("base64");
  try {
    if (hmacHeader.length !== expected.length) return false;
    return crypto.timingSafeEqual(Buffer.from(hmacHeader), Buffer.from(expected));
  } catch {
    return false;
  }
}
