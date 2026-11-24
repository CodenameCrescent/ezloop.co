import type { NextRequest } from "next/server";
import { voidAdSpend as voidAdSpendContract } from "@workspace/api-contract";
import { businessOf } from "@/lib/api/functions/http/guards";
import * as adSpend from "@/lib/api/functions/services/adSpend";
import { handle } from "@/lib/api/functions/http/handler";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(request, voidAdSpendContract, { write: true, params }, async ({ req, params }) => {
    const business = businessOf(req);
    const voided = await adSpend.voidAdSpend(business.id, params.id);
    return { id: voided.id, status: voided.status };
  });
}
