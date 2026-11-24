/**
 * Server code used only by `/api/businesses`. Shared code stays in
 * `src/lib/api/functions`. Server-only: nothing in components, views or the
 * client helpers may import this file.
 */
import type { BusinessSummaryShape } from "@workspace/api-contract";
import type { Business } from "@workspace/db";
import { isBusinessType } from "@workspace/domain";

// ── mappers ────────────────────────────────────────────────────

/**
 * The workspace layer. These are the ONLY authenticated endpoints that do not
 * pass through the business guard — they are how a user finds out which
 * businesses they have, which is a question that cannot presuppose one.
 */
export function toApi(row: Business): BusinessSummaryShape {
  return {
    id: row.id,
    name: row.name,
    businessType: isBusinessType(row.businessType) ? row.businessType : "ecommerce",
    currency: row.baseCurrency,
    currencySymbol: row.currencySymbol,
    archivedAt: row.archivedAt ? row.archivedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}
