-- Settings split, and integrations move from the account to the business.
--
-- Drizzle's generated version of this dropped the user_settings columns BEFORE
-- anything read them, and added integrations.business_id as NOT NULL with no
-- default against a table that has rows. Both are rewritten below: every move
-- copies first, checks second, and only then drops. Any mismatch raises and
-- takes the whole migration down with it, because a settings split that half
-- happened is worse than one that did not start.

CREATE TABLE "business_settings" (
	"business_id" text PRIMARY KEY NOT NULL,
	"default_cost_price" double precision DEFAULT 0 NOT NULL,
	"default_selling_price" double precision DEFAULT 0 NOT NULL,
	"scale_margin" double precision DEFAULT 25 NOT NULL,
	"stop_score" double precision DEFAULT -30 NOT NULL,
	"min_orders" integer DEFAULT 3 NOT NULL,
	"ad_attribution_pct" double precision DEFAULT 70 NOT NULL,
	"cash_buffer" double precision DEFAULT 0 NOT NULL,
	"business_models" text DEFAULT '[]' NOT NULL,
	"budget_plan" text DEFAULT '{"categories":[]}' NOT NULL,
	"seeded_at" timestamp with time zone,
	"onboarded" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

ALTER TABLE "business_settings" ADD CONSTRAINT "business_settings_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint

-- Copy the per-business half of the account's settings onto every business.
-- LEFT JOIN, because a user may own a business and have never had a settings
-- row written; those take the column defaults rather than being skipped.
-- `onboarded` is true for every existing business: they are all in use already,
-- and the welcome screen must not appear for someone who has been trading.
INSERT INTO "business_settings" (
  "business_id", "default_cost_price", "default_selling_price", "scale_margin",
  "stop_score", "min_orders", "ad_attribution_pct", "cash_buffer",
  "business_models", "budget_plan", "seeded_at", "onboarded"
)
SELECT
  b."id",
  COALESCE(s."default_cost_price", 0),
  COALESCE(s."default_selling_price", 0),
  COALESCE(s."scale_margin", 25),
  COALESCE(s."stop_score", -30),
  COALESCE(s."min_orders", 3),
  COALESCE(s."ad_attribution_pct", 70),
  COALESCE(s."cash_buffer", 0),
  COALESCE(s."business_models", '[]'),
  COALESCE(s."budget_plan", '{"categories":[]}'),
  s."seeded_at",
  true
FROM "businesses" b
LEFT JOIN "user_settings" s ON s."user_id" = b."user_id";--> statement-breakpoint

-- Reconcile or fail: one settings row per business, no more and no fewer.
DO $$
DECLARE
  businesses_count bigint;
  settings_count bigint;
BEGIN
  SELECT count(*) INTO businesses_count FROM "businesses";
  SELECT count(*) INTO settings_count FROM "business_settings";
  IF businesses_count <> settings_count THEN
    RAISE EXCEPTION
      'settings split did not reconcile: % businesses but % business_settings rows',
      businesses_count, settings_count;
  END IF;
END $$;--> statement-breakpoint

-- ── integrations: from the account to the business ─────────────────────────
ALTER TABLE "integrations" ADD COLUMN "business_id" text;--> statement-breakpoint

-- Unambiguous: until migration 0021 a user had exactly one business, so there
-- is precisely one candidate per row. The MIN() is a tie-break that can never
-- be reached on data written before this pair of migrations.
UPDATE "integrations" i
SET "business_id" = (
  SELECT MIN(b."id") FROM "businesses" b WHERE b."user_id" = i."user_id"
);--> statement-breakpoint

-- A connected account whose user owns no business cannot be given one, and
-- guessing would attach someone's store to the wrong books. This RAISES rather
-- than deleting: the row holds an access token, and destroying credentials
-- inside a migration is not a decision a migration gets to make quietly.
DO $$
DECLARE
  orphans bigint;
  who text;
BEGIN
  SELECT count(*), string_agg(DISTINCT "user_id", ', ')
    INTO orphans, who
    FROM "integrations" WHERE "business_id" IS NULL;
  IF orphans > 0 THEN
    RAISE EXCEPTION
      '% integration(s) belong to users with no business (%). Give them a business or remove the rows, then re-run.',
      orphans, who;
  END IF;
END $$;--> statement-breakpoint

ALTER TABLE "integrations" ALTER COLUMN "business_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "integrations" ADD CONSTRAINT "integrations_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
DROP INDEX "integrations_user_kind_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "integrations_business_kind_idx" ON "integrations" USING btree ("business_id","kind");--> statement-breakpoint
CREATE INDEX "integrations_user_idx" ON "integrations" USING btree ("user_id");--> statement-breakpoint

-- ── Only now is anything dropped ────────────────────────────────────────────
-- currency / currency_symbol / business_name were already moved onto
-- `businesses` by migration 0021 and have been unread since.
ALTER TABLE "user_settings" DROP COLUMN "currency";--> statement-breakpoint
ALTER TABLE "user_settings" DROP COLUMN "currency_symbol";--> statement-breakpoint
ALTER TABLE "user_settings" DROP COLUMN "business_name";--> statement-breakpoint
ALTER TABLE "user_settings" DROP COLUMN "default_cost_price";--> statement-breakpoint
ALTER TABLE "user_settings" DROP COLUMN "default_selling_price";--> statement-breakpoint
ALTER TABLE "user_settings" DROP COLUMN "scale_margin";--> statement-breakpoint
ALTER TABLE "user_settings" DROP COLUMN "stop_score";--> statement-breakpoint
ALTER TABLE "user_settings" DROP COLUMN "min_orders";--> statement-breakpoint
ALTER TABLE "user_settings" DROP COLUMN "ad_attribution_pct";--> statement-breakpoint
ALTER TABLE "user_settings" DROP COLUMN "cash_buffer";--> statement-breakpoint
ALTER TABLE "user_settings" DROP COLUMN "budget_plan";--> statement-breakpoint
ALTER TABLE "user_settings" DROP COLUMN "business_models";--> statement-breakpoint
ALTER TABLE "user_settings" DROP COLUMN "seeded_at";
