import test from "node:test";
import assert from "node:assert/strict";
import { mineItemPairs } from "./basket";

/**
 * Baskets — worked arithmetic:
 *  T1 {Mug, Coaster, Candle}  T2 {Mug, Coaster}  T3 {Mug, Candle}  T4 {Mug}
 *  Pairs: Mug+Coaster appears in T1,T2 = 2 · Mug+Candle in T1,T3 = 2 ·
 *         Coaster+Candle in T1 = 1 (below minSupport).
 * Names contain spaces to prove the miner never splits on them.
 */
test("frequently bought together: co-occurrence counts, minSupport filters singletons", () => {
  const pairs = mineItemPairs([
    { itemKeys: ["Ceramic mug", "Cork coaster", "Soy candle"] },
    { itemKeys: ["Ceramic mug", "Cork coaster"] },
    { itemKeys: ["Ceramic mug", "Soy candle"] },
    { itemKeys: ["Ceramic mug"] },
  ]);

  assert.equal(pairs.length, 2); // the count-1 pair is filtered out
  assert.deepEqual(pairs[0], { a: "Ceramic mug", b: "Cork coaster", count: 2 });
  assert.deepEqual(pairs[1], { a: "Ceramic mug", b: "Soy candle", count: 2 });
});

test("baskets: duplicate items in one transaction count once; a lone item makes no pair", () => {
  const pairs = mineItemPairs([
    { itemKeys: ["A", "A", "B"] }, // A appears twice — still one A+B for this txn
    { itemKeys: ["A", "B"] },
    { itemKeys: ["C"] },
  ]);
  assert.deepEqual(pairs, [{ a: "A", b: "B", count: 2 }]);
});
