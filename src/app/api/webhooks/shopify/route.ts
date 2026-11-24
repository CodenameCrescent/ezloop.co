import type { NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { db, integrationsTable } from "@workspace/db";
import { verifyShopifyWebhookHmac, ORDER_TOPICS, fetchOrderForRefund } from "./functions";
import { type ShopifyOrder, ensureIntegrationSource, importShopifyOrder } from "@/lib/api/functions/integrations/shopify";
import { logger } from "@/lib/api/functions/lib/logger";
import { handleRaw } from "@/lib/api/functions/http/handler";

/** Called by Shopify, not a browser: no session, verified by HMAC instead. */
export async function POST(request: NextRequest) {
  return handleRaw(request, { auth: false }, async (req) => {
    const clientSecret = process.env.SHOPIFY_CLIENT_SECRET;
    if (!clientSecret) {
      return Response.json({ error: "Shopify not configured" }, { status: 503 });
    }

    const hmacHeader = req.headers["x-shopify-hmac-sha256"] as string | undefined;
    if (!hmacHeader) {
      return Response.json({ error: "Missing HMAC header" }, { status: 401 });
    }

    const rawBody = req.rawBody;
    if (!rawBody) {
      return Response.json({ error: "No raw body available" }, { status: 400 });
    }

    if (!verifyShopifyWebhookHmac(rawBody, hmacHeader, clientSecret)) {
      req.log.warn("shopify webhook: HMAC verification failed");
      return Response.json({ error: "HMAC verification failed" }, { status: 401 });
    }

    const topic = req.headers["x-shopify-topic"] as string | undefined;
    // Normalize shop domain to canonical lowercase for consistent DB comparisons
    const rawShopDomain = req.headers["x-shopify-shop-domain"] as string | undefined;
    const shopDomain = rawShopDomain?.toLowerCase();

    if (!topic || !shopDomain) {
      return Response.json({ ok: true }, { status: 200 });
    }

    try {
      if (topic === "app/uninstalled") {
        // X-Shopify-Shop-Domain header is the primary identifier (already HMAC-verified).
        // Payload shop_domain is parsed for validation logging only — header wins.
        const resolvedShop = shopDomain;
        try {
          const payload = JSON.parse(rawBody.toString("utf8")) as { shop_domain?: string; domain?: string };
          const payloadShop = payload.shop_domain ?? payload.domain;
          if (payloadShop && payloadShop !== shopDomain) {
            req.log.warn(
              { headerShop: shopDomain, payloadShop },
              "shopify webhook: uninstall shop mismatch between header and payload — using header value",
            );
          }
        } catch {
          // payload parse failure — header value still used
        }
        const deleted = await db
          .delete(integrationsTable)
          .where(
            and(
              eq(integrationsTable.kind, "shopify"),
              eq(integrationsTable.externalAccount, resolvedShop),
            ),
          )
          .returning({ id: integrationsTable.id });
        logger.warn(
          { shopDomain, deletedCount: deleted.length },
          "shopify webhook: app/uninstalled — integration deleted",
        );
        return Response.json({ ok: true }, { status: 200 });
      }

      if (ORDER_TOPICS.has(topic)) {
        const [integration] = await db
          .select()
          .from(integrationsTable)
          .where(
            and(
              eq(integrationsTable.kind, "shopify"),
              eq(integrationsTable.externalAccount, shopDomain),
            ),
          );

        if (!integration) {
          req.log.warn({ shopDomain, topic }, "shopify webhook: no matching integration for shop");
          // Return 200 so Shopify doesn't retry for a store we've never seen
          return Response.json({ ok: true }, { status: 200 });
        }

        const payload = JSON.parse(rawBody.toString("utf8")) as ShopifyOrder;
        // A refunds/create payload is the REFUND, not the order it belongs to.
        // Its `order_id` is the thing to import, and importing the whole order
        // again is right: it carries every refund, and each one dedupes on its
        // own external ref.
        const orderId = (payload as ShopifyOrder & { order_id?: number }).order_id;
        if (topic === "refunds/create" && orderId == null) {
          req.log.warn({ shopDomain, topic }, "shopify webhook: refund without an order id");
          return Response.json({ ok: true }, { status: 200 });
        }

        const sourceId = await ensureIntegrationSource(integration);
        const order =
          topic === "refunds/create"
            ? await fetchOrderForRefund(integration, orderId!)
            : payload;

        if (!order) {
          // Nothing sensible to post. 200 rather than 500: retrying will not
          // make an order we cannot read appear.
          req.log.warn({ shopDomain, topic, orderId }, "shopify webhook: could not load the order");
          return Response.json({ ok: true }, { status: 200 });
        }

        const result = await importShopifyOrder(integration, sourceId, order);
        req.log.info(
          { shopDomain, topic, shopifyOrderId: order.id, ...result },
          "shopify webhook: order imported",
        );
        return Response.json({ ok: true }, { status: 200 });
      }

      // Unhandled topic — acknowledge so Shopify doesn't retry
      req.log.info({ topic, shopDomain }, "shopify webhook: unhandled topic (ignored)");
      return Response.json({ ok: true }, { status: 200 });
    } catch (err) {
      req.log.error({ err, topic, shopDomain }, "shopify webhook: processing error");
      // Return 500 so Shopify retries the delivery
      return Response.json({ error: "Internal processing error" }, { status: 500 });
    }
  });
}
