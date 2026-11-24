/**
 * The ONLY user ids the local development bypass may act as.
 *
 * Shared by the sidebar's dev account switcher and the server's bypass check
 * (`src/lib/api/functions/http/devBypass.ts`), so the two cannot drift apart.
 * Plain data: safe to import from the browser.
 *
 * The database is shared with real accounts, so the bypass must never be able
 * to become one of them. Real accounts are Supabase user ids (UUIDs); none of
 * these is, and `looksLikeRealUserId` refuses anything that is.
 */
export const DEV_ACCOUNTS = [
  { id: "local-user", label: "Local user", hint: "The default developer account" },
  { id: "test-fashion", label: "Test user · fashion", hint: "Separate fashion dataset" },
  { id: "test-empty", label: "Test user · empty", hint: "Owns nothing — for the welcome flow" },
  { id: "test-wholesale", label: "Test user · wholesale", hint: "B2B / bulk order testing" },
  { id: "test-demo-seed", label: "Test user · demo seed", hint: "Use Settings to seed/reset here" },
] as const;

export const DEV_ACCOUNT_IDS: ReadonlySet<string> = new Set(DEV_ACCOUNTS.map((account) => account.id));

/** The account that owned everything before real sign-in existed — the only source `auth:claim` moves from. */
export const LEGACY_LOCAL_USER_ID = "local-user";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True for a Supabase auth user id — a real person's account. */
export function looksLikeRealUserId(id: string): boolean {
  return UUID.test(id.trim());
}

/** A development account the bypass and the dev scripts may act as. */
export function isDevAccountId(id: string): boolean {
  return DEV_ACCOUNT_IDS.has(id) && !looksLikeRealUserId(id);
}
