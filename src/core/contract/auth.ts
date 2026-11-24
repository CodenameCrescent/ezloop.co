import { z } from "zod";
import { defineEndpoint } from "./shared";

/**
 * Sign-up and password recovery. Signing in and out is NextAuth's own
 * `/api/auth/*` (callback, session, signout…), not part of this contract.
 *
 * All three answer `{ ok: true }` whether or not the email has an account, so
 * none of them can be used to find out who is a customer.
 */

const email = z.string().trim().toLowerCase().email().max(254);
// 72 is bcrypt's ceiling, which Supabase Auth hashes with.
const password = z.string().min(8, "Use at least 8 characters").max(72);

export const signUp = defineEndpoint({
  method: "POST",
  path: "/auth/sign-up",
  body: z.object({ name: z.string().trim().max(120).optional(), email, password }),
  response: z.object({ ok: z.literal(true) }),
});

export const requestPasswordReset = defineEndpoint({
  method: "POST",
  path: "/auth/forgot-password",
  body: z.object({ email }),
  response: z.object({ ok: z.literal(true) }),
});

export const resetPassword = defineEndpoint({
  method: "POST",
  path: "/auth/reset-password",
  /** `accessToken` is the recovery token Supabase put in the emailed link. */
  body: z.object({ accessToken: z.string().min(1).max(4096), password }),
  response: z.object({ ok: z.literal(true) }),
});
