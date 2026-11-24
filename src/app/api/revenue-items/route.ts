import type { NextRequest } from "next/server";
import { listRevenueItems as listRevenueItemsContract, createRevenueItem as createRevenueItemContract } from "@workspace/api-contract";
import { rangeOf, resolveComponentSource, itemView } from "@/lib/api/functions/helpers/revenueItems";
import { type AuthedRequest, businessOf } from "@/lib/api/functions/http/guards";
import * as catalog from "@/lib/api/functions/services/catalog";
import { listRevenueItemsWithStats } from "@/lib/api/functions/services/read";
import { handle } from "@/lib/api/functions/http/handler";

export async function GET(request: NextRequest) {
  return handle(request, listRevenueItemsContract, {}, async ({ req, query }) => {
    const userId = (req as AuthedRequest).userId;
    const business = businessOf(req);
    return listRevenueItemsWithStats(business.id, userId, rangeOf(query), query.status);
  });
}

export async function POST(request: NextRequest) {
  return handle(request, createRevenueItemContract, { write: true }, async ({ req, body }) => {
    const userId = (req as AuthedRequest).userId;
    const business = businessOf(req);
    const categoryId = body.categoryId ?? (await catalog.findOrCreateCategory(business.id, body.categoryName, "revenue"));

    const item = await catalog.createRevenueItemWithVariants(business.id, {
      name: body.name,
      type: body.type,
      pricingModel: body.pricingModel,
      unitPriceCents: body.unitPriceCents ?? null,
      directCostCents: body.directCostCents ?? null,
      categoryId,
      unitLabel: body.unitLabel,
      defaultBillingCycle: body.defaultBillingCycle ?? null,
      tiers: body.tiers ?? null,
      notes: body.notes ?? null,
      variants: body.variants,
    });

    for (const comp of body.components ?? []) {
      await catalog.addCostComponent(business.id, item.id, {
        name: comp.name,
        calcType: comp.calcType,
        valueCents: comp.valueCents ?? null,
        valueRate: comp.valueRate ?? null,
        isFee: comp.isFee ?? null,
        sourceId: await resolveComponentSource(business.id, comp.sourceId),
      });
    }
    if (body.sourceLinks?.length) {
      await catalog.setRevenueItemSourceLinks(
        business.id,
        item.id,
        body.sourceLinks.map((l) => ({ sourceId: l.sourceId, priceOverrideCents: l.priceOverrideCents ?? null, externalId: l.externalId ?? null })),
      );
    }
    return itemView(business.id, userId, item.id);
  });
}
