import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { unavailable } from "../services/errors";

/**
 * Supabase Auth is the user store: it holds emails, password hashes and
 * verification state, and sends the verification and reset emails. NextAuth
 * owns the session. The browser never talks to Supabase; only this server does.
 *
 * Both clients are stateless (no stored session): each call stands alone.
 */

const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };

function need(name: string): string {
  const value = process.env[name];
  if (!value) throw unavailable(`Sign-in is not set up yet (${name} is missing).`);
  return value;
}

let admin: SupabaseClient | null = null;

/**
 * Acts as the public: sign in, sign up, ask for a reset email.
 *
 * A NEW client every call. With `persistSession: false` supabase-js still
 * keeps the last signed-in session (and its refresh token) in that client's
 * memory, so one shared client would hold whoever signed in last — and any
 * later call made without an explicit token would act as them. A client is
 * cheap; a session that outlives its request is not.
 */
export function supabaseAnon(): SupabaseClient {
  return createClient(need("NEXT_PUBLIC_SUPABASE_URL"), need("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"), options);
}

/**
 * Bypasses every rule: create, update and delete users. Server only, never the
 * browser. Cached: admin calls carry the service key and never sign anyone in,
 * so there is no user session for it to hold.
 */
export function supabaseAdmin(): SupabaseClient {
  admin ??= createClient(need("NEXT_PUBLIC_SUPABASE_URL"), need("SUPABASE_SECRET_KEY"), options);
  return admin;
}
