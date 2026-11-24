import type { NextRequest } from "next/server";
import { suggestBudget as suggestBudgetContract } from "@workspace/api-contract";
import { businessOf, type AuthedRequest } from "@/lib/api/functions/http/guards";
import * as budgets from "@/lib/api/functions/services/budget";
import { handle } from "@/lib/api/functions/http/handler";

/**
 * BEFORE `/budgets/:id`, and it has to stay that way.
 *
 * Express matches in the order routes are registered, so with `:id` first this
 * path would arrive as a budget whose id is the word "suggestion" — a 404 that
 * looks like a missing record rather than a routing mistake.
 */
export async function GET(request: NextRequest) {
  return handle(request, suggestBudgetContract, {}, async ({ req, query }) => {
    const business = businessOf(req);
    const userId = (req as AuthedRequest).userId;
    return budgets.suggestBudget(business.id, userId, query.months ?? 6);
  });
}
