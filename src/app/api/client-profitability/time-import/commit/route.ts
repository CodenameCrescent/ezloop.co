import type { NextRequest } from "next/server";
import { commitTimeImport as commitTimeImportContract } from "@workspace/api-contract";
import { businessOf } from "@/lib/api/functions/http/guards";
import * as timeImport from "../../functions";
import { handle } from "@/lib/api/functions/http/handler";

export async function POST(request: NextRequest) {
  return handle(request, commitTimeImportContract, { feature: "client_profitability", write: true }, async ({ req, body }) => {
    const business = businessOf(req);
    return timeImport.commitTimeImport(business.id, body);
  });
}
