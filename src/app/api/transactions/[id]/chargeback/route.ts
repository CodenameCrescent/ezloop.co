import type { NextRequest } from "next/server";
import { chargebackTransaction as chargebackContract } from "@workspace/api-contract";
import { type AuthedRequest, businessOf } from "@/lib/api/functions/http/guards";
import * as ledger from "@/lib/api/functions/services/ledger";
import { getTransactionDetail } from "@/lib/api/functions/services/read";
import { handle } from "@/lib/api/functions/http/handler";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(request, chargebackContract, { write: true, params }, async ({ req, params, body }) => {
    const userId = (req as AuthedRequest).userId;
    const business = businessOf(req);
    const result = await ledger.createRefund(business.id, {
      transactionId: params.id,
      requests: body.lines,
      adjustmentType: "chargeback",
      chargebackFeeCents: body.feeCents,
      occurredAt: body.occurredAt ? new Date(body.occurredAt) : undefined,
      notes: body.notes ?? null,
    });
    const detail = await getTransactionDetail(business.id, userId, result.transaction.id);
    return { transaction: detail!.transaction, parentStatus: result.parentStatus };
  });
}
