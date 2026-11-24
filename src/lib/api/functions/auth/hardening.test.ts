import test from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ??= "postgres://unused@localhost:5432/unused"; // imported, never queried
process.env.NEXT_PUBLIC_SUPABASE_URL ??= "http://127.0.0.1:9"; // createClient makes no request
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??= "test-key";

const { isRecoverySession } = await import("./accounts");
const { supabaseAnon } = await import("./supabase");
const { uid } = await import("../lib/uid");

/** A token-shaped string with these claims. Signature irrelevant: Supabase verifies it before this check runs. */
const tokenWith = (claims: object) => `h.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.s`;
const NOW = Date.parse("2026-11-19T12:00:00.000Z");
const sec = (ms: number) => Math.floor(ms / 1000);
const sentAt = new Date(NOW - 10 * 60_000).toISOString(); // recovery email sent 10 min ago

test("a session from the recovery email link is accepted", () => {
  for (const method of ["otp", "recovery", "magiclink"]) {
    assert.equal(isRecoverySession(tokenWith({ amr: [{ method, timestamp: sec(NOW - 5 * 60_000) }] }), sentAt, NOW), true, method);
  }
  assert.equal(isRecoverySession(tokenWith({ amr: ["otp"] }), sentAt, NOW), false, "a bare string has no timestamp: refused");
});

test("an ordinary sign-in session is refused, however fresh", () => {
  assert.equal(isRecoverySession(tokenWith({ amr: [{ method: "password", timestamp: sec(NOW - 60_000) }] }), sentAt, NOW), false);
  assert.equal(isRecoverySession(tokenWith({ amr: [{ method: "oauth", timestamp: sec(NOW - 60_000) }] }), sentAt, NOW), false);
});

test("a link session from BEFORE the recovery email was sent is refused", () => {
  assert.equal(isRecoverySession(tokenWith({ amr: [{ method: "otp", timestamp: sec(NOW - 60 * 60_000) }] }), sentAt, NOW), false);
});

test("a recovery session older than an hour is refused", () => {
  const oldSent = new Date(NOW - 3 * 60 * 60_000).toISOString();
  assert.equal(isRecoverySession(tokenWith({ amr: [{ method: "otp", timestamp: sec(NOW - 2 * 60 * 60_000) }] }), oldSent, NOW), false);
});

test("missing or malformed claims fail closed", () => {
  assert.equal(isRecoverySession(tokenWith({}), sentAt, NOW), false);
  assert.equal(isRecoverySession("not-a-jwt", sentAt, NOW), false);
  assert.equal(isRecoverySession(tokenWith({ amr: [{ method: "otp", timestamp: sec(NOW) }] }), null, NOW), false, "no recovery email was ever sent");
});

test("every sign-in gets its own Supabase client: no session can be left in a shared one", () => {
  assert.notEqual(supabaseAnon(), supabaseAnon());
});

test("ids keep their exact shape: prefix_ + 12 lowercase base-36 characters", () => {
  const SAFE_ID = /^[a-zA-Z0-9_-]{1,64}$/; // the business-id header check
  for (let i = 0; i < 1000; i++) {
    const id = uid("txn");
    assert.match(id, /^txn_[0-9a-z]{12}$/);
    assert.match(id, SAFE_ID);
  }
});

test("ids are unpredictable: no repeats, every character position varies, Math.random is not used", () => {
  const original = Math.random;
  Math.random = () => {
    throw new Error("uid must not use Math.random");
  };
  try {
    const ids = Array.from({ length: 20_000 }, () => uid("x").slice(2));
    assert.equal(new Set(ids).size, ids.length);
    for (let pos = 0; pos < 12; pos++) assert.ok(new Set(ids.map((id) => id[pos])).size > 30, `position ${pos} barely varies`);
  } finally {
    Math.random = original;
  }
});
