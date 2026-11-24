import type { NextRequest } from "next/server";
import { getCohorts as getCohortsContract } from "@workspace/api-contract";
import { businessOf } from "@/lib/api/functions/http/guards";
import { buildContributionCohorts } from "@/lib/api/functions/services/analytics";
import { handle } from "@/lib/api/functions/http/handler";

export async function GET(request: NextRequest) {
  return handle(request, getCohortsContract, {}, async ({ req }) => {
    const business = businessOf(req);
    return buildContributionCohorts(business.id);
  });
}
