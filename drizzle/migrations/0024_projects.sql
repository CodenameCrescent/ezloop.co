CREATE TABLE "projects" (
	"id" text PRIMARY KEY NOT NULL,
	"business_id" text NOT NULL,
	"name" text NOT NULL,
	"code" text,
	"person_id" text,
	"status" text DEFAULT 'active' NOT NULL,
	"contract_value_cents" bigint,
	"start_date" date,
	"end_date" date,
	"expected_end_date" date,
	"output_qty" text,
	"output_unit_label" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "projects_business_status_idx" ON "projects" USING btree ("business_id","status");--> statement-breakpoint
CREATE INDEX "projects_person_idx" ON "projects" USING btree ("person_id");--> statement-breakpoint
ALTER TABLE "transaction_lines" ADD CONSTRAINT "transaction_lines_revenue_target_check" CHECK (direction = 'out' OR target_type IS NULL OR target_type = 'project');