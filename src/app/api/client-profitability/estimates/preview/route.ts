import type { NextRequest } from "next/server";
import { previewEstimate as previewEstimateContract } from "@workspace/api-contract";
import { businessOf } from "@/lib/api/functions/http/guards";
import * as estimates from "../../functions";
import { handle } from "@/lib/api/functions/http/handler";

// ---------------------------------------------------------------------------
// Estimated hours
// ---------------------------------------------------------------------------

/** POST because a preview takes a body; like the import's, it writes nothing. */
export async function POST(request: NextRequest) {
  return handle(request, previewEstimateContract, { feature: "client_profitability" }, async ({ req, body }) => {
    const business = businessOf(req);
    return estimates.previewEstimate(business.id, body);
  });
}
