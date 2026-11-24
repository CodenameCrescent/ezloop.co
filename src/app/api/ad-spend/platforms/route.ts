import type { NextRequest } from "next/server";
import { listAdPlatforms as listAdPlatformsContract } from "@workspace/api-contract";
import { businessOf } from "@/lib/api/functions/http/guards";
import * as adSpend from "@/lib/api/functions/services/adSpend";
import { handle } from "@/lib/api/functions/http/handler";

/**
 * Ad spend rides the ordinary ledger — these routes orchestrate, they do not
 * compute money (CLAUDE.md). The share-of-revenue figure is taken against the
 * SAME ladder `/reports/pnl` serves, so the two screens can never disagree.
 */
export async function GET(request: NextRequest) {
  return handle(request, listAdPlatformsContract, {}, async ({ req }) => {
    const business = businessOf(req);
    const sources = await adSpend.listAdPlatforms(business.id);
    return sources.map((s) => ({
      id: s.id,
      name: s.name,
      defaultCurrency: s.defaultCurrency,
      status: s.status,
    }));
  });
}
