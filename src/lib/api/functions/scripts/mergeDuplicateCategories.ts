/**
 * `pnpm db:merge-categories` — folds categories that differ only by capitals
 * back into one.
 *
 * These exist because `findOrCreateCategory` used to match case-SENSITIVELY: an
 * owner who typed "Waven" once and "waven" the next time got two categories,
 * each holding part of the same revenue, and every grouped total was quietly
 * split between them. The matching is fixed, so no new pair can appear — this
 * cleans up the ones already in the database.
 *
 * Rules it follows:
 *   - The KEEPER is the earliest-created row of each group; it is the spelling
 *     the owner chose first, and the one the longest history already points at.
 *   - Everything pointing at a duplicate is repointed at the keeper: revenue
 *     items, expense items, transaction lines, and any child category.
 *   - Only then is the emptied duplicate deleted, inside one transaction, so a
 *     failure leaves the data exactly as it found it.
 *   - No money is touched. Categories are labels used for grouping and nothing
 *     else (CLAUDE.md), so no amount, snapshot or ladder figure can move.
 *
 * Run it with `--apply` to write. Without that it only reports.
 */
import { looksLikeRealUserId } from "@/lib/devAccounts";
import { confirmWrite, runScript } from "./guard";

const FALLBACK_DEV_URL = "postgres://postgres:postgres@localhost:5432/profit_loop";

async function main() {
  const apply = process.argv.includes("--apply");
  if (!process.env.DATABASE_URL) {
    if (process.env.NODE_ENV === "production") throw new Error("DATABASE_URL must be set in production");
    process.env.DATABASE_URL = FALLBACK_DEV_URL;
  }

  const { db, pool, categoriesTable, revenueItemsTable, expenseItemsTable, transactionLinesTable } = await import(
    "@workspace/db"
  );
  const { eq, inArray } = await import("drizzle-orm");

  const all = await db.select().from(categoriesTable);

  // Group by business AND folded name — two businesses may each own a "Retail".
  const groups = new Map<string, typeof all>();
  for (const row of all) {
    const key = `${row.businessId}::${row.name.trim().toLowerCase()}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }

  const duplicated = [...groups.values()].filter((rows) => rows.length > 1);
  if (duplicated.length === 0) {
    console.log("No categories differ only by capitals. Nothing to merge.");
    await pool.end();
    return;
  }

  if (apply) {
    // Every business in the database, so on the shared one this reaches real
    // accounts' books: say how many, and make the operator mean it.
    const businessIds = [...new Set(duplicated.map((rows) => rows[0].businessId))];
    const owners = await pool.query<{ user_id: string }>("select distinct user_id from businesses where id = any($1)", [businessIds]);
    const realOwners = owners.rows.filter((r) => looksLikeRealUserId(r.user_id)).length;
    await confirmWrite({
      action: "db:merge-categories --apply — repoints and DELETES duplicate categories.",
      affects: [
        `${duplicated.length} group(s) in ${businessIds.length} business(es), owned by ${owners.rows.length} account(s) — ${realOwners} of them real.`,
        "Money amounts are not changed; category labels on items and lines are.",
      ],
      phrase: "merge categories",
    });
  }

  let merged = 0;
  for (const rows of duplicated) {
    const ordered = [...rows].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    const [keeper, ...losers] = ordered;
    const loserIds = losers.map((l) => l.id);

    // What actually moves — counted before the write so the report is real.
    const [revenue, expenses, lines, children] = await Promise.all([
      db.select({ id: revenueItemsTable.id }).from(revenueItemsTable).where(inArray(revenueItemsTable.categoryId, loserIds)),
      db.select({ id: expenseItemsTable.id }).from(expenseItemsTable).where(inArray(expenseItemsTable.categoryId, loserIds)),
      db.select({ id: transactionLinesTable.id }).from(transactionLinesTable).where(inArray(transactionLinesTable.categoryId, loserIds)),
      db.select({ id: categoriesTable.id }).from(categoriesTable).where(inArray(categoriesTable.parentId, loserIds)),
    ]);

    console.log(
      `"${keeper.name}" ← ${losers.map((l) => `"${l.name}"`).join(", ")}  ` +
        `(${revenue.length} revenue item(s), ${expenses.length} expense item(s), ` +
        `${lines.length} transaction line(s), ${children.length} child categor(y/ies))`,
    );

    if (!apply) continue;

    await db.transaction(async (tx) => {
      await tx.update(revenueItemsTable).set({ categoryId: keeper.id }).where(inArray(revenueItemsTable.categoryId, loserIds));
      await tx.update(expenseItemsTable).set({ categoryId: keeper.id }).where(inArray(expenseItemsTable.categoryId, loserIds));
      await tx.update(transactionLinesTable).set({ categoryId: keeper.id }).where(inArray(transactionLinesTable.categoryId, loserIds));
      await tx.update(categoriesTable).set({ parentId: keeper.id }).where(inArray(categoriesTable.parentId, loserIds));
      await tx.delete(categoriesTable).where(inArray(categoriesTable.id, loserIds));
    });
    merged += losers.length;
  }

  console.log(
    apply
      ? `\nMerged ${merged} duplicate categor${merged === 1 ? "y" : "ies"} into ${duplicated.length} keeper(s).`
      : `\n${duplicated.length} group(s) would be merged. Re-run with --apply to write.`,
  );

  // A merged database must have nothing left to merge.
  if (apply) {
    const after = await db.select().from(categoriesTable);
    const seen = new Set<string>();
    for (const row of after) {
      const key = `${row.businessId}::${row.name.trim().toLowerCase()}`;
      if (seen.has(key)) throw new Error(`Still duplicated after merge: "${row.name}"`);
      seen.add(key);
    }
    console.log("Verified: no two categories in any business now differ only by capitals.");
  }

  await pool.end();
}

runScript(main);

export {};
