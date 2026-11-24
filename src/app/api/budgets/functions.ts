/**
 * Server code used only by `/api/budgets`. Shared code stays in
 * `src/lib/api/functions`. Server-only: nothing in components, views or the
 * client helpers may import this file.
 */
import type { BudgetShape } from "@workspace/api-contract";
import type { Budget } from "@workspace/db";
import { monthsInSpan } from "@workspace/domain";

// ── mappers ───────────────────────────────────────────────────────

export function toApi(row: Budget): BudgetShape {
  return {
    id: row.id,
    name: row.name,
    scope: row.scope as BudgetShape["scope"],
    projectId: row.projectId ?? null,
    projectName: null,
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
    targetProfitCents: row.targetProfitCents ?? null,
    status: row.status as BudgetShape["status"],
    monthsTotal: monthsInSpan(row.periodStart, row.periodEnd),
  };
}
