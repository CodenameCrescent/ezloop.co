import type { NextRequest } from "next/server";
import { businessOf } from "@/lib/api/functions/http/guards";
import * as attachments from "@/lib/api/functions/services/attachments";
import { handleRaw } from "@/lib/api/functions/http/handler";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handleRaw(request, { params }, async (req) => {
    const business = businessOf(req);
    const att = await attachments.getAttachment(business.id, String(req.params.id));
    return new Response(new Uint8Array(att.data), {
      headers: {
        "Content-Type": att.mimeType,
        "Content-Disposition": `attachment; filename="${att.filename.replace(/"/g, "")}"`,
      },
    });
  });
}
