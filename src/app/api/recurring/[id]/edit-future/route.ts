import type { NextRequest } from "next/server";
import { editRecurringScheduleFuture as editFutureContract } from "@workspace/api-contract";
import { toApi } from "../../functions";
import { businessOf } from "@/lib/api/functions/http/guards";
import { getSchedule, editThisAndFuture } from "@/lib/api/functions/services/recurring";
import { handle } from "@/lib/api/functions/http/handler";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(request, editFutureContract, { write: true, params }, async ({ req, params, body }) => {
    const business = businessOf(req);
    await getSchedule(business.id, params.id);
    const clone = await editThisAndFuture(business.id, params.id, { amountCents: body.amountCents === undefined ? undefined : body.amountCents ?? null, qty: body.qty });
    return toApi(business.id, clone);
  });
}
