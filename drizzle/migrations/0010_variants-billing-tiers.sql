DROP INDEX "revenue_items_business_name_uq";--> statement-breakpoint
ALTER TABLE "revenue_items" ADD COLUMN "parent_id" text;--> statement-breakpoint
ALTER TABLE "revenue_items" ADD COLUMN "default_billing_cycle" text;--> statement-breakpoint
ALTER TABLE "revenue_items" ADD COLUMN "tiers_json" jsonb;--> statement-breakpoint
ALTER TABLE "revenue_items" ADD CONSTRAINT "revenue_items_parent_id_revenue_items_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."revenue_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "revenue_items_business_root_name_uq" ON "revenue_items" USING btree ("business_id","name") WHERE "revenue_items"."parent_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "revenue_items_parent_name_uq" ON "revenue_items" USING btree ("parent_id","name") WHERE "revenue_items"."parent_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "revenue_items_parent_idx" ON "revenue_items" USING btree ("parent_id");