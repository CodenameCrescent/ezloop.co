/**
 * What a quantity is COUNTED IN, and how to say it.
 *
 * Every revenue item carries a `unit_label` — "hour", "unit", "month" — and
 * until now nothing on screen read it. The forms said "Qty" and the ledger said
 * "×6", so six hours of design work read as six logos. The arithmetic was
 * always right; the word beside it was not.
 *
 * The unit is the ITEM's, not the pricing model's. An item can be priced as a
 * fixed fee and still be sold by the hour — that is exactly the case that made
 * a pricing-model-driven label the wrong answer.
 */

/** Units that read naturally in the plural by adding "s". Anything else is left alone. */
const REGULAR_PLURALS = new Set(["unit", "hour", "month", "day", "week", "year", "session", "seat", "licence", "license", "item", "night", "word", "page", "class", "visit"]);

/** "hour" → "hours", "6" of them. Unknown units are left exactly as the owner typed them. */
export function pluralizeUnit(unitLabel: string, qty: number): string {
  const unit = unitLabel.trim();
  if (!unit) return "";
  if (qty === 1 || !REGULAR_PLURALS.has(unit.toLowerCase())) return unit;
  return unit.endsWith("s") ? unit : `${unit}s`;
}

/**
 * "6 hours", "1 unit", "148 units".
 *
 * Quantities are decimal STRINGS everywhere (CLAUDE.md), so this takes one and
 * prints it without inventing precision: "6" stays "6", "1.5" stays "1.5".
 */
export function formatQuantity(qty: string, unitLabel: string | null | undefined): string {
  const trimmed = (qty ?? "").trim();
  const shown = trimmed === "" ? "0" : trimmed;
  const asNumber = Number(shown);
  if (!unitLabel || !unitLabel.trim()) return shown;
  return `${shown} ${pluralizeUnit(unitLabel, Number.isFinite(asNumber) ? asNumber : 0)}`;
}

/** The word for the quantity BOX on a form: "Hours", "Units", "Months". */
export function quantityFieldLabel(unitLabel: string | null | undefined): string {
  const unit = (unitLabel ?? "").trim();
  if (!unit) return "Qty";
  const plural = pluralizeUnit(unit, 2);
  return plural.charAt(0).toUpperCase() + plural.slice(1);
}

/**
 * Whether an item's pricing model and the way it is actually SOLD disagree.
 *
 * Not auto-corrected, on the owner's instruction — the app cannot know whether
 * "Logo design, priced fixed, sold in varying hours" means the model is wrong
 * or the entries are. It says what it noticed and leaves the decision alone.
 */
export type UnitMismatch = "priced_fixed_sold_by_unit" | "priced_hourly_never_multiple" | null;

export function detectUnitMismatch(input: {
  pricingModel: string;
  unitLabel: string;
  /** How many sold lines this item has in the ledger. */
  lineCount: number;
  /** How many of those recorded a quantity other than 1. */
  linesWithNonUnitQty: number;
}): UnitMismatch {
  if (input.lineCount === 0) return null;
  const timeLike = ["hour", "hours", "day", "days", "session", "sessions"].includes(input.unitLabel.trim().toLowerCase());

  // Sold in varying amounts of a time-like unit, but not priced by it.
  if (timeLike && input.pricingModel !== "hourly" && input.linesWithNonUnitQty > 0) {
    return "priced_fixed_sold_by_unit";
  }
  // Priced by the hour, yet every sale records exactly one.
  if (input.pricingModel === "hourly" && input.linesWithNonUnitQty === 0) {
    return "priced_hourly_never_multiple";
  }
  return null;
}
