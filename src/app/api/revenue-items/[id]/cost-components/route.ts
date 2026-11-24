import type { NextRequest } from "next/server";
import { addCostComponent as addCostComponentContract } from "@workspace/api-contract";
import { resolveComponentSource, componentApi } from "@/lib/api/functions/helpers/revenueItems";
import { type AuthedRequest, businessOf } from "@/lib/api/functions/http/guards";
import * as catalog from "@/lib/api/functions/services/catalog";
import { loadNameMaps } from "@/lib/api/functions/services/read";
import { handle } from "@/lib/api/functions/http/handler";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(request, addCostComponentContract, { write: true, params }, async ({ req, params, body }) => {
    const userId = (req as AuthedRequest).userId;
    const business = businessOf(req);
    const component = await catalog.addCostComponent(business.id, params.id, {
      name: body.name,
      calcType: body.calcType,
      valueCents: body.valueCents ?? null,
      valueRate: body.valueRate ?? null,
      isFee: body.isFee ?? null,
      sourceId: await resolveComponentSource(business.id, body.sourceId),
      effectiveFrom: body.effectiveFrom ? new Date(body.effectiveFrom) : undefined,
    });
    const maps = await loadNameMaps(business.id, userId);
    return componentApi(component, maps.sources);
  });
}
