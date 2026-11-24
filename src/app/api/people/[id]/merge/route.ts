import type { NextRequest } from "next/server";
import { mergePeople as mergePeopleContract } from "@workspace/api-contract";
import { businessOf } from "@/lib/api/functions/http/guards";
import { computePeopleMetrics, personView } from "@/lib/api/functions/services/analytics";
import { mergePersons } from "@/lib/api/functions/services/person";
import { handle } from "@/lib/api/functions/http/handler";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(request, mergePeopleContract, { write: true, params }, async ({ req, params, body }) => {
    const business = businessOf(req);
    const kept = await mergePersons(business.id, params.id, body.mergeId);
    const metrics = await computePeopleMetrics(business.id);
    return personView(kept, metrics.get(kept.id));
  });
}
