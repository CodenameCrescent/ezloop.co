/**
 * What an expense IS FOR versus HOW IT BEHAVES — two questions, two fields.
 *
 * The single `type` list conflated them: it offered "fixed" and "variable"
 * alongside "marketing" and "payroll", so "marketing AND fixed" (a retainer to
 * an agency) was unsayable, and every marketing spend was implicitly variable.
 * Nothing could ever be classified fixed and mean it, which is why break-even
 * read zero.
 *
 * So:
 *   - PURPOSE (`type`)      — what the money bought. A label for grouping.
 *   - COST NATURE           — does it grow with sales? Behaviour; drives math.
 *
 * Both live here because the server (validating, seeding, computing break-even)
 * and the UI (rendering the two controls) must agree; two copies would drift.
 *
 * This module is vocabulary and defaults only. The break-even math that CONSUMES
 * a cost nature lives in ./breakeven.
 */

/**
 * Does this cost grow when sales grow?
 *
 * - `fixed` — the same whether you sell nothing or everything (rent, salaries).
 * - `variable` — rises and falls with sales (ad spend, packaging, commissions).
 * - `semi_variable` — a fixed base plus a usage part (a phone plan, a tiered
 *   software bill). Splitting the two halves needs the allocation machinery
 *   scheduled for a later phase; until then break-even treats it as fixed,
 *   which errs toward a HIGHER break-even target rather than a flattering one.
 */
export const COST_NATURES = ["fixed", "variable", "semi_variable"] as const;
export type CostNature = (typeof COST_NATURES)[number];

/**
 * What the money was for. Purely a grouping label — it never changes math.
 *
 * `fixed` and `variable` are absent by design: they are natures, not purposes.
 * They survive in the stored data (see LEGACY_PURPOSES) but may not be chosen
 * again, which is what stops the conflation coming back.
 */
export const EXPENSE_PURPOSES = [
  "marketing",
  "operational",
  "maintenance",
  "payroll",
  "cogs",
  "custom",
] as const;
export type ExpensePurpose = (typeof EXPENSE_PURPOSES)[number];

/**
 * Purposes that exist in stored rows but can no longer be chosen. Reads accept
 * them so history renders untouched; writes reject them so the two axes stay
 * separate from here on.
 */
export const LEGACY_PURPOSES = ["fixed", "variable"] as const;
export type LegacyPurpose = (typeof LEGACY_PURPOSES)[number];

/** Every purpose value a stored row may carry — the read vocabulary. */
export const STORED_PURPOSES = [...EXPENSE_PURPOSES, ...LEGACY_PURPOSES] as const;
export type StoredPurpose = (typeof STORED_PURPOSES)[number];

export function isCostNature(value: unknown): value is CostNature {
  return typeof value === "string" && (COST_NATURES as readonly string[]).includes(value);
}

/** True only for purposes that may be WRITTEN. Legacy values fail this on purpose. */
export function isExpensePurpose(value: unknown): value is ExpensePurpose {
  return typeof value === "string" && (EXPENSE_PURPOSES as readonly string[]).includes(value);
}

export function isStoredPurpose(value: unknown): value is StoredPurpose {
  return typeof value === "string" && (STORED_PURPOSES as readonly string[]).includes(value);
}

/**
 * The nature to PRE-FILL when the owner hasn't said. A starting point in the
 * form, never a silent override: whatever the owner leaves in the field is what
 * gets stored, and they can always disagree with these.
 *
 * Reasoning per purpose: payroll and the general operational bucket are the
 * things you owe whether or not you sell; marketing, goods sold, and repairs
 * track activity. `custom` is unknowable, so it takes the safer-for-the-owner
 * default (see UNCLASSIFIED_NATURE).
 */
const DEFAULT_NATURE_BY_PURPOSE: Record<ExpensePurpose, CostNature> = {
  marketing: "variable",
  operational: "fixed",
  maintenance: "variable",
  payroll: "fixed",
  cogs: "variable",
  custom: "variable",
};

/**
 * How the old conflated `type` maps onto the new nature, used once by the
 * migration backfill and again whenever a legacy row is read. The two legacy
 * values say their nature outright; the rest fall back to the purpose default.
 */
export function natureForStoredPurpose(purpose: StoredPurpose): CostNature {
  if (purpose === "fixed") return "fixed";
  if (purpose === "variable") return "variable";
  return DEFAULT_NATURE_BY_PURPOSE[purpose];
}

/** What the form pre-selects when the owner picks a purpose. */
export function defaultNatureFor(purpose: ExpensePurpose): CostNature {
  return DEFAULT_NATURE_BY_PURPOSE[purpose];
}

/**
 * Spend with no expense item behind it — a one-off line carrying only a label,
 * or a chargeback fee. Zero-catalog entry is a product requirement, so this is
 * a normal case, not an edge one.
 *
 * It reads as VARIABLE: an unclassified cost then lowers the contribution
 * margin instead of inflating the fixed base, and break-even still rises to
 * cover it. Either choice raises the target; this one avoids telling an owner
 * that an ad-hoc purchase is a standing monthly commitment.
 */
export const UNCLASSIFIED_NATURE: CostNature = "variable";

/** Plain English for the owner. The UI never invents its own words for these. */
export const COST_NATURE_LABELS: Record<CostNature, { label: string; help: string }> = {
  fixed: {
    label: "Stays the same",
    help: "You pay this whether you sell a lot or nothing at all — rent, salaries, subscriptions.",
  },
  variable: {
    label: "Grows with sales",
    help: "This rises and falls with how much you sell — ads, packaging, delivery, commissions.",
  },
  semi_variable: {
    label: "A bit of both",
    help: "A base amount you always pay, plus more when you sell more. Counted as staying the same until you can split it.",
  },
};

export const EXPENSE_PURPOSE_LABELS: Record<StoredPurpose, string> = {
  marketing: "Marketing",
  operational: "Running the business",
  maintenance: "Repairs and upkeep",
  payroll: "People",
  cogs: "Cost of goods",
  custom: "Other",
  // Retained so an old row still renders a word rather than a raw key.
  fixed: "Fixed (old)",
  variable: "Variable (old)",
};
