/**
 * Server code used only by `/api/jobs`. Shared code stays in
 * `src/lib/api/functions`. Server-only: nothing in components, views or the
 * client helpers may import this file.
 */
import crypto from "node:crypto";
import type { ApiRequest } from "@/lib/api/functions/http/request";
import { runRecurringJob } from "@/lib/api/functions/services/recurringJob";

// ── mappers ──────────────────────────────────────────────────────────

/**
 * Authenticated HTTP trigger for the recurring job so a cron / uptime pinger
 * can drive it: /api/jobs/recurring with
 * `Authorization: Bearer <RECURRING_JOB_TOKEN>` (header only). The token is
 * required everywhere, including local development: the job posts into every
 * business in the (shared) database. `npm run job:recurring` runs it locally
 * without HTTP. Idempotent — a double ping is safe.
 *
 * `CRON_SECRET` is accepted as well as `RECURRING_JOB_TOKEN` because that is
 * the name Vercel's scheduler uses: set it there and Vercel signs its own
 * nightly request with it, so the deployment needs one secret rather than two
 * that must be kept identical.
 */
function authorized(req: ApiRequest): boolean {
  const accepted = [process.env.RECURRING_JOB_TOKEN, process.env.CRON_SECRET].filter(
    (value): value is string => !!value,
  );
  if (accepted.length === 0) return false;
  // Header only: a token in the query string ends up in access logs and
  // browser history. Vercel's cron sends exactly this header.
  const header = req.get("authorization");
  const provided = header?.startsWith("Bearer ") ? header.slice(7) : undefined;
  if (!provided) return false;
  // Constant time: compare fixed-length digests, so neither the length nor the
  // first differing character leaks through timing.
  const digest = (value: string) => crypto.createHash("sha256").update(value).digest();
  const got = digest(provided);
  let ok = false;
  for (const token of accepted) ok = crypto.timingSafeEqual(got, digest(token)) || ok;
  return ok;
}

export async function runRecurring(req: ApiRequest): Promise<Response> {
  if (!authorized(req)) {
    return Response.json({ error: { code: "unauthorized", message: "Invalid job token" } }, { status: 401 });
  }
  try {
    return Response.json(await runRecurringJob(new Date()));
  } catch (err) {
    req.log.error({ err }, "recurring job failed");
    return Response.json({ error: { code: "internal", message: "Recurring job failed" } }, { status: 500 });
  }
}

/** Token-authed rather than session-authed, so the session guards are off. */
export const JOB_OPTIONS = { auth: false, write: true } as const;
