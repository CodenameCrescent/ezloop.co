/**
 * Server code used only by `/api/integrations`. Shared code stays in
 * `src/lib/api/functions`. Server-only: nothing in components, views or the
 * client helpers may import this file.
 */
import crypto from "node:crypto";
import type { IntegrationShape } from "@workspace/api-contract";
import { integrationsTable } from "@workspace/db";
import type { ApiRequest } from "@/lib/api/functions/http/request";
import { shopifyFetch } from "@/lib/api/functions/integrations/shopify";
import { encryptToken, isEncrypted } from "@/lib/api/functions/lib/tokenCrypto";

// ── mappers ──────────────────────────────────────────────────

export function toApi(row: typeof integrationsTable.$inferSelect): IntegrationShape {
  return {
    id: row.id,
    kind: row.kind as IntegrationShape["kind"],
    displayName: row.displayName,
    externalAccount: row.externalAccount ?? null,
    connectedAt: row.connectedAt.toISOString(),
    lastSyncedAt: row.lastSyncedAt ? row.lastSyncedAt.toISOString() : null,
  };
}

export function maybeEncryptToken(token: string | null | undefined, kind: string): string | null {
  if (!token) return null;
  if (kind !== "shopify") return token;
  return isEncrypted(token) ? token : encryptToken(token);
}

// ── shopify-oauth ─────────────────────────────────────────────────

function getSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is not set");
  return secret;
}

export function normalizeShop(raw: string): string {
  return (
    raw
      .replace(/^https?:\/\//, "")
      .replace(/\/$/, "")
      .replace(/\.myshopify\.com$/, "") + ".myshopify.com"
  );
}

export function isValidShopHost(shop: string): boolean {
  return /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop);
}

/**
 * The signed round-trip now carries the BUSINESS as well as the user, because a
 * store connects to one set of books and the callback has no other way to know
 * which. It rides inside the HMAC-signed payload rather than as a query
 * parameter, so it cannot be swapped for someone else's on the way back — and
 * the callback re-checks ownership anyway before writing anything.
 */
export function makeState(userId: string, businessId: string, shop: string): string {
  const ts = Date.now().toString();
  const payload = `${userId}:${businessId}:${shop}:${ts}`;
  const sig = crypto
    .createHmac("sha256", getSecret())
    .update(payload)
    .digest("hex");
  return Buffer.from(`${payload}:${sig}`).toString("base64url");
}

export function parseState(state: string, userId: string): { shop: string; businessId: string } | null {
  try {
    const decoded = Buffer.from(state, "base64url").toString();
    const lastColon = decoded.lastIndexOf(":");
    const sig = decoded.slice(lastColon + 1);
    const payload = decoded.slice(0, lastColon);
    const parts = payload.split(":");
    if (parts.length < 4) return null;
    const [storedUser, businessId, shop, ts] = parts;
    if (storedUser !== userId) return null;
    if (Date.now() - Number(ts) > 10 * 60 * 1000) return null;
    const expected = crypto
      .createHmac("sha256", getSecret())
      .update(payload)
      .digest("hex");
    if (sig.length !== expected.length) return null;
    if (!crypto.timingSafeEqual(Buffer.from(sig, "hex"), Buffer.from(expected, "hex")))
      return null;
    return { shop, businessId };
  } catch {
    return null;
  }
}

export function verifyShopifyHmac(query: Record<string, string>, secret: string): boolean {
  const { hmac, ...rest } = query;
  if (!hmac) return false;
  const msg = Object.entries(rest)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  const expected = crypto.createHmac("sha256", secret).update(msg).digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(hmac, "hex"), Buffer.from(expected, "hex"));
  } catch {
    return false;
  }
}

export function buildCallbackUrl(req: ApiRequest): string {
  return `${req.origin}/api/integrations/shopify/oauth/callback`;
}

export function buildWebhookAddress(req: ApiRequest, path: string): string {
  return `${req.origin}/api${path}`;
}

/** Back to a screen, by absolute URL as a redirect requires. */
export function redirectTo(req: ApiRequest, to: string): Response {
  return Response.redirect(new URL(to, req.origin), 302);
}

const WEBHOOK_TOPICS = ["orders/create", "orders/updated", "app/uninstalled"] as const;

export async function subscribeWebhooks(
  shop: string,
  accessToken: string,
  webhookAddress: string,
  req: ApiRequest,
): Promise<void> {
  const headers = {
    "X-Shopify-Access-Token": accessToken,
    "Content-Type": "application/json",
  };
  const url = `https://${shop}/admin/api/2024-10/webhooks.json`;

  for (const topic of WEBHOOK_TOPICS) {
    try {
      const resp = await shopifyFetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify({
          webhook: {
            topic,
            address: webhookAddress,
            format: "json",
          },
        }),
      });
      if (resp.ok) {
        const json = (await resp.json()) as { webhook?: { id?: number } };
        req.log.info(
          { shop, topic, webhookId: json.webhook?.id },
          "shopify oauth: webhook subscribed",
        );
      } else if (resp.status === 422) {
        // 422 = already subscribed — treat as success
        req.log.info({ shop, topic }, "shopify oauth: webhook already exists");
      } else {
        const body = await resp.text().catch(() => "");
        req.log.warn({ shop, topic, status: resp.status, body }, "shopify oauth: webhook subscribe failed");
      }
    } catch (err) {
      req.log.warn({ err, shop, topic }, "shopify oauth: webhook subscribe error");
    }
  }
}
