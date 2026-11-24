import type { NextRequest } from "next/server";
import { getOwed as getOwedContract } from "@workspace/api-contract";
import { type AuthedRequest, businessOf } from "@/lib/api/functions/http/guards";
import { computeOwed } from "@/lib/api/functions/services/owed";
import { handle } from "@/lib/api/functions/http/handler";

/**
 * Who owes you, and who you owe. Not period-scoped, and deliberately so: an
 * unpaid bill from March is exactly as outstanding today as one from last week,
 * and filtering by the screen's date range would hide the oldest debts — the
 * only ones that really matter.
 */
export async function GET(request: NextRequest) {
  return handle(request, getOwedContract, {}, async ({ req, query }) => {
    const userId = (req as AuthedRequest).userId;
    const business = businessOf(req);
    return computeOwed(business.id, userId, query.asOf ? new Date(query.asOf) : new Date());
  });
}
