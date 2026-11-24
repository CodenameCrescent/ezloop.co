/**
 * Which database a connection string points at — WITHOUT its credentials.
 *
 * The one place that decides "is this the local database or the shared one?".
 * Scripts print it before they write, the test suites refuse anything but a
 * local server, and the token cipher refuses its dev fallback key on a shared
 * database. Nothing here opens a connection, so it is safe to import before
 * `DATABASE_URL` is settled.
 *
 * The shared Supabase project holds real accounts while the app is being
 * finished, so it is treated as valuable data even though developers use it.
 */

export interface DatabaseTarget {
  /** Host name only — never the user name or password. */
  host: string;
  port: string;
  database: string;
  /** A loopback host: this machine's own Postgres. */
  isLocal: boolean;
  /** A Supabase host (pooler or direct). */
  isSupabase: boolean;
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export function describeDatabase(connectionString: string | undefined): DatabaseTarget {
  // No URL means the caller falls back to its local default.
  if (!connectionString) return { host: "localhost", port: "5432", database: "(default)", isLocal: true, isSupabase: false };
  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    // Unparseable: say nothing about it and treat it as NOT local, so every
    // guard errs on the side of refusing.
    return { host: "(unparseable connection string)", port: "?", database: "?", isLocal: false, isSupabase: false };
  }
  const host = url.hostname.toLowerCase();
  return {
    host,
    port: url.port || "5432",
    database: decodeURIComponent(url.pathname.replace(/^\//, "")) || "(default)",
    isLocal: LOOPBACK_HOSTS.has(host),
    isSupabase: host.endsWith(".supabase.com") || host.endsWith(".supabase.co"),
  };
}

/** `host:port/database`, for printing. Never includes credentials. */
export function targetLabel(target: DatabaseTarget): string {
  return `${target.host}:${target.port}/${target.database}${target.isLocal ? " (local)" : " (SHARED — not this machine)"}`;
}

/**
 * The integration tests create a database, migrate it and wipe their fixture
 * users. They may only ever do that to a Postgres on this machine. Throws for
 * anything else, including a mistyped TEST_DATABASE_URL pointing at Supabase.
 */
export function assertLocalTestDatabases(...connectionStrings: Array<string | undefined>): void {
  for (const connectionString of connectionStrings) {
    const target = describeDatabase(connectionString);
    if (!target.isLocal || target.isSupabase) {
      throw new Error(
        `Refusing to run integration tests against ${target.host}: they create, migrate and wipe data, ` +
          "so they only run against a Postgres on localhost. Check TEST_DATABASE_URL / TEST_ADMIN_DATABASE_URL.",
      );
    }
  }
}
