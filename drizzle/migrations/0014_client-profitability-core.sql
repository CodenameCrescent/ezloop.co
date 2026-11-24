CREATE TABLE "client_engagements" (
	"id" text PRIMARY KEY NOT NULL,
	"business_id" text NOT NULL,
	"person_id" text NOT NULL,
	"engagement_status" text DEFAULT 'active' NOT NULL,
	"engagement_type" text DEFAULT 'project' NOT NULL,
	"agreed_amount_cents" bigint,
	"agreed_hours" text,
	"billing_frequency" text DEFAULT 'monthly' NOT NULL,
	"currency" text DEFAULT 'PKR' NOT NULL,
	"start_date" date,
	"end_date" date,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "team_member_rates" (
	"id" text PRIMARY KEY NOT NULL,
	"business_id" text NOT NULL,
	"person_id" text NOT NULL,
	"cost_type" text NOT NULL,
	"monthly_cost_cents" bigint DEFAULT 0 NOT NULL,
	"hourly_rate_cents" bigint,
	"overhead_share_cents" bigint DEFAULT 0 NOT NULL,
	"billable_target_hours" text DEFAULT '130' NOT NULL,
	"effective_hourly_cost_cents" bigint DEFAULT 0 NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"effective_to" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "time_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"business_id" text NOT NULL,
	"person_id" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"entry_date" date NOT NULL,
	"hours" text NOT NULL,
	"billable" boolean DEFAULT true NOT NULL,
	"work_type" text DEFAULT 'delivery' NOT NULL,
	"cost_rate_snapshot_cents" bigint NOT NULL,
	"cost_amount_cents" bigint NOT NULL,
	"is_estimated" boolean DEFAULT false NOT NULL,
	"note" text,
	"source" text DEFAULT 'manual' NOT NULL,
	"external_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "time_entries_hours_check" CHECK (hours::numeric > 0 AND hours::numeric <= 24)
);
--> statement-breakpoint
ALTER TABLE "people" ADD COLUMN "role_label" text;--> statement-breakpoint
ALTER TABLE "people" ADD COLUMN "user_id" text;--> statement-breakpoint
ALTER TABLE "transaction_lines" ADD COLUMN "target_type" text;--> statement-breakpoint
ALTER TABLE "transaction_lines" ADD COLUMN "target_id" text;--> statement-breakpoint
ALTER TABLE "client_engagements" ADD CONSTRAINT "client_engagements_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_engagements" ADD CONSTRAINT "client_engagements_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_member_rates" ADD CONSTRAINT "team_member_rates_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_member_rates" ADD CONSTRAINT "team_member_rates_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "client_engagements_business_idx" ON "client_engagements" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "client_engagements_person_idx" ON "client_engagements" USING btree ("person_id");--> statement-breakpoint
CREATE UNIQUE INDEX "client_engagements_active_uq" ON "client_engagements" USING btree ("business_id","person_id") WHERE "client_engagements"."engagement_status" = 'active';--> statement-breakpoint
CREATE INDEX "team_member_rates_business_idx" ON "team_member_rates" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "team_member_rates_person_idx" ON "team_member_rates" USING btree ("person_id","effective_from");--> statement-breakpoint
CREATE UNIQUE INDEX "team_member_rates_open_uq" ON "team_member_rates" USING btree ("person_id") WHERE "team_member_rates"."effective_to" IS NULL;--> statement-breakpoint
CREATE INDEX "time_entries_business_date_idx" ON "time_entries" USING btree ("business_id","entry_date");--> statement-breakpoint
CREATE INDEX "time_entries_person_date_idx" ON "time_entries" USING btree ("person_id","entry_date");--> statement-breakpoint
CREATE INDEX "time_entries_target_idx" ON "time_entries" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE UNIQUE INDEX "time_entries_source_external_uq" ON "time_entries" USING btree ("business_id","source","external_id") WHERE "time_entries"."external_id" IS NOT NULL;