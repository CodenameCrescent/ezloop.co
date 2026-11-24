import type { NextRequest } from "next/server";
import { getMarketing as getMarketingContract } from "@workspace/api-contract";
import { type AuthedRequest, businessOf } from "@/lib/api/functions/http/guards";
import { computeMarketingReport } from "../functions";
import { handle } from "@/lib/api/functions/http/handler";

/** Is the ad spend making money. Everything blended, and labelled blended. */
export async function GET(request: NextRequest) {
  return handle(request, getMarketingContract, {}, async ({ req, query }) => {
    const userId = (req as AuthedRequest).userId;
    const business = businessOf(req);
    return computeMarketingReport(
      business.id,
      userId,
      { start: new Date(query.startDate), end: new Date(query.endDate) },
      { start: new Date(query.priorStartDate), end: new Date(query.priorEndDate) },
    );
  });
}
