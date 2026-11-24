import type { NextRequest } from "next/server";
import { getTeamMemberRateHistory as getTeamMemberRateHistoryContract } from "@workspace/api-contract";
import { businessOf } from "@/lib/api/functions/http/guards";
import * as team from "@/lib/api/functions/services/team";
import { handle } from "@/lib/api/functions/http/handler";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(request, getTeamMemberRateHistoryContract, { feature: "client_profitability", params }, async ({ req, params }) => {
    const business = businessOf(req);
    return { history: await team.listRateHistory(business.id, params.id) };
  });
}
