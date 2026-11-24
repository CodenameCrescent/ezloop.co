ALTER TABLE "transactions" ADD COLUMN "entered_currency" text;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "entered_fx_rate" text;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "entered_amount_cents" bigint;