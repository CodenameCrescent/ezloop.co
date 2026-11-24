import test from "node:test";
import assert from "node:assert/strict";
import {
  BUSINESS_TYPES,
  GATED_FEATURES,
  projectLabel,
  featureDefault,
  featureEnabled,
  isFeatureOverridden,
  resolveFeatures,
  sanitizeFeatureOverrides,
} from "./capabilities";

test("every gated feature belongs to exactly one type by default", () => {
  // The map points BOTH ways: fulfilment features are ecommerce-shaped, and
  // attributing labour to clients is service-shaped. What must hold for every
  // feature is that it is on for one type and off for the other — a feature on
  // for both would be pointless, and one on for neither is unreachable.
  for (const feature of GATED_FEATURES) {
    const ecommerce = featureDefault("ecommerce", feature);
    const service = featureDefault("service", feature);
    assert.notEqual(ecommerce, service, `${feature} must distinguish the two business types`);
  }
});

test("a service business sees the client work and none of the fulfilment features", () => {
  assert.deepEqual(resolveFeatures("service"), {
    order_outcomes: false,
    rto: false,
    courier_cost_rules: false,
    cod_fees: false,
    client_profitability: true,
    projects: true,
  });
});

test("an ecommerce business sees the fulfilment features and not the client work", () => {
  assert.deepEqual(resolveFeatures("ecommerce"), {
    order_outcomes: true,
    rto: true,
    courier_cost_rules: true,
    cod_fees: true,
    client_profitability: false,
    projects: false,
  });
});

test("the service-shaped feature overrides in both directions like any other", () => {
  // An ecommerce seller who also does client work turns it on.
  assert.equal(featureEnabled("ecommerce", "client_profitability", { client_profitability: true }), true);
  // An agency that doesn't want it turns it off.
  assert.equal(featureEnabled("service", "client_profitability", { client_profitability: false }), false);
  // And clearing the choice returns to the type's default.
  assert.equal(featureEnabled("service", "client_profitability", { client_profitability: null }), true);
});

test("the owner's choice beats the business type, per feature and in both directions", () => {
  // A service business that does ship merch turns just courier rules on.
  assert.equal(featureEnabled("service", "courier_cost_rules", { courier_cost_rules: true }), true);
  // Its other features stay hidden — the toggle is per feature, not a master switch.
  assert.equal(featureEnabled("service", "rto", { courier_cost_rules: true }), false);
  // An ecommerce seller who doesn't do cash-on-delivery turns that one off.
  assert.equal(featureEnabled("ecommerce", "cod_fees", { cod_fees: false }), false);
  assert.equal(featureEnabled("ecommerce", "rto", { cod_fees: false }), true);
});

test("no choice means follow the type, so changing type still moves the default", () => {
  for (const empty of [null, undefined, {}]) {
    assert.equal(featureEnabled("service", "rto", empty), false);
    assert.equal(featureEnabled("ecommerce", "rto", empty), true);
  }
});

test("an explicit false is not the same as never having chosen", () => {
  // Both hide RTO today, but only the override survives switching to ecommerce.
  assert.equal(featureEnabled("service", "rto", { rto: false }), false);
  assert.equal(featureEnabled("service", "rto", {}), false);
  assert.equal(featureEnabled("ecommerce", "rto", { rto: false }), false);
  assert.equal(featureEnabled("ecommerce", "rto", {}), true);
});

test("overridden only when the choice disagrees with the default", () => {
  assert.equal(isFeatureOverridden("service", "rto", { rto: true }), true);
  assert.equal(isFeatureOverridden("ecommerce", "rto", { rto: false }), true);
  // Choosing what the type already implies is not an override.
  assert.equal(isFeatureOverridden("ecommerce", "rto", { rto: true }), false);
  assert.equal(isFeatureOverridden("service", "rto", { rto: false }), false);
  assert.equal(isFeatureOverridden("service", "rto", {}), false);
});

test("a null choice reads as never-chosen, so clearing returns to the type's default", () => {
  assert.equal(featureEnabled("ecommerce", "rto", { rto: null }), true);
  assert.equal(featureEnabled("service", "rto", { rto: null }), false);
  assert.equal(isFeatureOverridden("ecommerce", "rto", { rto: null }), false);
});

test("unknown keys and non-booleans are dropped so a stale payload cannot widen access", () => {
  const cleaned = sanitizeFeatureOverrides({
    rto: true,
    inventory: true, // not a gated feature
    cod_fees: "yes", // not a boolean
    order_outcomes: false,
  });
  assert.deepEqual(cleaned, { rto: true, order_outcomes: false });

  for (const junk of [null, undefined, "rto", 42, ["rto"]]) {
    assert.deepEqual(sanitizeFeatureOverrides(junk), {});
  }
});

test("the trades that work in discrete pieces get projects; a shop does not", () => {
  // The unit of work in ecommerce is an order. A second container above it
  // would be permanently empty, which is worse than absent — it reads as a
  // feature the owner has failed to use.
  assert.equal(featureDefault("construction", "projects"), true);
  assert.equal(featureDefault("manufacturing", "projects"), true);
  assert.equal(featureDefault("service", "projects"), true);
  assert.equal(featureDefault("ecommerce", "projects"), false);
});

test("a factory runs production runs, a builder runs projects — same concept, its own word", () => {
  assert.equal(projectLabel("manufacturing").one, "Production run");
  assert.equal(projectLabel("manufacturing").many, "Production runs");
  assert.equal(projectLabel("construction").one, "Project");
  assert.equal(projectLabel("service").many, "Projects");
});

test("every business type has a project label, so no screen can render undefined", () => {
  for (const type of BUSINESS_TYPES) {
    const label = projectLabel(type);
    assert.ok(label.one.length > 0, `${type} needs a singular`);
    assert.ok(label.many.length > 0, `${type} needs a plural`);
  }
});
