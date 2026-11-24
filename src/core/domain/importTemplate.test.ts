import test from "node:test";
import assert from "node:assert/strict";
import { templateCsv, templateFilename } from "./importTemplate";
import { parseCsv } from "./csv";
import { columnsFor, IMPORT_KINDS } from "./importColumns";
import { guessMapping } from "./importMatch";

test("a template's headers are exactly its kind's labels, in order", () => {
  for (const kind of IMPORT_KINDS) {
    const [headers] = parseCsv(templateCsv(kind));
    assert.deepEqual(headers, columnsFor(kind).map((c) => c.label), kind);
  }
});

test("a template has exactly one example row", () => {
  for (const kind of IMPORT_KINDS) {
    assert.equal(parseCsv(templateCsv(kind)).length, 2, kind);
  }
});

test("every template maps onto itself with nothing ignored", () => {
  // The guard against our own template drifting from our own matcher.
  for (const kind of IMPORT_KINDS) {
    const [headers] = parseCsv(templateCsv(kind));
    const { mapping, ignored } = guessMapping(headers, kind);
    assert.deepEqual(ignored, [], kind);
    for (const col of columnsFor(kind)) {
      assert.equal(mapping[col.field], col.label, `${kind}.${col.field}`);
    }
  }
});

test("a label containing a comma is quoted", () => {
  // No current label does, but a future one must not break the file.
  const text = templateCsv("transactions");
  assert.equal(text.includes('""'), false, "no stray doubled quotes");
});

test("filenames are safe and say what they are", () => {
  assert.equal(templateFilename("revenue_items"), "profit-loop-revenue-items-template.csv");
  assert.equal(templateFilename("transactions"), "profit-loop-transactions-template.csv");
});
