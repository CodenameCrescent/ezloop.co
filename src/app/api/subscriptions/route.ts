import type { NextRequest } from "next/server";
import { listSubscriptions as listContract, createSubscription as createContract } from "@workspace/api-contract";
import { findSubView } from "./functions";
import { businessOf, type AuthedRequest } from "@/lib/api/functions/http/guards";
import { listSubscriptionViews } from "@/lib/api/functions/services/analytics";
import { getManualSource } from "@/lib/api/functions/services/business";
import { getRevenueItem } from "@/lib/api/functions/services/catalog";
import { invalid } from "@/lib/api/functions/services/errors";
import { findOrCreatePerson } from "@/lib/api/functions/services/person";
import { createSchedule } from "@/lib/api/functions/services/recurring";
import { createSubscription } from "@/lib/api/functions/services/subscription";
import { handle } from "@/lib/api/functions/http/handler";

export async function GET(request: NextRequest) {
  return handle(request, listContract, {}, async ({ req }) => {
    const business = businessOf(req);
    return listSubscriptionViews(business.id);
  });
}

export async function POST(request: NextRequest) {
  return handle(request, createContract, { write: true }, async ({ req, body }) => {
    const userId = (req as AuthedRequest).userId;
    const business = businessOf(req);
    const item = await getRevenueItem(business.id, body.revenueItemId);
    if (item.type !== "subscription") throw invalid("Subscriptions require a subscription-type revenue item");

    let personId = body.personId ?? null;
    if (!personId && body.personName?.trim()) personId = (await findOrCreatePerson(business.id, { name: body.personName })).id;
    if (!personId) throw invalid("A subscription needs a customer");

    const sourceId = body.sourceId ?? (await getManualSource(business.id))!.id;
    const startDate = new Date(body.startDate);
    const schedule = await createSchedule(business.id, {
      direction: "in",
      revenueItemId: body.revenueItemId,
      personId,
      sourceId,
      amountCents: body.amountCents ?? item.unitPriceCents ?? null,
      interval: body.interval ?? "monthly",
      intervalCount: body.intervalCount,
      anchorDay: startDate.getUTCDate(),
      startDate,
      postingMode: body.postingMode,
    });
    const sub = await createSubscription(business.id, {
      revenueItemId: body.revenueItemId,
      personId,
      scheduleId: schedule.id,
      startedAt: startDate,
      trialEndsAt: body.trialEndsAt ? new Date(body.trialEndsAt) : null,
    });
    return findSubView(business.id, sub.id);
  });
}
