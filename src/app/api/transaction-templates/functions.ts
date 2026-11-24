/**
 * Server code used only by `/api/transaction-templates`. Shared code stays in
 * `src/lib/api/functions`. Server-only: nothing in components, views or the
 * client helpers may import this file.
 */
import { and, desc, eq } from "drizzle-orm";
import { db, transactionTemplatesTable } from "@workspace/db";
import { uid } from "@/lib/api/functions/lib/uid";
import { notFound } from "@/lib/api/functions/services/errors";

// ── templates ────────────────────────────────────────────────────

/**
 * Transaction templates: reusable Quick-Add drafts. Convenience records only —
 * a template never moves money; using one posts through createTransaction like
 * any manual entry (CLAUDE.md: one write path).
 */
export async function listTemplates(businessId: string) {
  return db
    .select()
    .from(transactionTemplatesTable)
    .where(eq(transactionTemplatesTable.businessId, businessId))
    .orderBy(desc(transactionTemplatesTable.createdAt));
}

export async function createTemplate(businessId: string, input: { name: string; payload: unknown }) {
  const [row] = await db
    .insert(transactionTemplatesTable)
    .values({ id: uid("tmpl"), businessId, name: input.name.trim(), payload: input.payload })
    .returning();
  return row;
}

export async function deleteTemplate(businessId: string, id: string) {
  const deleted = await db
    .delete(transactionTemplatesTable)
    .where(and(eq(transactionTemplatesTable.businessId, businessId), eq(transactionTemplatesTable.id, id)))
    .returning();
  if (deleted.length === 0) throw notFound("Template");
  return { ok: true };
}
