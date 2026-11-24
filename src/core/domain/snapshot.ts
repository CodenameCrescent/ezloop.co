import { percentOfCents } from "./money";
import type { CostComponentInput, CostSnapshot, SnapshotComponent } from "./types";

function toTime(value: Date | string): number {
  return (value instanceof Date ? value : new Date(value)).getTime();
}

/**
 * Is this component version in force at the given instant? effective_from is
 * inclusive, effective_to exclusive (a closed version ends the moment its
 * successor starts).
 */
export function isEffectiveAt(component: CostComponentInput, occurredAt: Date | string): boolean {
  const at = toTime(occurredAt);
  if (toTime(component.effectiveFrom) > at) return false;
  if (component.effectiveTo !== null && component.effectiveTo !== undefined && toTime(component.effectiveTo) <= at) {
    return false;
  }
  return true;
}

/**
 * Resolves a revenue item's cost components into the frozen per-unit snapshot
 * written onto a transaction line at creation. Never recomputed afterwards.
 *
 * - Only components effective at `occurredAt` AND scoped to this sale's source
 *   (source_id null = all sources) participate.
 * - Percent components resolve against the UNDISCOUNTED unit price, rounded
 *   half-up per unit. (percent_of_price and percent_of_subtotal share that
 *   base today; the distinction is intent — subtotal-based order-level fee
 *   bases arrive with the engines that need them.)
 * - kind: percent components default to "fee" (platform cut, processor fee),
 *   fixed_per_unit defaults to "cost" (COGS-like) — overridable per component
 *   via is_fee.
 */
export function buildCostSnapshot(args: {
  components: CostComponentInput[];
  occurredAt: Date | string;
  sourceId: string;
  unitPriceCents: number;
  qty?: string;
}): CostSnapshot {
  const { components, occurredAt, sourceId, unitPriceCents } = args;
  if (!Number.isSafeInteger(unitPriceCents)) {
    throw new TypeError(`buildCostSnapshot: unitPriceCents must be integer cents, got ${unitPriceCents}`);
  }

  const resolved: SnapshotComponent[] = [];
  for (const component of components) {
    if (!isEffectiveAt(component, occurredAt)) continue;
    if (component.sourceId !== null && component.sourceId !== undefined && component.sourceId !== sourceId) {
      continue;
    }

    let perUnitCents: number;
    let input: string;
    if (component.calcType === "fixed_per_unit") {
      if (component.valueCents === null || component.valueCents === undefined) {
        throw new TypeError(`buildCostSnapshot: component "${component.name}" is fixed_per_unit but has no value_cents`);
      }
      perUnitCents = component.valueCents;
      input = String(component.valueCents);
    } else {
      if (!component.valueRate) {
        throw new TypeError(`buildCostSnapshot: component "${component.name}" is ${component.calcType} but has no value_rate`);
      }
      perUnitCents = percentOfCents(unitPriceCents, component.valueRate);
      input = component.valueRate;
    }

    const kind =
      component.isFee === true || (component.isFee == null && component.calcType !== "fixed_per_unit")
        ? "fee"
        : "cost";

    resolved.push({ name: component.name, calc: component.calcType, input, per_unit_cents: perUnitCents, kind });
  }

  return {
    version: 1,
    components: resolved,
    total_per_unit_cents: resolved.reduce((sum, component) => sum + component.per_unit_cents, 0),
  };
}
