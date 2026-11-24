import type { NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { connectIntegration as connectContract } from "@workspace/api-contract";
import { db, integrationsTable } from "@workspace/db";
import { maybeEncryptToken, toApi } from "../../functions";
import { type AuthedRequest, businessOf } from "@/lib/api/functions/http/guards";
import { CONNECTORS } from "@/lib/api/functions/integrations/connectors";
import { uid } from "@/lib/api/functions/lib/uid";
import { handle } from "@/lib/api/functions/http/handler";

export async function POST(request: NextRequest, { params }: { params: Promise<{ kind: string }> }) {
  return handle(request, connectContract, { write: true, params }, async ({ req, params, body }) => {
    const userId = (req as AuthedRequest).userId;
    const businessId = businessOf(req).id;
    const kind = params.kind;
    const [existing] = await db
      .select()
      .from(integrationsTable)
      .where(and(eq(integrationsTable.businessId, businessId), eq(integrationsTable.kind, kind)));

    if (existing) {
      const [updated] = await db
        .update(integrationsTable)
        .set({
          externalAccount: body.externalAccount ?? existing.externalAccount,
          ...(body.accessToken !== undefined ? { accessToken: maybeEncryptToken(body.accessToken, kind) } : {}),
        })
        .where(eq(integrationsTable.id, existing.id))
        .returning();
      return toApi(updated);
    }

    const [created] = await db
      .insert(integrationsTable)
      .values({
        id: uid("int"),
        userId,
        businessId,
        kind,
        displayName: CONNECTORS[kind].displayName,
        externalAccount: body.externalAccount ?? null,
        accessToken: maybeEncryptToken(body.accessToken ?? null, kind),
      })
      .returning();
    return toApi(created);
  });
}
