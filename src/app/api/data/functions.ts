/**
 * Server code used only by `/api/data`. Shared code stays in
 * `src/lib/api/functions`. Server-only: nothing in components, views or the
 * client helpers may import this file.
 */
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { ensureManualSource, wipeBusinessById } from "@/lib/api/functions/services/business";
import { ServiceError } from "@/lib/api/functions/services/errors";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// ── seed safety ─────────────────────────────────────────────────────────────

/**
 * Tables a seed leaves alone: the business row itself, its settings and its
 * saved entry templates survive a reset (`wipeBusinessById` with
 * `keepBusiness`). Every OTHER table with a `business_id` is emptied by the
 * seed, so every other table is checked.
 */
const KEPT_BY_SEED = new Set(["businesses", "business_settings", "transaction_templates"]);

/**
 * Rows a brand-new business is created with (`seedNewBusiness`): starter
 * expense types, the internal time categories, and the "Manual" channel. They
 * are not the owner's data as long as nobody has touched them — created with
 * the business and never edited since.
 */
const STARTER_ROWS: Record<string, string> = {
  expense_items: "t.updated_at = t.created_at AND t.created_at <= b.created_at + interval '5 minutes'",
  categories: "t.updated_at = t.created_at AND t.created_at <= b.created_at + interval '5 minutes'",
  sources: "t.kind = 'manual' AND t.updated_at = t.created_at",
};

/**
 * Seeding REPLACES a business's books (it wipes first). It is only allowed on a
 * business that holds nothing an owner made: the welcome screen's
 * "start with sample data" on the business it just created.
 *
 * Every table holding this business's rows is counted — found from the
 * database, not a hand-kept list, so a table added later is covered without
 * anyone remembering this function. Child tables without a `business_id`
 * (transaction lines, cost components, postings, subscription events, budget
 * lines) cannot hold anything without a parent that is counted here.
 */
export async function assertSafeToSeed(businessId: string, exec: typeof db | Tx = db, lockRows = false): Promise<void> {
  const tables = await exec.execute<{ table_name: string }>(sql`
    SELECT DISTINCT table_name FROM information_schema.columns
    WHERE table_schema = 'public' AND column_name = 'business_id'
  `);

  const holding: string[] = [];
  for (const { table_name } of tables.rows) {
    if (KEPT_BY_SEED.has(table_name)) continue;
    const starter = STARTER_ROWS[table_name];
    if (lockRows) {
      // Inside the seed's transaction: lock what is there now, so an edit to a
      // starter row waits for the wipe rather than racing it.
      await exec.execute(sql`SELECT 1 FROM ${sql.identifier(table_name)} WHERE business_id = ${businessId} FOR UPDATE`);
    }
    const result = await exec.execute<{ n: number }>(
      starter
        ? sql`SELECT count(*)::int AS n FROM ${sql.identifier(table_name)} t
              JOIN businesses b ON b.id = t.business_id
              WHERE t.business_id = ${businessId} AND NOT (${sql.raw(starter)})`
        : sql`SELECT count(*)::int AS n FROM ${sql.identifier(table_name)} WHERE business_id = ${businessId}`,
    );
    if (Number(result.rows[0]?.n ?? 0) > 0) holding.push(table_name);
  }

  if (holding.length > 0) {
    throw new ServiceError(
      "business_not_empty",
      "Sample data can only be added to a new, empty business — this one already has records, and adding samples would replace them.",
    );
  }
}

/**
 * Checks the business is empty and empties it, as ONE locked step.
 *
 * The race this closes: checking "is it empty?" and then wiping as two steps
 * leaves a gap in which the owner (another tab, the recurring job, an import)
 * can write a record that the wipe then deletes. Here both happen inside one
 * transaction that first takes `FOR UPDATE` on the business row. Every table
 * holding a business's records has a foreign key to `businesses` (checked:
 * all of them), and Postgres checks that key on INSERT with `FOR KEY SHARE`
 * on the business row — which waits behind `FOR UPDATE`. So no new record can
 * land between the check and the wipe; one that tries waits, then lands
 * safely AFTER, and is never deleted. Existing rows are locked too
 * (`lockRows`), so an edit to a starter row cannot slip in either.
 *
 * Afterwards the seed only INSERTS (`runSeed(…, { alreadyEmptied: true })`),
 * so nothing written later can be lost. A second seed of the same business
 * finds the first one's records and is refused.
 *
 * The "Manual" channel is restored after the commit: `ensureManualSource`
 * uses its own connection, and inside the transaction its foreign-key check
 * would wait on our own lock.
 */
export async function prepareBusinessForSeed(businessId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const locked = await tx.execute(sql`SELECT id FROM businesses WHERE id = ${businessId} FOR UPDATE`);
    if (locked.rows.length !== 1) throw new ServiceError("not_found", "That business could not be found.");
    await assertSafeToSeed(businessId, tx, true);
    await wipeBusinessById(businessId, { keepBusiness: true, restoreManualSource: false }, tx);
  });
  await ensureManualSource(businessId);
}
