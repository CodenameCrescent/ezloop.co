import type { NextRequest } from "next/server";
import { getPnl as getPnlContract } from "@workspace/api-contract";
import { type AuthedRequest, businessOf } from "@/lib/api/functions/http/guards";
import { computePnl } from "@/lib/api/functions/services/read";
import { handle } from "@/lib/api/functions/http/handler";

export async function GET(request: NextRequest) {
  return handle(request, getPnlContract, {}, async ({ req, query }) => {
    const userId = (req as AuthedRequest).userId;
    const business = businessOf(req);
    return computePnl(
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
