import test from "node:test";
import assert from "node:assert/strict";
import { IMPORT_KINDS, columnsFor } from "./importColumns";

test("every kind has at least one required column", () => {
  for (const kind of IMPORT_KINDS) {
    // People is the exception: name OR email satisfies findOrCreatePerson, and
    // a per-column boolean cannot say "one of these two". Task 3's parser
    // enforces that rule instead.
    if (kind === "people") continue;
    const required = columnsFor(kind).filter((c) => c.required);
    assert.ok(required.length > 0, `${kind} has no required column`);
  }
});

test("field keys are unique within a kind", () => {
  for (const kind of IMPORT_KINDS) {
    const fields = columnsFor(kind).map((c) => c.field);
    assert.equal(new Set(fields).size, fields.length, `${kind} repeats a field key`);
  }
});

test("a synonym never points at two fields in the same kind", () => {
  // Two fields claiming "amount" would make the guess order significant and
  // therefore accidental.
  for (const kind of IMPORT_KINDS) {
    const seen = new Map<string, string>();
    for (const col of columnsFor(kind)) {
      for (const syn of col.synonyms) {
        const owner = seen.get(syn);
        assert.equal(owner, undefined, `${kind}: "${syn}" claimed by ${owner} and ${col.field}`);
        seen.set(syn, col.field);
      }
    }
  }
});

test("synonyms are already normalized: lowercase, single-spaced", () => {
  for (const kind of IMPORT_KINDS) {
    for (const col of columnsFor(kind)) {
      for (const syn of col.synonyms) {
        assert.equal(syn, syn.toLowerCase().trim().replace(/\s+/g, " "), `${kind}.${col.field}: "${syn}"`);
      }
    }
  }
});

test("a column's own label is one of its synonyms", () => {
  // Otherwise our own template would not match our own matcher.
  for (const kind of IMPORT_KINDS) {
    for (const col of columnsFor(kind)) {
      const label = col.label.toLowerCase();
      assert.ok(col.synonyms.includes(label), `${kind}.${col.field} label "${col.label}" is not a synonym`);
    }
  }
});

test("enum columns carry their values and a default first", () => {
  for (const kind of IMPORT_KINDS) {
    for (const col of columnsFor(kind)) {
      if (col.kind !== "enum") continue;
      assert.ok(col.values && col.values.length > 0, `${kind}.${col.field} has no values`);
      assert.ok(col.values.includes(col.example), `${kind}.${col.field} example is not a listed value`);
    }
  }
});

test("transactions accept the columns the ledger needs", () => {
  const fields = columnsFor("transactions").map((c) => c.field);
  for (const expected of [
    "date", "description", "amount", "moneyIn", "moneyOut", "type",
    "item", "qty", "category", "channel", "person",
    "taxCollected", "shippingCharged", "discount", "reference", "orderId", "paidOn", "notes",
  ]) {
    assert.ok(fields.includes(expected), `transactions is missing ${expected}`);
  }
});
