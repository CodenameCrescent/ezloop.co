import type { NextRequest } from "next/server";
import { normalizeShop, isValidShopHost, makeState, buildCallbackUrl, redirectTo } from "../../../functions";
import { type AuthedRequest, businessOf } from "@/lib/api/functions/http/guards";
import { handleRaw } from "@/lib/api/functions/http/handler";

/**
 * The business guard runs on the start only: the callback below
 * is reached by Shopify redirecting the browser, which carries no header of
 * ours, so it recovers the business from the signed state instead.
 */
export async function GET(request: NextRequest) {
  return handleRaw(request, {}, (req) => {
      const clientId = process.env.SHOPIFY_CLIENT_ID;
      if (!clientId) {
        return Response.json({ error: "Shopify OAuth not configured." }, { status: 503 });
      }
      const { userId } = req as AuthedRequest;
      const rawShop = ((req.query.shop as string) ?? "").trim();
      if (!rawShop) {
        return Response.json({ error: "shop parameter required" }, { status: 400 });
      }
      const shop = normalizeShop(rawShop);
      if (!isValidShopHost(shop)) {
        return Response.json({ error: "Invalid shop URL. Must be a valid .myshopify.com domain." }, { status: 400 });
      }
      const state = makeState(userId, businessOf(req).id, shop);
      const authUrl = new URL(`https://${shop}/admin/oauth/authorize`);
      authUrl.searchParams.set("client_id", clientId);
      authUrl.searchParams.set("scope", "read_orders,read_products");
      authUrl.searchParams.set("redirect_uri", buildCallbackUrl(req));
      authUrl.searchParams.set("state", state);
      return redirectTo(req, authUrl.toString());
    });
}
