import type { NextRequest } from "next/server";
import { getPeople as getPeopleContract } from "@workspace/api-contract";
import { type AuthedRequest, businessOf } from "@/lib/api/functions/http/guards";
import { computePeopleReport } from "../functions";
import { handle } from "@/lib/api/functions/http/handler";

/** Who pays you, and are they staying. The concentration bar's data. */
export async function GET(request: NextRequest) {
  return handle(request, getPeopleContract, {}, async ({ req, query }) => {
    const userId = (req as AuthedRequest).userId;
    const business = businessOf(req);
    return computePeopleReport(business.id, userId, {
      start: new Date(query.startDate),
      end: new Date(query.endDate),
    });
  });
}
