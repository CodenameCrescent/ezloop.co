import { pool } from "@workspace/db";
import { logger } from "../lib/logger";
import { invalid, unavailable } from "../services/errors";
import { revokeSessionsBefore } from "./accountStatus";
import { clearEmailFailures } from "./signInLimits";
import { supabaseAdmin, supabaseAnon } from "./supabase";

/**
 * Everything the app asks of Supabase Auth. The user id everywhere in the app
 * (`owner_user_id`, `created_by`…) is the Supabase `auth.users.id`, whichever
 * way the person signed in.
 */

export interface AuthUser {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
}

export class EmailNotVerified extends Error {
  constructor() {
    super("EMAIL_NOT_VERIFIED");
  }
}

/** Supabase could not answer (outage, its own rate limit). Not the user's mistake — never counted as a failed password. */
export class SignInUnavailable extends Error {
  constructor() {
    super("SIGNIN_UNAVAILABLE");
  }
}

/** Where the emailed links come back to. NEXTAUTH_URL when set: a forwarded host header is the caller's to forge. */
export function appOrigin(requestOrigin: string): string {
  return (process.env.NEXTAUTH_URL ?? requestOrigin).replace(/\/+$/, "");
}

function nameOf(metadata: Record<string, unknown> | undefined): string | null {
  const name = metadata?.full_name ?? metadata?.name;
  return typeof name === "string" && name.trim() ? name.trim() : null;
}

/**
 * Email + password. Null for a wrong email or password: the two answer the
 * same, so the form cannot be used to test which emails have accounts.
 */
export async function passwordSignIn(email: string, password: string): Promise<AuthUser | null> {
  const { data, error } = await supabaseAnon().auth.signInWithPassword({ email, password });
  if (error) {
    if (error.code === "email_not_confirmed") throw new EmailNotVerified();
    if (error.code === "invalid_credentials") return null;
    logger.error({ code: error.code, status: error.status }, "supabase sign-in failed");
    throw new SignInUnavailable();
  }
  const user = data.user;
  if (!user.email_confirmed_at) throw new EmailNotVerified();
  return {
    id: user.id,
    email: user.email ?? email,
    name: nameOf(user.user_metadata),
    image: typeof user.user_metadata?.avatar_url === "string" ? user.user_metadata.avatar_url : null,
  };
}

/**
 * Creates the account and has Supabase send the verification email. An email
 * that already has an account gets the same answer (Supabase sends nothing and
 * reports success), so sign-up does not reveal who is a customer either.
 */
export async function signUpWithPassword(input: { name?: string; email: string; password: string }, origin: string): Promise<void> {
  const { error } = await supabaseAnon().auth.signUp({
    email: input.email,
    password: input.password,
    options: {
      emailRedirectTo: `${appOrigin(origin)}/sign-in?verified=1`,
      data: input.name ? { full_name: input.name } : undefined,
    },
  });
  if (!error) return;
  if (error.code === "weak_password") throw invalid("Choose a stronger password.");
  if (error.code === "over_email_send_rate_limit") throw unavailable("Too many emails just now. Please try again in a few minutes.");
  logger.error({ code: error.code, status: error.status }, "supabase sign-up failed");
  throw unavailable("We could not create your account just now. Please try again.");
}

export async function sendPasswordReset(email: string, origin: string): Promise<void> {
  const { error } = await supabaseAnon().auth.resetPasswordForEmail(email, {
    redirectTo: `${appOrigin(origin)}/reset-password`,
  });
  // Any failure but a rate limit answers "sent": saying otherwise would tell
  // the caller whether the email exists.
  if (error?.code === "over_email_send_rate_limit") {
    throw unavailable("Too many emails just now. Please try again in a few minutes.");
  }
  if (error) logger.warn({ code: error.code, status: error.status }, "supabase reset email failed");
}

/** How long after the email link was used a reset may still be completed. Supabase's link itself expires sooner by default (1 hour). */
const RECOVERY_SESSION_MAX_AGE_MS = 60 * 60 * 1000;
/** Allowance for clock difference between Supabase and this server. */
const CLOCK_SKEW_MS = 5 * 60 * 1000;
/**
 * The ways a session can come from clicking an emailed link — exactly the set
 * Supabase Auth itself treats as recovery (`AuthenticationMethod.IsRecovery()`
 * in supabase/auth). In the implicit flow this app uses, a recovery link and a
 * magic-link sign-in both record "otp" and share `recovery_token` /
 * `recovery_sent_at`, so no token claim can tell them apart. That is accepted:
 * both prove control of the inbox, which is what a reset requires. A password
 * or OAuth session — what a stolen ordinary session would be — is refused.
 */
const EMAIL_LINK_METHODS = new Set(["otp", "recovery", "magiclink"]);

/**
 * True only for a session minted by a password-recovery link: it was made by
 * an emailed link (its `amr`), recently, and AFTER this user's latest
 * recovery email was sent (`recovery_sent_at`, set by Supabase when it sends
 * one). Any other session the user might hold — e.g. from signing in — is
 * refused, so a stolen ordinary session cannot change the password.
 *
 * The token's signature was already checked by Supabase (`getUser`); this only
 * reads its claims. Anything missing or unexpected fails closed.
 */
export function isRecoverySession(accessToken: string, recoverySentAt: string | undefined | null, now = Date.now()): boolean {
  if (!recoverySentAt) return false;
  const sentAt = Date.parse(recoverySentAt);
  if (!Number.isFinite(sentAt)) return false;
  let claims: { amr?: unknown };
  try {
    claims = JSON.parse(Buffer.from(accessToken.split(".")[1] ?? "", "base64url").toString("utf8"));
  } catch {
    return false;
  }
  if (!Array.isArray(claims.amr)) return false;
  return claims.amr.some((entry) => {
    const method = typeof entry === "string" ? entry : (entry as { method?: unknown })?.method;
    const timestamp = typeof entry === "object" && entry ? (entry as { timestamp?: unknown }).timestamp : undefined;
    if (typeof method !== "string" || !EMAIL_LINK_METHODS.has(method)) return false;
    if (typeof timestamp !== "number") return false;
    const at = timestamp * 1000;
    return at >= sentAt - CLOCK_SKEW_MS && now - at <= RECOVERY_SESSION_MAX_AGE_MS && at <= now + CLOCK_SKEW_MS;
  });
}

/** Sets a new password. The token is the one Supabase put in the reset link, which proves the email. */
export async function resetPasswordWithToken(accessToken: string, password: string): Promise<void> {
  const { data, error } = await supabaseAnon().auth.getUser(accessToken);
  if (error || !data.user) throw invalid("This reset link has expired. Ask for a new one.");
  // Supabase has verified the token; now make sure it is a RECOVERY session,
  // not just any session for this user.
  if (!isRecoverySession(accessToken, data.user.recovery_sent_at)) {
    throw invalid("This reset link has expired. Ask for a new one.");
  }
  // Sign out every other device FIRST. If the password change below then
  // fails, the worst case is being signed out — never an old session that
  // outlives a reset (the point of resetting after a suspected break-in).
  try {
    await revokeSessionsBefore(data.user.id);
  } catch (err) {
    logger.error({ err }, "could not revoke sessions before a password reset");
    throw unavailable("We could not change your password just now. Please try again.");
  }
  const updated = await supabaseAdmin().auth.admin.updateUserById(data.user.id, { password });
  // Proven the inbox: the account-wide failure count starts again.
  if (!updated.error && data.user.email) clearEmailFailures(data.user.email);
  if (updated.error) {
    if (updated.error.code === "weak_password") throw invalid("Choose a stronger password.");
    if (updated.error.code === "same_password") throw invalid("Choose a password you haven't used here before.");
    logger.error({ code: updated.error.code }, "supabase password update failed");
    throw unavailable("We could not change your password just now. Please try again.");
  }
}

/**
 * Why an OAuth sign-in was not linked to an existing account. The code reaches
 * the sign-in page as `?error=<code>` (AuthForms.tsx says what to do).
 */
export class OAuthLinkRefused extends Error {
  constructor(readonly code: "OAUTH_EMAIL_UNVERIFIED" | "OAUTH_ACCOUNT_UNCONFIRMED" | "OAUTH_ACCOUNT_UNAVAILABLE") {
    super(code);
  }
}

type AdminCreate = Pick<ReturnType<typeof supabaseAdmin>["auth"]["admin"], "createUser">;
type FindByEmail = (email: string) => Promise<Array<{ id: string; confirmed: boolean; deleted: boolean }>>;

const findAuthUsersByEmail: FindByEmail = async (email) =>
  (
    await pool.query<{ id: string; confirmed: boolean; deleted: boolean }>(
      `SELECT id, email_confirmed_at IS NOT NULL AS confirmed, deleted_at IS NOT NULL AS deleted
         FROM auth.users WHERE lower(email) = $1 LIMIT 2`,
      [email],
    )
  ).rows;

/**
 * The Supabase user for someone who signed in with Google (or another OAuth
 * provider), created on their first visit.
 *
 * Linking is by email, which is only safe when BOTH sides have proven it:
 *
 *   - the provider says the address is verified (`emailVerified`) — otherwise
 *     anyone could claim any address at a provider that does not check;
 *   - an existing account has CONFIRMED that address. An unconfirmed account
 *     may have been created by someone else typing your email with their own
 *     password; linking you into it would hand them your books the moment the
 *     confirmation link is clicked. It is refused, never "repaired" — the
 *     existing record is not modified in any way.
 *
 * A soft-deleted account, or two accounts sharing the address, are refused too.
 * `findByEmail` and `admin` are test seams.
 */
export async function findOrCreateOAuthUser(
  input: { email: string; emailVerified: boolean; name: string | null; image: string | null; provider: string },
  findByEmail: FindByEmail = findAuthUsersByEmail,
  admin: AdminCreate = supabaseAdmin().auth.admin,
): Promise<string> {
  if (!input.emailVerified) throw new OAuthLinkRefused("OAUTH_EMAIL_UNVERIFIED");
  const email = input.email.trim().toLowerCase();

  const found = await findByEmail(email);
  if (found.length > 1) throw new OAuthLinkRefused("OAUTH_ACCOUNT_UNAVAILABLE");
  const existing = found[0];
  if (existing) {
    if (existing.deleted) throw new OAuthLinkRefused("OAUTH_ACCOUNT_UNAVAILABLE");
    if (!existing.confirmed) throw new OAuthLinkRefused("OAUTH_ACCOUNT_UNCONFIRMED");
    return existing.id;
  }

  const { data, error } = await admin.createUser({
    email,
    email_confirm: true, // the provider verified it (checked above)
    user_metadata: { full_name: input.name ?? undefined, avatar_url: input.image ?? undefined, provider: input.provider },
  });
  if (error || !data.user) {
    logger.error({ code: error?.code }, "supabase oauth user create failed");
    throw new Error("Could not create the account");
  }
  return data.user.id;
}

/** Removes the sign-in. The account's records are deleted separately, before this. */
export async function deleteAuthUser(userId: string): Promise<void> {
  const { error } = await supabaseAdmin().auth.admin.deleteUser(userId);
  // Already gone counts as done: a retry after a half-finished delete must succeed.
  if (error && error.status !== 404) throw error;
}
