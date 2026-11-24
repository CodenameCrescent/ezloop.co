import type { NextRequest } from "next/server";
import { confirmPendingTransaction as confirmContract } from "@workspace/api-contract";
import { type AuthedRequest, businessOf } from "@/lib/api/functions/http/guards";
import { getTransactionDetail } from "@/lib/api/functions/services/read";
import { confirmPending } from "@/lib/api/functions/services/recurring";
import { handle } from "@/lib/api/functions/http/handler";

// ── Pending recurring queue actions ─────────────────────────────────────────
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(request, confirmContract, { write: true, params }, async ({ req, params }) => {
    const userId = (req as AuthedRequest).userId;
    const business = businessOf(req);
    await confirmPending(business.id, params.id);
    const detail = await getTransactionDetail(business.id, userId, params.id);
    return detail!.transaction;
  });
}
