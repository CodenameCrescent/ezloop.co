import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { blocking, findings } from "./migrationChecks";

/** Against this repo's own history: the classifier must catch what really happened. */
const read = (tag: string) => fs.readFileSync(path.resolve("drizzle/migrations", `${tag}.sql`), "utf8");
const severities = (sql: string) => new Set(findings(sql).map((f) => f.severity));

test("dropping tables is destructive", () => {
  assert.ok(severities(read("0001_drop-legacy-money-tables")).has("destructive"));
});

test("dropping a column is destructive", () => {
  assert.ok(severities(read("0018_drop-sku")).has("destructive"));
});

test("a backfill UPDATE plus SET NOT NULL is destructive and incompatible", () => {
  const s = severities(read("0022_settings-split-and-business-integrations"));
  assert.ok(s.has("destructive"));
  assert.ok(s.has("incompatible"));
});

test("adding nullable columns is additive", () => {
  assert.equal(findings(read("0031_entered-currency")).length, 0);
});

test("a type change, a rename and TRUNCATE are each caught", () => {
  assert.ok(severities('ALTER TABLE "t" ALTER COLUMN "c" SET DATA TYPE integer;').has("destructive"));
  assert.ok(severities('ALTER TABLE "t" RENAME COLUMN "a" TO "b";').has("incompatible"));
  assert.ok(severities('TRUNCATE "t";').has("destructive"));
  assert.ok(severities('ALTER TABLE "t" ADD COLUMN "x" text NOT NULL;').has("incompatible"));
  assert.equal(findings('ALTER TABLE "t" ADD COLUMN "x" text DEFAULT \'a\' NOT NULL;').filter((f) => f.severity === "incompatible").length, 0);
});

test("index builds and dynamic SQL are surfaced for review but do not block on their own", () => {
  const idx = findings('CREATE INDEX "i" ON "t" ("c");');
  assert.ok(idx.some((f) => f.severity === "review"));
  assert.ok(!idx.some((f) => blocking(f.severity)));
  assert.ok(findings("DO $$ BEGIN EXECUTE 'DELETE FROM t'; END $$;").some((f) => f.severity === "review"));
});
