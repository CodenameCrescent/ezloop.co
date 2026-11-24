import type { NextRequest } from "next/server";
import { setRecurringScheduleStatus as setStatusContract } from "@workspace/api-contract";
import { toApi } from "../../functions";
import { businessOf } from "@/lib/api/functions/http/guards";
import { setScheduleStatus } from "@/lib/api/functions/services/recurring";
import { handle } from "@/lib/api/functions/http/handler";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(request, setStatusContract, { write: true, params }, async ({ req, params, body }) => {
    const business = businessOf(req);
    const updated = await setScheduleStatus(business.id, params.id, body.status);
    return toApi(business.id, updated);
  });
}
