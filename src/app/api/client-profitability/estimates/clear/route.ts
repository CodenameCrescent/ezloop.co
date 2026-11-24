import type { NextRequest } from "next/server";
import { clearTargetEstimate as clearTargetEstimateContract } from "@workspace/api-contract";
import { businessOf } from "@/lib/api/functions/http/guards";
import * as estimates from "../../functions";
import { handle } from "@/lib/api/functions/http/handler";

export async function POST(request: NextRequest) {
  return handle(request, clearTargetEstimateContract, { feature: "client_profitability", write: true }, async ({ req, body }) => {
    const business = businessOf(req);
    return estimates.clearTargetEstimate(business.id, body);
  });
}
