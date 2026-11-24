import type { NextRequest } from "next/server";
import { updateClientEngagement as updateClientEngagementContract } from "@workspace/api-contract";
import { clientView } from "../../functions";
import { businessOf } from "@/lib/api/functions/http/guards";
import * as clients from "../../functions";
import { handle } from "@/lib/api/functions/http/handler";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ engagementId: string }> }) {
  return handle(request, updateClientEngagementContract, { feature: "client_profitability", write: true, params }, async ({ req, params, body }) => {
    const business = businessOf(req);
    await clients.updateEngagement(business.id, params.engagementId, body);
    return clientView(business.id, params.engagementId);
  });
}
