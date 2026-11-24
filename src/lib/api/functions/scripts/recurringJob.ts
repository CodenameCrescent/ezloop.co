/**
 * `pnpm job:recurring` — post every due recurring schedule and sweep past-due
 * subscriptions. Cron-friendly and idempotent. Optional YYYY-MM-DD arg runs
 * "as of" a given day (used by tests / catch-up demos).
 */
import { Refused, confirmWrite, printTarget, runScript } from "./guard";

const FALLBACK_DEV_URL = "postgres://postgres:postgres@localhost:5432/profit_loop";

async function main() {
  if (!process.env.DATABASE_URL) {
    if (process.env.NODE_ENV === "production") throw new Error("DATABASE_URL must be set in production");
    process.env.DATABASE_URL = FALLBACK_DEV_URL;
  }
  const arg = process.argv.slice(2).find((a) => !a.startsWith("--"));
  const today = arg ? new Date(`${arg}T12:00:00Z`) : new Date();
  if (arg && Number.isNaN(today.getTime())) throw new Refused(`"${arg}" is not a date (YYYY-MM-DD).`);

  if (arg) {
    // Running "as of" another day posts into EVERY business in the database —
    // on the shared one, real accounts' books — so it needs a clear yes.
    await confirmWrite({
      action: `job:recurring ${arg} — posts every schedule that is due as of ${arg}, in every business.`,
      affects: ["All businesses in this database (real accounts included on the shared one)."],
      phrase: `post ${arg}`,
    });
  } else {
    // Today: exactly what the deployed nightly job does. Idempotent; a
    // second run posts nothing new.
    printTarget("job:recurring — posts what is due today (same as the nightly job).");
  }

  const { runRecurringJob } = await import("../services/recurringJob");
  const { pool } = await import("@workspace/db");

  const result = await runRecurringJob(today);
  console.log(`Recurring job @ ${result.ranAt}`);
  console.log(`  schedules processed: ${result.schedulesProcessed}`);
  console.log(`  transactions posted: ${result.postsCreated}`);
  console.log(`  subscriptions → past_due: ${result.subscriptionsPastDue}`);
  if (result.cappedScheduleIds.length) {
    console.warn(`  ⚠ ${result.cappedScheduleIds.length} schedule(s) hit the 12-occurrence catch-up cap: ${result.cappedScheduleIds.join(", ")}`);
  }
  await pool.end();
}

runScript(main);

export {};
