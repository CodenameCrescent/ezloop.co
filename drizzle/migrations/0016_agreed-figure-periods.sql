ALTER TABLE "client_engagements" ADD COLUMN "agreed_amount_period" text DEFAULT 'total' NOT NULL;--> statement-breakpoint
ALTER TABLE "client_engagements" ADD COLUMN "agreed_hours_period" text DEFAULT 'total' NOT NULL;--> statement-breakpoint
-- Carry over what the dying `engagement_type` column knew, before 0017 drops it.
--
-- `total` is the right default for every row, because it is what every row
-- written before these columns existed meant. But one group of rows carries a
-- deliberate answer that says otherwise: an owner who picked "Ongoing retainer"
-- was telling us the arrangement runs month to month, and their agreed figures
-- are almost certainly monthly ones.
--
-- Only `engagement_type = 'retainer'` is used as evidence. `billing_frequency`
-- is NOT, even though 'monthly' looks like it says the same thing — 'monthly'
-- is that column's DEFAULT, so it is set on every row where the owner never
-- chose anything, and a default is evidence of nothing.
--
-- This runs once, against data that is about to be deleted. An owner who
-- disagrees can flip either toggle on the Clients screen.
UPDATE "client_engagements"
SET "agreed_hours_period" = 'monthly', "agreed_amount_period" = 'monthly'
WHERE "engagement_type" = 'retainer';
