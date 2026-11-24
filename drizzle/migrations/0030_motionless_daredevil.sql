CREATE TABLE "import_batches" (
	"id" text PRIMARY KEY NOT NULL,
	"business_id" text NOT NULL,
	"kind" text NOT NULL,
	"filename" text NOT NULL,
	"source_id" text,
	"status" text DEFAULT 'applied' NOT NULL,
	"source_row_count" bigint DEFAULT 0 NOT NULL,
	"created_count" bigint DEFAULT 0 NOT NULL,
	"skipped_count" bigint DEFAULT 0 NOT NULL,
	"failed_count" bigint DEFAULT 0 NOT NULL,
	"mapping_json" jsonb,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"undone_at" timestamp with time zone,
	"undone_by" text
);
--> statement-breakpoint
ALTER TABLE "expense_items" ADD COLUMN "import_batch_id" text;--> statement-breakpoint
ALTER TABLE "people" ADD COLUMN "import_batch_id" text;--> statement-breakpoint
ALTER TABLE "revenue_items" ADD COLUMN "import_batch_id" text;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "import_batch_id" text;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "import_batches_business_created_idx" ON "import_batches" USING btree ("business_id","created_at");--> statement-breakpoint
ALTER TABLE "expense_items" ADD CONSTRAINT "expense_items_import_batch_id_import_batches_id_fk" FOREIGN KEY ("import_batch_id") REFERENCES "public"."import_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "people" ADD CONSTRAINT "people_import_batch_id_import_batches_id_fk" FOREIGN KEY ("import_batch_id") REFERENCES "public"."import_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revenue_items" ADD CONSTRAINT "revenue_items_import_batch_id_import_batches_id_fk" FOREIGN KEY ("import_batch_id") REFERENCES "public"."import_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_import_batch_id_import_batches_id_fk" FOREIGN KEY ("import_batch_id") REFERENCES "public"."import_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "expense_items_import_batch_idx" ON "expense_items" USING btree ("import_batch_id");--> statement-breakpoint
CREATE INDEX "people_import_batch_idx" ON "people" USING btree ("import_batch_id");--> statement-breakpoint
CREATE INDEX "revenue_items_import_batch_idx" ON "revenue_items" USING btree ("import_batch_id");--> statement-breakpoint
CREATE INDEX "transactions_import_batch_idx" ON "transactions" USING btree ("import_batch_id");