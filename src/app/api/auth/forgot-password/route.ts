import type { NextRequest } from "next/server";
import { requestPasswordReset as requestPasswordResetContract } from "@workspace/api-contract";
import { sendPasswordReset } from "@/lib/api/functions/auth/accounts";
import { handle } from "@/lib/api/functions/http/handler";

/** Emails a reset link. Answers the same whether or not the email has an account. */
export async function POST(request: NextRequest) {
  return handle(request, requestPasswordResetContract, { auth: false, write: true }, async ({ req, body }) => {
    await sendPasswordReset(body.email, req.origin);
    return { ok: true as const };
  });
}
