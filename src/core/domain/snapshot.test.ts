import test from "node:test";
import assert from "node:assert/strict";
import { buildCostSnapshot } from "./snapshot";
import type { CostComponentInput } from "./types";

const JAN = "2026-01-01T00:00:00.000Z";
const MAR = "2026-03-01T00:00:00.000Z";

function component(patch: Partial<CostComponentInput>): CostComponentInput {
  return {
    name: "Materials",
    calcType: "fixed_per_unit",
    valueCents: 350,
    valueRate: null,
    isFee: null,
    sourceId: null,
    effectiveFrom: JAN,
    effectiveTo: null,
    ...patch,
  };
}

test("snapshot resolution: fixed + percent with half-up rounding, source-scoped component filtered", () => {
  const components: CostComponentInput[] = [
    component({ name: "Materials", calcType: "fixed_per_unit", valueCents: 350 }),
    component({
      name: "Platform fee",
      calcType: "percent_of_price",
      valueCents: null,
      valueRate: "20",
      sourceId: "src_fiverr",
    }),
    component({ name: "Processor", calcType: "percent_of_subtotal", valueCents: null, valueRate: "2.5" }),
  ];

  // Manual sale: platform fee (scoped to src_fiverr) must NOT apply.
  // Processor: 2.5% of 999 = 24.975 → half-up → 25. Total 350 + 25 = 375.
  const manual = buildCostSnapshot({ components, occurredAt: MAR, sourceId: "src_manual", unitPriceCents: 999 });
  assert.equal(manual.components.length, 2);
  assert.deepEqual(
    manual.components.map((c) => [c.name, c.per_unit_cents, c.kind]),
    [
      ["Materials", 350, "cost"],
      ["Processor", 25, "fee"],
    ],
  );
  assert.equal(manual.total_per_unit_cents, 375);

  // Fiverr sale: + 20% of 999 = 199.8 → 200. Total 575.
  const fiverr = buildCostSnapshot({ components, occurredAt: MAR, sourceId: "src_fiverr", unitPriceCents: 999 });
  assert.equal(fiverr.components.length, 3);
  assert.equal(fiverr.total_per_unit_cents, 575);
  assert.equal(fiverr.components.find((c) => c.name === "Platform fee")?.kind, "fee");
});

test("is_fee overrides the calc-type default kind", () => {
  const snapshot = buildCostSnapshot({
    components: [
      component({ name: "Handling surcharge", isFee: true }), // fixed_per_unit would default to cost
      component({
        name: "Negotiated commission",
        calcType: "percent_of_price",
        valueCents: null,
        valueRate: "10",
        isFee: false, // percent would default to fee
      }),
    ],
    occurredAt: MAR,
    sourceId: "src_manual",
    unitPriceCents: 1000,
  });
  assert.equal(snapshot.components.find((c) => c.name === "Handling surcharge")?.kind, "fee");
  assert.equal(snapshot.components.find((c) => c.name === "Negotiated commission")?.kind, "cost");
});

test("effective dating: an edit changes new snapshots, old snapshots stay byte-identical", () => {
  // Materials cost 350 until Mar 1 (exclusive), 400 from Mar 1 — the closed +
  // open pair an effective-dated edit produces.
  const versions: CostComponentInput[] = [
    component({ valueCents: 350, effectiveFrom: JAN, effectiveTo: MAR }),
    component({ valueCents: 400, effectiveFrom: MAR, effectiveTo: null }),
  ];

  const beforeEdit = buildCostSnapshot({
    components: versions,
    occurredAt: "2026-02-10T12:00:00.000Z",
    sourceId: "src_manual",
    unitPriceCents: 1000,
  });
  assert.equal(beforeEdit.total_per_unit_cents, 350);

  // Boundary: effective_from inclusive, effective_to exclusive.
  const atBoundary = buildCostSnapshot({
    components: versions,
    occurredAt: MAR,
    sourceId: "src_manual",
    unitPriceCents: 1000,
  });
  assert.equal(atBoundary.total_per_unit_cents, 400);
  assert.equal(atBoundary.components.length, 1);

  const afterEdit = buildCostSnapshot({
    components: versions,
    occurredAt: "2026-03-10T12:00:00.000Z",
    sourceId: "src_manual",
    unitPriceCents: 1000,
  });
  assert.equal(afterEdit.total_per_unit_cents, 400);

  // Rebuilding the OLD transaction's snapshot yields byte-identical JSON —
  // history never moves.
  const rebuilt = buildCostSnapshot({
    components: versions,
    occurredAt: "2026-02-10T12:00:00.000Z",
    sourceId: "src_manual",
    unitPriceCents: 1000,
  });
  assert.equal(JSON.stringify(rebuilt), JSON.stringify(beforeEdit));
});

test("invalid component values throw instead of producing wrong money", () => {
  assert.throws(
    () =>
      buildCostSnapshot({
        components: [component({ calcType: "percent_of_price", valueCents: null, valueRate: null })],
        occurredAt: MAR,
        sourceId: "src_manual",
        unitPriceCents: 1000,
      }),
    TypeError,
  );
  assert.throws(
    () =>
      buildCostSnapshot({
        components: [component({ valueCents: null })],
        occurredAt: MAR,
        sourceId: "src_manual",
        unitPriceCents: 1000,
      }),
    TypeError,
  );
});
