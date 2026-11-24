import type { NextRequest } from "next/server";
import { getFxRate as getFxRateContract } from "@workspace/api-contract";
import { businessOf } from "@/lib/api/functions/http/guards";
import { lookupFxRate } from "./functions";
import { handle } from "@/lib/api/functions/http/handler";

// A suggestion for the rate box when an entry is typed in another currency.
export async function GET(request: NextRequest) {
  return handle(request, getFxRateContract, {}, async ({ req, query }) => {
    const business = businessOf(req);
    return lookupFxRate(query.from, business.baseCurrency);
  });
}
