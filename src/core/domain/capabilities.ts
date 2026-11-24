/**
 * What a business SEES, derived from what kind of business it is.
 *
 * Profit Loop is cross-vertical (CLAUDE.md): the same app serves a Shopify
 * seller and a freelance designer. Ecommerce-shaped features — order outcomes,
 * RTO, courier rules, COD fees — are meaningless to a consultant and must be
 * invisible for them, not merely disabled.
 *
 * The rule lives here, in one place, because BOTH the server (deciding what to
 * seed and compute) and the UI (deciding what to render) ask the same question.
 * Two copies would drift.
 *
 * NOTE: this gates FEATURES, never a user's own data. Expense types stay
 * user-created and unlimited for every business type — the type only chooses
 * the seeded starting list.
 */

/** Small open list: adding "retail" or "digital" later is a one-line change. */
export const BUSINESS_TYPES = ["ecommerce", "service", "construction", "manufacturing"] as const;
export type BusinessType = (typeof BUSINESS_TYPES)[number];

/** Individually togglable features. Each declares which types get it by default. */
export const GATED_FEATURES = [
  "order_outcomes",
  "rto",
  "courier_cost_rules",
  "cod_fees",
  "client_profitability",
  "projects",
] as const;
export type GatedFeature = (typeof GATED_FEATURES)[number];

/**
 * What a PROJECT is called, per trade.
 *
 * One concept, four words, because the concept is the trade's own and the word
 * has to be too. A builder does not have "jobs" on a site and a factory does not
 * run "projects" — asking either to translate is the kind of small friction that
 * makes software feel like it was written for somebody else.
 *
 * The plural is stored rather than derived: English is not reliable enough for
 * the app to guess, and a screen heading is not a place to be nearly right.
 */
export const PROJECT_LABELS: Record<BusinessType, { one: string; many: string }> = {
  construction: { one: "Project", many: "Projects" },
  manufacturing: { one: "Production run", many: "Production runs" },
  service: { one: "Project", many: "Projects" },
  ecommerce: { one: "Project", many: "Projects" },
};

export function projectLabel(businessType: BusinessType): { one: string; many: string } {
  return PROJECT_LABELS[businessType] ?? PROJECT_LABELS.service;
}

/**
 * Which business types switch each feature on when the owner hasn't chosen.
 * The map is per-feature precisely so it can point in both directions: the
 * fulfilment-shaped features default to ecommerce, while attributing labour to
 * clients defaults to service. A future type (retail) can take some and not
 * others without reshaping anything.
 */
const FEATURE_DEFAULT_TYPES: Record<GatedFeature, readonly BusinessType[]> = {
  order_outcomes: ["ecommerce"],
  rto: ["ecommerce"],
  courier_cost_rules: ["ecommerce"],
  cod_fees: ["ecommerce"],
  client_profitability: ["service"],
  /**
   * Everyone whose work comes in discrete pieces. Off for ecommerce, where the
   * unit of work is an order and a project would be an empty second container.
   */
  projects: ["construction", "manufacturing", "service"],
};

/** Owner choices as STORED. A missing key means "follow my type". */
export type FeatureOverrides = Partial<Record<GatedFeature, boolean>>;

/**
 * What callers may pass in. Wider than the stored shape because a UI patch uses
 * `null` to clear a choice; anything that isn't a real boolean reads as
 * "not chosen".
 */
export type FeatureOverridesInput = Partial<Record<GatedFeature, boolean | null>>;

export function isBusinessType(value: unknown): value is BusinessType {
  return typeof value === "string" && (BUSINESS_TYPES as readonly string[]).includes(value);
}

export function isGatedFeature(value: unknown): value is GatedFeature {
  return typeof value === "string" && (GATED_FEATURES as readonly string[]).includes(value);
}

/** What the toggle would be if the owner never touched it. */
export function featureDefault(businessType: BusinessType, feature: GatedFeature): boolean {
  return FEATURE_DEFAULT_TYPES[feature].includes(businessType);
}

/** The effective answer: the owner's explicit choice, else their type's default. */
export function featureEnabled(
  businessType: BusinessType,
  feature: GatedFeature,
  overrides?: FeatureOverridesInput | null,
): boolean {
  const chosen = overrides?.[feature];
  if (chosen === true || chosen === false) return chosen;
  return featureDefault(businessType, feature);
}

/** True when the owner's choice disagrees with their type's default. */
export function isFeatureOverridden(
  businessType: BusinessType,
  feature: GatedFeature,
  overrides?: FeatureOverridesInput | null,
): boolean {
  const chosen = overrides?.[feature];
  if (chosen !== true && chosen !== false) return false;
  return chosen !== featureDefault(businessType, feature);
}

/** Every feature with its effective state — what the UI renders the toggles from. */
export function resolveFeatures(
  businessType: BusinessType,
  overrides?: FeatureOverridesInput | null,
): Record<GatedFeature, boolean> {
  const out = {} as Record<GatedFeature, boolean>;
  for (const feature of GATED_FEATURES) out[feature] = featureEnabled(businessType, feature, overrides);
  return out;
}

/** Drop unknown keys and non-booleans so a stale payload can't widen access. */
export function sanitizeFeatureOverrides(raw: unknown): FeatureOverrides {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: FeatureOverrides = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (isGatedFeature(key) && typeof value === "boolean") out[key] = value;
  }
  return out;
}
