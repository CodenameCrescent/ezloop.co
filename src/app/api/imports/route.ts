import type { NextRequest } from "next/server";
import { listImportBatches as listImportBatchesContract } from "@workspace/api-contract";
import { businessOf } from "@/lib/api/functions/http/guards";
import * as batches from "./functions";
import { handle } from "@/lib/api/functions/http/handler";

// ---------------------------------------------------------------------------
// History, and going backwards
// ---------------------------------------------------------------------------

/** Every import this business has run, newest first — undone ones included. */
export async function GET(request: NextRequest) {
  return handle(request, listImportBatchesContract, {}, async ({ req }) => {
    const business = businessOf(req);
    return batches.listImportBatches(business.id);
  });
}
