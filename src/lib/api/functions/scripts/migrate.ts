/**
 * `npm run db:migrate` — INSPECTS pending migrations; applying needs `--apply`.
 *
 *   npm run db:migrate
 *       Prints the target, every pending migration's FULL SQL, its content
 *       hash and what it does to existing data. Writes nothing.
 *
 *   npm run db:migrate -- --apply --reviewed=<tag>@<hash>[,...] [--allow=<tag>,...] [--shared-db]
 *       Applies. Every pending migration must be named in --reviewed with the
 *       hash printed by the inspection — proof the SQL was read, and tied to
 *       those exact bytes: a file edited after review no longer matches and is
 *       refused. DESTRUCTIVE or INCOMPATIBLE files must also be named in
 *       --allow. Off localhost, --shared-db and a typed phrase as well.
 *
 * ── The review the shared database requires (also in README) ──────────────
 *   1. `npm run db:generate`, then READ the generated .sql file — not just
 *      the schema diff. Drizzle's SQL is what runs.
 *   2. `npm run db:migrate` and read its output: the SQL again, the findings.
 *   3. Destructive/incompatible? Prefer expand → deploy → contract: add the
 *      new shape, deploy code that uses it, remove the old shape in a LATER
 *      migration once nothing reads it. Take a backup of affected tables
 *      first; there are no down-migrations.
 *   4. Apply with the hashes from step 2, then deploy matching code promptly:
 *      the deployed app shares this database.
 *
 * ── What this safeguard does NOT do (limitations) ──────────────────────────
 *   - Findings are pattern matches on the SQL text (migrationChecks.ts). They
 *     cannot see through dynamic SQL (`DO $$ … EXECUTE …`), functions or
 *     triggers that delete, ON DELETE CASCADE chains set up earlier, or what a
 *     statement does to THIS database's data (a new unique index failing on
 *     existing duplicates is flagged, but not predicted). Reading the SQL is
 *     the real check; the findings only point at where to look.
 *   - It does not measure locks or duration. ALTER TYPE rewrites the table;
 *     CREATE INDEX blocks writes to it while it builds (drizzle runs each
 *     migration inside a transaction, so CONCURRENTLY is not available). On a
 *     big table the live app stalls for that long.
 *   - Drizzle applies ALL pending migrations, in one transaction. A subset
 *     cannot be applied; a failure rolls the whole batch back.
 *   - There is no rollback after commit. Recovery is a forward migration or a
 *     restore from backup (Supabase backups depend on the plan).
 *   - The hash ties the review to the file, not to the database's state at
 *     apply time, nor to the code deployed against it.
 *   - It guards THIS script only. The Supabase SQL editor, `drizzle-kit
 *     studio` and `psql` can change the schema with no review.
 *
 * Drift, which drizzle itself never reports (it decides "pending" by
 * timestamp alone), is checked and blocks --apply:
 *   - a file OLDER than the last applied migration that never ran — drizzle
 *     would silently skip it forever (typical after merging a branch);
 *   - a file EDITED after it was applied — the database has a different SQL
 *     than the repo says.
 *
 * Applying uses drizzle's own migrator on ONE session connection
 * (DATABASE_MIGRATION_URL, Supabase's session pooler) — the same
 * `drizzle.__drizzle_migrations` rows `drizzle-kit migrate` writes.
 * `drizzle-kit migrate` and `drizzle-kit push` are refused in drizzle.config.ts.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Refused, confirmWrite, printTarget, runScript } from "./guard";
import { blocking, findings } from "./migrationChecks";

const MIGRATIONS = path.resolve("drizzle/migrations");

interface Entry {
  tag: string;
  when: number;
}

/** The same hash drizzle stores: sha256 of the whole file. */
function hashOf(sqlText: string): string {
  return crypto.createHash("sha256").update(sqlText).digest("hex");
}
const short = (hash: string) => hash.slice(0, 12);

function listArg(args: string[], name: string): string[] {
  return args
    .filter((a) => a.startsWith(`${name}=`))
    .flatMap((a) => a.slice(name.length + 1).split(","))
    .map((t) => t.trim())
    .filter(Boolean);
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const allowed = new Set(listArg(args, "--allow"));
  const reviewed = new Map(
    listArg(args, "--reviewed").map((item) => {
      const [tag, hash] = item.split("@");
      return [tag, (hash ?? "").toLowerCase()] as const;
    }),
  );

  // The session connection: a migration is a sequence of DDL on ONE connection.
  const url = process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Refused("Set DATABASE_MIGRATION_URL (or DATABASE_URL).");

  const journal = JSON.parse(fs.readFileSync(path.join(MIGRATIONS, "meta", "_journal.json"), "utf8")) as { entries: Entry[] };
  const files = journal.entries.map((entry) => {
    const text = fs.readFileSync(path.join(MIGRATIONS, `${entry.tag}.sql`), "utf8");
    return { ...entry, text, hash: hashOf(text) };
  });

  const pg = (await import("pg")).default;
  const { sslFor } = await import("@/core/db/ssl");
  const client = new pg.Client({ connectionString: url, ssl: sslFor(url) ?? undefined, connectionTimeoutMillis: 10_000 });
  await client.connect();
  try {
    // Read-only: what has already run.
    const exists = await client.query<{ t: string | null }>("select to_regclass('drizzle.__drizzle_migrations')::text as t");
    const applied: Array<{ hash: string; when: number }> = exists.rows[0].t
      ? (await client.query<{ hash: string; created_at: string }>("select hash, created_at::text from drizzle.__drizzle_migrations")).rows.map((r) => ({
          hash: r.hash,
          when: Number(r.created_at),
        }))
      : [];
    const appliedHashes = new Set(applied.map((a) => a.hash));
    const lastApplied = applied.reduce((max, a) => Math.max(max, a.when), 0);

    // drizzle's own rule: a migration runs when it is newer than the last one applied.
    const pending = files.filter((f) => f.when > lastApplied);

    // Drift drizzle would never mention.
    const drift: string[] = [];
    for (const f of files.filter((f) => f.when <= lastApplied && !appliedHashes.has(f.hash))) {
      drift.push(
        applied.some((a) => a.when === f.when)
          ? `${f.tag}: EDITED after it was applied — the database ran different SQL than this file now holds.`
          : `${f.tag}: older than the last applied migration and never run — drizzle will SKIP it forever.`,
      );
    }
    const fileHashes = new Set(files.map((f) => f.hash));
    const orphans = applied.filter((a) => !fileHashes.has(a.hash) && !files.some((f) => f.when === a.when));
    for (const o of orphans) drift.push(`An applied migration (${new Date(o.when).toISOString()}) has no file in the repo.`);

    const target = printTarget(apply ? "db:migrate --apply" : "db:migrate (inspection only — nothing will be applied)", url);
    console.log(`  Applied: ${applied.length} · files: ${files.length} · pending: ${pending.length}`);
    for (const d of drift) console.log(`  ⚠ DRIFT: ${d}`);
    if (pending.length === 0) {
      console.log(drift.length ? "\n  Nothing pending, but resolve the drift above." : "  The database is up to date.");
      return;
    }

    const mustAllow: string[] = [];
    for (const f of pending) {
      const found = findings(f.text);
      const blocks = found.some((x) => blocking(x.severity));
      if (blocks) mustAllow.push(f.tag);
      console.log(`\n  ── ${f.tag}  [reviewed token: ${f.tag}@${short(f.hash)}]${blocks ? "  ⚠ FLAGGED" : ""}`);
      if (found.length === 0) console.log("     Findings: none (additive) — still read the SQL.");
      for (const x of found) console.log(`     ${x.severity.toUpperCase()}: ${x.what}`);
      console.log("     SQL:");
      for (const line of f.text.replace(/--> statement-breakpoint/g, "").trimEnd().split("\n")) console.log(`       ${line}`);
    }

    if (!apply) {
      console.log("\nNothing applied. After READING the SQL above:");
      console.log(
        `  npm run db:migrate -- --apply --reviewed=${pending.map((f) => `${f.tag}@${short(f.hash)}`).join(",")}` +
          (mustAllow.length ? ` --allow=${mustAllow.join(",")}` : "") +
          (target.isLocal ? "" : " --shared-db"),
      );
      return;
    }

    if (drift.length) throw new Refused("Migration history has drifted (see above). Resolve it before applying anything. Nothing was applied.");
    const notReviewed = pending.filter((f) => reviewed.get(f.tag) !== short(f.hash));
    if (notReviewed.length) {
      throw new Refused(
        `Not reviewed, or changed since review: ${notReviewed.map((f) => f.tag).join(", ")}. ` +
          "Run `npm run db:migrate`, read the SQL, and pass each printed --reviewed token. Nothing was applied.",
      );
    }
    const notAllowed = mustAllow.filter((tag) => !allowed.has(tag));
    if (notAllowed.length) {
      throw new Refused(`Flagged migration(s) not explicitly allowed: ${notAllowed.join(", ")}. Name each in --allow=. Nothing was applied.`);
    }

    await confirmWrite({
      action: "db:migrate --apply — changes the database schema.",
      affects: [
        `Will apply (all together, one transaction): ${pending.map((f) => f.tag).join(", ")}`,
        target.isLocal ? "" : "The deployed app uses this database: deploy code that matches the new schema.",
      ].filter(Boolean),
      phrase: `apply ${pending.length} migration${pending.length === 1 ? "" : "s"}`,
      url,
    });

    const { drizzle } = await import("drizzle-orm/node-postgres");
    const { migrate } = await import("drizzle-orm/node-postgres/migrator");
    await migrate(drizzle(client), { migrationsFolder: MIGRATIONS });
    console.log(`\nApplied ${pending.length} migration(s).`);
  } finally {
    await client.end();
  }
}

runScript(main);
