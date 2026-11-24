import type { NextRequest } from "next/server";
import { commitImport as commitImportContract } from "@workspace/api-contract";
import { IMPORTS_BODY_LIMIT } from "../functions";
import { businessOf, type AuthedRequest } from "@/lib/api/functions/http/guards";
import * as csvCommit from "../functions";
import { handle } from "@/lib/api/functions/http/handler";

/**
 * The file is read AGAIN in here, by the same call the check screen made. The
 * only thing the browser is trusted for is `includeKeys` — a list of decisions,
 * never a list of figures — which is what makes the number on the screen and the
 * number in the ledger the same number rather than two that agree today.
 *
 * The user id travels for the same reason it does on the undo below: the batch
 * records who ran an import. Taken off the REQUEST, never off the body — this
 * is the only honest source for it, and a caller that could name itself in the
 * body could name somebody else.
 */
export async function POST(request: NextRequest) {
  return handle(request, commitImportContract, { write: true, bodyLimit: IMPORTS_BODY_LIMIT }, async ({ req, body }) => {
    const business = businessOf(req);
    return csvCommit.commitImport(business.id, {
      kind: body.kind,
      filename: body.filename,
      csv: body.csv,
      mapping: body.mapping,
      dateOrder: body.dateOrder,
      totalsAre: body.totalsAre,
      sourceId: body.sourceId,
      includeKeys: body.includeKeys,
      timeZone: body.timeZone,
      userId: (req as AuthedRequest).userId,
    });
  });
}

export const maxDuration = 60;
