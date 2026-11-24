import type { NextRequest } from "next/server";
import { getRevenueItem as getRevenueItemContract, updateRevenueItem as updateRevenueItemContract } from "@workspace/api-contract";
import { rangeOf, resolveComponentSource, itemView } from "@/lib/api/functions/helpers/revenueItems";
import { type AuthedRequest, businessOf } from "@/lib/api/functions/http/guards";
import * as catalog from "@/lib/api/functions/services/catalog";
import { notFound } from "@/lib/api/functions/services/errors";
import { getRevenueItemDetail } from "@/lib/api/functions/services/read";
import { handle } from "@/lib/api/functions/http/handler";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(request, getRevenueItemContract, { params }, async ({ req, params, query }) => {
    const userId = (req as AuthedRequest).userId;
    const business = businessOf(req);
    const detail = await getRevenueItemDetail(business.id, userId, params.id, rangeOf(query));
    if (!detail) throw notFound("Revenue item");
    return detail;
  });
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(request, updateRevenueItemContract, { write: true, params }, async ({ req, params, body }) => {
    const userId = (req as AuthedRequest).userId;
    const business = businessOf(req);
    const categoryId =
      body.categoryId !== undefined
        ? body.categoryId
        : body.categoryName !== undefined
          ? await catalog.findOrCreateCategory(business.id, body.categoryName, "revenue")
          : undefined;

    await catalog.updateRevenueItem(business.id, params.id, {
      name: body.name,
      type: body.type,
      pricingModel: body.pricingModel,
      unitPriceCents: body.unitPriceCents === undefined ? undefined : body.unitPriceCents ?? null,
      categoryId,
      unitLabel: body.unitLabel,
      defaultBillingCycle: body.defaultBillingCycle === undefined ? undefined : body.defaultBillingCycle ?? null,
      tiers: body.tiers === undefined ? undefined : body.tiers ?? null,
      notes: body.notes === undefined ? undefined : body.notes ?? null,
      status: body.status,
    });
    // The form's one "direct cost" box. Re-versions rather than overwrites, so
    // history keeps the cost it was sold at.
    if (body.directCostCents !== undefined) {
      await catalog.setDirectCostEffective(business.id, params.id, body.directCostCents ?? null);
    }
    // "Other costs" added while editing. Existing versions are edited through
    // the /cost-components endpoints, never here.
    for (const comp of body.components ?? []) {
      await catalog.addCostComponent(business.id, params.id, {
        name: comp.name,
        calcType: comp.calcType,
        valueCents: comp.valueCents ?? null,
        valueRate: comp.valueRate ?? null,
        isFee: comp.isFee ?? null,
        sourceId: await resolveComponentSource(business.id, comp.sourceId),
      });
    }
    if (body.sourceLinks !== undefined) {
      await catalog.setRevenueItemSourceLinks(
        business.id,
        params.id,
        body.sourceLinks.map((l) => ({ sourceId: l.sourceId, priceOverrideCents: l.priceOverrideCents ?? null, externalId: l.externalId ?? null })),
      );
    }
    return itemView(business.id, userId, params.id);
  });
}
