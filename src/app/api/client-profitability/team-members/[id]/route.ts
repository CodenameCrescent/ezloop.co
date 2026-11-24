import type { NextRequest } from "next/server";
import { updateTeamMember as updateTeamMemberContract } from "@workspace/api-contract";
import { memberView } from "../../functions";
import { businessOf } from "@/lib/api/functions/http/guards";
import * as team from "@/lib/api/functions/services/team";
import { handle } from "@/lib/api/functions/http/handler";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(request, updateTeamMemberContract, { feature: "client_profitability", write: true, params }, async ({ req, params, body }) => {
    const business = businessOf(req);
    await team.updateTeamMember(business.id, params.id, {
      name: body.name,
      roleLabel: body.roleLabel === undefined ? undefined : body.roleLabel ?? null,
      email: body.email === undefined ? undefined : body.email ?? null,
      status: body.status,
    });
    return memberView(business.id, params.id);
  });
}
