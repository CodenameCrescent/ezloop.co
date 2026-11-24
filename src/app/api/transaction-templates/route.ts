import type { NextRequest } from "next/server";
import { listTransactionTemplates as listTemplatesContract, createTransactionTemplate as createTemplateContract } from "@workspace/api-contract";
import { templateView } from "@/lib/api/functions/helpers/transactions";
import { businessOf } from "@/lib/api/functions/http/guards";
import * as templates from "./functions";
import { handle } from "@/lib/api/functions/http/handler";

export async function GET(request: NextRequest) {
  return handle(request, listTemplatesContract, {}, async ({ req }) => {
    const business = businessOf(req);
    const rows = await templates.listTemplates(business.id);
    return { items: rows.map(templateView) };
  });
}

export async function POST(request: NextRequest) {
  return handle(request, createTemplateContract, { write: true }, async ({ req, body }) => {
    const business = businessOf(req);
    const row = await templates.createTemplate(business.id, { name: body.name, payload: body.payload });
    return templateView(row);
  });
}
