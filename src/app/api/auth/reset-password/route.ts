import type { NextRequest } from "next/server";
import { resetPassword as resetPasswordContract } from "@workspace/api-contract";
import { resetPasswordWithToken } from "@/lib/api/functions/auth/accounts";
import { handle } from "@/lib/api/functions/http/handler";

/** Sets the new password, proven by the token from the emailed link. */
export async function POST(request: NextRequest) {
  return handle(request, resetPasswordContract, { auth: false, write: true }, async ({ body }) => {
    await resetPasswordWithToken(body.accessToken, body.password);
    return { ok: true as const };
  });
}
