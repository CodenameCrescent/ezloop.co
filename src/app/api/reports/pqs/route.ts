import type { NextRequest } from "next/server";
import { getPqs as getPqsContract } from "@workspace/api-contract";
import { type AuthedRequest, businessOf } from "@/lib/api/functions/http/guards";
import { computePqsReport } from "../functions";
import { handle } from "@/lib/api/functions/http/handler";

/**
 * The Profit Quality Score. Orchestration only — the pillars, their scales and
 * the verdict all come from the pure `computePqs` in `lib/domain`.
 */
export async function GET(request: NextRequest) {
  return handle(request, getPqsContract, {}, async ({ req, query }) => {
    const userId = (req as AuthedRequest).userId;
    const business = businessOf(req);
    return computePqsReport(
      business.id,
      userId,
      { start: new Date(query.startDate), end: new Date(query.endDate) },
      { start: new Date(query.priorStartDate), end: new Date(query.priorEndDate) },
    );
  });
}
