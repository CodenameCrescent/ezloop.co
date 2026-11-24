import type { NextRequest } from "next/server";
import { getAssetsReport as getAssetsReportContract } from "@workspace/api-contract";
import { businessOf, type AuthedRequest } from "@/lib/api/functions/http/guards";
import { computeAssetsReport } from "../functions";
import { handle } from "@/lib/api/functions/http/handler";

/** What the business owns, derived from purchases spread over months. */
export async function GET(request: NextRequest) {
  return handle(request, getAssetsReportContract, {}, async ({ req, query }) => {
    const business = businessOf(req);
    return computeAssetsReport(business.id, (req as AuthedRequest).userId, {
      includeFullyUsed: query.includeFullyUsed === "true",
    });
  });
}
