import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ??= "postgres://unused@localhost:5432/unused"; // imported, never queried
const ENV = process.env as Record<string, string | undefined>;
const PLATFORM_KEYS = ["VERCEL", "VERCEL_REGION", "NODE_ENV"] as const;
const saved = Object.fromEntries(PLATFORM_KEYS.map((k) => [k, ENV[k]]));
/** A production Vercel Function's runtime environment. */
function onVercel() {
  Object.assign(process.env, { VERCEL: "1", VERCEL_REGION: "iad1", NODE_ENV: "production" });
}
const L = await import("./signInLimits");
const { SignInUnavailable } = await import("./accounts");

/** A fake Supabase: "right" is the only correct password; it counts how often it was asked. */
function fakeSupabase() {
  const calls = { n: 0 };
  const signIn = async (email: string, password: string) => {
    calls.n += 1;
    return password === "right" ? { id: "u", email, name: null, image: null } : null;
  };
  return { calls, signIn };
}
const from = (ip?: string) => (name: string) => (name === "x-real-ip" ? ip : undefined);

let clock = 1_000_000_000_000;
beforeEach(() => {
  L.resetSignInLimitsForTests();
  clock = 1_000_000_000_000;
  L.setClockForTests(() => clock);
  onVercel(); // a trusted platform: client IPs count
});
afterEach(() => {
  for (const k of PLATFORM_KEYS) {
    if (saved[k] === undefined) delete ENV[k];
    else ENV[k] = saved[k];
  }
});

test("5 failed passwords from one IP block that email+IP — Supabase is not asked a 6th time", async () => {
  const sb = fakeSupabase();
  for (let i = 0; i < 5; i++) assert.equal(await L.limitedPasswordSignIn("a@x.com", "wrong", from("1.1.1.1"), sb.signIn), null);
  await assert.rejects(() => L.limitedPasswordSignIn("a@x.com", "right", from("1.1.1.1"), sb.signIn), (e: Error) => /^RATE_LIMITED:15$/.test(e.message));
  assert.equal(sb.calls.n, 5);
});

test("the same email from another IP is not locked out by someone else's failures", async () => {
  const sb = fakeSupabase();
  for (let i = 0; i < 5; i++) await L.limitedPasswordSignIn("a@x.com", "wrong", from("1.1.1.1"), sb.signIn);
  assert.ok(await L.limitedPasswordSignIn("a@x.com", "right", from("2.2.2.2"), sb.signIn));
});

test("the block lifts when the window passes", async () => {
  const sb = fakeSupabase();
  for (let i = 0; i < 5; i++) await L.limitedPasswordSignIn("a@x.com", "wrong", from("1.1.1.1"), sb.signIn);
  clock += 15 * 60_000 + 1;
  assert.ok(await L.limitedPasswordSignIn("a@x.com", "right", from("1.1.1.1"), sb.signIn));
});

test("a success clears the email+IP failures", async () => {
  const sb = fakeSupabase();
  for (let i = 0; i < 4; i++) await L.limitedPasswordSignIn("a@x.com", "wrong", from("1.1.1.1"), sb.signIn);
  assert.ok(await L.limitedPasswordSignIn("a@x.com", "right", from("1.1.1.1"), sb.signIn));
  for (let i = 0; i < 4; i++) assert.equal(await L.limitedPasswordSignIn("a@x.com", "wrong", from("1.1.1.1"), sb.signIn), null);
});

test("one IP gets 30 attempts in 15 minutes across all emails", async () => {
  const sb = fakeSupabase();
  for (let i = 0; i < 30; i++) await L.limitedPasswordSignIn(`user${i}@x.com`, "right", from("3.3.3.3"), sb.signIn);
  await assert.rejects(() => L.limitedPasswordSignIn("new@x.com", "right", from("3.3.3.3"), sb.signIn), /RATE_LIMITED/);
  assert.ok(await L.limitedPasswordSignIn("new@x.com", "right", from("4.4.4.4"), sb.signIn), "other IPs are unaffected");
});

test("one email gets 30 failures an hour from any mix of IPs; a password reset clears it", async () => {
  const sb = fakeSupabase();
  for (let i = 0; i < 30; i++) await L.limitedPasswordSignIn("v@x.com", "wrong", from(`9.9.9.${i}`), sb.signIn);
  await assert.rejects(() => L.limitedPasswordSignIn("v@x.com", "right", from("8.8.8.8"), sb.signIn), /RATE_LIMITED/);
  L.clearEmailFailures("V@X.com");
  assert.ok(await L.limitedPasswordSignIn("v@x.com", "right", from("8.8.8.8"), sb.signIn));
});

test("emails are matched case-insensitively", async () => {
  const sb = fakeSupabase();
  for (let i = 0; i < 5; i++) await L.limitedPasswordSignIn("A@X.com", "wrong", from("1.1.1.1"), sb.signIn);
  await assert.rejects(() => L.limitedPasswordSignIn("a@x.com", "right", from("1.1.1.1"), sb.signIn), /RATE_LIMITED/);
});

test("Supabase being unavailable is never counted against the user", async () => {
  const down = async () => {
    throw new SignInUnavailable();
  };
  // 10 from one IP: under the 30-attempt IP brake, over the 5-failure pair limit.
  for (let i = 0; i < 10; i++) await assert.rejects(() => L.limitedPasswordSignIn("a@x.com", "x", from("1.1.1.1"), down), /SIGNIN_UNAVAILABLE/);
  // 40 more from many IPs: over the 30-failure email limit, had they counted.
  for (let i = 0; i < 40; i++) await assert.rejects(() => L.limitedPasswordSignIn("a@x.com", "x", from(`5.5.${i}.1`), down), /SIGNIN_UNAVAILABLE/);
  assert.ok(await L.limitedPasswordSignIn("a@x.com", "right", from("1.1.1.1"), fakeSupabase().signIn), "no failure was counted");
});

test("off a trusted platform, forwarded IPs are ignored: spoofing one cannot dodge the per-email limit", async () => {
  delete process.env.VERCEL;
  const sb = fakeSupabase();
  for (let i = 0; i < 30; i++) await L.limitedPasswordSignIn("a@x.com", "wrong", from(`7.7.7.${i}`), sb.signIn);
  await assert.rejects(() => L.limitedPasswordSignIn("a@x.com", "right", from("6.6.6.6"), sb.signIn), /RATE_LIMITED/);
});

test("trusted client IP: Vercel only, first value, malformed ignored", async () => {
  const { trustedClientIp } = await import("../http/clientIp");
  const h = (map: Record<string, string>) => (n: string) => map[n];
  assert.equal(trustedClientIp(h({ "x-forwarded-for": "5.6.7.8, 10.0.0.1" })), "5.6.7.8");
  assert.equal(trustedClientIp(h({ "x-real-ip": "not-an-ip" })), null);
  delete process.env.VERCEL;
  assert.equal(trustedClientIp(h({ "x-forwarded-for": "5.6.7.8" })), null, "never trusted off-platform");
});

test("VERCEL=1 set by hand (pulled .env, copied config) does not make forwarded IPs trusted", async () => {
  const { trustedClientIp, trustedProxyPlatform } = await import("../http/clientIp");
  const spoofed = (n: string) => (n === "x-forwarded-for" || n === "x-vercel-forwarded-for" ? "9.9.9.9" : undefined);
  const cases: Array<[string, Record<string, string>]> = [
    ["VERCEL=1 alone", { VERCEL: "1" }],
    ["VERCEL=1 under next start, no runtime region", { VERCEL: "1", NODE_ENV: "production" }],
    ["vercel env pull values under next dev", { VERCEL: "1", VERCEL_ENV: "production", VERCEL_REGION: "iad1", NODE_ENV: "development" }],
    ["vercel dev's placeholder region", { VERCEL: "1", VERCEL_REGION: "dev1", NODE_ENV: "production" }],
    ["empty region", { VERCEL: "1", VERCEL_REGION: "", NODE_ENV: "production" }],
    ["junk region", { VERCEL: "1", VERCEL_REGION: "local; x", NODE_ENV: "production" }],
    ["VERCEL=true (not the platform's value)", { VERCEL: "true", VERCEL_REGION: "iad1", NODE_ENV: "production" }],
  ];
  for (const [name, env] of cases) {
    assert.equal(trustedProxyPlatform(env as NodeJS.ProcessEnv), false, name);
    for (const k of PLATFORM_KEYS) delete ENV[k];
    Object.assign(process.env, env);
    assert.equal(trustedClientIp(spoofed), null, name);
  }
  // Control: the real runtime shape is trusted.
  onVercel();
  assert.equal(trustedClientIp(spoofed), "9.9.9.9");
});

test("a hand-set VERCEL=1 cannot dodge the per-email limit by rotating forwarded IPs", async () => {
  for (const k of PLATFORM_KEYS) delete ENV[k];
  process.env.VERCEL = "1";
  const sb = fakeSupabase();
  for (let i = 0; i < 30; i++) await L.limitedPasswordSignIn("b@x.com", "wrong", from(`8.8.${i}.8`), sb.signIn);
  await assert.rejects(() => L.limitedPasswordSignIn("b@x.com", "right", from("6.6.6.6"), sb.signIn), /RATE_LIMITED/);
});
