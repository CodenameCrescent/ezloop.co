/**
 * Market-basket mining: which items get bought TOGETHER. A pair "supports" a
 * count for every transaction whose lines contain both. Pure and deterministic
 * (pairs are ordered a<b; ties broken by name), minSupport filters noise.
 */

export interface BasketTransaction {
  /** Distinct item identifiers/names from ONE sale's revenue lines. */
  itemKeys: string[];
}

export interface ItemPair {
  a: string;
  b: string;
  count: number;
}

export function mineItemPairs(transactions: BasketTransaction[], minSupport = 2, cap = 20): ItemPair[] {
  // Nested map (a → b → count) so item names may contain any character.
  const counts = new Map<string, Map<string, number>>();
  for (const txn of transactions) {
    // Distinct + sorted so each unordered pair is counted once per transaction.
    const items = [...new Set(txn.itemKeys)].sort();
    for (let i = 0; i < items.length; i += 1) {
      for (let j = i + 1; j < items.length; j += 1) {
        const inner = counts.get(items[i]) ?? new Map<string, number>();
        inner.set(items[j], (inner.get(items[j]) ?? 0) + 1);
        counts.set(items[i], inner);
      }
    }
  }
  const pairs: ItemPair[] = [];
  for (const [a, inner] of counts) {
    for (const [b, count] of inner) {
      if (count >= minSupport) pairs.push({ a, b, count });
    }
  }
  return pairs.sort((x, y) => y.count - x.count || (x.a < y.a ? -1 : x.a > y.a ? 1 : x.b < y.b ? -1 : 1)).slice(0, cap);
}
