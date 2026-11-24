import NextAuth from "next-auth";
import { authOptions } from "@/lib/api/functions/auth/options";

/**
 * NextAuth's own endpoints: sign in (credentials, Google), the OAuth callback,
 * session, CSRF and sign out. The one part of `/api` that does not go through
 * `handle()` — NextAuth checks its own CSRF token and signs its own cookie,
 * and nothing here reads a business or touches money.
 */
const handler = NextAuth(authOptions);

export { handler as GET, handler as POST };
