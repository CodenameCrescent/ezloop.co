import type { NextRequest } from "next/server";
import { getExpenseItem as getExpenseItemContract, updateExpenseItem as updateExpenseItemContract } from "@workspace/api-contract";
import { rangeOf, toApi, categoryNameOf, vendorNameOf } from "../functions";
import { type AuthedRequest, businessOf } from "@/lib/api/functions/http/guards";
import * as catalog from "@/lib/api/functions/services/catalog";
import { notFound } from "@/lib/api/functions/services/errors";
import { getExpenseItemDetail } from "@/lib/api/functions/services/read";
import { handle } from "@/lib/api/functions/http/handler";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(request, getExpenseItemContract, { params }, async ({ req, params, query }) => {
    const userId = (req as AuthedRequest).userId;
    const business = businessOf(req);
    const detail = await getExpenseItemDetail(business.id, userId, params.id, rangeOf(query));
    if (!detail) throw notFound("Expense item");
    return detail;
  });
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(request, updateExpenseItemContract, { write: true, params }, async ({ req, params, body }) => {
    const business = businessOf(req);
    const categoryId =
      body.categoryId !== undefined
        ? body.categoryId
        : body.categoryName !== undefined
          ? await catalog.findOrCreateCategory(business.id, body.categoryName, "expense")
          : undefined;
    const item = await catalog.updateExpenseItem(business.id, params.id, {
      name: body.name,
      type: body.type,
      costNature: body.costNature,
      behavior: body.behavior,
      defaultAmountCents: body.defaultAmountCents === undefined ? undefined : body.defaultAmountCents ?? null,
      categoryId,
      vendorName: body.vendorName === undefined ? undefined : body.vendorName ?? null,
      notes: body.notes === undefined ? undefined : body.notes ?? null,
      status: body.status,
    });
    return toApi(item, await categoryNameOf(business.id, item.categoryId), await vendorNameOf(business.id, item.vendorPersonId));
  });
}
