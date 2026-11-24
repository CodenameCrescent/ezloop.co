import type { NextRequest } from "next/server";
import { listSources as listSourcesContract, createSource as createSourceContract } from "@workspace/api-contract";
import { toApi } from "./functions";
import { businessOf } from "@/lib/api/functions/http/guards";
import * as catalog from "@/lib/api/functions/services/catalog";
import { handle } from "@/lib/api/functions/http/handler";

export async function GET(request: NextRequest) {
  return handle(request, listSourcesContract, {}, async ({ req }) => {
    const business = businessOf(req);
    return (await catalog.listSources(business.id)).map(toApi);
  });
}

export async function POST(request: NextRequest) {
  return handle(request, createSourceContract, { write: true }, async ({ req, body }) => {
    const business = businessOf(req);
    return toApi(
      await catalog.createSource(business.id, {
        name: body.name,
        kind: body.kind,
        platformFeePercent: body.platformFeePercent ?? null,
        defaultCurrency: body.defaultCurrency,
      }),
    );
  });
}
