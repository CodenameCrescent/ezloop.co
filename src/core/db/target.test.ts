import test from "node:test";
import assert from "node:assert/strict";
import { assertLocalTestDatabases, describeDatabase, targetLabel } from "./target";

test("a loopback host is local; a Supabase pooler is shared", () => {
  assert.equal(describeDatabase("postgres://u:p@localhost:5432/x").isLocal, true);
  assert.equal(describeDatabase("postgres://u:p@127.0.0.1:5432/x").isLocal, true);
  const shared = describeDatabase("postgresql://postgres.abc:secret@aws-0-eu-west-1.pooler.supabase.com:6543/postgres");
  assert.equal(shared.isLocal, false);
  assert.equal(shared.isSupabase, true);
});

test("the printed label never carries the user name or password", () => {
  const label = targetLabel(describeDatabase("postgresql://postgres.abc:hunter2@aws-0-eu-west-1.pooler.supabase.com:6543/postgres"));
  assert.ok(!label.includes("hunter2"));
  assert.ok(!label.includes("postgres.abc"));
  assert.match(label, /aws-0-eu-west-1\.pooler\.supabase\.com:6543\/postgres/);
});

test("an unparseable connection string is treated as NOT local", () => {
  assert.equal(describeDatabase("not a url").isLocal, false);
});

test("integration tests refuse anything but localhost", () => {
  assert.doesNotThrow(() => assertLocalTestDatabases("postgres://postgres:postgres@localhost:5432/profit_loop_test", undefined));
  assert.throws(() => assertLocalTestDatabases("postgresql://u:p@aws-0-eu-west-1.pooler.supabase.com:5432/postgres"), /Refusing/);
  assert.throws(() => assertLocalTestDatabases("postgres://u:p@db.example.com:5432/x"), /Refusing/);
});
