/**
 * Server code used only by `/api/fx-rate`. Shared code stays in
 * `src/lib/api/functions`. Server-only: nothing in components, views or the
 * client helpers may import this file.
 */
import { isValidFxRate } from "@workspace/domain";

// ── fxRates ──────────────────────────────────────────────────────

/**
 * Today's exchange rate, as a SUGGESTION for an entry typed in another
 * currency. The owner can overwrite it (to match what their bank actually
 * paid), and the rate saved is always the one they send — this lookup never
 * decides what money is worth.
 *
 * open.er-api.com: free, no key, daily rates, and it carries PKR (the ECB-based
 * free feeds do not). Asked at most twice a day per currency; a failure is not
 * remembered, and simply means the owner types the rate.
 */

const PROVIDER = "https://open.er-api.com/v6/latest/";
const KEEP_FOR_MS = 12 * 60 * 60 * 1000;
const GIVE_UP_AFTER_MS = 4000;
const CURRENCY_CODE = /^[A-Z]{3}$/;

type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

interface Cached {
  rates: Record<string, number>;
  asOf: string | null;
  fetchedAt: number;
}

const cache = new Map<string, Cached>();
let fetcher: Fetcher = (url, init) => fetch(url, init);

/** Swap the network call out in tests; null restores the real one. Clears the cache. */
export function setFxFetcherForTests(fake: Fetcher | null) {
  fetcher = fake ?? ((url, init) => fetch(url, init));
  cache.clear();
}

async function ratesFor(from: string, fresh: boolean): Promise<Cached | null> {
  const hit = cache.get(from);
  if (hit && !fresh && Date.now() - hit.fetchedAt < KEEP_FOR_MS) return hit;
  try {
    const res = await fetcher(`${PROVIDER}${from}`, { signal: AbortSignal.timeout(GIVE_UP_AFTER_MS) });
    if (!res.ok) return null;
    const body = (await res.json()) as { result?: string; rates?: Record<string, number>; time_last_update_utc?: string };
    if (body.result !== "success" || !body.rates) return null;
    const published = body.time_last_update_utc ? new Date(body.time_last_update_utc) : null;
    const entry: Cached = {
      rates: body.rates,
      asOf: published && !Number.isNaN(published.getTime()) ? published.toISOString() : null,
      fetchedAt: Date.now(),
    };
    cache.set(from, entry);
    return entry;
  } catch {
    return null;
  }
}

export async function lookupFxRate(from: string, to: string, opts: { fresh?: boolean } = {}) {
  const none = { from, to, rate: null, asOf: null };
  if (!CURRENCY_CODE.test(from) || !CURRENCY_CODE.test(to)) return none;
  const found = await ratesFor(from, opts.fresh ?? false);
  const value = found?.rates[to];
  if (typeof value !== "number" || !Number.isFinite(value)) return none;
  // Two places, the way a bank quotes it; six when the rate is below one, or a
  // rupee-to-dollar rate would round to nothing. Written out in full because
  // String() of a small number goes exponential, which is not a decimal string.
  const rate = value.toFixed(value >= 1 ? 2 : 6).replace(/\.?0+$/, "");
  if (!isValidFxRate(rate)) return none;
  return { from, to, rate, asOf: found!.asOf };
}
