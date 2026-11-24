import type { NextRequest } from "next/server";
import { getOffers as getOffersContract } from "@workspace/api-contract";
import { type AuthedRequest, businessOf } from "@/lib/api/functions/http/guards";
import { computeOffersReport } from "../functions";
import { handle } from "@/lib/api/functions/http/handler";

/** What you sell, ranked by profit and mapped onto the quadrant. */
export async function GET(request: NextRequest) {
  return handle(request, getOffersContract, {}, async ({ req, query }) => {
    const userId = (req as AuthedRequest).userId;
    const business = businessOf(req);
    return computeOffersReport(business.id, userId, {
      start: new Date(query.startDate),
      end: new Date(query.endDate),
    });
  });
}
