import type { NextRequest } from "next/server";
import { setTeamMemberRate as setTeamMemberRateContract } from "@workspace/api-contract";
import { memberView } from "../../../functions";
import { businessOf } from "@/lib/api/functions/http/guards";
import * as team from "@/lib/api/functions/services/team";
import { handle } from "@/lib/api/functions/http/handler";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(request, setTeamMemberRateContract, { feature: "client_profitability", write: true, params }, async ({ req, params, body }) => {
    const business = businessOf(req);
    await team.setTeamMemberRate(business.id, params.id, {
      costType: body.costType,
      monthlyCostCents: body.monthlyCostCents,
      hourlyRateCents: body.hourlyRateCents ?? null,
      overheadShareCents: body.overheadShareCents,
      billableTargetHours: body.billableTargetHours,
      effectiveFrom: body.effectiveFrom ? new Date(body.effectiveFrom) : undefined,
    });
    return memberView(business.id, params.id);
  });
}
