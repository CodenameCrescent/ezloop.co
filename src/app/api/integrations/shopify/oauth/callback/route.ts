import type { NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { db, integrationsTable } from "@workspace/db";
import { redirectTo, normalizeShop, isValidShopHost, parseState, verifyShopifyHmac, buildWebhookAddress, subscribeWebhooks } from "../../../functions";
import type { AuthedRequest } from "@/lib/api/functions/http/guards";
import { CONNECTORS } from "@/lib/api/functions/integrations/connectors";
import { shopifyFetch } from "@/lib/api/functions/integrations/shopify";
import { encryptToken } from "@/lib/api/functions/lib/tokenCrypto";
import { uid } from "@/lib/api/functions/lib/uid";
import { getBusinessForUser } from "@/lib/api/functions/services/business";
import { handleRaw } from "@/lib/api/functions/http/handler";

export async function GET(request: NextRequest) {
  return handleRaw(request, { business: false, write: true }, async (req) => {
      const clientId = process.env.SHOPIFY_CLIENT_ID;
      const clientSecret = process.env.SHOPIFY_CLIENT_SECRET;
      if (!clientId || !clientSecret) {
        return redirectTo(req, "/integrations?error=not_configured");
      }
      const { userId } = req as AuthedRequest;
      const query = req.query as Record<string, string>;
      const { code, shop, state } = query;

      const normalizedCallbackShop = normalizeShop(shop ?? "");
      if (!isValidShopHost(normalizedCallbackShop)) {
        req.log.warn({ userId, shop }, "shopify oauth: invalid shop in callback");
        return redirectTo(req, "/integrations?error=invalid_state");
      }
      const parsed = parseState(state, userId);
      if (!parsed) {
        req.log.warn({ userId }, "shopify oauth: invalid state");
        return redirectTo(req, "/integrations?error=invalid_state");
      }
      if (normalizedCallbackShop !== parsed.shop) {
        req.log.warn({ userId, shop, stateShop: parsed.shop }, "shopify oauth: shop mismatch");
        return redirectTo(req, "/integrations?error=invalid_state");
      }
      if (!verifyShopifyHmac(query, clientSecret)) {
        req.log.warn({ userId, shop }, "shopify oauth: invalid hmac");
        return redirectTo(req, "/integrations?error=invalid_hmac");
      }

      let accessToken: string;
      try {
        const resp = await shopifyFetch(`https://${shop}/admin/oauth/access_token`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code }),
        });
        if (!resp.ok) throw new Error(`status ${resp.status}`);
        const json = (await resp.json()) as { access_token: string };
        accessToken = json.access_token;
      } catch (err) {
        req.log.error({ err, userId, shop }, "shopify oauth: token exchange failed");
        return redirectTo(req, "/integrations?error=token_exchange_failed");
      }

      // The business came back inside the signed state, but it is re-checked
      // against the caller before a token is written: a signature proves the
      // value was ours when it left, not that it is still theirs now.
      const business = await getBusinessForUser(userId, parsed.businessId);
      if (!business) {
        req.log.warn({ userId, businessId: parsed.businessId }, "shopify oauth: business not owned");
        return redirectTo(req, "/integrations?error=invalid_state");
      }

      try {
        const [existing] = await db
          .select()
          .from(integrationsTable)
          .where(and(eq(integrationsTable.businessId, business.id), eq(integrationsTable.kind, "shopify")));

        const encryptedToken = encryptToken(accessToken);
        if (existing) {
          await db
            .update(integrationsTable)
            .set({ externalAccount: shop, accessToken: encryptedToken })
            .where(eq(integrationsTable.id, existing.id));
        } else {
          await db.insert(integrationsTable).values({
            id: uid("int"),
            userId,
            businessId: business.id,
            kind: "shopify",
            displayName: CONNECTORS.shopify.displayName,
            externalAccount: shop,
            accessToken: encryptedToken,
          });
        }
      } catch (err) {
        req.log.error({ err, userId }, "shopify oauth: db upsert failed");
        return redirectTo(req, "/integrations?error=db_error");
      }

      // Subscribe to required Shopify webhooks after storing the token
      const webhookAddress = buildWebhookAddress(req, "/webhooks/shopify");
      await subscribeWebhooks(shop, accessToken, webhookAddress, req);

      return redirectTo(req, "/integrations?connected=shopify");
    });
}
