import type { NextRequest } from "next/server";
import { getOverheadDefault as getOverheadDefaultContract } from "@workspace/api-contract";
import { type AuthedRequest, businessOf } from "@/lib/api/functions/http/guards";
import * as team from "@/lib/api/functions/services/team";
import { handle } from "@/lib/api/functions/http/handler";

export async function GET(request: NextRequest) {
  return handle(request, getOverheadDefaultContract, { feature: "client_profitability" }, async ({ req }) => {
    const userId = (req as AuthedRequest).userId;
    const business = businessOf(req);
    return team.computeOverheadDefault(business.id, userId);
  });
}
