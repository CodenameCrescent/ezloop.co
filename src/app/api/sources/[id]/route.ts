import type { NextRequest } from "next/server";
import { updateSource as updateSourceContract } from "@workspace/api-contract";
import { toApi } from "../functions";
import { businessOf } from "@/lib/api/functions/http/guards";
import * as catalog from "@/lib/api/functions/services/catalog";
import { handle } from "@/lib/api/functions/http/handler";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(request, updateSourceContract, { write: true, params }, async ({ req, params, body }) => {
    const business = businessOf(req);
    return toApi(await catalog.updateSource(business.id, params.id, body));
  });
}
