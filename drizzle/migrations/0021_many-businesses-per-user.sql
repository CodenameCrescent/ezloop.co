DROP INDEX "businesses_user_uq";--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "currency_symbol" text DEFAULT 'Rs' NOT NULL;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "businesses_user_idx" ON "businesses" USING btree ("user_id");--> statement-breakpoint

-- Backfill: a business's NAME and CURRENCY describe that set of books, so they
-- move off the account and onto the business. Every existing user has exactly
-- one business (the unique index dropped above is what guaranteed it), so this
-- is an unambiguous one-to-one copy and cannot pick the wrong row.
--
-- `currency` is copied only when it is a real currency code. Some old rows hold
-- 'Rs', which is a SYMBOL that leaked into the code field; those keep the
-- column default of 'PKR' rather than carrying the mistake across.
UPDATE "businesses" b
SET "name" = COALESCE(NULLIF(s."business_name", ''), b."name"),
    "base_currency" = CASE WHEN s."currency" IN ('Rs', '') THEN b."base_currency" ELSE s."currency" END,
    "currency_symbol" = COALESCE(NULLIF(s."currency_symbol", ''), b."currency_symbol")
FROM "user_settings" s
WHERE s."user_id" = b."user_id";
