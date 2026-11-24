import type { NextRequest } from "next/server";
import { changeSubscriptionPlan as changePlanContract } from "@workspace/api-contract";
import { findSubView } from "../../functions";
import { businessOf } from "@/lib/api/functions/http/guards";
import { changePlan } from "@/lib/api/functions/services/subscription";
import { handle } from "@/lib/api/functions/http/handler";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(request, changePlanContract, { write: true, params }, async ({ req, params, body }) => {
    const business = businessOf(req);
    await changePlan(business.id, params.id, body.amountCents);
    return findSubView(business.id, params.id);
  });
}
