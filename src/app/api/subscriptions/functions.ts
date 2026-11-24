/**
 * Server code used only by `/api/subscriptions`. Shared code stays in
 * `src/lib/api/functions`. Server-only: nothing in components, views or the
 * client helpers may import this file.
 */
import { listSubscriptionViews } from "@/lib/api/functions/services/analytics";
import { invalid } from "@/lib/api/functions/services/errors";

// ── mappers ─────────────────────────────────────────────────

export async function findSubView(businessId: string, subscriptionId: string) {
  const views = await listSubscriptionViews(businessId);
  const view = views.find((v) => v.id === subscriptionId);
  if (!view) throw invalid("Subscription not found");
  return view;
}
