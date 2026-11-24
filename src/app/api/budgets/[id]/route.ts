import type { NextRequest } from "next/server";
import { getBudget as getBudgetContract, updateBudget as updateBudgetContract } from "@workspace/api-contract";
import { toApi } from "../functions";
import { businessOf, type AuthedRequest } from "@/lib/api/functions/http/guards";
import * as budgets from "@/lib/api/functions/services/budget";
import { handle } from "@/lib/api/functions/http/handler";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(request, getBudgetContract, { params }, async ({ req, params }) => {
    const business = businessOf(req);
    const userId = (req as AuthedRequest).userId;
    return budgets.computeBudgetDetail(business.id, userId, params.id);
  });
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handle(request, updateBudgetContract, { write: true, params }, async ({ req, params, body }) => {
    const business = businessOf(req);
    return toApi(await budgets.updateBudget(business.id, params.id, body));
  });
}
