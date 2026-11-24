/**
 * `pnpm db:demo` — wipe this user's books and rebuild them as TWO businesses.
 *
 * A ceramics studio (eighteen months, ecommerce) and a builder (fourteen
 * months, construction). Two, because half the app is invisible on either one
 * alone: the studio has no sites, no retention and no plant, and the builder
 * has no marketplace fees, no product mix and no discount blitz. Together they
 * are also the only honest exercise of the multi-business restructure — one
 * login, two sets of books, and a switch between them.
 *
 * Distinct from `pnpm db:seed`, which is the hand-computed correctness fixture
 * and must stay small enough to verify by reading. This one is deliberately
 * large: it exists so the pages can be judged on a real trading history rather
 * than four transactions.
 */
import { assertDevAccount, confirmWrite, databaseTarget, runScript } from "./guard";

const FALLBACK_DEV_URL = "postgres://postgres:postgres@localhost:5432/profit_loop";

async function main() {
  if (!process.env.DATABASE_URL) {
    if (process.env.NODE_ENV === "production") throw new Error("DATABASE_URL must be set in production");
    process.env.DATABASE_URL = FALLBACK_DEV_URL;
  }
  const userId = (process.env.SEED_USER_ID ?? "local-user").trim();
  // Never a real account; on the shared database only a development account.
  assertDevAccount(userId, databaseTarget());

  const { runDemoSeed, describeLadder } = await import("./demoSeedCore");
  const { runConstructionSeed } = await import("./demoSeedConstruction");
  const { wipeBusinessData } = await import("../services/business");
  const { pool } = await import("@workspace/db");

  // What the wipe would take, counted before anyone is asked to confirm it.
  const owned = await pool.query<{ n: number; names: string | null }>(
    "select count(*)::int as n, string_agg(name, ', ' order by created_at) as names from businesses where user_id = $1",
    [userId],
  );
  await confirmWrite({
    action: "db:demo — DELETES everything this user owns, then builds two demo businesses.",
    affects: [
      `User: ${userId}`,
      `Will delete: ${owned.rows[0].n} business(es)${owned.rows[0].names ? ` (${owned.rows[0].names})` : ""} and every record in them.`,
    ],
    phrase: `wipe ${userId}`,
  });

  console.log(`Building the demo dataset for "${userId}" — this replaces everything they have.\n`);
  const started = Date.now();

  // Once, before either seeder: each one now CREATES its business rather than
  // adopting the user's only one, so a wipe inside them would delete the other.
  await wipeBusinessData(userId);

  const studio = await runDemoSeed(userId);
  console.log(
    `${studio.name}: ${studio.transactionCount} transactions across ${studio.monthsCovered} months.`,
  );
  console.log(`\nThis calendar year:`);
  for (const row of describeLadder(studio.ladderThisYear)) console.log(row);

  const builder = await runConstructionSeed(userId);
  console.log(
    `\n${builder.name}: ${builder.transactionCount} transactions across ${builder.projectCount} projects.`,
  );

  console.log(`\nTwo businesses. Open /businesses to switch between them.`);
  console.log(`Done in ${((Date.now() - started) / 1000).toFixed(1)}s.`);

  await pool.end();
}

runScript(main);

export {};
