/**
 * The caller's IP address — ONLY when a trusted proxy put it there.
 *
 * Forwarding headers are whatever the client sends unless a proxy in front of
 * us overwrites them. Next does not show route code the socket, and it fills
 * `x-forwarded-for` only when the client did not, so outside a known platform
 * an "IP" from a header is the attacker's choice — useless as a rate-limit key
 * and worse (they could aim it at someone else's address).
 *
 * Trusted: a production Vercel Function, which writes the client's address
 * into these headers itself. Everywhere else this returns null and callers
 * fall back to limits that do not need an IP.
 *
 * `VERCEL=1` alone is not enough: it is an ordinary variable that ends up in
 * `.env` files (`vercel env pull`, copied configs). Trust also needs
 *   - NODE_ENV=production — `next dev` is never trusted, whatever its env;
 *   - VERCEL_REGION set to a real region id (e.g. "iad1") — documented as
 *     exposed only at RUNTIME in Vercel Functions, so it is not in pulled env
 *     files; `vercel dev` leaves it empty or "dev1".
 * If any is missing on Vercel, header trust is simply off (fail safe).
 * Whoever controls the process environment can still set all three — no code
 * can tell a hand-made environment from the platform's.
 */

const IPV4 = /^(\d{1,3}\.){3}\d{1,3}$/;
const IPV6 = /^[0-9a-f:]+$/i;

function clean(value: string | undefined): string | null {
  const first = value?.split(",")[0]?.trim();
  if (!first) return null;
  return IPV4.test(first) || (first.includes(":") && IPV6.test(first)) ? first : null;
}

const VERCEL_REGION_ID = /^[a-z]{3}\d$/;

export function trustedProxyPlatform(env: NodeJS.ProcessEnv = process.env): boolean {
  const region = env.VERCEL_REGION?.trim() ?? "";
  return env.VERCEL === "1" && env.NODE_ENV === "production" && VERCEL_REGION_ID.test(region) && region !== "dev1";
}

/** The client IP from a trusted platform's headers, else null. `header` reads one header by lower-case name. */
export function trustedClientIp(header: (name: string) => string | undefined): string | null {
  if (!trustedProxyPlatform()) return null;
  return clean(header("x-vercel-forwarded-for")) ?? clean(header("x-real-ip")) ?? clean(header("x-forwarded-for"));
}
