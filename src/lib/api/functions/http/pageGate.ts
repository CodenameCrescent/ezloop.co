import { NextResponse, type NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";
import { bypassRequested, resolveDevBypass } from "./devBypass";

/**
 * The page gate `src/proxy.ts` runs on every page request, client navigations
 * and prefetches included. Pages are signed-in only unless listed here, so a
 * new page is protected by default.
 *
 * This is the FIRST check, not the only one. It reads the signed session
 * cookie and nothing else — no database, because it runs on every navigation
 * and prefetch. A revoked, deleted or banned account still holds a valid
 * cookie; the layouts' `requireSignedIn()` and the API's auth guard check the
 * account's live state and refuse it there. Keep both: a proxy can be skipped
 * (CVE-2025-29927) or miss a path, and the layouts still hold.
 *
 * The API (`/api/*`) is not gated here: its guard answers 401 as JSON, which
 * is what a fetch wants, and a redirect would break it.
 */
export const PUBLIC_PAGES: ReadonlySet<string> = new Set([
  "/",
  "/sign-in",
  "/sign-up",
  "/forgot-password",
  "/reset-password",
  "/privacy",
  "/terms",
]);

/** Where a signed-out visitor lands. The same place `requireSignedIn()` sends them. */
export const SIGNED_OUT_HOME = "/";

export function isPublicPage(pathname: string): boolean {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  return PUBLIC_PAGES.has(path || "/");
}

/** A valid session cookie (or the fenced local dev bypass) — the optimistic check. */
export async function hasPageSession(request: NextRequest): Promise<boolean> {
  if (bypassRequested()) {
    // Same fences as `currentUserId()`; "off" falls through to the real cookie.
    const dev = await resolveDevBypass((name) => request.headers.get(name) ?? undefined);
    if (dev.kind === "user") return true;
    if (dev.kind === "refused") return false;
  }
  const token = await getToken({ req: request });
  return typeof token?.uid === "string" && token.uid.length > 0;
}

export async function gatePage(request: NextRequest): Promise<NextResponse> {
  if (isPublicPage(request.nextUrl.pathname)) return NextResponse.next();
  if (await hasPageSession(request)) return NextResponse.next();
  return NextResponse.redirect(new URL(SIGNED_OUT_HOME, request.url));
}
