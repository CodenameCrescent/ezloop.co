import type { NextRequest } from "next/server";
import { previewTimeImport as previewTimeImportContract } from "@workspace/api-contract";
import { businessOf } from "@/lib/api/functions/http/guards";
import * as timeImport from "../../functions";
import { handle } from "@/lib/api/functions/http/handler";

// ---------------------------------------------------------------------------
// CSV import
// ---------------------------------------------------------------------------

/**
 * Preview is a POST because the file goes in the body — a week of timesheet
 * rows does not belong in a URL. It writes nothing.
 */
export async function POST(request: NextRequest) {
  return handle(request, previewTimeImportContract, { feature: "client_profitability", write: true }, async ({ req, body }) => {
    const business = businessOf(req);
    return timeImport.previewTimeImport(business.id, body);
  });
}
