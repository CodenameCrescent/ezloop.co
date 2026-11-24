import { useMemo, useState } from "react";
import { AlertTriangle, Info } from "lucide-react";
import { TopBar } from "@/components/TopBar";
import { Skeleton } from "@/components/ui/skeleton";
import { useGlobalPeriod } from "@/lib/globalPeriod";
import { useFormatters } from "@/lib/store";
import { toApiRange, useClientProfitability } from "@/api/hooks";
import { figureState, figureStateSentence } from "@/lib/figureState";
import { Meter } from "@/components/charts/Meter";
import { ACCOUNTING_BASES, BASIS_LABELS, DATA_STATE_MESSAGE, coverageSentence, type AccountingBasis } from "@workspace/domain";
import type { EndpointResponse, getClientProfitability } from "@workspace/api-contract";
import { TargetTable, ScopeCreepSection, ConcentrationSection } from "./Profitability.parts/TargetTable";
import { WorkTypeSection } from "./Profitability.parts/WorkTypeSection";

/**
 * Which client, product or subscription is actually worth having.
 *
 * The rule this screen enforces above all others: a target with NO HOURS shows
 * a MARKER, never a number. Its revenue with no labour against it would read as
 * pure profit at 100% margin — the most flattering possible lie about the
 * client most likely to be losing money. Every figure below is nullable for
 * exactly that reason, and null renders as "—", not as zero.
 */
export default function Profitability() {
  const period = useGlobalPeriod();
  const f = useFormatters();
  const money = f.moneyCents;
  const range = useMemo(() => toApiRange(period.range), [period.range]);
  const [basis, setBasis] = useState<AccountingBasis>("accrual");
  const query = useClientProfitability(range, basis);

  const data = query.data;
  const state = figureState(query, data != null);
  const summary = data?.summary;
  const noHours = summary?.state === "no_hours";

  const clients = (data?.rows ?? []).filter((r) => r.targetType === "client");
  const products = (data?.rows ?? []).filter((r) => r.targetType === "revenue_item");
  const internal = (data?.rows ?? []).filter((r) => r.targetType === "internal");

  return (
    <>
      <TopBar title="What's worth having" subtitle="Which clients and products actually make you money." />
      <div className="app-page-shell space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex gap-1 rounded-lg bg-muted/40 p-1">
            {ACCOUNTING_BASES.map((b) => (
              <button
                key={b}
                onClick={() => setBasis(b)}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                  basis === b ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {BASIS_LABELS[b].label}
              </button>
            ))}
          </div>
        </div>

        {state === "loading" && (
          <div className="pl-glass space-y-3 p-5">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-6 w-full" />
            ))}
          </div>
        )}

        {/*
          This page was already the closest to right in the app — it was the
          only one that checked `isError` at all. Two things were still wrong.
          It had no branch for a PAUSED request, so going offline rendered
          nothing whatsoever below the tabs: no figures, no reason, no clue
          that anything had been asked for. And it printed the raw error
          message, which is the transport talking to the owner in its own
          words — the interface never speaks backend (CLAUDE.md).

          Amber rather than `text-destructive`: red is money lost (DESIGN.md
          §2), and on a page about which clients lose money that is the one
          colour a loading failure must not borrow.
        */}
        {(state === "offline" || state === "failed") && (
          <div className="pl-glass p-5 text-sm">
            <p className="text-[color:var(--pl-amber)]">
              {figureStateSentence(state, "these figures")}
            </p>
            {state === "failed" && (
              <button
                onClick={() => query.refetch()}
                className="mt-3 rounded-lg border border-card-border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-muted/40"
              >
                Try again
              </button>
            )}
          </div>
        )}

        {summary && (
          <>
            {/* State first: what the owner is allowed to conclude from this page. */}
            <div
              className={`rounded-xl border p-4 ${
                noHours
                  ? " bg-[color:var(--pl-amber-tint)]"
                  : summary.state === "partial"
                    ? " bg-[color:var(--pl-amber-tint)]"
                    : "border-card-border bg-muted/20"
              }`}
            >
              <div className="flex items-start gap-2">
                {summary.state === "complete" ? (
                  <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                ) : (
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[color:var(--pl-amber)]" />
                )}
                <div className="text-sm">
                  <p>{DATA_STATE_MESSAGE[summary.state]}</p>
                  {summary.hasEstimates && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Some hours here are estimates rather than logged day by day.
                    </p>
                  )}
                </div>
              </div>
            </div>

            {/* Summary — SUPPRESSED entirely when nothing is costed. */}
            {!noHours && (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Stat label="Revenue" value={money(summary.costedRevenueCents ?? 0)} sub={`${summary.costedCount} costed`} />
                <Stat label="Their time cost" value={money(summary.costedLabourCents ?? 0)} sub="From logged hours" />
                <Stat
                  label="Left after costs"
                  value={money(summary.costedContributionCents ?? 0)}
                  sub={summary.costedMarginPct == null ? "" : `${summary.costedMarginPct.toFixed(1)}% margin`}
                  tone={(summary.costedContributionCents ?? 0) >= 0 ? "good" : "bad"}
                />
                <Stat
                  label="Not counted"
                  value={money(summary.uncostedRevenueCents)}
                  sub={`${summary.uncostedWithRevenueCount} without hours`}
                  tone={summary.uncostedWithRevenueCount > 0 ? "warn" : "neutral"}
                />
              </div>
            )}

            {noHours && summary.uncostedRevenueCents > 0 && (
              <div className="pl-glass p-5">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Revenue in this period</p>
                <p className="mt-1 text-2xl font-bold tabular-nums">{money(summary.uncostedRevenueCents)}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  No profit figure can be shown against this until hours are logged.
                </p>
              </div>
            )}

            {/* Coverage — a data-quality signal, not an error. */}
            {data && (
              <div className="rounded-xl border border-card-border bg-muted/10 p-4 text-sm">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-medium">
                    Hours vs wages
                    {data.coverage.pct != null && (
                      <span
                        className={`ml-2 tabular-nums ${
                          data.coverage.direction === "matched" ? "text-[color:var(--pl-green)]" : "text-[color:var(--pl-amber)]"
                        }`}
                      >
                        {data.coverage.pct.toFixed(0)}%
                      </span>
                    )}
                  </span>
                  {data.coverage.reason === "ok" && (
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {money(data.coverage.attributedCents)} logged · {money(data.coverage.payrollCents)} paid
                    </span>
                  )}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{coverageSentence(data.coverage)}</p>
              </div>
            )}

            {data!.unattributedRevenueCents > 0 && (
              <p className="text-xs text-muted-foreground">
                {money(data!.unattributedRevenueCents)} of revenue in this period names no customer, so it sits
                outside the client figures. Add the customer on those transactions to bring it in.
              </p>
            )}

            <TargetTable title="Clients" rows={clients} money={money} noHours={noHours} />
            <TargetTable title="What you sell" rows={products} money={money} noHours={noHours} />
            <TargetTable title="Internal" rows={internal} money={money} noHours={noHours} internal />

            {!noHours && (
              <>
                <ConcentrationSection concentration={data!.concentration} money={money} />
                <UtilizationSection utilization={data!.utilization} />
                <ScopeCreepSection rows={data!.scopeCreep} money={money} />
                <WorkTypeSection workTypes={data!.workTypes} reworkByClient={data!.reworkByClient} />
              </>
            )}

            <p className="text-xs text-muted-foreground">
              These figures never change your Profit &amp; Loss. Wages are already counted there once —
              this page only shows which work absorbed them.
            </p>
          </>
        )}
      </div>
    </>
  );
}

function Stat({
  label,
  value,
  sub,
  tone = "neutral",
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "good" | "warn" | "bad" | "neutral";
}) {
  const toneClass =
    tone === "good" ? "text-[color:var(--pl-green)]" : tone === "warn" ? "text-[color:var(--pl-amber)]" : tone === "bad" ? "text-destructive" : "";
  return (
    <div className="pl-glass p-4">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`mt-1 text-xl font-bold tabular-nums ${toneClass}`}>{value}</p>
      {sub && <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

/** Billable share, for the business and per person. */
function UtilizationSection({
  utilization,
}: {
  utilization: EndpointResponse<typeof getClientProfitability>["utilization"];
}) {
  const { overall, byMember } = utilization;
  if (overall.pct == null) return null;

  return (
    <div className="pl-glass p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Time you can bill for
        </span>
        <span className="text-2xl font-bold tabular-nums">{overall.pct.toFixed(0)}%</span>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        {overall.billableHours} of {overall.totalHours} hours. The other {overall.nonBillableHours} are
        paid for and earn nothing — some of that is unavoidable, but it is real money.
      </p>
      {byMember.length > 1 && (
        /* Utilisation is a percentage against a ceiling, which is what Meter
           is. The bar this replaces was drawn in the brand orange — orange is
           the mark and never encodes data (DESIGN.md rule 2), and here it was
           encoding three different dimensions on one page. */
        <div className="mt-3 space-y-1.5">
          {byMember.map((m) => (
            <div key={m.personId} className="flex items-center gap-3 text-sm">
              <span className="w-32 shrink-0 truncate">{m.name}</span>
              <div className="flex-1">
                <Meter value={Math.min(100, m.pct ?? 0)} tone="cat-1" inline />
              </div>
              <span className="w-24 text-right text-xs tabular-nums text-muted-foreground">
                {m.pct == null ? "—" : `${m.pct.toFixed(0)}% of ${m.totalHours}h`}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
