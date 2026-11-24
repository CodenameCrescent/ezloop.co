import { AsyncLocalStorage } from "node:async_hooks";

/**
 * A cache that lives exactly as long as one HTTP request.
 *
 * The read paths are deliberately composed of small, independent loaders —
 * `computePnl`, `computeLeaks`, `computeBreakEvenReport` and the rest each ask
 * for the period they need without knowing who else already asked. That
 * independence is what keeps them testable in isolation, and it is worth
 * keeping. What it costs is repetition: one Insights page load asked for the
 * SAME window eleven times, and read the whole ledger roughly six times over.
 *
 * So the deduplication happens here rather than by threading a cache argument
 * through every signature. Within one request the ledger cannot change under
 * us, so two identical loads must return identical rows — which makes reusing
 * the first one a pure optimisation, not a behaviour change.
 *
 * Scoped to GET only (see `requestCache` middleware). A request that WRITES
 * must never read its own pre-write snapshot, and the cheapest way to guarantee
 * that is to give mutating requests no cache at all.
 */
const storage = new AsyncLocalStorage<Map<string, Promise<unknown>>>();

/** Run `fn` with a fresh, empty cache that is discarded when it settles. */
export function runWithRequestCache<T>(fn: () => T): T {
  return storage.run(new Map(), fn);
}

/**
 * Return the in-flight or completed load for `key`, or start one.
 *
 * The PROMISE is cached rather than the resolved value, which is what makes
 * this work inside a `Promise.all`: six callers that start the same load in the
 * same tick share one query instead of racing to fill the cache after it.
 *
 * Outside a request (scripts, jobs, tests) there is no store and every call
 * loads normally — the cache is an optimisation, never a requirement.
 */
export function cachedRead<T>(key: string, load: () => Promise<T>): Promise<T> {
  const store = storage.getStore();
  if (!store) return load();

  const hit = store.get(key) as Promise<T> | undefined;
  if (hit) return hit;

  const pending = load();
  store.set(key, pending);
  // A failed load must not be remembered: the next caller in the same request
  // deserves a real attempt rather than a replay of the rejection.
  pending.catch(() => store.delete(key));
  return pending;
}

/** Express middleware giving each GET its own cache. */
export function requestCache(): (req: { method: string }, res: unknown, next: () => void) => void {
  return (req, _res, next) => {
    if (req.method !== "GET") return next();
    runWithRequestCache(next);
  };
}
