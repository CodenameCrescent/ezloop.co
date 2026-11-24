import test from "node:test";
import assert from "node:assert/strict";
import {
  buildGrowthActionsFromInsights,
  updateGrowthActionStatus,
  type StoredGrowthActionMap,
} from "./growthActions";
import type { GeneratedInsight } from "./insightsEngine";

function insight(patch: Partial<GeneratedInsight>): GeneratedInsight {
  return {
    id: "summary-revenue-up-profit-down",
    type: "summary",
    title: "You sold more, but kept less",
    plainEnglishMessage:
      "You sold more, but kept less. Revenue increased, but profit dropped because costs grew faster than sales.",
    severity: "warning",
    priority: 88,
    relatedMetrics: {},
    actionHref: "/insights/profit-leaks",
    ...patch,
  };
}

test("maps insight IDs to deterministic growth actions", () => {
  const actions = buildGrowthActionsFromInsights([
    insight({ id: "summary-revenue-up-profit-down" }),
    insight({
      id: "offers-high-revenue-low-margin-prod_1",
      type: "offers",
      relatedOfferId: "prod_1",
      relatedMetrics: { offerName: "Service Package A" },
    }),
    insight({
      id: "costs-spike-rent",
      type: "costs",
      relatedMetrics: { category: "Rent" },
    }),
    insight({ id: "ads-spend-pressure", type: "ads" }),
    insight({ id: "summary-weak-cash-flow" }),
    insight({
      id: "offers-winner-prod_2",
      type: "offers",
      relatedOfferId: "prod_2",
      severity: "positive",
      priority: 64,
      relatedMetrics: { offerName: "Retainer" },
    }),
  ]);

  assert.equal(actions.length, 6);
  assert.ok(actions.some((action) => action.id === "growth-action:summary-revenue-up-profit-down"));
  assert.ok(actions.some((action) => action.title === "Improve margin before pushing more sales"));
  assert.ok(actions.some((action) => action.relatedCategory === "Rent"));
});

test("does not duplicate actions for repeated insight IDs", () => {
  const actions = buildGrowthActionsFromInsights([
    insight({ id: "ads-spend-pressure" }),
    insight({ id: "ads-spend-pressure" }),
  ]);

  assert.equal(actions.length, 1);
  assert.equal(actions[0].id, "growth-action:ads-spend-pressure");
});

test("keeps stored status when regenerating actions", () => {
  const now = new Date("2026-01-10T00:00:00.000Z");
  const first = buildGrowthActionsFromInsights([insight({ id: "summary-weak-cash-flow" })], {}, now);
  const stored = updateGrowthActionStatus({}, first[0], "done", now);
  const second = buildGrowthActionsFromInsights(
    [insight({ id: "summary-weak-cash-flow" })],
    stored,
    new Date("2026-01-11T00:00:00.000Z"),
  );

  assert.equal(second[0].status, "done");
  assert.equal(second[0].createdAt, first[0].createdAt);
});

test("updates existing action state instead of creating a second state row", () => {
  const action = buildGrowthActionsFromInsights([insight({ id: "offers-winner-prod_1" })])[0];
  const state: StoredGrowthActionMap = updateGrowthActionStatus({}, action, "in_progress");
  const next = updateGrowthActionStatus(state, action, "ignored");

  assert.equal(Object.keys(next).length, 1);
  assert.equal(next[action.id].status, "ignored");
});
