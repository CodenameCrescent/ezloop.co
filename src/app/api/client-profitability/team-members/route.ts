import type { NextRequest } from "next/server";
import { listTeamMembers as listTeamMembersContract, createTeamMember as createTeamMemberContract } from "@workspace/api-contract";
import { memberView } from "../functions";
import { businessOf } from "@/lib/api/functions/http/guards";
import * as team from "@/lib/api/functions/services/team";
import { handle } from "@/lib/api/functions/http/handler";

export async function GET(request: NextRequest) {
  return handle(request, listTeamMembersContract, { feature: "client_profitability" }, async ({ req, query }) => {
    const business = businessOf(req);
    return { members: await team.listTeamMembers(business.id, query.status) };
  });
}

export async function POST(request: NextRequest) {
  return handle(request, createTeamMemberContract, { feature: "client_profitability", write: true }, async ({ req, body }) => {
    const business = businessOf(req);
    const person = await team.createTeamMember(business.id, {
      name: body.name,
      roleLabel: body.roleLabel ?? null,
      email: body.email ?? null,
      rate: {
        costType: body.rate.costType,
        monthlyCostCents: body.rate.monthlyCostCents,
        hourlyRateCents: body.rate.hourlyRateCents ?? null,
        overheadShareCents: body.rate.overheadShareCents,
        billableTargetHours: body.rate.billableTargetHours,
        effectiveFrom: body.rate.effectiveFrom ? new Date(body.rate.effectiveFrom) : undefined,
      },
    });
    return memberView(business.id, person.id);
  });
}
