CREATE TABLE "people" (
	"id" text PRIMARY KEY NOT NULL,
	"business_id" text NOT NULL,
	"kind" text DEFAULT 'customer' NOT NULL,
	"display_name" text NOT NULL,
	"email" text,
	"phone" text,
	"company" text,
	"first_transaction_at" timestamp with time zone,
	"needs_review" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recurring_postings" (
	"id" text PRIMARY KEY NOT NULL,
	"schedule_id" text NOT NULL,
	"scheduled_for" timestamp with time zone NOT NULL,
	"transaction_id" text,
	"skipped" boolean DEFAULT false NOT NULL,
	"posted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recurring_schedules" (
	"id" text PRIMARY KEY NOT NULL,
	"business_id" text NOT NULL,
	"direction" text NOT NULL,
	"revenue_item_id" text,
	"expense_item_id" text,
	"person_id" text,
	"source_id" text NOT NULL,
	"amount_cents" bigint,
	"qty" text DEFAULT '1' NOT NULL,
	"interval" text NOT NULL,
	"interval_count" integer DEFAULT 1 NOT NULL,
	"anchor_day" integer,
	"start_date" timestamp with time zone NOT NULL,
	"end_date" timestamp with time zone,
	"max_occurrences" integer,
	"occurrences_posted" integer DEFAULT 0 NOT NULL,
	"next_run_at" timestamp with time zone NOT NULL,
	"posting_mode" text DEFAULT 'auto_post' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recurring_schedules_direction_check" CHECK ((direction = 'in' AND revenue_item_id IS NOT NULL AND expense_item_id IS NULL)
          OR (direction = 'out' AND expense_item_id IS NOT NULL AND revenue_item_id IS NULL))
);
--> statement-breakpoint
CREATE TABLE "subscription_events" (
	"id" text PRIMARY KEY NOT NULL,
	"subscription_id" text NOT NULL,
	"event" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" text PRIMARY KEY NOT NULL,
	"business_id" text NOT NULL,
	"revenue_item_id" text NOT NULL,
	"person_id" text NOT NULL,
	"schedule_id" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"trial_ends_at" timestamp with time zone,
	"canceled_at" timestamp with time zone,
	"cancel_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "expense_items" ADD COLUMN "vendor_person_id" text;--> statement-breakpoint
ALTER TABLE "people" ADD CONSTRAINT "people_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_postings" ADD CONSTRAINT "recurring_postings_schedule_id_recurring_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."recurring_schedules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_postings" ADD CONSTRAINT "recurring_postings_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_schedules" ADD CONSTRAINT "recurring_schedules_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_schedules" ADD CONSTRAINT "recurring_schedules_revenue_item_id_revenue_items_id_fk" FOREIGN KEY ("revenue_item_id") REFERENCES "public"."revenue_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_schedules" ADD CONSTRAINT "recurring_schedules_expense_item_id_expense_items_id_fk" FOREIGN KEY ("expense_item_id") REFERENCES "public"."expense_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_schedules" ADD CONSTRAINT "recurring_schedules_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_schedules" ADD CONSTRAINT "recurring_schedules_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_events" ADD CONSTRAINT "subscription_events_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_revenue_item_id_revenue_items_id_fk" FOREIGN KEY ("revenue_item_id") REFERENCES "public"."revenue_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_schedule_id_recurring_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."recurring_schedules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "people_business_email_uq" ON "people" USING btree ("business_id",lower("email")) WHERE "people"."email" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "people_business_kind_idx" ON "people" USING btree ("business_id","kind");--> statement-breakpoint
CREATE INDEX "people_business_name_idx" ON "people" USING btree ("business_id","display_name");--> statement-breakpoint
CREATE UNIQUE INDEX "recurring_postings_schedule_date_uq" ON "recurring_postings" USING btree ("schedule_id","scheduled_for");--> statement-breakpoint
CREATE INDEX "recurring_schedules_business_idx" ON "recurring_schedules" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "recurring_schedules_due_idx" ON "recurring_schedules" USING btree ("status","next_run_at");--> statement-breakpoint
CREATE INDEX "subscription_events_sub_idx" ON "subscription_events" USING btree ("subscription_id","occurred_at");--> statement-breakpoint
CREATE INDEX "subscriptions_business_idx" ON "subscriptions" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "subscriptions_person_idx" ON "subscriptions" USING btree ("person_id");--> statement-breakpoint
-- DATA MIGRATION: pre-rewrite client_customers → people (SAME ids so Transaction.person_id
-- stays valid). Emails that would collide within a business are nulled, not dropped, so
-- every id survives for the FK below.
INSERT INTO "people" ("id","business_id","kind","display_name","email","phone","company","needs_review","status","notes","created_at","updated_at")
SELECT cc."id", b."id", 'customer', cc."name",
       CASE WHEN cc."email" IS NULL OR cc."email" = '' THEN NULL
            WHEN row_number() OVER (PARTITION BY b."id", lower(cc."email") ORDER BY cc."created_at") = 1 THEN cc."email"
            ELSE NULL END,
       NULLIF(cc."phone", ''), NULLIF(cc."company_name", ''), false, 'active', cc."notes", cc."created_at", cc."updated_at"
FROM "client_customers" cc JOIN "businesses" b ON b."user_id" = cc."user_id"
ON CONFLICT ("id") DO NOTHING;--> statement-breakpoint
-- DATA MIGRATION: distinct expense_items.vendor_name → vendor people, then link vendor_person_id.
INSERT INTO "people" ("id","business_id","kind","display_name","needs_review","status","created_at","updated_at")
SELECT DISTINCT 'vperson_' || substr(md5(ei."business_id" || '|' || lower(ei."vendor_name")), 1, 20),
       ei."business_id", 'vendor', ei."vendor_name", false, 'active', now(), now()
FROM "expense_items" ei
WHERE ei."vendor_name" IS NOT NULL AND ei."vendor_name" <> ''
ON CONFLICT ("id") DO NOTHING;--> statement-breakpoint
UPDATE "expense_items" ei
SET "vendor_person_id" = 'vperson_' || substr(md5(ei."business_id" || '|' || lower(ei."vendor_name")), 1, 20)
WHERE ei."vendor_name" IS NOT NULL AND ei."vendor_name" <> '';--> statement-breakpoint
ALTER TABLE "expense_items" ADD CONSTRAINT "expense_items_vendor_person_id_people_id_fk" FOREIGN KEY ("vendor_person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;