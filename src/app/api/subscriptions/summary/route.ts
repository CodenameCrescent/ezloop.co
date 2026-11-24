import type { NextRequest } from "next/server";
import { getSubscriptionSummary as summaryContract } from "@workspace/api-contract";
import { businessOf } from "@/lib/api/functions/http/guards";
import { subscriptionSummary } from "@/lib/api/functions/services/analytics";
import { handle } from "@/lib/api/functions/http/handler";

export async function GET(request: NextRequest) {
  return handle(request, summaryContract, {}, async ({ req, query }) => {
    const business = businessOf(req);
    return subscriptionSummary(business.id, {
      start: query.startDate ? new Date(query.startDate) : undefined,
      end: query.endDate ? new Date(query.endDate) : undefined,
    });
  });
}
