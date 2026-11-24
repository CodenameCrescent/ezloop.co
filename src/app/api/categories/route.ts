import type { NextRequest } from "next/server";
import { listCategories as listCategoriesContract, createCategory as createCategoryContract } from "@workspace/api-contract";
import { toApi } from "./functions";
import { businessOf } from "@/lib/api/functions/http/guards";
import * as catalog from "@/lib/api/functions/services/catalog";
import { handle } from "@/lib/api/functions/http/handler";

export async function GET(request: NextRequest) {
  return handle(request, listCategoriesContract, {}, async ({ req, query }) => {
    const business = businessOf(req);
    return (await catalog.listCategories(business.id, query.usableFor)).map(toApi);
  });
}

export async function POST(request: NextRequest) {
  return handle(request, createCategoryContract, { write: true }, async ({ req, body }) => {
    const business = businessOf(req);
    return toApi(
      await catalog.createCategory(business.id, {
        name: body.name,
        parentId: body.parentId ?? null,
        appliesTo: body.appliesTo,
      }),
    );
  });
}
