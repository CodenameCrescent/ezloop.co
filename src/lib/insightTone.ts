/**
 * The three-colour language for Insights (DESIGN.md rule 2, INSIGHTS.md
 * § Visual language).
 *
 * Green = money gained. Red = money lost. Grey = neutral. That is the ENTIRE
 * vocabulary here: no category colours, no rainbow charts, no gradients. If the
 * reader sees red, something cost them.
 *
 * **Orange never appears.** It is the brand and interaction colour — the active
 * tab, the primary button, a focus ring — and the moment it encodes data nobody
 * can tell whether it means "brand" or "caution", which collapses the whole
 * system. This file has no orange in it for that reason.
 *
 * Every Insights surface reads tone from here so the language cannot drift page
 * to page. Tone comes from the sign of server-computed impact cents — this
 * module classifies, it never does money math (CLAUDE.md).
 */

export type InsightTone = "gain" | "loss" | "neutral";

/**
 * Sign of the impact decides the colour. `neutral` is for the genuinely
 * informational card — a fact worth surfacing that neither made nor cost money.
 */
export function toneForImpact(impactCents: number): InsightTone {
  if (impactCents > 0) return "gain";
  if (impactCents < 0) return "loss";
  return "neutral";
}

interface ToneStyle {
  /** The impact figure — the largest, and the only always-coloured text on the card. */
  text: string;
  /** Sparkline stroke and any bar fill. The `-solid` value, because a stroke is a fill. */
  stroke: string;
  /** Soft wash behind pills and badges. */
  softBg: string;
  /** Left edge, used for urgent cards only. */
  edge: string;
}

/**
 * Text uses the plain token (it is a word, and needs 4.5:1); strokes and edges
 * use `-solid` (they are fills, and need 3:1). That split is DESIGN.md rule 3,
 * and it exists because the previous palette used one value for both and the
 * two colours the product's meaning rests on were the two hardest to read.
 */
export const TONE_STYLE: Record<InsightTone, ToneStyle> = {
  gain: {
    text: "text-[color:var(--pl-green)]",
    stroke: "var(--pl-green-solid)",
    softBg: "bg-[color:var(--pl-green-tint)]",
    edge: "bg-[color:var(--pl-green-solid)]",
  },
  loss: {
    text: "text-[color:var(--pl-red)]",
    stroke: "var(--pl-red-solid)",
    softBg: "bg-[color:var(--pl-red-tint)]",
    edge: "bg-[color:var(--pl-red-solid)]",
  },
  neutral: {
    text: "text-[color:var(--pl-ink-2)]",
    stroke: "var(--pl-ink-3)",
    softBg: "bg-[color:var(--pl-recessed)]",
    edge: "bg-[color:var(--pl-ink-3)]",
  },
};

/**
 * A dismissed card comes back only when the underlying condition changes
 * materially — permanent dismissal would mean the app quietly stopped warning
 * about a real leak (INSIGHTS.md § card controls).
 */
export const DISMISS_RESURFACE_PCT = 15;

/**
 * Has the condition moved enough to bring a dismissed card back? Both figures
 * are server-computed cents; this only compares them.
 */
export function shouldResurface(dismissedAtCents: number, currentCents: number): boolean {
  if (dismissedAtCents === 0) return currentCents !== 0;
  const movedPct = (Math.abs(currentCents - dismissedAtCents) / Math.abs(dismissedAtCents)) * 100;
  return movedPct >= DISMISS_RESURFACE_PCT;
}
