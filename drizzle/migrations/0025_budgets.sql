CREATE TABLE "budget_lines" (
	"id" text PRIMARY KEY NOT NULL,
	"budget_id" text NOT NULL,
	"side" text NOT NULL,
	"expense_item_id" text,
	"revenue_item_id" text,
	"category_id" text,
	"label" text,
	"amount_cents" bigint NOT NULL,
	"basis" text DEFAULT 'total' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "budget_lines_one_match_check" CHECK ((
        (CASE WHEN expense_item_id IS NOT NULL THEN 1 ELSE 0 END) +
        (CASE WHEN revenue_item_id IS NOT NULL THEN 1 ELSE 0 END) +
        (CASE WHEN category_id IS NOT NULL THEN 1 ELSE 0 END) +
        (CASE WHEN label IS NOT NULL THEN 1 ELSE 0 END)
      ) = 1),
	CONSTRAINT "budget_lines_side_match_check" CHECK ((side = 'in' AND expense_item_id IS NULL) OR (side = 'out' AND revenue_item_id IS NULL)),
	CONSTRAINT "budget_lines_amount_check" CHECK (amount_cents >= 0)
);
--> statement-breakpoint
CREATE TABLE "budgets" (
	"id" text PRIMARY KEY NOT NULL,
	"business_id" text NOT NULL,
	"name" text NOT NULL,
	"scope" text DEFAULT 'period' NOT NULL,
	"project_id" text,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"target_profit_cents" bigint,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "budgets_period_order_check" CHECK (period_end >= period_start),
	CONSTRAINT "budgets_scope_project_check" CHECK ((scope = 'project' AND project_id IS NOT NULL) OR (scope = 'period' AND project_id IS NULL))
);
--> statement-breakpoint
ALTER TABLE "budget_lines" ADD CONSTRAINT "budget_lines_budget_id_budgets_id_fk" FOREIGN KEY ("budget_id") REFERENCES "public"."budgets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_lines" ADD CONSTRAINT "budget_lines_expense_item_id_expense_items_id_fk" FOREIGN KEY ("expense_item_id") REFERENCES "public"."expense_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_lines" ADD CONSTRAINT "budget_lines_revenue_item_id_revenue_items_id_fk" FOREIGN KEY ("revenue_item_id") REFERENCES "public"."revenue_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_lines" ADD CONSTRAINT "budget_lines_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "budget_lines_budget_idx" ON "budget_lines" USING btree ("budget_id");--> statement-breakpoint
CREATE INDEX "budgets_business_idx" ON "budgets" USING btree ("business_id","status");--> statement-breakpoint
CREATE INDEX "budgets_project_idx" ON "budgets" USING btree ("project_id");