import type { NextRequest } from "next/server";
import { closeCostComponent as closeCostComponentContract } from "@workspace/api-contract";
import { componentApi } from "@/lib/api/functions/helpers/revenueItems";
import { type AuthedRequest, businessOf } from "@/lib/api/functions/http/guards";
import * as catalog from "@/lib/api/functions/services/catalog";
import { loadNameMaps } from "@/lib/api/functions/services/read";
import { handle } from "@/lib/api/functions/http/handler";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(request, closeCostComponentContract, { write: true, params }, async ({ req, params, body }) => {
    const userId = (req as AuthedRequest).userId;
    const business = businessOf(req);
    const component = await catalog.closeCostComponent(business.id, params.id, body?.effectiveTo ? new Date(body.effectiveTo) : undefined);
    const maps = await loadNameMaps(business.id, userId);
    return componentApi(component, maps.sources);
  });
}
