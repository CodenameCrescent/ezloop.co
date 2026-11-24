import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";
import { sslFor } from "./ssl";
import { assertLocalTestDatabases } from "./target";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

/**
 * How many connections one API process may hold at once.
 *
 * Written down rather than left to `pg`'s default — which is also ten — because
 * the number now has a job. `commitImport` (`src/app/api/imports/functions.ts`) holds
 * TWO at a time: one for the advisory-lock transaction that stops two uploads of
 * one file both landing, and one for whichever `createTransaction` is running
 * inside it. Ten leaves room for four imports running side by side on one
 * process with two spare for ordinary requests, and every other query in this
 * app checks a connection out for milliseconds.
 *
 * Bigger is not safer here. Production is Vercel (DEPLOY.md): every warm
 * instance builds its own pool against ONE shared Neon pooled endpoint, so this
 * number is multiplied by however many instances are awake. And no finite value
 * removes the failure below — N simultaneous imports want 2N connections — which
 * is why the timeout, not the size, is the fix.
 */
/**
 * Backstop for the integration tests: under Node's test runner the pool may
 * only point at this machine. Each suite also checks for itself before it
 * connects; this catches a suite that forgets.
 */
if (process.env.NODE_TEST_CONTEXT) assertLocalTestDatabases(process.env.DATABASE_URL);

const POOL_MAX = 10;

/**
 * How long a caller waits for a free connection before it is told no.
 *
 * `pg` defaults this to zero, meaning WAIT FOREVER, and that default is what
 * turned a busy moment into a dead process. Ten imports starting together each
 * take a lock connection immediately, then each queue for a second one that will
 * never come. Postgres cannot see any of it: the wait is in this pool, in Node,
 * so the import lock's own 30-second `lock_timeout` never applies and nothing
 * anywhere times out. The process wedges until it is restarted, and it takes
 * every other request with it, not just the imports.
 *
 * Five seconds, chosen against three things rather than picked:
 *
 *  - Every ordinary query here holds a connection for milliseconds, so five
 *    seconds of waiting already means the pool is genuinely saturated. Waiting
 *    longer would not find a connection; it would only delay the answer.
 *  - It is well under the import lock's 30-second wait (`IMPORT_LOCK_WAIT`), so
 *    a pile-up of lock-waiters can no longer hold unrelated routes hostage for
 *    the whole lock window.
 *  - It leaves room inside a serverless invocation's budget for the handler to
 *    return a real error, instead of the platform killing the request with
 *    nothing to show for it.
 *
 * The point is not that the error is pleasant. It is that the pool DRAINS: a
 * caller that gives up hands its connection back, the holder finishes, and the
 * process recovers on its own.
 */
const POOL_CONNECTION_TIMEOUT_MS = 5_000;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: sslFor(process.env.DATABASE_URL),
  max: POOL_MAX,
  connectionTimeoutMillis: POOL_CONNECTION_TIMEOUT_MS,
});
export const db = drizzle(pool, { schema });

export * from "./schema";
