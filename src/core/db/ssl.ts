import { existsSync, readFileSync } from "node:fs";
import type { ConnectionOptions } from "node:tls";

/**
 * TLS settings for a Postgres connection string.
 *
 * A database on this machine gets none. Anything else is encrypted AND
 * verified: Supabase signs its database certificates with its own root CA
 * rather than a public one, so that CA is supplied in `DATABASE_CA_CERT` —
 * either the PEM text itself (how Vercel holds it) or a path to the `.crt`
 * file (how `.env.local` holds it). Certificate checking is never switched off.
 */
export function sslFor(connectionString: string): ConnectionOptions | undefined {
  const host = new URL(connectionString).hostname;
  if (host === "localhost" || host === "127.0.0.1" || host === "::1") return undefined;

  const configured = process.env.DATABASE_CA_CERT?.trim();
  if (!configured) return { rejectUnauthorized: true };
  const ca = configured.startsWith("-----BEGIN")
    ? configured.replace(/\\n/g, "\n")
    : existsSync(configured)
      ? readFileSync(configured, "utf8")
      : undefined;
  if (!ca) throw new Error(`DATABASE_CA_CERT points at "${configured}", which does not exist.`);
  return { ca, rejectUnauthorized: true };
}
