import { businessSettingsTable, db, userSettingsTable, type Business } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  isBusinessType,
  resolveFeatures,
  sanitizeFeatureOverrides,
  type BusinessType,
} from "@workspace/domain";
import { DEFAULT_BUSINESS_SETTINGS, DEFAULT_USER_SETTINGS } from "./defaults";
import { parseBusinessModels } from "./businessModels";

/**
 * Business type + feature gating live on the BUSINESS (they scope money and
 * seeding), while account preferences live on user_settings. The settings
 * endpoint is the one surface the UI reads, so it resolves both.
 *
 * Takes the business rather than looking one up: the caller has already had it
 * verified by the business guard, and re-resolving from a user id is exactly the
 * habit that made "the user's business" mean something when it no longer does.
 */
export function loadBusinessCapabilities(business: Business) {
  const businessType: BusinessType = isBusinessType(business.businessType)
    ? business.businessType
    : "ecommerce";
  const featureOverrides = sanitizeFeatureOverrides(business.featureOverrides);
  return { businessType, featureOverrides, features: resolveFeatures(businessType, featureOverrides) };
}

/** The account's row, created on first read. */
export async function loadUserSettings(userId: string) {
  const [existing] = await db.select().from(userSettingsTable).where(eq(userSettingsTable.userId, userId));
  if (existing) return existing;
  const [created] = await db
    .insert(userSettingsTable)
    .values({ userId, ...DEFAULT_USER_SETTINGS })
    .returning();
  return created;
}

/**
 * This business's row, created on first read.
 *
 * Lazily rather than at creation, so a business made before this table existed
 * still answers. `onConflictDoNothing` because two requests arriving together
 * for a business that has never been read would otherwise race to insert it.
 */
export async function loadBusinessSettings(businessId: string) {
  const [existing] = await db
    .select()
    .from(businessSettingsTable)
    .where(eq(businessSettingsTable.businessId, businessId));
  if (existing) return existing;
  const [created] = await db
    .insert(businessSettingsTable)
    .values({ businessId, ...DEFAULT_BUSINESS_SETTINGS })
    .onConflictDoNothing()
    .returning();
  if (created) return created;
  const [raced] = await db
    .select()
    .from(businessSettingsTable)
    .where(eq(businessSettingsTable.businessId, businessId));
  return raced;
}

/**
 * Settings in the contract shape, for ONE business.
 *
 * Three sources, and which one a field comes from is the whole point: identity
 * (name, currency, type, features) from the business row, per-books preferences
 * from `business_settings`, and the short account-wide list from
 * `user_settings`. The UI sees one flat object, because to an owner "my
 * settings" is one idea.
 */
export async function loadSettingsShape(userId: string, business: Business) {
  const [account, perBusiness] = await Promise.all([
    loadUserSettings(userId),
    loadBusinessSettings(business.id),
  ]);

  return {
    ...loadBusinessCapabilities(business),
    currency: business.baseCurrency,
    currencySymbol: business.currencySymbol,
    businessName: business.name,
    plan: account.plan,
    locale: account.locale,
    toastsEnabled: account.toastsEnabled,
    defaultCostPrice: perBusiness.defaultCostPrice,
    defaultSellingPrice: perBusiness.defaultSellingPrice,
    adAttributionPct: perBusiness.adAttributionPct,
    cashBuffer: perBusiness.cashBuffer,
    businessModels: parseBusinessModels(perBusiness.businessModels),
    thresholds: {
      scaleMargin: perBusiness.scaleMargin,
      stopScore: perBusiness.stopScore,
      minOrders: perBusiness.minOrders,
    },
  };
}
