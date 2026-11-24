import type { QueryClient } from "@tanstack/react-query";
import { getCurrentBusinessId, setCurrentBusinessId } from "@/lib/api-helpers/transport";
import { ApiError } from "@/lib/api-helpers/transport";

export { getCurrentBusinessId, setCurrentBusinessId };

/**
 * Switching business RELOADS the page. That is the design, not a shortcut.
 *
 * Seventy-four React Query keys in `api/hooks.ts` carry no business id, and the
 * legacy store keeps its own arrays besides. Adding the id to every key would
 * work until the next hook was written without it, and the failure mode is one
 * business's figures rendered under another's name — the single worst thing this
 * app can do. A reload makes a stale number impossible by construction.
 *
 * The cost is a white flash on an action nobody takes ten times a day, and the
 * same trade is already made by the dev account switcher, which has behaved this
 * way since it was written.
 */
export function switchBusiness(businessId: string, queryClient: QueryClient, to = "/dashboard"): void {
  setCurrentBusinessId(businessId);
  // Cleared as well as reloaded: a persisted cache would otherwise survive the
  // navigation and rehydrate the previous business's answers.
  queryClient.clear();
  window.location.assign(to);
}

/**
 * True when a failure means "this request did not name a business the server
 * would accept" — either none was chosen (`business_required`, 400) or the one
 * we hold is archived, deleted, or someone else's (`business_not_found`, 404).
 *
 * Both send the screens to the businesses page. Without this the app would sit
 * on a dashboard of empty states, which reads as a business with no money in it
 * rather than as a business it could not open.
 */
export function isBusinessScopeError(error: unknown): boolean {
  if (!(error instanceof ApiError)) return false;
  if (error.status !== 400 && error.status !== 404) return false;
  const code = (error.data as { error?: { code?: string } } | null)?.error?.code;
  return code === "business_required" || code === "business_not_found";
}
