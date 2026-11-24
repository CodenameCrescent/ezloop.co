/**
 * Server code used only by `/api/projects`. Shared code stays in
 * `src/lib/api/functions`. Server-only: nothing in components, views or the
 * client helpers may import this file.
 */
import { eq } from "drizzle-orm";
import type { ProjectShape } from "@workspace/api-contract";
import { db, peopleTable, type Project } from "@workspace/db";
import { isBusinessType, projectLabel } from "@workspace/domain";

// ── mappers ──────────────────────────────────────────────────────

/**
 * Projects — sites, contracts, production runs.
 *
 * Gated on the `projects` feature, so an ecommerce business whose unit of work
 * is an order cannot reach a container that would be permanently empty for
 * them. Every handler here carries `feature: "projects"`: the gate is the
 * server's, not the nav's — hiding a link is not gating.
 */

export async function nameMap(businessId: string): Promise<Map<string, string>> {
  const people = await db.select().from(peopleTable).where(eq(peopleTable.businessId, businessId));
  return new Map(people.map((person) => [person.id, person.displayName]));
}

export function toApi(row: Project, names: Map<string, string>): ProjectShape {
  return {
    id: row.id,
    name: row.name,
    code: row.code ?? null,
    status: row.status as ProjectShape["status"],
    personId: row.personId ?? null,
    personName: row.personId ? (names.get(row.personId) ?? null) : null,
    contractValueCents: row.contractValueCents ?? null,
    startDate: row.startDate ?? null,
    endDate: row.endDate ?? null,
    expectedEndDate: row.expectedEndDate ?? null,
    outputQty: row.outputQty ?? null,
    outputUnitLabel: row.outputUnitLabel ?? null,
    notes: row.notes ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

/** The trade's own word, so no screen has to guess what to call these. */
export function labelFor(businessTypeValue: string) {
  return projectLabel(isBusinessType(businessTypeValue) ? businessTypeValue : "service");
}
