/**
 * Server code used only by `/api/categories`. Shared code stays in
 * `src/lib/api/functions`. Server-only: nothing in components, views or the
 * client helpers may import this file.
 */
import type { CategoryShape } from "@workspace/api-contract";
import type { Category } from "@workspace/db";

// ── mappers ────────────────────────────────────────────────────

export function toApi(row: Category): CategoryShape {
  return {
    id: row.id,
    name: row.name,
    parentId: row.parentId ?? null,
    appliesTo: row.appliesTo as CategoryShape["appliesTo"],
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
