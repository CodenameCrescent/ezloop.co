import type { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { getSettings as getSettingsContract, updateSettings as updateSettingsContract } from "@workspace/api-contract";
import { db, businessesTable, userSettingsTable, businessSettingsTable } from "@workspace/db";
import { sanitizeFeatureOverrides } from "@workspace/domain";
import { type AuthedRequest, businessOf } from "@/lib/api/functions/http/guards";
import { serializeBusinessModels } from "@/lib/api/functions/lib/businessModels";
import { loadSettingsShape, loadUserSettings, loadBusinessSettings } from "@/lib/api/functions/lib/settingsShape";
import { seedStarterExpenseTypes, seedInternalTimeCategories } from "@/lib/api/functions/services/business";
import { handle } from "@/lib/api/functions/http/handler";

export async function GET(request: NextRequest) {
  return handle(request, getSettingsContract, {}, async ({ req }) =>
    loadSettingsShape((req as AuthedRequest).userId, businessOf(req)));
}

export async function PATCH(request: NextRequest) {
  return handle(request, updateSettingsContract, { write: true }, async ({ req, body }) => {
    const userId = (req as AuthedRequest).userId;
    const business = businessOf(req);
    // Both rows are created on read if they are missing, so the updates below
    // always have something to hit.
    await Promise.all([loadUserSettings(userId), loadBusinessSettings(business.id)]);

    // ── The account: three fields, and the test for adding a fourth is whether
    // an owner would want the same value in every one of their businesses.
    const accountPatch: Record<string, unknown> = { updatedAt: new Date() };
    if (body.plan !== undefined) accountPatch.plan = body.plan;
    if (body.locale !== undefined) accountPatch.locale = body.locale;
    if (body.toastsEnabled !== undefined) accountPatch.toastsEnabled = body.toastsEnabled;

    // ── This set of books: prefills and thresholds. All of these used
    // to be account-wide, which meant a second business inherited the first
    // one's numbers and quietly reported against them.
    const businessSettingsPatch: Record<string, unknown> = { updatedAt: new Date() };
    if (body.defaultCostPrice !== undefined) businessSettingsPatch.defaultCostPrice = body.defaultCostPrice;
    if (body.defaultSellingPrice !== undefined) businessSettingsPatch.defaultSellingPrice = body.defaultSellingPrice;
    if (body.adAttributionPct !== undefined) businessSettingsPatch.adAttributionPct = body.adAttributionPct;
    if (body.cashBuffer !== undefined) businessSettingsPatch.cashBuffer = body.cashBuffer;
    if (body.businessModels !== undefined) {
      businessSettingsPatch.businessModels = serializeBusinessModels(body.businessModels);
    }
    if (body.thresholds) {
      if (body.thresholds.scaleMargin !== undefined) businessSettingsPatch.scaleMargin = body.thresholds.scaleMargin;
      if (body.thresholds.stopScore !== undefined) businessSettingsPatch.stopScore = body.thresholds.stopScore;
      if (body.thresholds.minOrders !== undefined) businessSettingsPatch.minOrders = body.thresholds.minOrders;
    }

    // What describes THIS SET OF BOOKS lives on the business: its name, its
    // currency, its type and its feature gating. An owner with a shop and a
    // studio names them separately, so none of these may sit on the account.
    // Overrides MERGE so a single toggle never clears the others; sanitizing
    // drops unknown keys so a stale client can't widen access.
    let updatedBusiness = business;
    const touchesBusiness =
      body.businessType !== undefined ||
      body.featureOverrides !== undefined ||
      body.businessName !== undefined ||
      body.currency !== undefined ||
      body.currencySymbol !== undefined;
    if (touchesBusiness) {
      const businessPatch: Record<string, unknown> = { updatedAt: new Date() };
      if (body.businessName !== undefined) businessPatch.name = body.businessName;
      if (body.currency !== undefined) businessPatch.baseCurrency = body.currency;
      if (body.currencySymbol !== undefined) businessPatch.currencySymbol = body.currencySymbol;
      if (body.businessType !== undefined) businessPatch.businessType = body.businessType;
      if (body.featureOverrides !== undefined) {
        const merged = sanitizeFeatureOverrides(business.featureOverrides) as Record<string, boolean>;
        for (const [feature, choice] of Object.entries(body.featureOverrides)) {
          // null clears the key, so the feature follows the business type again.
          if (choice === null) delete merged[feature];
          else if (typeof choice === "boolean") merged[feature] = choice;
        }
        businessPatch.featureOverrides = sanitizeFeatureOverrides(merged);
      }
      const [row] = await db
        .update(businessesTable)
        .set(businessPatch)
        .where(eq(businessesTable.id, business.id))
        .returning();
      updatedBusiness = row;

      // Switching type tops up the starter expense types for the new one. Add
      // only: existing rows keep their name, nature and archived status (the
      // insert conflicts on name and does nothing), so nothing an owner set is
      // overwritten and nothing they archived comes back. Someone who signed up
      // on the default and later says "actually, I'm a freelancer" would
      // otherwise be stuck with a courier-shaped starter list forever.
      if (body.businessType !== undefined && body.businessType !== business.businessType) {
        await seedStarterExpenseTypes(business.id, body.businessType);
        await seedInternalTimeCategories(business.id);
      }
    }

    await Promise.all([
      db.update(userSettingsTable).set(accountPatch).where(eq(userSettingsTable.userId, userId)),
      db
        .update(businessSettingsTable)
        .set(businessSettingsPatch)
        .where(eq(businessSettingsTable.businessId, business.id)),
    ]);

    // Re-read through the SAME function GET uses, rather than assembling a
    // second copy of the shape here. The two used to be assembled separately,
    // which is how a field can start disagreeing with itself depending on
    // whether you loaded the page or saved it.
    return loadSettingsShape(userId, updatedBusiness);
  });
}
