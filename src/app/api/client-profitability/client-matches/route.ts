import type { NextRequest } from "next/server";
import { findClientMatches as findClientMatchesContract } from "@workspace/api-contract";
import { businessOf } from "@/lib/api/functions/http/guards";
import * as clients from "../functions";
import { handle } from "@/lib/api/functions/http/handler";

/**
 * Checked BEFORE creating, so an agency that already invoiced Acme adds an
 * engagement to that Acme rather than a second one beside it.
 */
export async function GET(request: NextRequest) {
  return handle(request, findClientMatchesContract, { feature: "client_profitability" }, async ({ req, query }) => {
    const business = businessOf(req);
    return { matches: await clients.findClientMatches(business.id, { name: query.name, email: query.email ?? null }) };
  });
}
