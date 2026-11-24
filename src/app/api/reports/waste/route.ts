import type { NextRequest } from "next/server";
import { getWasteReport as getWasteReportContract } from "@workspace/api-contract";
import { businessOf, type AuthedRequest } from "@/lib/api/functions/http/guards";
import { computeWasteReport } from "../functions";
import { handle } from "@/lib/api/functions/http/handler";

/**
 * What went to waste. NOT money of its own — every figure here is a slice of
 * spending the ledger already counted, valued at what it cost.
 */
export async function GET(request: NextRequest) {
  return handle(request, getWasteReportContract, {}, async ({ req, query }) => {
    const business = businessOf(req);
    return computeWasteReport(business.id, (req as AuthedRequest).userId, {
      start: query.startDate ? new Date(query.startDate) : undefined,
      end: query.endDate ? new Date(query.endDate) : undefined,
    });
  });
}
