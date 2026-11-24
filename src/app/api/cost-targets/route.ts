import type { NextRequest } from "next/server";
import { listCostTargets as listCostTargetsContract } from "@workspace/api-contract";
import { businessOf } from "@/lib/api/functions/http/guards";
import { listTimeTargets } from "@/lib/api/functions/services/timesheet";
import { handle } from "@/lib/api/functions/http/handler";

export async function GET(request: NextRequest) {
  return handle(request, listCostTargetsContract, {}, async ({ req }) => {
    const business = businessOf(req);
    return { items: await listTimeTargets(business.id) };
  });
}
