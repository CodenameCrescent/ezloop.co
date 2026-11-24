import type { NextRequest } from "next/server";
import { eq, asc } from "drizzle-orm";
import { listIntegrations as listContract } from "@workspace/api-contract";
import { db, integrationsTable } from "@workspace/db";
import { toApi } from "./functions";
import { businessOf } from "@/lib/api/functions/http/guards";
import { handle } from "@/lib/api/functions/http/handler";

export async function GET(request: NextRequest) {
  return handle(request, listContract, {}, async ({ req }) => {
    const rows = await db
      .select()
      .from(integrationsTable)
      .where(eq(integrationsTable.businessId, businessOf(req).id))
      .orderBy(asc(integrationsTable.connectedAt));
    return rows.map(toApi);
  });
}
