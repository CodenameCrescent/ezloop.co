import type { NextRequest } from "next/server";
import { updateCostComponent as updateCostComponentContract } from "@workspace/api-contract";
import { componentApi } from "@/lib/api/functions/helpers/revenueItems";
import { type AuthedRequest, businessOf } from "@/lib/api/functions/http/guards";
import * as catalog from "@/lib/api/functions/services/catalog";
import { loadNameMaps } from "@/lib/api/functions/services/read";
import { handle } from "@/lib/api/functions/http/handler";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(request, updateCostComponentContract, { write: true, params }, async ({ req, params, body }) => {
    const userId = (req as AuthedRequest).userId;
    const business = businessOf(req);
    const component = await catalog.updateCostComponent(business.id, params.id, {
      valueCents: body.valueCents === undefined ? undefined : body.valueCents ?? null,
      valueRate: body.valueRate === undefined ? undefined : body.valueRate ?? null,
      isFee: body.isFee === undefined ? undefined : body.isFee ?? null,
      effectiveFrom: body.effectiveFrom ? new Date(body.effectiveFrom) : undefined,
    });
    const maps = await loadNameMaps(business.id, userId);
    return componentApi(component, maps.sources);
  });
}
