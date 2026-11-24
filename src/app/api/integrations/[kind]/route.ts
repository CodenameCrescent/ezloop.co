import type { NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { disconnectIntegration as disconnectContract } from "@workspace/api-contract";
import { db, integrationsTable } from "@workspace/db";
import { businessOf } from "@/lib/api/functions/http/guards";
import { handle } from "@/lib/api/functions/http/handler";

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ kind: string }> }) {
  return handle(request, disconnectContract, { write: true, params }, async ({ req, params }) => {
    await db
      .delete(integrationsTable)
      .where(
        and(eq(integrationsTable.businessId, businessOf(req).id), eq(integrationsTable.kind, params.kind)),
      );
    return { ok: true };
  });
}
