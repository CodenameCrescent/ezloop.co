import test from "node:test";
import assert from "node:assert/strict";
import { resolveSelection } from "./transactionSelection";

/**
 * The detail card is pinned open, so it always has to have something in it —
 * and it must not swap out from under someone who is reading it.
 */

test("the card opens on the newest transaction", () => {
  // The ledger comes back newest first.
  assert.equal(resolveSelection(null, ["newest", "older", "oldest"]), "newest");
});

test("a chosen transaction stays chosen while the list refreshes", () => {
  assert.equal(resolveSelection("older", ["newest", "older", "oldest"]), "older");
});

test("a selection filtered off the list falls back to the newest row", () => {
  assert.equal(resolveSelection("gone", ["newest", "older"]), "newest");
});

test("an empty list selects nothing", () => {
  assert.equal(resolveSelection("older", []), null);
  assert.equal(resolveSelection(null, []), null);
});
