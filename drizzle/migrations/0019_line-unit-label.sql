ALTER TABLE "transaction_lines" ADD COLUMN "unit_label" text;--> statement-breakpoint
-- Backfill from the item each line already points at. The unit label has never
-- been editable in the UI, so an item's current label is what its past sales
-- were sold in — this is a restatement of what was always true, not a guess.
-- Label-only lines stay null: they count nothing in particular.
UPDATE "transaction_lines" tl
SET "unit_label" = ri."unit_label"
FROM "revenue_items" ri
WHERE tl."revenue_item_id" = ri."id";
