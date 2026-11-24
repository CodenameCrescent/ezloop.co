/**
 * Which nav links exist for this business — the ONE answer, for every rendering
 * of the nav.
 *
 * This used to live inside `Sidebar.tsx` as a private helper, and the sidebar
 * applied it in one of the two ways it draws itself. Expanded, it filtered
 * `CORE_NAV`. Collapsed — the icon rail — it rendered a second, hand-written
 * list that no feature flag ever reached, so a business with hours switched off
 * still got Hours and Worth having in the rail, and a business with projects
 * switched ON never got Projects at all.
 *
 * It stayed hidden because of an unlucky coincidence: for an ecommerce business
 * (hours on, projects off) an UNGATED list produces exactly the right answer,
 * so the rail looked correct on one demo business and identical on both.
 *
 * Pure and separate so the rule can be tested without rendering anything, and
 * so a second renderer has something to call rather than a reason to re-decide.
 *
 * Both links behind `client_profitability` reach pages whose endpoints answer
 * **403** when the feature is off, and the page reports that as "You're
 * offline" — so a link that should not be here is not a cosmetic problem.
 */

export type GatedFeature = "client_profitability" | "projects";

/** What the caller knows about this business. */
export interface NavFeatureFlags {
  /** `client_profitability` — Hours, and Worth having. */
  showTeam: boolean;
  /** `projects` — sites, contracts, production runs. */
  showProjects: boolean;
}

/**
 * Hrefs that only exist when a gated feature is on.
 *
 * Off for a shop, whose unit of work is an order: a Projects container above it
 * would be permanently empty, which reads as a feature they have failed to use.
 */
export const FEATURE_GATED_HREFS: Record<string, GatedFeature> = {
  "/record/hours": "client_profitability",
  "/insights/worth-having": "client_profitability",
  "/setup/projects": "projects",
};

/** Whether one href belongs in this business's nav. Ungated hrefs always do. */
export function navHrefAllowed(href: string, features: NavFeatureFlags): boolean {
  const gate = FEATURE_GATED_HREFS[href];
  if (gate === "client_profitability") return features.showTeam;
  if (gate === "projects") return features.showProjects;
  return true;
}

/** The same rule over a flat list of leaves, order preserved. */
export function filterGatedLeaves<T extends { href: string }>(
  leaves: readonly T[],
  features: NavFeatureFlags,
): T[] {
  return leaves.filter((leaf) => navHrefAllowed(leaf.href, features));
}
