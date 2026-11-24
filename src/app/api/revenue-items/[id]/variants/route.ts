import type { NextRequest } from "next/server";
import { addRevenueItemVariant as addRevenueItemVariantContract } from "@workspace/api-contract";
import { itemView } from "@/lib/api/functions/helpers/revenueItems";
import { type AuthedRequest, businessOf } from "@/lib/api/functions/http/guards";
import * as catalog from "@/lib/api/functions/services/catalog";
import { handle } from "@/lib/api/functions/http/handler";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(request, addRevenueItemVariantContract, { write: true, params }, async ({ req, params, body }) => {
    const userId = (req as AuthedRequest).userId;
    const business = businessOf(req);
    const variant = await catalog.addVariant(business.id, params.id, {
      name: body.name,
      unitPriceCents: body.unitPriceCents ?? null,
      directCostCents: body.directCostCents ?? null,
    });
    return itemView(business.id, userId, variant.id);
  });
}
