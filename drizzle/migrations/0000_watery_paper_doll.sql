CREATE TABLE "ad_spend" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"date" timestamp with time zone NOT NULL,
	"total_spend" double precision DEFAULT 0 NOT NULL,
	"product_id" text,
	"platform" text,
	"campaign" text,
	"source" text DEFAULT 'manual' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "client_customers" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"type" text DEFAULT 'customer' NOT NULL,
	"name" text NOT NULL,
	"phone" text,
	"email" text,
	"company_name" text,
	"notes" text,
	"legacy_customer_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customer_merges" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"primary_key" text NOT NULL,
	"primary_label" text NOT NULL,
	"merged_key" text NOT NULL,
	"merged_label" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "expense_items" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"type" text DEFAULT 'fixed' NOT NULL,
	"origin_label" text DEFAULT 'Manual' NOT NULL,
	"provider" text DEFAULT 'manual' NOT NULL,
	"connection_id" text,
	"connection_name" text,
	"external_id" text,
	"amount_mode" text DEFAULT 'fixed' NOT NULL,
	"amount" double precision,
	"rate_unit" text,
	"rate_label" text,
	"frequency" text DEFAULT 'monthly' NOT NULL,
	"schedule_mode" text DEFAULT 'monthly_day' NOT NULL,
	"due_date" timestamp with time zone,
	"monthly_day" integer,
	"weekly_day" text,
	"next_due_date" timestamp with time zone,
	"last_paid_date" timestamp with time zone,
	"auto_sync" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"notes" text,
	"metadata_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "expenses" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"amount" double precision NOT NULL,
	"type" text NOT NULL,
	"frequency" text,
	"date" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"payment_status" text DEFAULT 'paid' NOT NULL,
	"category" text,
	"vendor" text,
	"attachment_name" text,
	"order_id" text,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"category" text,
	"default_cost_price" double precision DEFAULT 0 NOT NULL,
	"default_selling_price" double precision DEFAULT 0 NOT NULL,
	"packaging_cost" double precision DEFAULT 0 NOT NULL,
	"default_shipping_cost" double precision DEFAULT 0 NOT NULL,
	"image_color" text NOT NULL,
	"sku" text,
	"supplier" text,
	"low_stock_alert_level" integer DEFAULT 10 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_items" (
	"id" text PRIMARY KEY NOT NULL,
	"order_id" text NOT NULL,
	"product_id" text NOT NULL,
	"product_name" text NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"unit_selling_price" double precision DEFAULT 0 NOT NULL,
	"unit_cost_price" double precision DEFAULT 0 NOT NULL,
	"position" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"customer" text,
	"phone" text,
	"source" text,
	"platform" text,
	"payment_status" text DEFAULT 'paid' NOT NULL,
	"refund_amount" double precision DEFAULT 0 NOT NULL,
	"tax_amount" double precision DEFAULT 0 NOT NULL,
	"shipping_charged" double precision DEFAULT 0 NOT NULL,
	"delivery_cost" double precision DEFAULT 0 NOT NULL,
	"ad_cost" double precision DEFAULT 0 NOT NULL,
	"discount" double precision DEFAULT 0 NOT NULL,
	"date" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'completed' NOT NULL,
	"external_id" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "offers" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"offer_type" text DEFAULT 'physical_product' NOT NULL,
	"price" double precision DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"product_cost" double precision DEFAULT 0 NOT NULL,
	"direct_cost" double precision DEFAULT 0 NOT NULL,
	"category" text,
	"price_unit" text,
	"availability" text,
	"metadata_json" jsonb,
	"sku" text,
	"supplier" text,
	"inventory_tracking_enabled" boolean DEFAULT false NOT NULL,
	"stock_quantity" integer DEFAULT 0 NOT NULL,
	"low_stock_threshold" integer DEFAULT 0 NOT NULL,
	"notes" text,
	"source" text DEFAULT 'manual' NOT NULL,
	"external_id" text,
	"source_record_type" text,
	"source_record_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"transaction_type" text NOT NULL,
	"amount" double precision DEFAULT 0 NOT NULL,
	"date" timestamp with time zone NOT NULL,
	"category" text,
	"source" text DEFAULT 'manual' NOT NULL,
	"offer_id" text,
	"linked_revenue_item_id" text,
	"linked_expense_item_id" text,
	"client_customer_id" text,
	"campaign_id" text,
	"notes" text,
	"payment_status" text,
	"origin_label" text,
	"provider" text,
	"connection_id" text,
	"connection_name" text,
	"external_id" text,
	"metadata_json" jsonb,
	"line_items_json" jsonb,
	"source_record_type" text,
	"source_record_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_settings" (
	"user_id" text PRIMARY KEY NOT NULL,
	"currency" text DEFAULT 'PKR' NOT NULL,
	"currency_symbol" text DEFAULT 'Rs' NOT NULL,
	"business_name" text DEFAULT 'My Business' NOT NULL,
	"plan" text DEFAULT 'Free' NOT NULL,
	"default_cost_price" double precision DEFAULT 0 NOT NULL,
	"default_selling_price" double precision DEFAULT 0 NOT NULL,
	"locale" text DEFAULT 'en-IN' NOT NULL,
	"toasts_enabled" boolean DEFAULT true NOT NULL,
	"scale_margin" double precision DEFAULT 25 NOT NULL,
	"stop_score" double precision DEFAULT -30 NOT NULL,
	"min_orders" integer DEFAULT 3 NOT NULL,
	"ad_attribution_pct" double precision DEFAULT 70 NOT NULL,
	"cash_buffer" double precision DEFAULT 0 NOT NULL,
	"budget_plan" text DEFAULT '{"categories":[]}' NOT NULL,
	"business_models" text DEFAULT '[]' NOT NULL,
	"seeded_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"paddle_customer_id" text,
	"paddle_subscription_id" text
);
--> statement-breakpoint
CREATE TABLE "inventory_movements" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"inventory_id" text NOT NULL,
	"product_id" text NOT NULL,
	"type" text NOT NULL,
	"quantity" integer DEFAULT 0 NOT NULL,
	"unit_cost" double precision DEFAULT 0 NOT NULL,
	"total_cost" double precision DEFAULT 0 NOT NULL,
	"previous_quantity" integer DEFAULT 0 NOT NULL,
	"new_quantity" integer DEFAULT 0 NOT NULL,
	"note" text,
	"movement_date" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inventory" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"product_id" text NOT NULL,
	"variant_name" text,
	"sku" text,
	"quantity" integer DEFAULT 0 NOT NULL,
	"cost_per_unit" double precision DEFAULT 0 NOT NULL,
	"stock_in" integer DEFAULT 0 NOT NULL,
	"stock_out" integer DEFAULT 0 NOT NULL,
	"purchase_quantity" integer DEFAULT 0 NOT NULL,
	"purchase_cost" double precision DEFAULT 0 NOT NULL,
	"damaged_stock" integer DEFAULT 0 NOT NULL,
	"returned_stock" integer DEFAULT 0 NOT NULL,
	"supplier" text,
	"notes" text,
	"external_source" text,
	"external_id" text,
	"last_synced_at" timestamp with time zone,
	"last_movement_at" timestamp with time zone,
	"sync_status" text DEFAULT 'manual' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integrations" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"display_name" text NOT NULL,
	"external_account" text,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_synced_at" timestamp with time zone,
	"access_token" text
);
--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_inventory_id_inventory_id_fk" FOREIGN KEY ("inventory_id") REFERENCES "public"."inventory"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ad_spend_user_idx" ON "ad_spend" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "ad_spend_user_date_idx" ON "ad_spend" USING btree ("user_id","date");--> statement-breakpoint
CREATE INDEX "client_customers_user_idx" ON "client_customers" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "client_customers_user_name_idx" ON "client_customers" USING btree ("user_id","name");--> statement-breakpoint
CREATE INDEX "customer_merges_user_idx" ON "customer_merges" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "customer_merges_user_edge_uq" ON "customer_merges" USING btree ("user_id","primary_key","merged_key");--> statement-breakpoint
CREATE INDEX "expense_items_user_idx" ON "expense_items" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "expense_items_user_status_idx" ON "expense_items" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "expense_items_user_type_idx" ON "expense_items" USING btree ("user_id","type");--> statement-breakpoint
CREATE INDEX "expense_items_source_idx" ON "expense_items" USING btree ("user_id","provider","connection_id","external_id");--> statement-breakpoint
CREATE INDEX "expenses_user_idx" ON "expenses" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "expenses_type_idx" ON "expenses" USING btree ("type");--> statement-breakpoint
CREATE INDEX "products_user_idx" ON "products" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "order_items_order_idx" ON "order_items" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "order_items_product_idx" ON "order_items" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "orders_user_idx" ON "orders" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "orders_user_date_idx" ON "orders" USING btree ("user_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_user_external_idx" ON "orders" USING btree ("user_id","external_id");--> statement-breakpoint
CREATE INDEX "offers_user_idx" ON "offers" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "offers_user_type_idx" ON "offers" USING btree ("user_id","offer_type");--> statement-breakpoint
CREATE INDEX "offers_source_record_idx" ON "offers" USING btree ("user_id","source_record_type","source_record_id");--> statement-breakpoint
CREATE INDEX "transactions_user_idx" ON "transactions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "transactions_user_date_idx" ON "transactions" USING btree ("user_id","date");--> statement-breakpoint
CREATE INDEX "transactions_user_type_idx" ON "transactions" USING btree ("user_id","transaction_type");--> statement-breakpoint
CREATE INDEX "transactions_offer_idx" ON "transactions" USING btree ("offer_id");--> statement-breakpoint
CREATE INDEX "transactions_revenue_item_idx" ON "transactions" USING btree ("linked_revenue_item_id");--> statement-breakpoint
CREATE INDEX "transactions_expense_item_idx" ON "transactions" USING btree ("linked_expense_item_id");--> statement-breakpoint
CREATE INDEX "transactions_source_record_idx" ON "transactions" USING btree ("user_id","source_record_type","source_record_id");--> statement-breakpoint
CREATE INDEX "user_settings_paddle_customer_idx" ON "user_settings" USING btree ("paddle_customer_id");--> statement-breakpoint
CREATE INDEX "inventory_movements_user_idx" ON "inventory_movements" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "inventory_movements_inventory_idx" ON "inventory_movements" USING btree ("inventory_id");--> statement-breakpoint
CREATE INDEX "inventory_movements_product_idx" ON "inventory_movements" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "inventory_movements_date_idx" ON "inventory_movements" USING btree ("movement_date");--> statement-breakpoint
CREATE INDEX "inventory_user_idx" ON "inventory" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "inventory_product_idx" ON "inventory" USING btree ("product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_user_product_uniq" ON "inventory" USING btree ("user_id","product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "integrations_user_kind_idx" ON "integrations" USING btree ("user_id","kind");