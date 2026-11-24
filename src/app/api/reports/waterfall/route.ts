import type { NextRequest } from "next/server";
import { getWaterfall as getWaterfallContract } from "@workspace/api-contract";
import { type AuthedRequest, businessOf } from "@/lib/api/functions/http/guards";
import { computeWaterfallReport } from "../functions";
import { handle } from "@/lib/api/functions/http/handler";

/**
 * The money waterfall. The service throws rather than serving a chart whose
 * bars do not land on the profit printed beside them.
 */
export async function GET(request: NextRequest) {
  return handle(request, getWaterfallContract, {}, async ({ req, query }) => {
    const userId = (req as AuthedRequest).userId;
    const business = businessOf(req);
    return computeWaterfallReport(
      business.id,
      userId,
      { start: new Date(query.startDate), end: new Date(query.endDate) },
      { start: new Date(query.priorStartDate), end: new Date(query.priorEndDate) },
    );
  });
}
