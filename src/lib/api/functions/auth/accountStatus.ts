import { pool } from "@workspace/db";
import { looksLikeRealUserId } from "@/lib/devAccounts";
import { logger } from "../lib/logger";
import { unavailable } from "../services/errors";
import { supabaseAdmin } from "./supabase";

/**
 * Is the account behind a session still allowed in?
 *
 * The session is a signed NextAuth cookie that lives 30 days and is checked
 * without a database: on its own it would keep working after the account is
 * deleted, banned, or has its password reset. This reads the account's real
 * state from Supabase Auth's own table and refuses the session when:
 *
 *   - the user no longer exists (Supabase hard delete removes the row);
 *   - `deleted_at` is set (Supabase soft delete);
 *   - `banned_until` is in the future (Supabase ban; `ban_duration: "none"`
 *     clears it, and a past date means the ban is over);
 *   - the session began before `app_metadata.sessions_valid_after` — written
 *     when the password is reset, so every OTHER device is signed out.
 *
 * Cost: one primary-key read of `auth.users` per user per TTL, per server
 * instance — not one per request. Revocation therefore takes effect within
 * TTL_MS on every instance (immediately on the one that made the change, which
 * calls `forgetAccountStatus`). Development and test accounts (not Supabase
 * UUIDs) never reach here: the dev bypass answers before any session is read.
 */

export const ACCOUNT_STATUS_TTL_MS = 60_000;
const MAX_CACHED = 10_000;

interface Status {
  active: boolean;
  /** Sessions that began before this instant (ms) are revoked. */
  validAfterMs: number | null;
  checkedAt: number;
}

const cache = new Map<string, Status>();

async function readStatus(userId: string): Promise<Status> {
  const now = Date.now();
  // Not a Supabase id: there is no such account (and the cast below would fail).
  if (!looksLikeRealUserId(userId)) return { active: false, validAfterMs: null, checkedAt: now };
  const { rows } = await pool.query<{ deleted_at: Date | null; banned_until: Date | null; valid_after: string | null }>(
    `SELECT deleted_at, banned_until, raw_app_meta_data->>'sessions_valid_after' AS valid_after
       FROM auth.users WHERE id = $1::uuid`,
    [userId],
  );
  const row = rows[0];
  if (!row) return { active: false, validAfterMs: null, checkedAt: now };
  const banned = row.banned_until !== null && row.banned_until.getTime() > now;
  const validAfter = row.valid_after ? Date.parse(row.valid_after) : NaN;
  return {
    active: row.deleted_at === null && !banned,
    validAfterMs: Number.isFinite(validAfter) ? validAfter : null,
    checkedAt: now,
  };
}

async function statusOf(userId: string): Promise<Status> {
  const hit = cache.get(userId);
  if (hit && Date.now() - hit.checkedAt < ACCOUNT_STATUS_TTL_MS) return hit;
  let status: Status;
  try {
    status = await readStatus(userId);
  } catch (err) {
    // Cannot tell: refuse with "try again", never let the session through blind.
    logger.error({ err }, "account status check failed");
    throw unavailable("We could not check your account just now. Please try again.");
  }
  if (cache.size >= MAX_CACHED) cache.clear();
  cache.set(userId, status);
  return status;
}

/** The moment a session began, in ms: our `authTime` claim, else the token's `iat` (sessions from before it existed). */
export function sessionStartMs(token: { authTime?: unknown; iat?: unknown } | null | undefined): number {
  if (typeof token?.authTime === "number") return token.authTime;
  if (typeof token?.iat === "number") return token.iat * 1000;
  return 0;
}

/** True when this user's account is active and this session was not revoked. */
export async function sessionAllowed(userId: string, sessionStartedMs: number): Promise<boolean> {
  const status = await statusOf(userId);
  if (!status.active) return false;
  return status.validAfterMs === null || sessionStartedMs >= status.validAfterMs;
}

/** Drop the cached verdict — after this instance deletes, bans or revokes the account. */
export function forgetAccountStatus(userId: string): void {
  cache.delete(userId);
}

/** Test seam. */
export function clearAccountStatusCache(): void {
  cache.clear();
}

/**
 * Signs the user out everywhere: every session that began before now is
 * refused from the next check on.
 *
 * `app_metadata` is read first and written back WHOLE with one key added. The
 * Supabase types do not promise whether an update merges or replaces that
 * object, so this is correct either way and keeps Supabase's own keys
 * (`provider`, `providers`) intact. Only the service key can write it — the
 * user cannot clear it themselves.
 */
export async function revokeSessionsBefore(
  userId: string,
  at: Date = new Date(),
  /** Test seam: the Supabase admin API (the real one by default). */
  admin: Pick<ReturnType<typeof supabaseAdmin>["auth"]["admin"], "getUserById" | "updateUserById"> = supabaseAdmin().auth.admin,
): Promise<void> {
  const current = await admin.getUserById(userId);
  if (current.error || !current.data.user) throw current.error ?? new Error("User not found");
  const app_metadata = { ...(current.data.user.app_metadata ?? {}), sessions_valid_after: at.toISOString() };
  const updated = await admin.updateUserById(userId, { app_metadata });
  if (updated.error) throw updated.error;
  forgetAccountStatus(userId);
}
