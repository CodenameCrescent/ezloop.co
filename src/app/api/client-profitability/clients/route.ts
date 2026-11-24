import type { NextRequest } from "next/server";
import { listClients as listClientsContract, createClient as createClientContract } from "@workspace/api-contract";
import { clientView } from "../functions";
import { businessOf } from "@/lib/api/functions/http/guards";
import * as clients from "../functions";
import { handle } from "@/lib/api/functions/http/handler";

export async function GET(request: NextRequest) {
  return handle(request, listClientsContract, { feature: "client_profitability" }, async ({ req, query }) => {
    const business = businessOf(req);
    return { clients: await clients.listClients(business.id, query.status) };
  });
}

export async function POST(request: NextRequest) {
  return handle(request, createClientContract, { feature: "client_profitability", write: true }, async ({ req, body }) => {
    const business = businessOf(req);
    const engagement = await clients.createClient(business.id, {
      name: body.name,
      email: body.email ?? null,
      personId: body.personId ?? null,
      engagement: body.engagement,
    });
    return clientView(business.id, engagement.id);
  });
}
