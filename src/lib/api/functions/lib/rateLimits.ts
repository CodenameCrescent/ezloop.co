import type { ApiRequest } from "../http/request";

function makeKey(req: ApiRequest): string {
  if (req.userId) return `u:${req.userId}`;
  return `ip:${req.ip ?? "unknown"}`;
}

/**
 * Test seam. The isolation suite fires one request at EVERY contract endpoint
 * to prove none of them leaks, which is several times the per-minute budget —
 * so a limiter would make the security test fail for the wrong reason. Guarded
 * on NODE_ENV so it cannot be switched on in production by an env var alone.
 */
const rateLimitsDisabled = () =>
  process.env.NODE_ENV !== "production" && process.env.DISABLE_RATE_LIMIT === "true";

/**
 * A fixed one-minute window per key, held in this process's memory.
 *
 * Same budgets as the Express version (`express-rate-limit`, memory store), and
 * the same caveat: on Vercel each warm instance counts on its own, so this is a
 * brake on one runaway client, not a global quota. A shared store (Upstash,
 * Redis) is the upgrade when that stops being enough.
 */
function windowLimiter(limit: number, windowMs: number) {
  const hits = new Map<string, { count: number; resetAt: number }>();
  return (key: string): { ok: boolean; resetAt: number } => {
    const now = Date.now();
    let entry = hits.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      hits.set(key, entry);
      if (hits.size > 10_000) {
        for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k);
      }
    }
    entry.count++;
    return { ok: entry.count <= limit, resetAt: entry.resetAt };
  };
}

const WINDOW_MS = 60 * 1000;
const globalWindow = windowLimiter(120, WINDOW_MS);
const mutationWindow = windowLimiter(60, WINDOW_MS);

function tooMany(message: string, resetAt: number): Response {
  return Response.json(
    { error: message },
    { status: 429, headers: { "retry-after": String(Math.ceil((resetAt - Date.now()) / 1000)) } },
  );
}

/**
 * Every request, counted before its body is read — so an unauthenticated caller
 * cannot make the process buffer a 4 MB import body faster than this allows.
 */
export function globalRateLimit(req: ApiRequest): Response | null {
  if (rateLimitsDisabled()) return null;
  const verdict = globalWindow(makeKey(req));
  return verdict.ok ? null : tooMany("Too many requests — please slow down.", verdict.resetAt);
}

/** Writes, counted per signed-in user. */
export function mutationRateLimit(req: ApiRequest): Response | null {
  if (rateLimitsDisabled()) return null;
  const verdict = mutationWindow(makeKey(req));
  return verdict.ok ? null : tooMany("Too many write requests — please slow down.", verdict.resetAt);
}
