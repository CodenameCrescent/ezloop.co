ALTER TABLE "expense_items" ADD COLUMN "cost_nature" text DEFAULT 'variable' NOT NULL;--> statement-breakpoint

-- Split the two questions the old `type` column answered at once.
--
-- `type` offered "fixed" and "variable" next to "marketing" and "payroll", so
-- an expense could say what it was for OR how it behaved, never both. Nothing
-- could be classified fixed and mean it, which is why break-even read Rs 0.
--
-- Step 1 — move the behaviour into `cost_nature`. The two behavioural values
-- state their own nature; the purposes take the default that matches what they
-- usually are (see natureForStoredPurpose in lib/domain/src/costNature.ts,
-- which is the same mapping and is unit-tested). The column default already
-- covers everything variable, so only the fixed side needs writing.
UPDATE "expense_items"
   SET "cost_nature" = 'fixed'
 WHERE "type" IN ('fixed', 'operational', 'payroll');--> statement-breakpoint

-- Step 2 — leave `type` holding purposes only. The meaning is not dropped: it
-- moved to cost_nature above. "fixed" rows are overheads (rent, software,
-- salaries), so they land on operational; "variable" carried no purpose at all,
-- so it lands on the neutral "custom" bucket the UI shows as "Other".
--
-- Money is untouched. Profit reads frozen cost snapshots on transaction lines,
-- never this catalog label, so no historical figure moves. Only the label a
-- P&L expense breakdown groups under changes.
UPDATE "expense_items" SET "type" = 'operational' WHERE "type" = 'fixed';--> statement-breakpoint
UPDATE "expense_items" SET "type" = 'custom' WHERE "type" = 'variable';
