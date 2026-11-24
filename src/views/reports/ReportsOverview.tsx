import { FileText, FileSpreadsheet, TrendingUp, Receipt, DollarSign, Percent } from "lucide-react";
import { exportExcel, exportPDF } from "@/lib/exportReport";
import { LADDER_LABELS } from "@workspace/domain";
import { TopBar } from "@/components/TopBar";
import { Button } from "@/components/ui/button";
import { type RangePreset, RANGE_OPTIONS, StatPill, ExportCard, useReportsOverviewLogic } from "./ReportsOverview.parts/UseReportsOverviewLogic";

function RangeTab({
  value,
  active,
  onClick,
}: {
  value: RangePreset;
  active: boolean;
  onClick: () => void;
}) {
  const opt = RANGE_OPTIONS.find((o) => o.value === value)!;
  return (
    <button
      onClick={onClick}
      className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
        active
          ? "bg-primary text-primary-foreground"
          : "text-muted-foreground hover:text-foreground"
      }`}
    >
      {opt.label}
    </button>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ReportsOverview() {
  const {
    exportBlockedReason,
    headerReasonId,
    reportPayload,
    rangePreset,
    setRangePreset,
    rangeLabel,
    revenueCents,
    f,
    pnlState,
    totalCostsCents,
    profitCents,
    marginPct,
    cardsReasonId,
  } = useReportsOverviewLogic();

  return (
    <>
      <TopBar
        title="Reports"
        subtitle="Export profit summaries for your accountant or business partner"
        primaryAction={
          <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1">
            {/* Shown beside the buttons only where there is measurably room.
                The header's actions box does not shrink (`PageHeader.tsx:57`),
                so this one sentence pushed the period filter off the right
                edge — and on the error path that state never clears by itself,
                so the header stayed broken until the page was reloaded.

                `2xl`, not `lg`, and the difference is not a guess: `lg` is
                exactly where the sidebar appears and takes 268px, so the
                header is NARROWER at 1024px than at 900px.

                It was `xl` until the wording moved to `figureState`, and that
                is the trap worth naming: the breakpoint had been measured
                against "This period's figures could not be loaded" and fitted
                at 1280 with 24px to spare. The new sentence — "Couldn't load
                this period's figures — the server didn't answer." — is 351px
                wide, half as wide again, and 24px of headroom does not absorb
                that. Because this box is `shrink-0`, the overflow is paid by
                the title beside it rather than by the sentence: measured with
                the current string, the title block gets 0px at 1280 (the page
                heading disappears outright), 69px at 1366, 143px at 1440 and
                239px at 1536, which is the first width where the heading and
                its subtitle read normally. A breakpoint is measured against a
                specific string, so it belongs next to that string — change one
                and this number is void.

                Nothing is lost below `2xl`: the same sentence renders above the
                two export cards a screen down, where it explains both
                greyed-out buttons with room to breathe. `aria-describedby`
                still reads it out at every width, because an accessible
                description is taken from a referenced element even when that
                element is `display:none`. */}
            {exportBlockedReason && (
              <span
                id={headerReasonId}
                className="hidden text-xs text-muted-foreground 2xl:inline"
              >
                {exportBlockedReason}
              </span>
            )}
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                className="gap-2"
                disabled={!reportPayload}
                aria-describedby={exportBlockedReason ? headerReasonId : undefined}
                onClick={() => reportPayload && exportExcel(reportPayload)}
              >
                <FileSpreadsheet className="h-4 w-4 text-[color:var(--pl-green)]" />
                Excel
              </Button>
              <Button
                className="gap-2"
                disabled={!reportPayload}
                aria-describedby={exportBlockedReason ? headerReasonId : undefined}
                onClick={() => reportPayload && exportPDF(reportPayload)}
              >
                <FileText className="h-4 w-4" />
                PDF
              </Button>
            </div>
          </div>
        }
      />

      <div className="space-y-6 px-4 py-4 sm:px-8 sm:py-6">
        {/* Range selector */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground mr-1">Period:</span>
          <div className="flex items-center gap-1 rounded-lg border border-border bg-background p-1">
            {RANGE_OPTIONS.map((opt) => (
              <RangeTab
                key={opt.value}
                value={opt.value}
                active={rangePreset === opt.value}
                onClick={() => setRangePreset(opt.value)}
              />
            ))}
          </div>
        </div>

        {/* Snapshot */}
        <div className="rounded-xl border border-card-border bg-card p-5">
          <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium mb-4">
            Snapshot — {rangeLabel}
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-6">
            <div className="flex items-center gap-3">
              <span className="p-2 rounded-lg bg-[color:var(--pl-orange-tint)] text-primary">
                <DollarSign className="h-4 w-4" />
              </span>
              <StatPill
                label={LADDER_LABELS.netRevenue.label}
                value={revenueCents === null ? null : f.moneyCents(revenueCents)}
                state={pnlState}
              />
            </div>
            <div className="flex items-center gap-3">
              <span className="p-2 rounded-lg bg-orange-500/10 text-orange-400">
                <Receipt className="h-4 w-4" />
              </span>
              <StatPill
                label="Total costs"
                value={totalCostsCents === null ? null : f.moneyCents(totalCostsCents)}
                state={pnlState}
              />
            </div>
            <div className="flex items-center gap-3">
              {/* No figure yet means no verdict yet: the tile stays neutral
                  rather than claiming a profit sign it cannot know. */}
              <span
                className={`p-2 rounded-lg ${
                  profitCents === null
                    ? "bg-muted/40 text-muted-foreground"
                    : profitCents >= 0
                      ? "bg-[color:var(--pl-green-tint)] text-[color:var(--pl-green)]"
                      : "bg-[color:var(--pl-red-tint)] text-[color:var(--pl-red)]"
                }`}
              >
                <TrendingUp className="h-4 w-4" />
              </span>
              <StatPill
                label={LADDER_LABELS.trueProfit.label}
                value={profitCents === null ? null : f.moneyCents(profitCents)}
                state={pnlState}
              />
            </div>
            <div className="flex items-center gap-3">
              <span
                className={`p-2 rounded-lg ${
                  marginPct !== null && marginPct >= 20
                    ? "bg-[color:var(--pl-green-tint)] text-[color:var(--pl-green)]"
                    : "bg-muted/40 text-muted-foreground"
                }`}
              >
                <Percent className="h-4 w-4" />
              </span>
              <StatPill
                label="Profit margin"
                value={marginPct === null ? null : `${marginPct.toFixed(1)}%`}
                state={pnlState}
              />
            </div>
          </div>
        </div>

        {/* Export Cards */}
        <div>
          <h2 className="text-sm font-semibold mb-1">Export Report</h2>
          <div className="mb-3 space-y-1">
            <p className="text-xs text-muted-foreground">
              Both exports reflect the selected period: <strong>{rangeLabel}</strong>
            </p>
            {/* Sits directly above both cards, so it explains both greyed-out
                buttons without printing the same sentence twice. */}
            {exportBlockedReason && (
              <p id={cardsReasonId} className="text-xs text-muted-foreground">
                {exportBlockedReason}
              </p>
            )}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <ExportCard
              icon={<FileText className="h-5 w-5" />}
              title="PDF Report"
              description="A formatted PDF with your money summary, offer breakdown, and cost ledger. Great for sharing with accountants or partners."
              badge="Recommended"
              badgeColor="bg-[color:var(--pl-orange-tint)] text-primary"
              onClick={() => reportPayload && exportPDF(reportPayload)}
              buttonLabel="Download PDF"
              disabledReason={exportBlockedReason}
              reasonId={cardsReasonId}
            />
            <ExportCard
              icon={<FileSpreadsheet className="h-5 w-5" />}
              title="Excel Spreadsheet"
              description="A multi-sheet workbook with raw numbers - summary, per-offer breakdown, and full cost list. Perfect for further analysis."
              badge="Editable"
              badgeColor="bg-[color:var(--pl-green-tint)] text-[color:var(--pl-green)]"
              onClick={() => reportPayload && exportExcel(reportPayload)}
              buttonLabel="Download Excel"
              buttonVariant="outline"
              disabledReason={exportBlockedReason}
              reasonId={cardsReasonId}
            />
          </div>
        </div>

        {/* What's included */}
        <div className="rounded-xl border border-card-border bg-card p-5">
          <h3 className="text-sm font-semibold mb-4">What's included in the report</h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {/* This panel describes the FILE, so it lists the ladder the file
                now contains, in the ladder's own words. The counts come from the
                payload rather than from the store, because the store holds one
                capped page and the panel would otherwise promise a smaller
                report than the one that downloads. With no payload yet there is
                no count to promise, so it says so instead of guessing. */}
            {[
              {
                title: "Money Summary",
                items: [
                  "Gross revenue, less discounts and refunds",
                  "Net revenue and direct costs",
                  "Contribution profit and period expenses",
                  "True profit and profit margin",
                  "Period expenses broken down by type",
                ],
              },
              {
                title: "Offer Breakdown",
                items: [
                  reportPayload
                    ? `${reportPayload.offers.length} offers tracked`
                    : "Every offer in this period",
                  "Units or sales per offer",
                  "Net revenue and refunds per offer",
                  "Contribution profit per offer",
                  "Contribution margin per offer",
                ],
              },
              {
                title: "Cost Ledger",
                items: [
                  reportPayload
                    ? `${reportPayload.costs.length} costs tracked`
                    : "Every cost in this period",
                  "Type and behaviour for each cost",
                  "Amount spent, and how much sat inside sales",
                  "Each cost's share of period expenses",
                ],
              },
            ].map((section) => (
              <div key={section.title} className="space-y-2">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  {section.title}
                </p>
                <ul className="space-y-1.5">
                  {section.items.map((item) => (
                    <li
                      key={item}
                      className="flex items-start gap-2 text-xs text-muted-foreground"
                    >
                      <span className="mt-0.5 h-1.5 w-1.5 rounded-full bg-primary flex-shrink-0" />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
