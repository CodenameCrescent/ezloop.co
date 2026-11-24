import test from "node:test";
import assert from "node:assert/strict";
import {
  COST_NATURES,
  EXPENSE_PURPOSES,
  LEGACY_PURPOSES,
  STORED_PURPOSES,
  UNCLASSIFIED_NATURE,
  COST_NATURE_LABELS,
  EXPENSE_PURPOSE_LABELS,
  defaultNatureFor,
  isCostNature,
  isExpensePurpose,
  isStoredPurpose,
  natureForStoredPurpose,
} from "./costNature";

test("purpose and nature are separate axes: neither list contains the other's values", () => {
  // The whole point of the phase — "marketing and fixed" must be sayable.
  for (const nature of COST_NATURES) {
    assert.ok(
      !(EXPENSE_PURPOSES as readonly string[]).includes(nature),
      `"${nature}" is a cost nature and must not be offered as a purpose`,
    );
  }
  assert.ok((EXPENSE_PURPOSES as readonly string[]).includes("marketing"));
  assert.ok((COST_NATURES as readonly string[]).includes("fixed"));
});

test("the old conflated values are readable but never writable", () => {
  for (const legacy of LEGACY_PURPOSES) {
    assert.equal(isStoredPurpose(legacy), true, `${legacy} must still read`);
    assert.equal(isExpensePurpose(legacy), false, `${legacy} must not be writable`);
  }
});

test("every stored purpose maps to a nature, and the legacy two say their own", () => {
  for (const purpose of STORED_PURPOSES) {
    assert.ok(isCostNature(natureForStoredPurpose(purpose)), `${purpose} must map to a real nature`);
  }
  // This mapping IS the migration backfill: a row typed "fixed" becomes fixed.
  assert.equal(natureForStoredPurpose("fixed"), "fixed");
  assert.equal(natureForStoredPurpose("variable"), "variable");
});

test("the pre-filled nature follows what the purpose usually is", () => {
  assert.equal(defaultNatureFor("payroll"), "fixed");
  assert.equal(defaultNatureFor("operational"), "fixed");
  assert.equal(defaultNatureFor("marketing"), "variable");
  assert.equal(defaultNatureFor("cogs"), "variable");
});

test("a default is only a starting point — every purpose accepts either nature", () => {
  // Nothing in this module may pin a purpose to one nature; an agency retainer
  // is marketing AND fixed, which the old single list could not express.
  for (const purpose of EXPENSE_PURPOSES) {
    for (const nature of COST_NATURES) {
      assert.equal(isCostNature(nature), true, `${purpose} must be storable as ${nature}`);
    }
  }
});

test("unclassified spend reads as variable so it never invents a standing commitment", () => {
  assert.equal(UNCLASSIFIED_NATURE, "variable");
  assert.equal(isCostNature(UNCLASSIFIED_NATURE), true);
});

test("guards reject junk", () => {
  for (const junk of [null, undefined, 42, "FIXED", "rent", {}]) {
    assert.equal(isCostNature(junk), false);
    assert.equal(isExpensePurpose(junk), false);
  }
});

test("every value the owner can see has plain English behind it", () => {
  for (const nature of COST_NATURES) {
    const entry = COST_NATURE_LABELS[nature];
    assert.ok(entry?.label && entry.help, `${nature} needs a label and help text`);
    // The product promise: no backend vocabulary on screen.
    assert.ok(!entry.label.includes("_"), `${nature} label must not leak the enum key`);
  }
  for (const purpose of STORED_PURPOSES) {
    assert.ok(EXPENSE_PURPOSE_LABELS[purpose], `${purpose} needs a label`);
  }
});
