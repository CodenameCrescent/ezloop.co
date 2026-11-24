import type { NextRequest } from "next/server";
import { listBusinesses as listBusinessesContract, createBusiness as createBusinessContract } from "@workspace/api-contract";
import { toApi } from "./functions";
import type { AuthedRequest } from "@/lib/api/functions/http/guards";
import * as businesses from "@/lib/api/functions/services/business";
import { handle } from "@/lib/api/functions/http/handler";

export async function GET(request: NextRequest) {
  return handle(request, listBusinessesContract, { business: false }, async ({ req, query }) => {
    const rows = await businesses.listBusinesses((req as AuthedRequest).userId, {
      includeArchived: query.includeArchived === "true",
    });
    return { items: rows.map(toApi) };
  });
}

export async function POST(request: NextRequest) {
  return handle(request, createBusinessContract, { business: false, write: true }, async ({ req, body }) => {
    const created = await businesses.createBusiness((req as AuthedRequest).userId, {
      name: body.name,
      businessType: body.businessType,
      currency: body.currency,
      currencySymbol: body.currencySymbol,
    });
    return toApi(created);
  });
}
