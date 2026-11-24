import type { NextRequest } from "next/server";
import { deleteTransactionTemplate as deleteTemplateContract } from "@workspace/api-contract";
import { businessOf } from "@/lib/api/functions/http/guards";
import * as templates from "../functions";
import { handle } from "@/lib/api/functions/http/handler";

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(request, deleteTemplateContract, { write: true, params }, async ({ req, params }) => {
    const business = businessOf(req);
    return templates.deleteTemplate(business.id, params.id);
  });
}
