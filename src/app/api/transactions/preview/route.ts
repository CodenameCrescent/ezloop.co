import type { NextRequest } from "next/server";
import { previewTransaction as previewContract } from "@workspace/api-contract";
import { toInput } from "@/lib/api/functions/helpers/transactions";
import { type AuthedRequest, businessOf } from "@/lib/api/functions/http/guards";
import { buildPreview } from "@/lib/api/functions/services/read";
import { handle } from "@/lib/api/functions/http/handler";

// NOTE: register /transactions/preview BEFORE /transactions/:id so "preview"
// is never captured as an :id.
export async function POST(request: NextRequest) {
  return handle(request, previewContract, {}, async ({ req, body }) => {
    const userId = (req as AuthedRequest).userId;
    const business = businessOf(req);
    return buildPreview(business.id, await toInput(business.id, userId, body, business.baseCurrency));
  });
}
