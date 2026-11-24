/**
 * Server code used only by `/api/client-customers`. Shared code stays in
 * `src/lib/api/functions`. Server-only: nothing in components, views or the
 * client helpers may import this file.
 */
import type { ClientCustomer } from "@workspace/api-contract";
import type { Person } from "@workspace/db";

// ── mappers ───────────────────────────────────────────────

/**
 * TODO(R5): delete. Bridge: the pre-R4 client-customers contract endpoints now
 * serve customer-kind rows from the new `people` table, keeping the current
 * People page + analytics adapter working until R4.7 rebuilds them on the
 * native /people endpoints.
 */
export function toApi(row: Person): ClientCustomer {
  return {
    id: row.id,
    type: "customer",
    name: row.displayName,
    phone: row.phone ?? null,
    email: row.email ?? null,
    companyName: row.company ?? null,
    notes: row.notes ?? null,
    legacyCustomerKey: null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
