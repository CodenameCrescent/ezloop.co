import { z } from "zod";
import { defineEndpoint } from "./shared";

/**
 * User/business settings. NOT money-ledger data — numbers here are legacy
 * float preferences stored on user_settings (KEEP table); the ledger never
 * reads them for money math.
 */
export const businessModel = z.enum([
  "products",
  "services",
  "subscriptions",
  "freelance_projects",
  "digital_products",
  "mixed",
]);

/**
 * What kind of business this is — decides which features are visible and which
 * expense types get seeded. Retail and digital are deliberately deferred; the
 * enum is cheap to extend when they arrive.
 *
 * MIRRORS `BUSINESS_TYPES` in lib/domain/src/capabilities.ts, copied rather than
 * imported for the same reason `gatedFeature` is: this package depends on
 * nothing but zod, and drift fails response validation in dev.
 */
export const businessType = z.enum(["ecommerce", "service", "construction", "manufacturing"]);

/** Features gated by business type, each individually overridable by the owner. */
/**
 * MIRRORS `GATED_FEATURES` in lib/domain/src/capabilities.ts. The contract
 * package deliberately has no dependencies beyond zod, so this list is copied
 * rather than imported — and a test asserts the two stay identical, because a
 * feature added to one and not the other fails response validation at runtime
 * (which is exactly how this line got out of date once).
 */
export const gatedFeature = z.enum([
  "order_outcomes",
  "rto",
  "courier_cost_rules",
  "cod_fees",
  "client_profitability",
  "projects",
]);

/**
 * Owner choices per feature. A missing key means "follow my business type" and
 * must stay distinguishable from an explicit false.
 */
export const featureOverrides = z.partialRecord(gatedFeature, z.boolean());

/** Effective on/off per feature — overrides applied over the type's defaults. */
export const resolvedFeatures = z.partialRecord(gatedFeature, z.boolean());

export const settings = z.object({
  currency: z.string(),
  currencySymbol: z.string(),
  businessName: z.string(),
  plan: z.string(),
  defaultCostPrice: z.number(),
  defaultSellingPrice: z.number(),
  locale: z.string(),
  toastsEnabled: z.boolean(),
  adAttributionPct: z.number(),
  cashBuffer: z.number(),
  businessModels: z.array(businessModel),
  businessType,
  featureOverrides,
  /** Server-resolved: what the UI actually shows. Read-only — patch featureOverrides instead. */
  features: resolvedFeatures,
  thresholds: z.object({
    scaleMargin: z.number(),
    stopScore: z.number(),
    minOrders: z.number(),
  }),
});
export type SettingsShape = z.infer<typeof settings>;

export const getSettings = defineEndpoint({
  method: "GET",
  path: "/settings",
  response: settings,
});

export const updateSettings = defineEndpoint({
  method: "PATCH",
  path: "/settings",
  /**
   * `features` is derived from businessType + featureOverrides — never written
   * directly. Overrides MERGE, and a `null` value clears that key so the
   * feature goes back to following the business type.
   */
  body: settings
    .omit({ features: true })
    .partial()
    .extend({ featureOverrides: z.partialRecord(gatedFeature, z.boolean().nullable()).optional() }),
  response: settings,
});
