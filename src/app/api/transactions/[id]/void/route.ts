import type { NextRequest } from "next/server";
import { voidTransaction as voidContract } from "@workspace/api-contract";
import { type AuthedRequest, businessOf } from "@/lib/api/functions/http/guards";
import { invalid } from "@/lib/api/functions/services/errors";
import * as ledger from "@/lib/api/functions/services/ledger";
import { getTransactionDetail } from "@/lib/api/functions/services/read";
import { handle } from "@/lib/api/functions/http/handler";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(request, voidContract, { write: true, params }, async ({ req, params }) => {
    const userId = (req as AuthedRequest).userId;
    const business = businessOf(req);
    const voided = await ledger.voidTransaction(business.id, params.id);
    // Voided rows are hidden from the ledger read; return the summary directly.
    const detail = await getTransactionDetail(business.id, userId, voided.id);
    if (!detail) throw invalid("Transaction could not be voided");
    return detail.transaction;
  });
}
