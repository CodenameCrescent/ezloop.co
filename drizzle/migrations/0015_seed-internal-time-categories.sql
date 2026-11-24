-- Give every EXISTING business the internal time buckets.
--
-- Migration 0014 added the `time` category tag, and new businesses get these
-- buckets seeded at creation. Without this step every business that already
-- existed would open the client module to an empty screen and have no way to
-- log an hour against anything internal — the seeding only runs on creation
-- and on a business-type change, neither of which an existing owner would hit.
--
-- Idempotent by name: the NOT EXISTS clause means re-running adds nothing, and
-- a bucket the owner renamed is not resurrected under its old name.
--
-- Ids mirror the app's own format (prefix_ + random suffix) closely enough to
-- be indistinguishable in use; nothing parses an id.
INSERT INTO "categories" ("id", "business_id", "name", "applies_to")
SELECT
  'cat_' || substr(md5(random()::text || b."id" || seed."name"), 1, 12),
  b."id",
  seed."name",
  'time'
FROM "businesses" b
CROSS JOIN (
  VALUES ('Admin'), ('Sales & pitching'), ('Own marketing'), ('Training'), ('Rework (unattributed)')
) AS seed("name")
WHERE NOT EXISTS (
  SELECT 1 FROM "categories" c
   WHERE c."business_id" = b."id"
     AND c."applies_to" = 'time'
     AND c."name" = seed."name"
);
