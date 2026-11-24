import type { NextRequest } from "next/server";
import { getInsights as getInsightsContract } from "@workspace/api-contract";
import { type AuthedRequest, businessOf } from "@/lib/api/functions/http/guards";
import { computeInsights } from "../functions";
import { handle } from "@/lib/api/functions/http/handler";

/**
 * The insight feed. Orchestration only — every card, its money and its wording
 * come from the pure rule catalogue in `lib/domain`.
 */
export async function GET(request: NextRequest) {
  return handle(request, getInsightsContract, {}, async ({ req, query }) => {
    const userId = (req as AuthedRequest).userId;
    const business = businessOf(req);
    return computeInsights(
      business.id,
      userId,
      { start: new Date(query.startDate), end: new Date(query.endDate) },
      { start: new Date(query.priorStartDate), end: new Date(query.priorEndDate) },
      query.comparisonLabel ?? "This period vs the one before",
    );
  });
}
