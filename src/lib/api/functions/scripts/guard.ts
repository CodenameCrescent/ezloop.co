/**
 * The brake on every script that can change or delete records.
 *
 * Development shares its database with real accounts. Before a script writes,
 * it says WHERE (host, port and database — never credentials) and WHO it will
 * touch, and against anything but a local Postgres it needs all of:
 *
 *   - `--shared-db` on the command line, and
 *   - the exact confirmation phrase typed into an interactive terminal.
 *
 * Neither is enough to touch a real account's records where the script's own
 * rules forbid it: `assertDevAccount` refuses real (Supabase UUID) user ids
 * whatever flags are passed.
 *
 * Import this BEFORE `@workspace/db`: it only reads the connection string.
 */
import readline from "node:readline/promises";
import { describeDatabase, targetLabel, type DatabaseTarget } from "@/core/db/target";
import { isDevAccountId, looksLikeRealUserId } from "@/lib/devAccounts";

export class Refused extends Error {}

export function databaseTarget(url = process.env.DATABASE_URL): DatabaseTarget {
  return describeDatabase(url);
}

/** Prints where this run points, without credentials. */
export function printTarget(action: string, url = process.env.DATABASE_URL): DatabaseTarget {
  const target = describeDatabase(url);
  console.log(`\n${action}`);
  console.log(`  Database: ${targetLabel(target)}`);
  return target;
}

/**
 * A user id a WIPING script may target. On the shared database only the listed
 * development accounts; anywhere, never a real account.
 */
export function assertDevAccount(userId: string, target: DatabaseTarget): void {
  if (looksLikeRealUserId(userId)) {
    throw new Refused(`"${userId}" is a real account. This script never wipes a real account's data.`);
  }
  if (!target.isLocal && !isDevAccountId(userId)) {
    throw new Refused(
      `"${userId}" is not one of the development accounts (src/lib/devAccounts.ts). ` +
        "On the shared database this script only touches those.",
    );
  }
}

/**
 * Stops unless the operator has clearly meant it. Local databases pass straight
 * through (after printing the target); shared ones need `--shared-db` and the
 * phrase typed back.
 */
export async function confirmWrite(opts: {
  action: string;
  /** Who/what is affected, in plain words — printed before asking. */
  affects: string[];
  /** Typed back to proceed. */
  phrase: string;
  args?: string[];
  url?: string;
}): Promise<void> {
  const target = printTarget(opts.action, opts.url);
  for (const line of opts.affects) console.log(`  ${line}`);
  if (target.isLocal) return;

  const args = opts.args ?? process.argv.slice(2);
  if (!args.includes("--shared-db")) {
    throw new Refused("This is the SHARED database. Nothing was changed. Re-run with --shared-db if you really mean it.");
  }
  if (!process.stdin.isTTY) {
    throw new Refused("Confirmation needs an interactive terminal. Nothing was changed.");
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(`\n  Type "${opts.phrase}" to continue (anything else cancels): `);
    if (answer.trim() !== opts.phrase) throw new Refused("Not confirmed. Nothing was changed.");
  } finally {
    rl.close();
  }
}

/** Shared ending for scripts: a refusal is a clean exit 1 with its message, not a stack trace. */
export function runScript(main: () => Promise<void>): void {
  main().catch((err) => {
    if (err instanceof Refused) console.error(`\nRefused: ${err.message}`);
    else console.error(err);
    process.exit(1);
  });
}
