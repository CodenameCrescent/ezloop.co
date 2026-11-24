import "server-only";
import { redirect } from "next/navigation";
import { cookies, headers } from "next/headers";
import { getToken } from "next-auth/jwt";
import { sessionAllowed, sessionStartMs } from "./auth/accountStatus";
import { bypassRequested, resolveDevBypass } from "./http/devBypass";

/** The signed-in Supabase user id, or null. */
export async function currentUserId(): Promise<string | null> {
  if (bypassRequested()) {
    // Same fences as the API (`devBypass.ts`); "off" falls through to real sign-in.
    const h = await headers();
    const dev = await resolveDevBypass((name) => h.get(name) ?? undefined);
    if (dev.kind === "user") return dev.userId;
    if (dev.kind === "refused") return null;
  }
  // The same check the API makes (guards.ts): the signed cookie, then the
  // account's live state — deleted, banned or revoked means signed out.
  const token = await getToken({ req: { cookies: await cookies(), headers: await headers() } as never });
  const userId = typeof token?.uid === "string" ? token.uid : null;
  if (!userId) return null;
  return (await sessionAllowed(userId, sessionStartMs(token))) ? userId : null;
}

/**
 * Sends a signed-out visitor to the front door. Called by every layout whose
 * pages need a session. `src/proxy.ts` redirects signed-out navigations first,
 * but only from the cookie; this is the full check (deleted, banned, revoked)
 * and the one that still holds if the proxy is skipped or misses a path.
 *
 * The API does not use this: its auth guard answers 401 as JSON, which is what
 * a fetch wants.
 */
export async function requireSignedIn(): Promise<void> {
  if (!(await currentUserId())) redirect("/");
}
