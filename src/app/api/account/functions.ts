/**
 * Server code used only by `/api/account`. Shared code stays in
 * `src/lib/api/functions`. Server-only: nothing in components, views or the
 * client helpers may import this file.
 */
import { eq } from "drizzle-orm";
import { businessesTable, db, integrationsTable, userSettingsTable } from "@workspace/db";
import { wipeBusinessById } from "@/lib/api/functions/services/business";

// ── account ──────────────────────────────────────────────────────

/**
 * Erases everything one person has in Profit Loop: every business they own
 * (archived ones too), every row inside them — transactions, receipts, catalog,
 * people, connected stores — and their own settings.
 *
 * This is the one place the app hard-deletes money rows on an owner's request.
 * The append-only rule protects a business's history from ITS OWN edits; it was
 * never a reason to keep a departed customer's books. The owner chose this
 * (DECISIONS.md, 2026-09-28): a customer who asks to be forgotten is forgotten.
 *
 * One transaction, so a failure part-way leaves everything as it was and the
 * customer can simply try again. Closing the sign-in happens after, in the
 * route, because it is a call to Supabase Auth and cannot join the transaction.
 */
export async function deleteAccountData(userId: string): Promise<{ businessesDeleted: number }> {
  return db.transaction(async (tx) => {
    const owned = await tx
      .select({ id: businessesTable.id })
      .from(businessesTable)
      .where(eq(businessesTable.userId, userId));
    for (const business of owned) await wipeBusinessById(business.id, undefined, tx);
    // Rows keyed by the person rather than by a business.
    await tx.delete(integrationsTable).where(eq(integrationsTable.userId, userId));
    await tx.delete(userSettingsTable).where(eq(userSettingsTable.userId, userId));
    return { businessesDeleted: owned.length };
  });
}
