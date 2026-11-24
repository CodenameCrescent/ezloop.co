import type { NextRequest } from "next/server";
import { listTargetEstimates as listTargetEstimatesContract, setTargetEstimate as setTargetEstimateContract } from "@workspace/api-contract";
import { businessOf } from "@/lib/api/functions/http/guards";
import * as estimates from "../functions";
import { handle } from "@/lib/api/functions/http/handler";

export async function GET(request: NextRequest) {
  return handle(request, listTargetEstimatesContract, { feature: "client_profitability" }, async ({ req, query }) => {
    const business = businessOf(req);
    return { estimates: await estimates.listTargetEstimates(business.id, { start: query.startDate, end: query.endDate }) };
  });
}

export async function POST(request: NextRequest) {
  return handle(request, setTargetEstimateContract, { feature: "client_profitability", write: true }, async ({ req, body }) => {
    const business = businessOf(req);
    return estimates.setTargetEstimate(business.id, body);
  });
}
