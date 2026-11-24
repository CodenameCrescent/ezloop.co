import type { NextRequest } from "next/server";
import { listTransactionAttachments as listAttachmentsContract } from "@workspace/api-contract";
import { attachmentView } from "@/lib/api/functions/helpers/transactions";
import { businessOf } from "@/lib/api/functions/http/guards";
import * as attachments from "@/lib/api/functions/services/attachments";
import { handle, handleRaw } from "@/lib/api/functions/http/handler";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(request, listAttachmentsContract, { params }, async ({ req, params }) => {
    const business = businessOf(req);
    const rows = await attachments.listAttachments(business.id, params.id);
    return { items: rows.map(attachmentView) };
  });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handleRaw(request, { write: true, body: "raw", bodyLimit: attachments.ATTACHMENT_MAX_BYTES + 1024 * 1024, params }, async (req) => {
      const business = businessOf(req);
      const filename = decodeURIComponent(String(req.headers["x-filename"] ?? "attachment"));
      const mimeType = String(req.headers["content-type"] ?? "").split(";")[0].trim();
      const row = await attachments.addAttachment(business.id, String(req.params.id), {
        filename,
        mimeType,
        data: Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0),
      });
      return Response.json(attachmentView(row), { status: 201 });
    });
}
