import test from "node:test";
import assert from "node:assert/strict";
import { FEATURE_GATED_HREFS, filterGatedLeaves, navHrefAllowed } from "./navVisibility";

/**
 * The defect this exists for.
 *
 * The sidebar gated its nav in ONE of its two renderings. Expanded, it ran
 * `CORE_NAV` through `filterNavItems`. Collapsed — the icon rail, which is what
 * `profit_loop_sidebar_collapsed` leaves most people looking at — it rendered a
 * second, hand-written list that no feature flag ever reached.
 *
 * So on a construction business with hours OFF and projects ON, the rail showed
 * Hours and Worth having (both gated off, both leading to a 403 the page
 * reports as "You're offline") and never showed Projects at all. The reason it
 * took so long to see: on an ecommerce business — hours ON, projects OFF — an
 * ungated list produces exactly the right answer by coincidence, so the rail
 * looked correct on one of the two demo businesses and identical on both.
 *
 * The rule now lives here, once, and both renderings ask it.
 */

const ALL_ON = { showTeam: true, showProjects: true };
const ALL_OFF = { showTeam: false, showProjects: false };
/** The construction demo: hours off, projects on. The case that was wrong both ways. */
const BUILDER = { showTeam: false, showProjects: true };
/** The ecommerce demo: hours on, projects off. The case that hid the bug. */
const SHOP = { showTeam: true, showProjects: false };

test("a gated href is allowed only when its own feature is on", () => {
  assert.equal(navHrefAllowed("/record/hours", ALL_ON), true);
  assert.equal(navHrefAllowed("/record/hours", ALL_OFF), false);
  assert.equal(navHrefAllowed("/insights/worth-having", ALL_ON), true);
  assert.equal(navHrefAllowed("/insights/worth-having", ALL_OFF), false);
  assert.equal(navHrefAllowed("/setup/projects", ALL_ON), true);
  assert.equal(navHrefAllowed("/setup/projects", ALL_OFF), false);
});

test("the two gates are independent — the builder case, which was wrong in both directions", () => {
  // Hours off means hours and Worth having go...
  assert.equal(navHrefAllowed("/record/hours", BUILDER), false);
  assert.equal(navHrefAllowed("/insights/worth-having", BUILDER), false);
  // ...and projects on means Projects stays. The rail showed the exact opposite
  // of all three.
  assert.equal(navHrefAllowed("/setup/projects", BUILDER), true);
});

test("the shop case is the one that looked right by accident", () => {
  // An ungated list gives this answer too, which is why nobody saw it.
  assert.equal(navHrefAllowed("/record/hours", SHOP), true);
  assert.equal(navHrefAllowed("/insights/worth-having", SHOP), true);
  assert.equal(navHrefAllowed("/setup/projects", SHOP), false);
});

test("an ungated href is always allowed, whatever is switched off", () => {
  for (const href of ["/dashboard", "/record/transactions", "/money", "/settings", "/integrations"]) {
    assert.equal(navHrefAllowed(href, ALL_OFF), true, `${href} is not gated and must always show`);
  }
});

test("filterGatedLeaves drops exactly the leaves whose feature is off, and keeps order", () => {
  const rail = [
    { href: "/dashboard" },
    { href: "/record/transactions" },
    { href: "/record/hours" },
    { href: "/setup/projects" },
    { href: "/insights/worth-having" },
    { href: "/settings" },
  ];

  assert.deepEqual(
    filterGatedLeaves(rail, BUILDER).map((leaf) => leaf.href),
    ["/dashboard", "/record/transactions", "/setup/projects", "/settings"],
  );
  assert.deepEqual(
    filterGatedLeaves(rail, SHOP).map((leaf) => leaf.href),
    ["/dashboard", "/record/transactions", "/record/hours", "/insights/worth-having", "/settings"],
  );
  assert.deepEqual(filterGatedLeaves(rail, ALL_ON).map((leaf) => leaf.href), rail.map((leaf) => leaf.href));
});

test("every gated href names a feature the flags actually carry", () => {
  // A typo in the map is silent: an href nobody gates renders always, which is
  // the failure this whole module exists to stop.
  for (const [href, feature] of Object.entries(FEATURE_GATED_HREFS)) {
    assert.ok(
      feature === "client_profitability" || feature === "projects",
      `${href} is gated on "${feature}", which is not a flag`,
    );
  }
});
