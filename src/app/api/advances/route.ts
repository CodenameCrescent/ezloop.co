import type { NextRequest } from "next/server";
import { listOpenAdvances as listOpenAdvancesContract } from "@workspace/api-contract";
import { businessOf, type AuthedRequest } from "@/lib/api/functions/http/guards";
import * as advances from "@/lib/api/functions/services/advances";
import { handle } from "@/lib/api/functions/http/handler";

export async function GET(request: NextRequest) {
  return handle(request, listOpenAdvancesContract, {}, async ({ req }) => {
    const business = businessOf(req);
    const userId = (req as AuthedRequest).userId;
    const items = await advances.listOpenAdvances(business.id, userId);
    return {
      items,
      // Two totals, not one: money you paid ahead and money you are holding are
      // opposite obligations, and netting them would hide both.
      totalPaidAheadCents: items
        .filter((item) => item.direction === "out")
        .reduce((sum, item) => sum + item.remainingCents, 0),
      totalHeldCents: items
        .filter((item) => item.direction === "in")
        .reduce((sum, item) => sum + item.remainingCents, 0),
    };
  });
}
