import test from "node:test";
import assert from "node:assert/strict";
import { DEV_ACCOUNT_IDS, LEGACY_LOCAL_USER_ID, isDevAccountId, looksLikeRealUserId } from "./devAccounts";

test("Supabase user ids are recognised as real accounts", () => {
  assert.equal(looksLikeRealUserId("e486de75-aca2-487b-ad0c-b35b700df9f7"), true);
  assert.equal(looksLikeRealUserId("local-user"), false);
});

test("only the listed development accounts pass, and never a UUID", () => {
  for (const id of DEV_ACCOUNT_IDS) assert.equal(isDevAccountId(id), true);
  assert.equal(isDevAccountId("e486de75-aca2-487b-ad0c-b35b700df9f7"), false);
  assert.equal(isDevAccountId("someone-else"), false);
  assert.equal(DEV_ACCOUNT_IDS.has(LEGACY_LOCAL_USER_ID), true);
});
