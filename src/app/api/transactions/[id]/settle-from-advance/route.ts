import type { NextRequest } from "next/server";
import { settleFromAdvance as settleFromAdvanceContract } from "@workspace/api-contract";
import { businessOf } from "@/lib/api/functions/http/guards";
import * as advances from "@/lib/api/functions/services/advances";
import { handle } from "@/lib/api/functions/http/handler";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(request, settleFromAdvanceContract, { write: true, params }, async ({ req, params, body }) => {
    const business = businessOf(req);
    return advances.settleFromAdvance(business.id, {
      transactionId: params.id,
      advanceTransactionId: body.advanceTransactionId,
      amountCents: body.amountCents,
      appliedOn: body.appliedOn,
    });
  });
}
