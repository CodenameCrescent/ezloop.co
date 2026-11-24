import type { NextRequest } from "next/server";
import { skipPendingTransaction as skipContract } from "@workspace/api-contract";
import { businessOf } from "@/lib/api/functions/http/guards";
import { skipPending } from "@/lib/api/functions/services/recurring";
import { handle } from "@/lib/api/functions/http/handler";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(request, skipContract, { write: true, params }, async ({ req, params }) => {
    const business = businessOf(req);
    return skipPending(business.id, params.id);
  });
}
