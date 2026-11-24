/**
 * Server code used only by `/api/expense-items`. Shared code stays in
 * `src/lib/api/functions`. Server-only: nothing in components, views or the
 * client helpers may import this file.
 */
import type { ExpenseItemShape } from "@workspace/api-contract";
import type { ExpenseItem } from "@workspace/db";
import * as catalog from "@/lib/api/functions/services/catalog";
import { getPerson } from "@/lib/api/functions/services/person";
import type { PeriodRange } from "@/lib/api/functions/services/read";

// ── mappers ──────────────────────────────────────────────────

export function rangeOf(query: { startDate?: string; endDate?: string }): PeriodRange {
  return {
    start: query.startDate ? new Date(query.startDate) : undefined,
    end: query.endDate ? new Date(query.endDate) : undefined,
  };
}

export function toApi(item: ExpenseItem, categoryName: string | null, vendorName: string | null): ExpenseItemShape {
  return {
    id: item.id,
    name: item.name,
    type: item.type as ExpenseItemShape["type"],
    costNature: item.costNature as ExpenseItemShape["costNature"],
    categoryId: item.categoryId ?? null,
    categoryName,
    vendorName,
    defaultAmountCents: item.defaultAmountCents ?? null,
    unitLabel: item.unitLabel ?? null,
    currency: item.currency,
    behavior: item.behavior as ExpenseItemShape["behavior"],
    status: item.status as ExpenseItemShape["status"],
    notes: item.notes ?? null,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
  };
}

export async function categoryNameOf(businessId: string, categoryId: string | null) {
  if (!categoryId) return null;
  const categories = await catalog.listCategories(businessId);
  return categories.find((c) => c.id === categoryId)?.name ?? null;
}

export async function vendorNameOf(businessId: string, vendorPersonId: string | null) {
  if (!vendorPersonId) return null;
  try {
    return (await getPerson(businessId, vendorPersonId)).displayName;
  } catch {
    return null;
  }
}
