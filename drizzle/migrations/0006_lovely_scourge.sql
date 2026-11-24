-- Per-line money direction: lets ONE transaction carry both revenue and expense
-- lines. Existing lines are single-direction, so backfill each from its header.
ALTER TABLE "transaction_lines" ADD COLUMN "direction" text;--> statement-breakpoint
UPDATE "transaction_lines" l SET "direction" = t."direction" FROM "transactions" t WHERE l."transaction_id" = t."id";--> statement-breakpoint
ALTER TABLE "transaction_lines" ALTER COLUMN "direction" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "transaction_lines" ADD CONSTRAINT "transaction_lines_direction_item_check" CHECK ((direction = 'in' AND expense_item_id IS NULL) OR (direction = 'out' AND revenue_item_id IS NULL));
