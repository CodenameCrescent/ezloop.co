import type { NextRequest } from "next/server";
import { listBudgets as listBudgetsContract, createBudget as createBudgetContract } from "@workspace/api-contract";
import { toApi } from "./functions";
import { businessOf } from "@/lib/api/functions/http/guards";
import * as budgets from "@/lib/api/functions/services/budget";
import { handle } from "@/lib/api/functions/http/handler";

export async function GET(request: NextRequest) {
  return handle(request, listBudgetsContract, {}, async ({ req, query }) => {
    const business = businessOf(req);
    return { items: (await budgets.listBudgets(business.id, query.status)).map(toApi) };
  });
}

export async function POST(request: NextRequest) {
  return handle(request, createBudgetContract, { write: true }, async ({ req, body }) => {
    const business = businessOf(req);
    return toApi(await budgets.createBudget(business.id, body));
  });
}
