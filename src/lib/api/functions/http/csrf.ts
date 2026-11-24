import type { ApiRequest } from "./request";

/**
 * Cross-site request forgery guard for signed-in writes.
 *
 * The session is a cookie the browser attaches by itself, so a page on another
 * site could make your browser submit a write to this API. SameSite=Lax
 * already keeps the cookie off most cross-site POSTs; this is the second,
 * independent lock, and it also covers the local dev bypass (which uses no
 * cookie at all — a cross-site form to http://localhost would otherwise act as
 * the default dev account).
 *
 * A state-changing request (not GET/HEAD/OPTIONS) to a route that needs a
 * signed-in user is refused when the browser says it came from elsewhere:
 *
 *   - Fetch Metadata `Sec-Fetch-Site` is `cross-site` or `same-site` (a
 *     sibling subdomain is another site's code too). `same-origin` and `none`
 *     pass.
 *   - `Origin` is present and is not this host — including `Origin: null`
 *     (sandboxed frames, opaque redirects).
 *
 * A request carrying neither header is not from a browser page and is not a
 * forgery vector (it holds no victim's cookie), so it passes; every current
 * browser sends at least one of them on a cross-site write.
 *
 * Not applied to routes that authenticate independently of the session
 * (`auth: false` in `handle()`): the Shopify webhook (HMAC), the recurring job
 * (bearer token), sign-up / forgot / reset password (no session), health.
 * NextAuth's own `/api/auth/*` routes carry NextAuth's CSRF token.
 */

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function hostOf(value: string): string | null {
  try {
    return new URL(value).host.toLowerCase();
  } catch {
    return null;
  }
}

/** Null to let the request through, or the 403 to answer with. */
export function crossSiteRefusal(req: ApiRequest): Response | null {
  if (SAFE_METHODS.has(req.method)) return null;

  const site = req.get("sec-fetch-site")?.trim().toLowerCase();
  const origin = req.get("origin")?.trim();
  const host = req.get("host")?.trim().toLowerCase();

  const crossBySite = site === "cross-site" || site === "same-site";
  const crossByOrigin = origin !== undefined && origin !== "" && (origin === "null" || !host || hostOf(origin) !== host);

  if (!crossBySite && !crossByOrigin) return null;
  req.log.warn({ site, originHost: origin ? hostOf(origin) : null }, "cross-site write refused");
  return Response.json(
    { error: { code: "cross_site_request", message: "This request came from another site and was refused." } },
    { status: 403 },
  );
}
