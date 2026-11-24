import type { NextRequest } from "next/server";
import { getClientProfitability as getClientProfitabilityContract } from "@workspace/api-contract";
import { type AuthedRequest, businessOf } from "@/lib/api/functions/http/guards";
import { computeClientProfitability } from "@/lib/api/functions/services/clientProfit";
import { handle } from "@/lib/api/functions/http/handler";

// ---------------------------------------------------------------------------
// Profitability — the answer this module exists to give
// ---------------------------------------------------------------------------
export async function GET(request: NextRequest) {
  return handle(request, getClientProfitabilityContract, { feature: "client_profitability" }, async ({ req, query }) => {
    const userId = (req as AuthedRequest).userId;
    const business = businessOf(req);
    return computeClientProfitability(
      business.id,
      userId,
      {
        start: query.startDate ? new Date(query.startDate) : undefined,
        end: query.endDate ? new Date(query.endDate) : undefined,
      },
      query.basis ?? "accrual",
    );
  });
}
