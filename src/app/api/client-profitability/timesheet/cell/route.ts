import type { NextRequest } from "next/server";
import { setTimesheetCell as setTimesheetCellContract } from "@workspace/api-contract";
import { businessOf } from "@/lib/api/functions/http/guards";
import * as timesheet from "@/lib/api/functions/services/timesheet";
import { handle } from "@/lib/api/functions/http/handler";

/**
 * One cell per request, because the grid saves as you type. Deliberately not
 * rate-limited as a bulk mutation would be: filling a week is dozens of small
 * writes in quick succession, and throttling them would make the screen feel
 * broken at exactly the moment adoption is decided.
 */
export async function POST(request: NextRequest) {
  return handle(request, setTimesheetCellContract, { feature: "client_profitability" }, async ({ req, body }) => {
    const business = businessOf(req);
    const result = await timesheet.setTimesheetCell(business.id, {
      personId: body.personId,
      targetType: body.targetType,
      targetId: body.targetId,
      entryDate: body.entryDate,
      hours: body.hours,
      workType: body.workType,
      billable: body.billable,
      isEstimated: body.isEstimated,
      note: body.note ?? undefined,
    });
    return {
      saved: result.entry
        ? {
            personId: result.entry.personId,
            targetType: result.entry.targetType as "client",
            targetId: result.entry.targetId,
            entryDate: result.entry.entryDate,
            hours: result.entry.hours,
            isEstimated: result.entry.isEstimated,
            workType: result.entry.workType as "delivery",
            billable: result.entry.billable,
          }
        : null,
      dayCheck: result.dayCheck,
    };
  });
}
