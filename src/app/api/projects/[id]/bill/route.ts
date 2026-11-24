import type { NextRequest } from "next/server";
import { billProject as billProjectContract } from "@workspace/api-contract";
import { businessOf } from "@/lib/api/functions/http/guards";
import * as projects from "@/lib/api/functions/services/project";
import { handle } from "@/lib/api/functions/http/handler";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(request, billProjectContract, { feature: "projects", write: true, params }, async ({ req, params, body }) => {
    const business = businessOf(req);
    return projects.billProject(business.id, params.id, {
      amountCents: body.amountCents,
      occurredAt: new Date(body.occurredAt),
      label: body.label,
      dueDate: body.dueDate ?? null,
      retentionPct: body.retentionPct ?? null,
      retentionDueDate: body.retentionDueDate ?? null,
      referenceNumber: body.referenceNumber ?? null,
    });
  });
}
