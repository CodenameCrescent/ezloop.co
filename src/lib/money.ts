/**
 * Frontend money SHAPING. Cents in, display string out.
 *
 * This file shapes; it does not convert. Every function here assumes the cents
 * it is handed are already in the currency the symbol names. Converting between
 * currencies is `useFormatters()`'s job in lib/store.tsx, because conversion
 * needs the settings and this file must stay a pure function of its arguments.
 *
 * Read that boundary as a rule: **if you have a symbol from settings, you must
 * have gone through `useFormatters()` to get the number too.** Pairing a
 * settings symbol with raw API cents is what put a `$` in front of an
 * unconverted rupee figure on every insights page — a 278x overstatement, since
 * PKR_RATES.USD is 1/278. `f.moneyCents()` exists so the two can never again be
 * taken from different places.
 *
 * The UI never does money math — it only formats what the server computed
 * (CLAUDE.md).
 */
export function formatCents(cents: number, symbol = "Rs"): string {
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const whole = Math.trunc(abs / 100);
  const grouped = new Intl.NumberFormat("en-US").format(whole);
  const fraction = String(abs % 100).padStart(2, "0");
  return `${negative ? "-" : ""}${symbol} ${grouped}.${fraction}`;
}

export function formatCentsSigned(cents: number, symbol = "Rs"): string {
  const sign = cents > 0 ? "+" : cents < 0 ? "-" : "";
  return `${sign}${formatCents(Math.abs(cents), symbol)}`;
}

/** "8.6M" → "8.6M", but "8.0M" → "8M". A trailing .0 is noise at axis size. */
function trimTrailingZero(value: string): string {
  return value.endsWith(".0") ? value.slice(0, -2) : value;
}

/**
 * Magnitude only, no symbol — for axis ticks and chart labels.
 *
 * The symbol belongs ONCE on the chart's figure, not six times down a Y axis.
 *
 * Note the `Math.abs` before the magnitude test. The formatter this replaces
 * (LiquidRevenueExpenseChart's local `formatAxisValue`) tested `value >= 1e6`,
 * so a negative tick never matched any branch and -5,000,000 printed in full as
 * "-5000000" — which is exactly the axis a loss-making period draws.
 */
export function formatCompactNumber(cents: number): string {
  const rupees = cents / 100;
  const abs = Math.abs(rupees);
  const sign = rupees < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}${trimTrailingZero((abs / 1_000_000).toFixed(1))}M`;
  if (abs >= 1_000) return `${sign}${Math.round(abs / 1_000)}k`;
  return `${sign}${Math.round(abs)}`;
}

/** Compact WITH the symbol — for a hero figure large enough that exact digits stop helping. */
export function formatCompactCents(cents: number, symbol = "Rs"): string {
  const sign = cents < 0 ? "-" : "";
  return `${sign}${symbol} ${formatCompactNumber(Math.abs(cents))}`;
}

/** Rupees ⇄ cents at the input boundary (users type rupees). */
export const toCents = (rupees: number) => Math.round(rupees * 100);
export const fromCents = (cents: number) => cents / 100;

/**
 * What somebody typed in a money box → integer cents, or null if it is not an
 * amount of money.
 *
 * `toCents(Number(raw))` gave NaN for a lone "." or "-", and Infinity for
 * something like "1e999". JSON turns both into `null`, the contract rejects
 * `null` where it wants a number, and the owner was shown "Invalid request" —
 * a sentence that names no field and helps nobody. Nothing gets that far now.
 */
export function parseMoneyInput(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed || trimmed === ".") return null;
  // Digits around at most one point. Money typed into these boxes is never
  // negative — the server refuses that too, with its own message.
  if (!/^\d*\.?\d*$/.test(trimmed)) return null;
  const value = Number(trimmed);
  if (!Number.isFinite(value)) return null;
  const cents = Math.round(value * 100);
  return Number.isSafeInteger(cents) ? cents : null;
}

/** Thrown by `readMoney`, caught by a form's save to name the box that is wrong. */
export class MoneyInputError extends Error {}

/**
 * Reads a money box by the name the owner sees on it.
 *
 * The label is the whole point: the screen knows the field is called "Price",
 * the server only knows it as `unitPriceCents`, so this is the layer that can
 * say which box to go and fix.
 */
export function readMoney(label: string, raw: string): number {
  const cents = parseMoneyInput(raw);
  if (cents === null) {
    throw new MoneyInputError(`${label} needs to be an amount, like 1200 or 1200.50`);
  }
  return cents;
}

/** Same, for a box that may be left empty. */
export function readOptionalMoney(label: string, raw: string): number | null {
  return raw.trim() ? readMoney(label, raw) : null;
}

/** Contribution-margin health dot — one config the whole app reads. */
export const MARGIN_THRESHOLDS = { good: 40, warn: 20 } as const;

export function marginHealth(marginPct: number | null): "good" | "warn" | "bad" | "none" {
  if (marginPct == null) return "none";
  if (marginPct >= MARGIN_THRESHOLDS.good) return "good";
  if (marginPct >= MARGIN_THRESHOLDS.warn) return "warn";
  return "bad";
}

export const HEALTH_DOT_CLASS: Record<"good" | "warn" | "bad" | "none", string> = {
  good: "bg-emerald-500",
  warn: "bg-amber-500",
  bad: "bg-destructive",
  none: "bg-muted-foreground/40",
};
