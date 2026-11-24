import * as catalog from "../services/catalog";
import { getRevenueItemDetail, type PeriodRange } from "../services/read";
import { notFound } from "../services/errors";

export function rangeOf(query: { startDate?: string; endDate?: string }): PeriodRange {
  return {
    start: query.startDate ? new Date(query.startDate) : undefined,
    end: query.endDate ? new Date(query.endDate) : undefined,
  };
}

/** Rebuild an item view (no stats) for create/update responses. */
export async function itemView(businessId: string, userId: string, id: string) {
  const detail = await getRevenueItemDetail(businessId, userId, id, {});
  if (!detail) throw notFound("Revenue item");
  return detail.item;
}

export async function resolveComponentSource(businessId: string, componentSourceId: string | null | undefined) {
  if (componentSourceId) await catalog.getSource(businessId, componentSourceId);
  return componentSourceId ?? null;
}

export function componentApi(
  c: { id: string; name: string; calcType: string; valueCents: number | null; valueRate: string | null; isFee: boolean | null; sourceId: string | null; effectiveFrom: Date; effectiveTo: Date | null },
  sourceMap: Map<string, { name: string }>,
) {
  return {
    id: c.id,
    name: c.name,
    calcType: c.calcType as "fixed_per_unit" | "percent_of_price" | "percent_of_subtotal",
    valueCents: c.valueCents ?? null,
    valueRate: c.valueRate ?? null,
    isFee: c.isFee ?? null,
    sourceId: c.sourceId ?? null,
    sourceName: c.sourceId ? sourceMap.get(c.sourceId)?.name ?? null : null,
    effectiveFrom: c.effectiveFrom.toISOString(),
    effectiveTo: c.effectiveTo ? c.effectiveTo.toISOString() : null,
  };
}
