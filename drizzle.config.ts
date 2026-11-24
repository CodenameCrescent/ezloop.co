import { config } from "dotenv";

// Same files Next reads, so `drizzle-kit generate` sees the database the app uses.
config({ path: [".env.local", ".env"], quiet: true });
import { defineConfig } from "drizzle-kit";
import { sslFor } from "./src/core/db/ssl";

/**
 * Migrations take the SESSION connection when there is one. Supabase's
 * transaction pooler (DATABASE_URL, port 6543) hands each statement to whichever
 * connection is free, which a migration — a sequence of DDL that must run in
 * order on one connection — cannot tolerate.
 */
/**
 * drizzle-kit may GENERATE migrations, never apply them. The database is
 * shared with the deployed app and real accounts: `push` rewrites the schema
 * with no migration file and no review, and `drizzle-kit migrate` skips the
 * inspection in `npm run db:migrate` (scripts/migrate.ts), which reads every
 * pending migration and refuses destructive ones unless each is named.
 */
const REFUSED_COMMANDS = new Set(["push", "migrate"]);
const command = process.argv.slice(2).find((arg) => !arg.startsWith("-"));
if (command && REFUSED_COMMANDS.has(command)) {
  throw new Error(
    `drizzle-kit ${command} is disabled for this project. Use \`npm run db:migrate\` (inspects first; --apply to run).`,
  );
}

const url = process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL;
if (!url) {
  throw new Error("DATABASE_URL, ensure the database is provisioned");
}
const parsed = new URL(url);

export default defineConfig({
  schema: "./src/core/db/schema/*.ts",
  out: "./drizzle/migrations",
  dialect: "postgresql",
  // Spelled out rather than `{ url }`, because only this form carries TLS settings.
  dbCredentials: {
    host: parsed.hostname,
    port: Number(parsed.port || 5432),
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database: parsed.pathname.replace(/^\//, "") || "postgres",
    ssl: sslFor(url) ?? false,
  },
});
