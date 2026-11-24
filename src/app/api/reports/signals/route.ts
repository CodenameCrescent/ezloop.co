import type { NextRequest } from "next/server";
import { getSignals as getSignalsContract } from "@workspace/api-contract";
import { type AuthedRequest, businessOf } from "@/lib/api/functions/http/guards";
import { computeSignals } from "@/lib/api/functions/services/analytics";
import { handle } from "@/lib/api/functions/http/handler";

export async function GET(request: NextRequest) {
  return handle(request, getSignalsContract, {}, async ({ req, query }) => {
    const userId = (req as AuthedRequest).userId;
    const business = businessOf(req);
    // Default the app-wide chip to this calendar month vs last month.
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const priorStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const current = {
      start: query.startDate ? new Date(query.startDate) : monthStart,
      end: query.endDate ? new Date(query.endDate) : now,
    };
    const prior = {
      start: query.priorStartDate ? new Date(query.priorStartDate) : priorStart,
      end: query.priorEndDate ? new Date(query.priorEndDate) : new Date(monthStart.getTime() - 1),
    };
    return computeSignals(business.id, userId, current, prior);
  });
}
