import { z } from "zod";
import { defineEndpoint, moneyCents } from "./shared";

export const revenueItemType = z.enum([
  "product",
  "service",
  "subscription",
  "rental",
  "commission",
  "royalty",
  "other",
]);
export type RevenueItemTypeShape = z.infer<typeof revenueItemType>;

export const pricingModel = z.enum(["fixed", "per_unit", "hourly", "variable", "tiered"]);
export const catalogStatus = z.enum(["active", "archived"]);
export const costCalcType = z.enum(["fixed_per_unit", "percent_of_price", "percent_of_subtotal"]);

/** Default cadence for subscription/rental items; pre-fills the recurring schedule. */
export const billingCycle = z.enum(["daily", "weekly", "monthly", "quarterly", "yearly"]);
export type BillingCycleShape = z.infer<typeof billingCycle>;

/** One tier of a tiered price: applies up to `upToQty` units (decimal string); null = this tier and above. */
export const pricingTier = z.object({
  upToQty: z.string().nullable(),
  unitPriceCents: moneyCents,
});
export type PricingTierShape = z.infer<typeof pricingTier>;

export const costComponent = z.object({
  id: z.string(),
  name: z.string(),
  calcType: costCalcType,
  valueCents: moneyCents.nullable(),
  /** Decimal string of percentage points, e.g. "20" = 20%. */
  valueRate: z.string().nullable(),
  isFee: z.boolean().nullable(),
  sourceId: z.string().nullable(),
  sourceName: z.string().nullable(),
  effectiveFrom: z.string(),
  effectiveTo: z.string().nullable(),
});
export type CostComponentShape = z.infer<typeof costComponent>;

export const revenueItemStats = z.object({
  unitsSold: z.number(),
  netRevenueCents: moneyCents,
  contributionProfitCents: moneyCents,
  /** Contribution margin % of net revenue; null when no revenue in period. */
  marginPct: z.number().nullable(),
  refundedCents: moneyCents,
  /** Refunded amount as % of gross item revenue in the period. */
  refundRatePct: z.number(),
  transactionCount: z.number().int(),
  /**
   * Set when the item's pricing model and the way it is actually sold disagree
   * — priced as a fixed fee but sold in varying hours, or priced hourly with
   * every sale recording exactly one. Descriptive only: the app never changes
   * the model on the owner's behalf.
   */
  unitMismatch: z.enum(["priced_fixed_sold_by_unit", "priced_hourly_never_multiple"]).nullable(),
});
export type RevenueItemStatsShape = z.infer<typeof revenueItemStats>;

export const revenueItemSourceLink = z.object({
  sourceId: z.string(),
  sourceName: z.string(),
  externalId: z.string().nullable(),
  priceOverrideCents: moneyCents.nullable(),
});

export const revenueItem = z.object({
  id: z.string(),
  /** Variant tree: null = root item; set = this row is a variant of that parent. Only leaves are sellable. */
  parentId: z.string().nullable(),
  /** True when this item has variants — it groups, it doesn't sell. */
  hasVariants: z.boolean(),
  name: z.string(),
  type: revenueItemType,
  categoryId: z.string().nullable(),
  categoryName: z.string().nullable(),
  pricingModel,
  unitPriceCents: moneyCents.nullable(),
  /** The open "Direct cost" component's value, surfaced as one friendly number. */
  directCostCents: moneyCents.nullable(),
  defaultBillingCycle: billingCycle.nullable(),
  tiers: z.array(pricingTier).nullable(),
  currency: z.string(),
  unitLabel: z.string(),
  status: catalogStatus,
  notes: z.string().nullable(),
  sources: z.array(revenueItemSourceLink),
  /** Open (currently effective) cost component versions. */
  openComponents: z.array(costComponent),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type RevenueItemShape = z.infer<typeof revenueItem>;

const periodQuery = z.object({
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  status: catalogStatus.optional(),
});

export const listRevenueItems = defineEndpoint({
  method: "GET",
  path: "/revenue-items",
  query: periodQuery,
  response: z.object({
    items: z.array(revenueItem.extend({ stats: revenueItemStats })),
    totalNetRevenueCents: moneyCents,
  }),
});

export const getRevenueItem = defineEndpoint({
  method: "GET",
  path: "/revenue-items/:id",
  params: z.object({ id: z.string() }),
  query: periodQuery,
  response: z.object({
    item: revenueItem,
    stats: revenueItemStats,
    /** Every component version, open and closed — the effective-dated timeline. */
    componentHistory: z.array(costComponent),
    perSource: z.array(
      z.object({
        sourceId: z.string(),
        sourceName: z.string(),
        unitsSold: z.number(),
        netRevenueCents: moneyCents,
        contributionProfitCents: moneyCents,
      }),
    ),
  }),
});

export const costComponentInput = z.object({
  name: z.string().min(1).max(255),
  calcType: costCalcType,
  valueCents: moneyCents.nullish(),
  valueRate: z.string().nullish(),
  isFee: z.boolean().nullish(),
  sourceId: z.string().nullish(),
});

/** Recursive variant node: only leaves carry price/cost; a node with `variants` just groups. */
export type VariantInputShape = {
  name: string;
  unitPriceCents?: number | null;
  directCostCents?: number | null;
  variants?: VariantInputShape[];
};
export const variantInput: z.ZodType<VariantInputShape> = z.lazy(() =>
  z.object({
    name: z.string().min(1).max(255),
    unitPriceCents: moneyCents.nullish(),
    directCostCents: moneyCents.nullish(),
    variants: z.array(variantInput).max(50).optional(),
  }),
);

export const createRevenueItemBody = z.object({
  name: z.string().min(1).max(255),
  type: revenueItemType,
  pricingModel,
  unitPriceCents: moneyCents.nullish(),
  /** Sugar: creates a single "Direct cost" fixed_per_unit cost component. */
  directCostCents: moneyCents.nullish(),
  categoryId: z.string().nullish(),
  /** Convenience: find-or-create a category by name. */
  categoryName: z.string().max(255).nullish(),
  unitLabel: z.string().max(50).optional(),
  defaultBillingCycle: billingCycle.nullish(),
  tiers: z.array(pricingTier).max(20).nullish(),
  notes: z.string().max(2000).nullish(),
  /** When present the root is a non-sellable group; prices/costs live on the leaves. */
  variants: z.array(variantInput).max(50).optional(),
  components: z.array(costComponentInput).max(20).optional(),
  sourceLinks: z
    .array(z.object({ sourceId: z.string(), priceOverrideCents: moneyCents.nullish(), externalId: z.string().nullish() }))
    .max(20)
    .optional(),
});

export const createRevenueItem = defineEndpoint({
  method: "POST",
  path: "/revenue-items",
  body: createRevenueItemBody,
  response: revenueItem,
});

/**
 * Everything the edit form shows, it can send.
 *
 * Two fields behave differently here than on create, because costs are
 * effective-dated and history is never rewritten:
 *
 * - `directCostCents` re-versions the open "Direct cost" component (closes it,
 *   opens its successor); `null` retires it. Anything already sold keeps the
 *   cost frozen onto it.
 * - `components` ADDS cost components. Editing or retiring an existing one goes
 *   through the /cost-components endpoints, which version them properly.
 *
 * `variants` stays out: a variant is its own row, edited through its own PATCH.
 */
export const updateRevenueItem = defineEndpoint({
  method: "PATCH",
  path: "/revenue-items/:id",
  params: z.object({ id: z.string() }),
  body: createRevenueItemBody
    .omit({ sourceLinks: true, variants: true })
    .partial()
    .extend({
    status: catalogStatus.optional(),
    sourceLinks: z
      .array(z.object({ sourceId: z.string(), priceOverrideCents: moneyCents.nullish(), externalId: z.string().nullish() }))
      .max(20)
      .optional(),
  }),
  response: revenueItem,
});

/**
 * Add a variant to an item that already exists.
 *
 * Its shared traits — type, pricing model, category, currency, unit label,
 * billing cycle — are INHERITED from the parent rather than sent, so a variant
 * can never drift away from the thing it is a variant of.
 *
 * Adding the first variant CONVERTS the parent into a grouping row: only leaves
 * sell, so the parent's own price is cleared and its open direct cost retired.
 * Nothing already sold changes — those lines carry frozen snapshots.
 */
export const addRevenueItemVariant = defineEndpoint({
  method: "POST",
  path: "/revenue-items/:id/variants",
  params: z.object({ id: z.string() }),
  body: z.object({
    name: z.string().min(1).max(255),
    unitPriceCents: moneyCents.nullish(),
    directCostCents: moneyCents.nullish(),
  }),
  response: revenueItem,
});

export const addCostComponent = defineEndpoint({
  method: "POST",
  path: "/revenue-items/:id/cost-components",
  params: z.object({ id: z.string() }),
  body: costComponentInput.extend({ effectiveFrom: z.string().optional() }),
  response: costComponent,
});

/**
 * The effective-dated edit: closes the open version and inserts its successor
 * (never mutates in place). Historical snapshots are untouched.
 */
export const updateCostComponent = defineEndpoint({
  method: "PATCH",
  path: "/cost-components/:id",
  params: z.object({ id: z.string() }),
  body: z.object({
    valueCents: moneyCents.nullish(),
    valueRate: z.string().nullish(),
    isFee: z.boolean().nullish(),
    effectiveFrom: z.string().optional(),
  }),
  response: costComponent,
});

/** Retire a component: closes the open version with no successor. */
export const closeCostComponent = defineEndpoint({
  method: "POST",
  path: "/cost-components/:id/close",
  params: z.object({ id: z.string() }),
  body: z.object({ effectiveTo: z.string().optional() }).optional(),
  response: costComponent,
});
