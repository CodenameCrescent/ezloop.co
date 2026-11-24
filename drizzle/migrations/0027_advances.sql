CREATE TABLE "payment_applications" (
	"id" text PRIMARY KEY NOT NULL,
	"business_id" text NOT NULL,
	"transaction_id" text NOT NULL,
	"applied_from_transaction_id" text,
	"amount_cents" bigint NOT NULL,
	"applied_on" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_applications_amount_check" CHECK (amount_cents > 0),
	CONSTRAINT "payment_applications_not_self_check" CHECK (applied_from_transaction_id IS NULL OR applied_from_transaction_id <> transaction_id)
);
--> statement-breakpoint
ALTER TABLE "transaction_lines" ADD COLUMN "is_advance" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "payment_applications" ADD CONSTRAINT "payment_applications_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_applications" ADD CONSTRAINT "payment_applications_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_applications" ADD CONSTRAINT "payment_applications_applied_from_transaction_id_transactions_id_fk" FOREIGN KEY ("applied_from_transaction_id") REFERENCES "public"."transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payment_applications_transaction_idx" ON "payment_applications" USING btree ("transaction_id");--> statement-breakpoint
CREATE INDEX "payment_applications_source_idx" ON "payment_applications" USING btree ("applied_from_transaction_id");--> statement-breakpoint
CREATE INDEX "payment_applications_business_idx" ON "payment_applications" USING btree ("business_id");