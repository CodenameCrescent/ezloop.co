import { trustedClientIp } from "../http/clientIp";
import type { AuthUser } from "./accounts";

/**
 * Brakes on password guessing.
 *
 * Supabase rate-limits sign-ins too, but it sees OUR server's address for
 * every user, so its limit is one bucket for everyone — a single attacker can
 * spend it and lock every user out, and it does nothing per account. These
 * limits run before Supabase is asked:
 *
 *   email + client IP   5 failures / 15 min   stops one attacker on one account
 *   client IP          30 attempts / 15 min   stops one attacker across accounts
 *   email              30 failures / 60 min   stops a distributed attack on one
 *                                             account; cleared by a password reset
 *
 * Only a REJECTED password counts as a failure — not Supabase being down, not
 * an unconfirmed email (the password was right). A success clears that
 * email+IP pair. The client IP is used only where a trusted platform supplied
 * it (clientIp.ts); elsewhere only the per-email limit applies, so a spoofed
 * header can neither dodge a limit nor aim one at someone else.
 *
 * LIMITATION: counters live in this server instance's memory, like the API
 * limiter. Several instances (serverless scale-out) each count separately and
 * a restart forgets — an initial brake, not a distributed limiter. A shared
 * store (a small Postgres table, or Redis) is the upgrade and needs approval.
 */

const MIN = 60_000;
export const LIMITS = {
  pair: { max: 5, windowMs: 15 * MIN },
  ip: { max: 30, windowMs: 15 * MIN },
  email: { max: 30, windowMs: 60 * MIN },
} as const;

type Window = { count: number; resetAt: number };
const pairs = new Map<string, Window>();
const ips = new Map<string, Window>();
const emails = new Map<string, Window>();

let now = () => Date.now();
/** Test seam. */
export function setClockForTests(clock: () => number): void {
  now = clock;
}
export function resetSignInLimitsForTests(): void {
  pairs.clear();
  ips.clear();
  emails.clear();
  now = () => Date.now();
}

function live(map: Map<string, Window>, key: string): Window | undefined {
  const w = map.get(key);
  if (w && w.resetAt <= now()) {
    map.delete(key);
    return undefined;
  }
  return w;
}

function bump(map: Map<string, Window>, key: string, windowMs: number): void {
  const w = live(map, key);
  if (w) w.count += 1;
  else {
    if (map.size > 50_000) for (const [k, v] of map) if (v.resetAt <= now()) map.delete(k);
    map.set(key, { count: 1, resetAt: now() + windowMs });
  }
}

const normal = (email: string) => email.trim().toLowerCase();

export interface SignInKey {
  email: string;
  /** Null when no trusted platform supplied the client address. */
  ip: string | null;
}

export function signInKey(email: string, header: (name: string) => string | undefined): SignInKey {
  return { email: normal(email), ip: trustedClientIp(header) };
}

/** Null when the attempt may go ahead (and it is counted), else the minutes to wait. */
export function admitSignIn(key: SignInKey): number | null {
  const blockedFor = (w: Window | undefined, max: number) => (w && w.count >= max ? Math.max(1, Math.ceil((w.resetAt - now()) / MIN)) : null);
  const waits = [
    key.ip ? blockedFor(live(pairs, `${key.ip}|${key.email}`), LIMITS.pair.max) : null,
    key.ip ? blockedFor(live(ips, key.ip), LIMITS.ip.max) : null,
    blockedFor(live(emails, key.email), LIMITS.email.max),
  ].filter((m): m is number => m !== null);
  if (waits.length) return Math.max(...waits);
  if (key.ip) bump(ips, key.ip, LIMITS.ip.windowMs);
  return null;
}

/** Supabase rejected the password. */
export function recordFailedSignIn(key: SignInKey): void {
  if (key.ip) bump(pairs, `${key.ip}|${key.email}`, LIMITS.pair.windowMs);
  bump(emails, key.email, LIMITS.email.windowMs);
}

/** The password was right: this device's slate is clean. */
export function recordSuccessfulSignIn(key: SignInKey): void {
  if (key.ip) pairs.delete(`${key.ip}|${key.email}`);
}

/** After a password reset the owner has proven the inbox: forget the account-wide failures. */
export function clearEmailFailures(email: string): void {
  emails.delete(normal(email));
}

/** The sign-in form shows "try again in N minutes" from this. */
export class SignInRateLimited extends Error {
  constructor(readonly minutes: number) {
    super(`RATE_LIMITED:${minutes}`);
  }
}

/**
 * Email + password sign-in with the brakes on. `signIn` is the real Supabase
 * check (injected so this can be tested without Supabase): it returns null for
 * a rejected password and throws for anything else.
 */
export async function limitedPasswordSignIn(
  email: string,
  password: string,
  header: (name: string) => string | undefined,
  signIn: (email: string, password: string) => Promise<AuthUser | null>,
): Promise<AuthUser | null> {
  const key = signInKey(email, header);
  const wait = admitSignIn(key);
  if (wait !== null) throw new SignInRateLimited(wait); // Supabase is not asked
  const user = await signIn(key.email, password); // throws: not counted (outage, unconfirmed email)
  if (user) recordSuccessfulSignIn(key);
  else recordFailedSignIn(key);
  return user;
}
