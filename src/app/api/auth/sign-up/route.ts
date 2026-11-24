import type { NextRequest } from "next/server";
import { signUp as signUpContract } from "@workspace/api-contract";
import { signUpWithPassword } from "@/lib/api/functions/auth/accounts";
import { handle } from "@/lib/api/functions/http/handler";

/** Creates the account; Supabase emails the verification link. */
export async function POST(request: NextRequest) {
  return handle(request, signUpContract, { auth: false, write: true }, async ({ req, body }) => {
    await signUpWithPassword(body, req.origin);
    return { ok: true as const };
  });
}
