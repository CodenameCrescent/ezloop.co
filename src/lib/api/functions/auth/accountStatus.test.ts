import test from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ??= "postgres://unused@localhost:5432/unused"; // no query is made here

const { revokeSessionsBefore, sessionStartMs } = await import("./accountStatus");

test("revocation keeps every existing app_metadata key and adds sessions_valid_after", async () => {
  const writes: unknown[] = [];
  const fake = {
    getUserById: async () => ({ data: { user: { app_metadata: { provider: "email", providers: ["email"], role: "x" } } }, error: null }),
    updateUserById: async (_id: string, attrs: unknown) => {
      writes.push(attrs);
      return { data: { user: null }, error: null };
    },
  };
  const at = new Date("2026-11-19T10:00:00.000Z");
  await revokeSessionsBefore("e486de75-aca2-487b-ad0c-b35b700df9f7", at, fake as never);
  assert.deepEqual(writes, [
    { app_metadata: { provider: "email", providers: ["email"], role: "x", sessions_valid_after: "2026-11-19T10:00:00.000Z" } },
  ]);
});

test("a failed read means no write (and the error surfaces)", async () => {
  let wrote = false;
  const fake = {
    getUserById: async () => ({ data: { user: null }, error: new Error("boom") }),
    updateUserById: async () => {
      wrote = true;
      return { data: { user: null }, error: null };
    },
  };
  await assert.rejects(() => revokeSessionsBefore("e486de75-aca2-487b-ad0c-b35b700df9f7", new Date(), fake as never));
  assert.equal(wrote, false);
});

test("session start: authTime, else iat, else 0", () => {
  assert.equal(sessionStartMs({ authTime: 123 }), 123);
  assert.equal(sessionStartMs({ iat: 10 }), 10_000);
  assert.equal(sessionStartMs(null), 0);
});
