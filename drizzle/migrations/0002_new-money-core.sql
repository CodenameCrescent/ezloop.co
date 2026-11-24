CREATE TABLE "businesses" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text DEFAULT 'My Business' NOT NULL,
	"base_currency" text DEFAULT 'PKR' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" text PRIMARY KEY NOT NULL,
	"business_id" text NOT NULL,
	"name" text NOT NULL,
	"parent_id" text,
	"applies_to" text DEFAULT 'both' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cost_components" (
	"id" text PRIMARY KEY NOT NULL,
	"revenue_item_id" text NOT NULL,
	"name" text NOT NULL,
	"calc_type" text NOT NULL,
	"value_cents" bigint,
	"value_rate" text,
	"is_fee" boolean,
	"source_id" text,
	"effective_from" timestamp with time zone NOT NULL,
	"effective_to" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cost_components_value_check" CHECK ((calc_type = 'fixed_per_unit' AND value_cents IS NOT NULL AND value_rate IS NULL)
          OR (calc_type IN ('percent_of_price', 'percent_of_subtotal') AND value_rate IS NOT NULL AND value_cents IS NULL))
);
--> statement-breakpoint
CREATE TABLE "expense_items" (
	"id" text PRIMARY KEY NOT NULL,
	"business_id" text NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"category_id" text,
	"vendor_name" text,
	"default_amount_cents" bigint,
	"currency" text DEFAULT 'PKR' NOT NULL,
	"behavior" text DEFAULT 'one_time' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sources" (
	"id" text PRIMARY KEY NOT NULL,
	"business_id" text NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"platform_fee_percent" text,
	"default_currency" text DEFAULT 'PKR' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"last_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "revenue_item_sources" (
	"id" text PRIMARY KEY NOT NULL,
	"revenue_item_id" text NOT NULL,
	"source_id" text NOT NULL,
	"external_id" text,
	"price_override_cents" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "revenue_items" (
	"id" text PRIMARY KEY NOT NULL,
	"business_id" text NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"category_id" text,
	"pricing_model" text NOT NULL,
	"unit_price_cents" bigint,
	"currency" text DEFAULT 'PKR' NOT NULL,
	"unit_label" text NOT NULL,
	"sku" text,
	"status" text DEFAULT 'active' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transaction_lines" (
	"id" text PRIMARY KEY NOT NULL,
	"transaction_id" text NOT NULL,
	"revenue_item_id" text,
	"expense_item_id" text,
	"label" text,
	"category_id" text,
	"qty" text DEFAULT '1' NOT NULL,
	"unit_price_cents" bigint NOT NULL,
	"line_discount_cents" bigint DEFAULT 0 NOT NULL,
	"cost_snapshot" jsonb,
	"refunded_line_id" text,
	"restocked" boolean,
	"fees_recovered" boolean,
	"attributed_campaign_id" text,
	"attribution_method" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transaction_lines_one_item_check" CHECK (NOT (revenue_item_id IS NOT NULL AND expense_item_id IS NOT NULL)),
	CONSTRAINT "transaction_lines_label_check" CHECK (revenue_item_id IS NOT NULL OR expense_item_id IS NOT NULL OR label IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" text PRIMARY KEY NOT NULL,
	"business_id" text NOT NULL,
	"direction" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"source_id" text NOT NULL,
	"person_id" text,
	"status" text DEFAULT 'completed' NOT NULL,
	"currency" text DEFAULT 'PKR' NOT NULL,
	"fx_rate_to_base" text DEFAULT '1' NOT NULL,
	"origin" text DEFAULT 'manual' NOT NULL,
	"external_ref" text,
	"parent_transaction_id" text,
	"adjustment_type" text,
	"order_discount_cents" bigint DEFAULT 0 NOT NULL,
	"discount_code" text,
	"shipping_charged_cents" bigint DEFAULT 0 NOT NULL,
	"tax_collected_cents" bigint DEFAULT 0 NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_parent_id_categories_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_components" ADD CONSTRAINT "cost_components_revenue_item_id_revenue_items_id_fk" FOREIGN KEY ("revenue_item_id") REFERENCES "public"."revenue_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_components" ADD CONSTRAINT "cost_components_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_items" ADD CONSTRAINT "expense_items_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_items" ADD CONSTRAINT "expense_items_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sources" ADD CONSTRAINT "sources_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revenue_item_sources" ADD CONSTRAINT "revenue_item_sources_revenue_item_id_revenue_items_id_fk" FOREIGN KEY ("revenue_item_id") REFERENCES "public"."revenue_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revenue_item_sources" ADD CONSTRAINT "revenue_item_sources_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revenue_items" ADD CONSTRAINT "revenue_items_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revenue_items" ADD CONSTRAINT "revenue_items_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_lines" ADD CONSTRAINT "transaction_lines_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_lines" ADD CONSTRAINT "transaction_lines_revenue_item_id_revenue_items_id_fk" FOREIGN KEY ("revenue_item_id") REFERENCES "public"."revenue_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_lines" ADD CONSTRAINT "transaction_lines_expense_item_id_expense_items_id_fk" FOREIGN KEY ("expense_item_id") REFERENCES "public"."expense_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_lines" ADD CONSTRAINT "transaction_lines_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_lines" ADD CONSTRAINT "transaction_lines_refunded_line_id_transaction_lines_id_fk" FOREIGN KEY ("refunded_line_id") REFERENCES "public"."transaction_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_parent_transaction_id_transactions_id_fk" FOREIGN KEY ("parent_transaction_id") REFERENCES "public"."transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "businesses_user_uq" ON "businesses" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "categories_business_idx" ON "categories" USING btree ("business_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cost_components_open_uq" ON "cost_components" USING btree ("revenue_item_id","name",coalesce("source_id", '')) WHERE "cost_components"."effective_to" IS NULL;--> statement-breakpoint
CREATE INDEX "cost_components_item_idx" ON "cost_components" USING btree ("revenue_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "expense_items_business_name_uq" ON "expense_items" USING btree ("business_id","name");--> statement-breakpoint
CREATE INDEX "expense_items_business_idx" ON "expense_items" USING btree ("business_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sources_business_name_uq" ON "sources" USING btree ("business_id","name");--> statement-breakpoint
CREATE INDEX "sources_business_idx" ON "sources" USING btree ("business_id");--> statement-breakpoint
CREATE UNIQUE INDEX "revenue_item_sources_uq" ON "revenue_item_sources" USING btree ("revenue_item_id","source_id");--> statement-breakpoint
CREATE UNIQUE INDEX "revenue_items_business_name_uq" ON "revenue_items" USING btree ("business_id","name");--> statement-breakpoint
CREATE INDEX "revenue_items_business_idx" ON "revenue_items" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "transaction_lines_transaction_idx" ON "transaction_lines" USING btree ("transaction_id");--> statement-breakpoint
CREATE INDEX "transaction_lines_revenue_item_idx" ON "transaction_lines" USING btree ("revenue_item_id");--> statement-breakpoint
CREATE INDEX "transaction_lines_expense_item_idx" ON "transaction_lines" USING btree ("expense_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "transactions_source_external_ref_uq" ON "transactions" USING btree ("source_id","external_ref") WHERE "transactions"."external_ref" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "transactions_business_occurred_idx" ON "transactions" USING btree ("business_id","occurred_at");--> statement-breakpoint
CREATE INDEX "transactions_business_source_occurred_idx" ON "transactions" USING btree ("business_id","source_id","occurred_at");--> statement-breakpoint
CREATE INDEX "transactions_parent_idx" ON "transactions" USING btree ("parent_transaction_id");