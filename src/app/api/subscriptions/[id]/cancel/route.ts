import type { NextRequest } from "next/server";
import { cancelSubscription as cancelContract } from "@workspace/api-contract";
import { findSubView } from "../../functions";
import { businessOf } from "@/lib/api/functions/http/guards";
import { cancelSubscription } from "@/lib/api/functions/services/subscription";
import { handle } from "@/lib/api/functions/http/handler";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(request, cancelContract, { write: true, params }, async ({ req, params, body }) => {
    const business = businessOf(req);
    await cancelSubscription(business.id, params.id, body.reason ?? undefined);
    return findSubView(business.id, params.id);
  });
}
