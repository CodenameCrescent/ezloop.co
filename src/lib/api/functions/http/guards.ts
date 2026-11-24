import type { Business } from "@workspace/db";
import type { GatedFeature } from "@workspace/domain";
import { loadBusinessCapabilities } from "../lib/settingsShape";
import { getBusinessForUser, listBusinesses } from "../services/business";
import { sessionAllowed, sessionStartMs } from "../auth/accountStatus";
import { resolveDevBypass } from "./devBypass";
import type { ApiRequest, AuthedRequest, BusinessRequest } from "./request";

/**
 * The checks a request passes before its handler runs. Each returns `null` to
 * let the request through, or the `Response` to answer with instead.
 */

const SAFE_ID = /^[a-zA-Z0-9_-]{1,64}$/;

export const BUSINESS_HEADER = "x-profit-loop-business-id";

function parseCookies(header: string | undefined): Map<string, string> {
  const cookies = new Map<string, string>();
  for (const part of header?.split(";") ?? []) {
    const eq = part.indexOf("=");
    if (eq < 1) continue;
    const name = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    try {
      cookies.set(name, decodeURIComponent(value));
    } catch {
      cookies.set(name, value);
    }
  }
  return cookies;
}

/** Who is asking. Sets `req.userId`. */
export async function authenticate(req: ApiRequest): Promise<Response | null> {
  // Local development only, behind every fence in `devBypass.ts`.
  const dev = await resolveDevBypass((name) => req.get(name));
  if (dev.kind === "user") {
    req.userId = dev.userId;
    return null;
  }
  if (dev.kind === "refused") {
    return Response.json({ error: { code: "dev_bypass_refused", message: dev.reason } }, { status: 401 });
  }

  // Imported here, not at the top, so the integration tests (which run
  // outside Next under the test-harness bypass) never load NextAuth. The session is
  // NextAuth's signed JWT cookie; `uid` in it is the Supabase user id.
  const { getToken } = await import("next-auth/jwt");
  const token = await getToken({ req: { headers: req.headers, cookies: parseCookies(req.get("cookie")) } as never });
  const userId = typeof token?.uid === "string" ? token.uid : undefined;
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });
  // A valid signature is not enough: the account must still exist, not be
  // deleted or banned, and this session must not have been revoked.
  if (!(await sessionAllowed(userId, sessionStartMs(token)))) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  req.userId = userId;
  return null;
}

/**
 * Resolves WHICH set of books this request is about, and proves the caller owns
 * them. Sets `req.business`.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 *
 * A user used to own exactly one business, so scoping was implicit. Many
 * businesses per user means the business id now arrives FROM THE CLIENT, and a
 * client-supplied key that reaches money is a door. This guard is that door,
 * and it is the only one — no route resolves a business for itself.
 *
 * ── Not found, never forbidden ──────────────────────────────────────────────
 *
 * An id that exists but belongs to someone else answers exactly like an id that
 * does not exist: 404. A 403 would confirm the row is real, which turns this
 * endpoint into a free directory of other people's businesses.
 *
 * ── The single-business fallback ────────────────────────────────────────────
 *
 * When the header is absent the request is NOT guessed at, with one exception
 * that is not a guess: a user who owns exactly one business has only one
 * possible answer, so it is used. Zero businesses and two-or-more both refuse
 * with `business_required` — the first because there is nothing to open, the
 * second because choosing for them would silently write money into the wrong
 * books. Both send the screens to the businesses page.
 */
export async function resolveBusiness(req: ApiRequest): Promise<Response | null> {
  const { userId } = req as AuthedRequest;
  const requested = req.get(BUSINESS_HEADER)?.trim();

  if (requested) {
    // A malformed id is treated as a wrong id, not as a bad request: the
    // answer to "is this yours" is no either way.
    const business = SAFE_ID.test(requested) ? await getBusinessForUser(userId, requested) : null;
    if (!business) {
      return Response.json(
        { error: { code: "business_not_found", message: "That business could not be found." } },
        { status: 404 },
      );
    }
    req.business = business;
    return null;
  }

  const owned = await listBusinesses(userId);
  if (owned.length === 1) {
    req.business = owned[0];
    return null;
  }

  return Response.json(
    {
      error: {
        code: "business_required",
        message: owned.length === 0 ? "You don't have a business yet." : "Choose which business this is for.",
      },
    },
    { status: 400 },
  );
}

/**
 * Refuses a request when the business has a gated feature switched off.
 *
 * Hiding a nav entry is not gating: without this anyone could reach a hidden
 * feature by typing its URL. 403, not 404 — the endpoint exists and the owner
 * can turn it on in Settings; pretending it isn't there would send them
 * hunting for a bug.
 */
export function checkFeature(req: ApiRequest, feature: GatedFeature): Response | null {
  const { features } = loadBusinessCapabilities(businessOf(req));
  if (features[feature]) return null;
  return Response.json(
    {
      error: {
        code: "feature_disabled",
        message: "This is turned off for your business. You can switch it on in Settings.",
      },
    },
    { status: 403 },
  );
}

/**
 * The business this request is about. Throws rather than returning undefined,
 * because a handler reaching this without the guard is a wiring bug that must
 * not degrade into an unscoped query.
 */
export function businessOf(req: ApiRequest): Business {
  const business = (req as BusinessRequest).business;
  if (!business) {
    throw new Error("businessOf: the business guard did not run on this route");
  }
  return business;
}

export type { AuthedRequest, BusinessRequest };
