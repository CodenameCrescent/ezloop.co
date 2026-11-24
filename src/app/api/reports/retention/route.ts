import type { NextRequest } from "next/server";
import { getRetention as getRetentionContract } from "@workspace/api-contract";
import { businessOf } from "@/lib/api/functions/http/guards";
import { buildCustomerRetention } from "@/lib/api/functions/services/analytics";
import { handle } from "@/lib/api/functions/http/handler";

export async function GET(request: NextRequest) {
  return handle(request, getRetentionContract, {}, async ({ req }) => {
    const business = businessOf(req);
    return buildCustomerRetention(business.id);
  });
}
