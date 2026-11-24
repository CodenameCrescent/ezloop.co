/**
 * Server code used only by `/api/sources`. Shared code stays in
 * `src/lib/api/functions`. Server-only: nothing in components, views or the
 * client helpers may import this file.
 */
import type { SourceShape } from "@workspace/api-contract";
import type { Source } from "@workspace/db";

// ── mappers ───────────────────────────────────────────────────────

export function toApi(row: Source): SourceShape {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind as SourceShape["kind"],
    platformFeePercent: row.platformFeePercent ?? null,
    defaultCurrency: row.defaultCurrency,
    status: row.status as SourceShape["status"],
    lastSyncedAt: row.lastSyncedAt ? row.lastSyncedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
