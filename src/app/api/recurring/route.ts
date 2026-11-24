import type { NextRequest } from "next/server";
import { listRecurringSchedules as listContract, createRecurringSchedule as createContract } from "@workspace/api-contract";
import { toApi } from "./functions";
import { businessOf } from "@/lib/api/functions/http/guards";
import { getManualSource } from "@/lib/api/functions/services/business";
import { listSchedules, createSchedule } from "@/lib/api/functions/services/recurring";
import { handle } from "@/lib/api/functions/http/handler";

export async function GET(request: NextRequest) {
  return handle(request, listContract, {}, async ({ req }) => {
    const business = businessOf(req);
    const schedules = await listSchedules(business.id);
    return Promise.all(schedules.map((s) => toApi(business.id, s)));
  });
}

export async function POST(request: NextRequest) {
  return handle(request, createContract, { write: true }, async ({ req, body }) => {
    const business = businessOf(req);
    const sourceId = body.sourceId ?? (await getManualSource(business.id))!.id;
    const schedule = await createSchedule(business.id, {
      direction: body.direction,
      revenueItemId: body.revenueItemId ?? null,
      expenseItemId: body.expenseItemId ?? null,
      personId: body.personId ?? null,
      sourceId,
      amountCents: body.amountCents ?? null,
      qty: body.qty,
      interval: body.interval,
      intervalCount: body.intervalCount,
      anchorDay: body.anchorDay ?? null,
      startDate: new Date(body.startDate),
      endDate: body.endDate ? new Date(body.endDate) : null,
      maxOccurrences: body.maxOccurrences ?? null,
      postingMode: body.postingMode,
    });
    return toApi(business.id, schedule);
  });
}
