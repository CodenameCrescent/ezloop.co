import type { NextRequest } from "next/server";
import { undoImportBatch as undoImportBatchContract } from "@workspace/api-contract";
import { IMPORTS_BODY_LIMIT } from "../../functions";
import { businessOf, type AuthedRequest } from "@/lib/api/functions/http/guards";
import * as batches from "../../functions";
import { handle } from "@/lib/api/functions/http/handler";

/**
 * Undo one import: transactions are VOIDED, catalogue rows are ARCHIVED, and
 * anything already in use is kept and named. The user id travels because the
 * batch records who undid it.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(request, undoImportBatchContract, { write: true, bodyLimit: IMPORTS_BODY_LIMIT, params }, async ({ req, params }) => {
    const business = businessOf(req);
    const userId = (req as AuthedRequest).userId;
    return batches.undoImportBatch(business.id, params.id, userId);
  });
}
