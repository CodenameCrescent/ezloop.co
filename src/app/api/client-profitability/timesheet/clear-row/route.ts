import type { NextRequest } from "next/server";
import { clearTimesheetRow as clearTimesheetRowContract } from "@workspace/api-contract";
import { businessOf } from "@/lib/api/functions/http/guards";
import * as timesheet from "@/lib/api/functions/services/timesheet";
import { handle } from "@/lib/api/functions/http/handler";

export async function POST(request: NextRequest) {
  return handle(request, clearTimesheetRowContract, { feature: "client_profitability", write: true }, async ({ req, body }) => {
    const business = businessOf(req);
    await timesheet.clearTimesheetRow(business.id, body);
    return { ok: true };
  });
}
