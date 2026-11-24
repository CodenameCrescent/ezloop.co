import type { NextRequest } from "next/server";
import { editPendingTransactionAmount as editAmountContract } from "@workspace/api-contract";
import { type AuthedRequest, businessOf } from "@/lib/api/functions/http/guards";
import { getTransactionDetail } from "@/lib/api/functions/services/read";
import { editPendingAmount } from "@/lib/api/functions/services/recurring";
import { handle } from "@/lib/api/functions/http/handler";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(request, editAmountContract, { write: true, params }, async ({ req, params, body }) => {
    const userId = (req as AuthedRequest).userId;
    const business = businessOf(req);
    await editPendingAmount(business.id, params.id, body.amountCents);
    const detail = await getTransactionDetail(business.id, userId, params.id);
    return detail!.transaction;
  });
}
