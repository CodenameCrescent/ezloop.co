/**
 * What a chart mark is allowed to be coloured, and how a money mark carries its
 * meaning without relying on colour.
 *
 * Two vocabularies, and they never mix:
 *
 *   MONEY   gain / loss / neutral — green, red, grey. Re-exported from
 *           `insightTone.ts` rather than restated, so there stays exactly ONE
 *           definition in the app of what green means.
 *   IDENTITY cat-1..cat-5 — a category, a source, a platform. These say
 *           "different from each other" and never "more" or "better".
 *
 * Orange is absent from both, deliberately: it is the brand and interaction
 * colour, and the moment it encodes data nobody can tell whether it means
 * "brand" or "caution" (see the note at the top of insightTone.ts).
 *
 * ── Why money marks never rely on colour ────────────────────────────────────
 *
 * Measured with a colour-blindness simulator, the money green and the money red
 * separate by ΔE 4.9 under deuteranopia — below the floor of 6, against a target
 * of 8. Re-stepping cannot fix it; darkening the green made it worse (2.0).
 * Green-and-red is simply the worst pair in the space, and it is also the pair
 * this product's entire meaning rests on.
 *
 * The rule that follows is not "use different colours" — the convention is worth
 * keeping — it is: A MONEY MARK IS NEVER COLOUR ALONE. It always carries a
 * second channel that survives having the colour removed:
 *
 *   · a sign or an arrow (`moneyMark().sign`, `.Arrow`), or
 *   · position — above or below a zero rule, which is why `DivergingBar` centres
 *     its baseline rather than left-aligning both directions.
 *
 * Position is the strongest of the three, because it also needs no reading.
 */
import { ArrowDownRight, ArrowUpRight, Minus, type LucideIcon } from "lucide-react";
import { TONE_STYLE, type InsightTone } from "./insightTone";

export type { InsightTone };
export { TONE_STYLE, toneForImpact } from "./insightTone";

/** The five identity slots, in the fixed order they must be assigned. */
export type CatSlot = "cat-1" | "cat-2" | "cat-3" | "cat-4" | "cat-5";

export type ChartTone = InsightTone | CatSlot;

/**
 * Assign in order, never cycle. A sixth series folds into "Other" — a generated
 * hue is indistinguishable from an existing slot under colour-blind simulation,
 * so cycling does not add a category, it removes one.
 */
export const CAT_SLOTS: CatSlot[] = ["cat-1", "cat-2", "cat-3", "cat-4", "cat-5"];

/** How many distinct categories can be drawn before the tail must fold into "Other". */
export const MAX_CAT_SLOTS = CAT_SLOTS.length;

const CAT_FILL: Record<CatSlot, string> = {
  "cat-1": "var(--pl-cat-1)",
  "cat-2": "var(--pl-cat-2)",
  "cat-3": "var(--pl-cat-3)",
  "cat-4": "var(--pl-cat-4)",
  "cat-5": "var(--pl-cat-5)",
};

/** The fill or stroke for any tone. Marks wear this; words never do. */
export function toneFill(tone: ChartTone): string {
  if (tone in CAT_FILL) return CAT_FILL[tone as CatSlot];
  return TONE_STYLE[tone as InsightTone].stroke;
}

/**
 * Slot for the nth item in a ranked list, with everything past the fifth
 * sharing the neutral grey — which is what "Other" should look like anyway.
 */
export function slotFor(index: number): ChartTone {
  return index < MAX_CAT_SLOTS ? CAT_SLOTS[index] : "neutral";
}

export interface MoneyMark {
  tone: InsightTone;
  /** Fill/stroke — the `-solid` value, because a stroke is a fill. */
  fill: string;
  /** Text colour class — the plain value, because a word needs 4.5:1. */
  text: string;
  /** Soft wash for a pill behind the figure. */
  softBg: string;
  /** The second channel. Never render a money mark without one of these. */
  Arrow: LucideIcon;
  /** "+", "−", or "" when flat. The cheapest second channel there is. */
  sign: string;
}

/**
 * Everything a money mark needs, in one call, so the colour and its second
 * channel cannot be taken from different places.
 *
 * `goodDirection` exists because up is not always good: expenses rising is bad,
 * expenses falling is good. The ARROW follows the number (which way it moved);
 * the COLOUR follows the verdict (whether that was good news). Those are
 * different facts and a cost figure needs both.
 */
export function moneyMark(
  value: number,
  goodDirection: "up-is-good" | "down-is-good" | "neutral" = "up-is-good",
): MoneyMark {
  const flat = value === 0;
  const rose = value > 0;
  const good =
    !flat &&
    goodDirection !== "neutral" &&
    ((rose && goodDirection === "up-is-good") || (!rose && goodDirection === "down-is-good"));

  const tone: InsightTone = flat || goodDirection === "neutral" ? "neutral" : good ? "gain" : "loss";
  const style = TONE_STYLE[tone];

  return {
    tone,
    fill: style.stroke,
    text: style.text,
    softBg: style.softBg,
    Arrow: flat ? Minus : rose ? ArrowUpRight : ArrowDownRight,
    sign: flat ? "" : rose ? "+" : "−",
  };
}
