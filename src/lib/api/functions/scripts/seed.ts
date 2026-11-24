/**
 * `pnpm db:seed` — deterministic demo seed for the new money core, then a
 * printed period P&L compared against the hand-computed expectations
 * (EXPECTED_PNL in seedCore.ts). Exits non-zero on any mismatch.
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

  // Imported only after DATABASE_URL is settled.
  const { runSeed, loadSeededLadder, EXPECTED_PNL } = await import("./seedCore");
  const { LADDER_LABELS, formatMoney } = await import("@workspace/domain");
  const { pool } = await import("@workspace/db");

  // What the wipe would take, counted before anyone is asked to confirm it.
  const owned = await pool.query<{ n: number; names: string | null }>(
    "select count(*)::int as n, string_agg(name, ', ' order by created_at) as names from businesses where user_id = $1",
    [userId],
  );
  await confirmWrite({
    action: "db:seed — DELETES everything this user owns, then builds the fixture business.",
    affects: [
      `User: ${userId}`,
      `Will delete: ${owned.rows[0].n} business(es)${owned.rows[0].names ? ` (${owned.rows[0].names})` : ""} and every record in them.`,
    ],
    phrase: `wipe ${userId}`,
  });

  console.log(`Seeding money core for user "${userId}" …`);
  const businessId = await runSeed(userId);
  const ladder = await loadSeededLadder(businessId);

  const rows: Array<[string, number, number]> = [
    [LADDER_LABELS.grossRevenue.label, ladder.grossRevenue, EXPECTED_PNL.grossRevenue],
    ["  − Discounts", ladder.discounts, EXPECTED_PNL.discounts],
    ["  − Refunds", ladder.refunds, EXPECTED_PNL.refunds],
    [LADDER_LABELS.netRevenue.label, ladder.netRevenue, EXPECTED_PNL.netRevenue],
    [LADDER_LABELS.contributionProfit.label, ladder.contributionProfit, EXPECTED_PNL.contributionProfit],
    ["  − Period expenses", ladder.periodExpenses, EXPECTED_PNL.periodExpenses],
    [LADDER_LABELS.trueProfit.label, ladder.trueProfit, EXPECTED_PNL.trueProfit],
  ];

  console.log("\nPeriod P&L (last 90 days)          computed        expected");
  let mismatches = 0;
  for (const [label, actual, expected] of rows) {
    const ok = actual === expected;
    if (!ok) mismatches += 1;
    console.log(
      `${ok ? "✓" : "✗"} ${label.padEnd(28)} ${formatMoney(actual, { symbol: "Rs " }).padStart(15)} ${formatMoney(expected, { symbol: "Rs " }).padStart(15)}`,
    );
  }

  await pool.end();
  if (mismatches > 0) {
    console.error(`\n${mismatches} ladder value(s) diverge from the hand-computed fixture.`);
    process.exit(1);
  }
  console.log("\nSeed matches the hand-computed P&L to the cent.");
}

runScript(main);

export {};
