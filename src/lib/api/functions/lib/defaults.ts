/**
 * Defaults for a settings row that does not exist yet, split the same way the
 * tables are: what belongs to the person, and what belongs to one set of books.
 * The database carries these values as column defaults too; these exist so an
 * insert reads as a deliberate starting state rather than an empty object.
 */

/** Account-wide. See `user_settings`. */
export const DEFAULT_USER_SETTINGS = {
  plan: "Starter Plan",
  locale: "en-IN",
  toastsEnabled: true,
};

/** Per business. See `business_settings`. */
export const DEFAULT_BUSINESS_SETTINGS = {
  defaultCostPrice: 1000,
  defaultSellingPrice: 2500,
  scaleMargin: 30,
  stopScore: 45,
  minOrders: 3,
  adAttributionPct: 70,
  cashBuffer: 0,
  businessModels: "[]",
};
