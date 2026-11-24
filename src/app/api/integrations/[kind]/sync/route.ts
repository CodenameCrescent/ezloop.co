import type { NextRequest } from "next/server";
import { syncIntegration as syncContract } from "@workspace/api-contract";
import { businessOf } from "@/lib/api/functions/http/guards";
import { runIntegrationSync } from "@/lib/api/functions/integrations/connectors";
import { handle } from "@/lib/api/functions/http/handler";

export async function POST(request: NextRequest, { params }: { params: Promise<{ kind: string }> }) {
  return handle(request, syncContract, { write: true, params }, async ({ req, params }) => {
    // Ownership is settled by the business guard before this runs, so the sync
    // is handed a verified business and never goes looking for one.
    const result = await runIntegrationSync(businessOf(req).id, params.kind);
    return { ok: result.ok, message: result.message };
  });
}

export const maxDuration = 60;
