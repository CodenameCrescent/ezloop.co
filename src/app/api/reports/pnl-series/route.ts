import type { NextRequest } from "next/server";
import { getPnlSeries as getPnlSeriesContract } from "@workspace/api-contract";
import { businessOf } from "@/lib/api/functions/http/guards";
import { computePnlSeries } from "@/lib/api/functions/services/analytics";
import { handle } from "@/lib/api/functions/http/handler";

export async function GET(request: NextRequest) {
  return handle(request, getPnlSeriesContract, {}, async ({ req, query }) => {
    const business = businessOf(req);
    return computePnlSeries(
      business.id,
      { start: new Date(query.startDate), end: new Date(query.endDate) },
      query.bucket,
    );
  });
}
