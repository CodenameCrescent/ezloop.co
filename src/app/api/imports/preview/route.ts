import type { NextRequest } from "next/server";
import { previewImport as previewImportContract } from "@workspace/api-contract";
import { IMPORTS_BODY_LIMIT } from "../functions";
import { businessOf } from "@/lib/api/functions/http/guards";
import * as csvImport from "../functions";
import { handle } from "@/lib/api/functions/http/handler";

// ---------------------------------------------------------------------------
// Check, then commit
// ---------------------------------------------------------------------------

/**
 * A POST that writes nothing. The file goes in the body — a spreadsheet does not
 * belong in a URL — which is the same reason the timesheet import's preview is a
 * POST. Rate-limited as a mutation anyway: reading and matching a file at the
 * cap is the most expensive thing an unauthenticated-looking burst could ask for.
 */
export async function POST(request: NextRequest) {
  return handle(request, previewImportContract, { write: true, bodyLimit: IMPORTS_BODY_LIMIT }, async ({ req, body }) => {
    const business = businessOf(req);
    return csvImport.previewImport(business.id, {
      kind: body.kind,
      filename: body.filename,
      csv: body.csv,
      mapping: body.mapping,
      dateOrder: body.dateOrder,
      totalsAre: body.totalsAre,
      sourceId: body.sourceId,
      timeZone: body.timeZone,
    });
  });
}

export const maxDuration = 60;
