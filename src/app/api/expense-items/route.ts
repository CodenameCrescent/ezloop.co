import type { NextRequest } from "next/server";
import { listExpenseItems as listExpenseItemsContract, createExpenseItem as createExpenseItemContract } from "@workspace/api-contract";
import { rangeOf, toApi, categoryNameOf, vendorNameOf } from "./functions";
import { type AuthedRequest, businessOf } from "@/lib/api/functions/http/guards";
import * as catalog from "@/lib/api/functions/services/catalog";
import { listExpenseItemsWithStats } from "@/lib/api/functions/services/read";
import { handle } from "@/lib/api/functions/http/handler";

export async function GET(request: NextRequest) {
  return handle(request, listExpenseItemsContract, {}, async ({ req, query }) => {
    const userId = (req as AuthedRequest).userId;
    const business = businessOf(req);
    return listExpenseItemsWithStats(business.id, userId, rangeOf(query), query.status);
  });
}

export async function POST(request: NextRequest) {
  return handle(request, createExpenseItemContract, { write: true }, async ({ req, body }) => {
    const business = businessOf(req);
    const categoryId = body.categoryId ?? (await catalog.findOrCreateCategory(business.id, body.categoryName, "expense"));
    const item = await catalog.createExpenseItem(business.id, {
      name: body.name,
      type: body.type,
      costNature: body.costNature,
      behavior: body.behavior,
      defaultAmountCents: body.defaultAmountCents ?? null,
      categoryId,
      vendorName: body.vendorName ?? null,
      notes: body.notes ?? null,
    });
    return toApi(item, await categoryNameOf(business.id, item.categoryId), await vendorNameOf(business.id, item.vendorPersonId));
  });
}
