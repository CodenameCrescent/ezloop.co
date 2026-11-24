import type { NextRequest } from "next/server";
import { listAdSpend as listAdSpendContract, logAdSpend as logAdSpendContract } from "@workspace/api-contract";
import { type AuthedRequest, businessOf } from "@/lib/api/functions/http/guards";
import * as adSpend from "@/lib/api/functions/services/adSpend";
import { computePnl } from "@/lib/api/functions/services/read";
import { handle } from "@/lib/api/functions/http/handler";

export async function GET(request: NextRequest) {
  return handle(request, listAdSpendContract, {}, async ({ req, query }) => {
    const userId = (req as AuthedRequest).userId;
    const business = businessOf(req);
    const range = {
      startDate: query.startDate ? new Date(query.startDate) : undefined,
      endDate: query.endDate ? new Date(query.endDate) : undefined,
    };

    const entries = await adSpend.listAdSpend(business.id, range);
    const pnl = await computePnl(business.id, userId, { start: range.startDate, end: range.endDate });
    const report = adSpend.summariseAdSpend(entries, pnl.ladder.grossRevenue);

    return { ...report, grossRevenueCents: pnl.ladder.grossRevenue };
  });
}

export async function POST(request: NextRequest) {
  return handle(request, logAdSpendContract, { write: true }, async ({ req, body }) => {
    const business = businessOf(req);
    const { transaction } = await adSpend.logAdSpend(business.id, {
      platform: body.platform,
      spentOn: new Date(body.spentOn),
      amountCents: body.amountCents,
      // undefined means "paid on the day"; an explicit null means not settled
      // yet. The nullish body field preserves that difference.
      paidAt: body.paidAt === undefined ? undefined : body.paidAt === null ? null : new Date(body.paidAt),
      campaign: body.campaign ?? null,
      currency: body.currency,
      notes: body.notes ?? null,
    });
    return { id: transaction.id };
  });
}
