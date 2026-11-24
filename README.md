# Profit Loop

Profit tracking for any kind of business. One Next.js app: pages, API, cron and webhooks.

Read `CLAUDE.md` before changing code. It covers the money invariants and the project layout.

## Run locally

Requirements: Node 24+ and a Supabase project (the database).

```bash
npm install
cp .env.example .env.local      # fill in the three DATABASE_* lines from your Supabase dashboard
npm run db:migrate              # inspect pending migrations; add -- --apply to run them
npm run db:demo                 # optional, local DB: two demo businesses for local-user
npm run dev                     # http://localhost:3000 (bound to 127.0.0.1 only)
```

**The development database is shared with real accounts.** Every script that can change records prints the target database (never credentials) and, on anything but a local Postgres, needs `--shared-db` plus a typed confirmation; seeding never targets a real account; `/api/data/seed` refuses a business with records; `drizzle-kit push`/`migrate` are disabled; integration tests only run against localhost. `npm run dev:lan` exposes the dev server to your network with real sign-in only.

With `LOCAL_AUTH_BYPASS=true` (off by default) there is no sign-in: under `npm run dev` only, you act as one of the development accounts in `src/lib/devAccounts.ts` — never a real account. Real sign-in is NextAuth over Supabase Auth: set `NEXTAUTH_SECRET`, `NEXTAUTH_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` and `SUPABASE_SECRET_KEY`, and in Supabase → Authentication → URL Configuration set the Site URL to your app and add `<app>/**` to Redirect URLs (the confirm and reset emails link back there). Google sign-in turns on when `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` are set (redirect URI `<app>/api/auth/callback/google`). To hand data made under the bypass to your real account: `npm run auth:claim -- you@example.com` (add `--apply` to write; it only ever moves the legacy `local-user` account, to a confirmed email).

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` / `build` / `start` | Next.js |
| `npm run typecheck` | `tsc --noEmit` over the whole app |
| `npm test` | Domain and UI unit tests (no database) |
| `npm run test:server` | Server tests (`src/lib/api/functions`). The integration tests create, wipe and drop their own database, so point `TEST_ADMIN_DATABASE_URL` and `TEST_DATABASE_URL` at a throwaway Postgres — **never at the Supabase database the app uses** |
| `npm run db:generate` | New migration from schema changes (`drizzle-kit push` is banned) |
| `npm run db:migrate` | Inspect pending migrations — prints their SQL (`-- --apply --reviewed=…` to run; see below) |
| `npm run db:seed` / `db:demo` | Seed data |
| `npm run job:recurring` | Run the recurring-posting job once |

## Deploy (Vercel + Supabase)

1. Import the repo into Vercel. The framework is detected; no build settings are needed.
2. Set `DATABASE_URL` (the 6543 Transaction pooler string), `DATABASE_CA_CERT` (the certificate's text, not a path), and the other variables from `.env.example` — not the bypass ones, and not `DATABASE_MIGRATION_URL`.
3. Run `npm run db:migrate` from your machine before the first deploy, and after any deploy that adds a migration.
4. `vercel.json` schedules `/api/jobs/recurring` nightly; Vercel signs it with `CRON_SECRET`.

## Changing the database schema (shared database)

The development database is shared with real accounts and the deployed app, so a migration is **read before it runs** — the tooling makes that a required step, not a suggestion.

1. Change the schema in `src/core/db/schema`, then `npm run db:generate`.
2. **Read the generated `.sql` file** in `drizzle/migrations`. That SQL — not the schema diff — is what runs.
3. `npm run db:migrate`. It prints every pending migration's full SQL, what it does to existing data (DESTRUCTIVE / INCOMPATIBLE / REVIEW), and a `--reviewed` token per file: `<tag>@<hash>`. The hash is of the file's exact contents.
4. Destructive or incompatible (drops, rewrites, renames, new NOT NULL or constraints)? Prefer **expand → deploy → contract**: add the new shape, deploy code that uses it, remove the old one in a later migration. Back up the affected tables first — there are no down-migrations.
5. Apply: `npm run db:migrate -- --apply --reviewed=<tokens> [--allow=<flagged tags>] --shared-db`, then type the confirmation phrase. A file edited after you reviewed it no longer matches its token and is refused.
6. Deploy code that matches the new schema promptly.

What the check cannot do: it reads SQL text, so dynamic SQL (`DO $$ … EXECUTE`), functions and triggers, cascades, lock duration on big tables and data-dependent failures are only *flagged for review*, never proven safe. Drizzle applies all pending migrations together in one transaction. The Supabase SQL editor, `drizzle-kit studio` and `psql` bypass all of this. The full list is at the top of `src/lib/api/functions/scripts/migrate.ts`.

