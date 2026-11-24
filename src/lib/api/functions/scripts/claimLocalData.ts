/**
 * `npm run auth:claim -- you@example.com` — hands the data made under the
 * old local sign-in bypass (the legacy account `local-user`) to a real
 * Supabase account.
 *
 * The source is FIXED: it only ever moves `local-user`'s records. It cannot
 * move another real account's data, because there is no way to name one.
 * The target must be a Supabase account whose email is confirmed.
 *
 * Without `--apply` it only reports. With `--apply` against the shared
 * database it also needs `--shared-db` and a typed confirmation (see guard.ts).
 * One transaction: it all moves or nothing does. Only ownership columns change
 * — no money row is touched. Running it again moves nothing (0 rows match).
 */
import { LEGACY_LOCAL_USER_ID } from "@/lib/devAccounts";
import { Refused, confirmWrite, printTarget, runScript } from "./guard";

const USAGE = "Usage: npm run auth:claim -- you@example.com [--apply [--shared-db]]";

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  if (args.some((a) => a === "--from" || a.startsWith("--from="))) {
    throw new Refused(`--from is no longer accepted: auth:claim only moves the legacy "${LEGACY_LOCAL_USER_ID}" account. ${USAGE}`);
  }
  const email = args.find((a) => !a.startsWith("--"))?.trim().toLowerCase();
  if (!email) throw new Refused(USAGE);
  if (!process.env.DATABASE_URL) throw new Refused("DATABASE_URL is not set.");
  const from = LEGACY_LOCAL_USER_ID;

  const { pool } = await import("@workspace/db");
  const client = await pool.connect();
  try {
    const found = await client.query<{ id: string; confirmed: boolean }>(
      "select id, email_confirmed_at is not null as confirmed from auth.users where lower(email) = $1",
      [email],
    );
    if (found.rows.length !== 1) throw new Refused(`No single Supabase account for ${email}. Sign up (and confirm the email) first.`);
    const { id: to, confirmed } = found.rows[0];
    if (!confirmed) throw new Refused(`${email} has not confirmed its email yet. Confirm it, then run this again.`);

    const counts = await client.query<{ businesses: number; integrations: number; settings: number }>(
      `select (select count(*)::int from businesses where user_id = $1) as businesses,
              (select count(*)::int from integrations where user_id = $1) as integrations,
              (select count(*)::int from user_settings where user_id = $1) as settings`,
      [from],
    );
    const c = counts.rows[0];
    const affects = [
      `From: ${from} (legacy local account)  →  To: ${email} (${to})`,
      `Moves: ${c.businesses} business(es), ${c.integrations} connected store(s), settings ${c.settings ? "if the account has none yet" : "(none)"}.`,
    ];

    if (!apply) {
      printTarget("auth:claim (dry run) — nothing will be written.");
      for (const line of affects) console.log(`  ${line}`);
      console.log("\nRun again with --apply to move them.");
      return;
    }

    await confirmWrite({ action: "auth:claim --apply — changes who owns these records.", affects, phrase: `claim ${email}` });

    await client.query("begin");
    const moved = {
      businesses: (await client.query("update businesses set user_id = $2 where user_id = $1", [from, to])).rowCount,
      integrations: (await client.query("update integrations set user_id = $2 where user_id = $1", [from, to])).rowCount,
      importsCreated: (await client.query("update import_batches set created_by = $2 where created_by = $1", [from, to])).rowCount,
      importsUndone: (await client.query("update import_batches set undone_by = $2 where undone_by = $1", [from, to])).rowCount,
      // user_settings is keyed by user: keep the account's own row if it already has one.
      userSettings: (
        await client.query(
          "update user_settings set user_id = $2 where user_id = $1 and not exists (select 1 from user_settings where user_id = $2)",
          [from, to],
        )
      ).rowCount,
    };
    await client.query("commit");
    console.log(`\nMoved from "${from}" to ${email}:`, moved);
  } catch (err) {
    await client.query("rollback").catch(() => {});
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

runScript(main);
