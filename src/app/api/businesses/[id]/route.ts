import type { NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { updateBusiness as updateBusinessContract } from "@workspace/api-contract";
import { db, businessesTable } from "@workspace/db";
import { toApi } from "../functions";
import type { AuthedRequest } from "@/lib/api/functions/http/guards";
import * as businesses from "@/lib/api/functions/services/business";
import { ServiceError } from "@/lib/api/functions/services/errors";
import { handle } from "@/lib/api/functions/http/handler";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(request, updateBusinessContract, { business: false, write: true, params }, async ({ req, params, body }) => {
    const userId = (req as AuthedRequest).userId;
    // The same not-found-never-forbidden rule the middleware applies: a
    // business that isn't yours is a business that isn't there.
    const existing = await businesses.getBusinessForUser(userId, params.id);
    if (!existing) throw new ServiceError("not_found", "That business could not be found.");

    // Archiving the last one open would leave the owner with nothing to switch
    // to and a switcher that refuses every choice. Refuse it here instead.
    if (body.archived === true && existing.archivedAt === null) {
      const open = await businesses.listBusinesses(userId);
      if (open.length <= 1) {
        throw new ServiceError(
          "last_business",
          "This is your only business. Make another one before archiving this.",
        );
      }
    }

    const [updated] = await db
      .update(businessesTable)
      .set({
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.currency !== undefined ? { baseCurrency: body.currency } : {}),
        ...(body.currencySymbol !== undefined ? { currencySymbol: body.currencySymbol } : {}),
        ...(body.archived !== undefined ? { archivedAt: body.archived ? new Date() : null } : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(businessesTable.id, params.id), eq(businessesTable.userId, userId)))
      .returning();
    return toApi(updated);
  });
}
