import type { NextRequest } from "next/server";
import { getTimesheet as getTimesheetContract } from "@workspace/api-contract";
import { businessOf } from "@/lib/api/functions/http/guards";
import * as timesheet from "@/lib/api/functions/services/timesheet";
import { handle } from "@/lib/api/functions/http/handler";

// ---------------------------------------------------------------------------
// Timesheet — the weekly grid
// ---------------------------------------------------------------------------
export async function GET(request: NextRequest) {
  return handle(request, getTimesheetContract, { feature: "client_profitability" }, async ({ req, query }) => {
    const business = businessOf(req);
    const weekStart = query.weekStart ? new Date(`${query.weekStart}T00:00:00Z`) : new Date();
    return timesheet.getTimesheet(business.id, weekStart);
  });
}
