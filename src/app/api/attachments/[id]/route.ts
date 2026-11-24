import type { NextRequest } from "next/server";
import { deleteTransactionAttachment as deleteAttachmentContract } from "@workspace/api-contract";
import { businessOf } from "@/lib/api/functions/http/guards";
import * as attachments from "@/lib/api/functions/services/attachments";
import { handle } from "@/lib/api/functions/http/handler";

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(request, deleteAttachmentContract, { write: true, params }, async ({ req, params }) => {
    const business = businessOf(req);
    return attachments.deleteAttachment(business.id, params.id);
  });
}
