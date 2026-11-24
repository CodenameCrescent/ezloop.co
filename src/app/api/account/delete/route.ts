import type { NextRequest } from "next/server";
import { deleteAccount as deleteAccountContract } from "@workspace/api-contract";
import type { AuthedRequest } from "@/lib/api/functions/http/guards";
import { looksLikeRealUserId } from "@/lib/devAccounts";
import { deleteAuthUser } from "@/lib/api/functions/auth/accounts";
import { forgetAccountStatus } from "@/lib/api/functions/auth/accountStatus";
import { logger } from "@/lib/api/functions/lib/logger";
import { deleteAccountData } from "../functions";
import { ServiceError } from "@/lib/api/functions/services/errors";
import { handle } from "@/lib/api/functions/http/handler";

/**
 * The account, not a business — so it sits outside the business gate, beside
 * the business list. Deleting it takes every business the person owns.
 */
export async function POST(request: NextRequest) {
  return handle(request, deleteAccountContract, { business: false, write: true }, async ({ req }) => {
    const userId = (req as AuthedRequest).userId;
    const { businessesDeleted } = await deleteAccountData(userId);
    logger.info({ businessesDeleted }, "account deleted");

    // Only a real account (a Supabase user id) has a sign-in to remove; the
    // development accounts used under the local bypass have none.
    if (looksLikeRealUserId(userId)) {
      try {
        await deleteAuthUser(userId);
        forgetAccountStatus(userId);
      } catch (err) {
        // The records are already gone. Saying so matters: "something went
        // wrong" would leave the owner wondering whether their books survived.
        // Trying again is safe — there is nothing left to delete but the sign-in.
        logger.error({ err }, "account data deleted but the Supabase user could not be removed");
        throw new ServiceError(
          "unavailable",
          "Your records are deleted, but we could not close your sign-in. Please try again.",
        );
      }
    }
    return { ok: true as const };
  });
}
