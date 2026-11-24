import type { NextRequest } from "next/server";
import { getMomentum as getMomentumContract } from "@workspace/api-contract";
import { type AuthedRequest, businessOf } from "@/lib/api/functions/http/guards";
import { computeMomentum } from "@/lib/api/functions/services/analytics";
import { handle } from "@/lib/api/functions/http/handler";

export async function GET(request: NextRequest) {
  return handle(request, getMomentumContract, {}, async ({ req, query }) => {
    const userId = (req as AuthedRequest).userId;
    const business = businessOf(req);
    return computeMomentum(
      business.id,
      userId,
      { start: new Date(query.startDate), end: new Date(query.endDate) },
      { start: new Date(query.priorStartDate), end: new Date(query.priorEndDate) },
    );
  });
}
