ALTER TABLE "transactions" ADD COLUMN "paid_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "tax_paid_cents" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "tax_reclaimable" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "transactions_business_paid_idx" ON "transactions" USING btree ("business_id","paid_at");--> statement-breakpoint

-- Separate WHEN IT HAPPENED from WHEN IT WAS PAID.
--
-- Until now `status` answered both "where is this in its lifecycle" and "has
-- the money moved", and `pending` in particular meant two unrelated things:
--   (a) an invoice that is real but has not been paid yet, and
--   (b) a recurring post the owner has not yet confirmed happened at all.
-- Those need opposite treatment — (a) belongs in profit, (b) does not — so
-- paid-ness moves to its own column and `status` keeps only the lifecycle.
--
-- Step 1 — everything already settled was, in effect, paid on the day it
-- happened; that is the assumption every existing figure was built on, so
-- copying occurred_at keeps all history identical under the cash basis.
UPDATE "transactions"
   SET "paid_at" = "occurred_at"
 WHERE "status" IN ('completed', 'refunded', 'partially_refunded', 'disputed');--> statement-breakpoint

-- Step 2 — case (a). A pending row the recurring engine did NOT create was an
-- ordinary entry the owner marked unpaid via the settle toggle. It is a real
-- money event awaiting cash: completed, with paid_at left NULL. This is the
-- one place a figure moves — such rows now count in accrual profit, which is
-- the point of the change (an unpaid July invoice IS July revenue).
--
-- Case (b) needs no statement: an unconfirmed recurring post keeps status
-- 'pending' and a NULL paid_at, so it stays out of profit AND out of cash
-- until the owner confirms it, exactly as before.
UPDATE "transactions"
   SET "status" = 'completed'
 WHERE "status" = 'pending'
   AND "origin" <> 'recurring_engine';--> statement-breakpoint

-- Voids never moved money; paid_at stays NULL for them by omission above.
