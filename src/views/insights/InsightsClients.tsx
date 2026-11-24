import { useMemo } from "react";
import Link from "next/link";
import { ArrowRight, TrendingUp, Users2, AlertTriangle, CalendarClock, Repeat2 } from "lucide-react";
import { useCohorts, usePeople, useRetention, useSubscriptions, useSubscriptionSummary } from "@/api/hooks";
import { RetentionHeatmap } from "@/components/RetentionHeatmap";
import { FigureSlot } from "@/components/FigureSlot";
import { figureState, figureStateSentence } from "@/lib/figureState";
import { formatCents, formatCentsSigned } from "@/lib/money";
import { CohortGrid, ClientsWorthHaving } from "./InsightsClients.parts/ClientsWorthHaving";

const INACTIVE_DAYS = 60;

function daysSince(iso: string | null): number | null {
  if (!iso) return null;
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
}

export default function InsightsClients() {
  const summary = useSubscriptionSummary({});
  const cohorts = useCohorts();
  const customers = usePeople("customer");
  const subscriptions = useSubscriptions();
  const retention = useRetention();

  const people = customers.data?.items ?? [];
  /*
   * Four claims on this page were made off empty fallbacks, and every one of
   * them is an all-clear:
   *
   *   "No customers with sales yet."          — from `people`
   *   "None — every subscription is current." — from `subscriptions`
   *   "Nobody's overdue for a nudge."         — from `people`
   *   "Record sales with customers to unlock cohorts." — from `cohorts`
   *
   * None was gated on anything but `!isLoading` or an empty array, so a failed
   * or paused request produced all four at once: a clean bill of health for a
   * business the page had not managed to look at. The subscription one is the
   * sharpest — a past-due subscription is money not arriving, and this page
   * was the thing telling the owner there weren't any.
   */
  const customersState = figureState(customers, customers.data != null);
  const subscriptionsState = figureState(subscriptions, subscriptions.data != null);
  const summaryState = figureState(summary, summary.data != null);
  const retentionState = figureState(retention, retention.data != null);

  const topByContribution = useMemo(
    () => [...people].sort((a, b) => b.metrics.lifetimeContributionCents - a.metrics.lifetimeContributionCents).slice(0, 10),
    [people],
  );

  const atRisk = useMemo(() => {
    const pastDue = (subscriptions.data ?? []).filter((s) => s.status === "past_due");
    const goingQuiet = people
      .filter((p) => p.metrics.orderCount > 0)
      .map((p) => ({ p, days: daysSince(p.metrics.lastActivityAt) }))
      .filter((x) => x.days != null && x.days > INACTIVE_DAYS)
      .sort((a, b) => (b.days ?? 0) - (a.days ?? 0))
      .slice(0, 6);
    return { pastDue, goingQuiet };
  }, [subscriptions.data, people]);

  const s = summary.data;

  return (
    <div className="mx-auto max-w-[1500px] space-y-5 px-4 py-5 sm:px-6 lg:px-8">
      {/* Subscriptions summary strip */}
      <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {/* The em dash these used to fall back to understates rather than
            lies, but it still answered three different questions the same way.
            `settled` keeps it; the other two get their own words. */}
        <StatCard
          label="Monthly recurring revenue"
          value={<FigureSlot state={summaryState}>{s ? formatCents(s.mrrCents) : "—"}</FigureSlot>}
          icon={<Repeat2 className="h-5 w-5" />}
        />
        <StatCard
          label="Active subscriptions"
          value={<FigureSlot state={summaryState}>{s ? String(s.activeCount) : "—"}</FigureSlot>}
          icon={<Users2 className="h-5 w-5" />}
        />
        <StatCard
          label="Net MRR movement"
          value={
            <FigureSlot state={summaryState}>
              {s ? formatCentsSigned(s.movement.netCents) : "—"}
            </FigureSlot>
          }
          tone={s && s.movement.netCents >= 0 ? "good" : "bad"}
          icon={<TrendingUp className="h-5 w-5" />}
        />
        <StatCard
          label="Monthly churn"
          value={
            <FigureSlot state={summaryState}>{s ? `${s.churnRatePct.toFixed(1)}%` : "—"}</FigureSlot>
          }
          tone={s && s.churnRatePct > 5 ? "bad" : "neutral"}
          icon={<AlertTriangle className="h-5 w-5" />}
        />
      </section>

      {s && (
        <section className="pl-glass p-5">
          <div className="space-y-1.5 text-sm leading-6 text-muted-foreground">
            <p>{s.sentences.mrr}</p>
            <p>{s.sentences.movement}</p>
            <p>{s.sentences.churn}</p>
          </div>
        </section>
      )}

      {/* Do customers come back? — repeat behaviour + retention heatmap */}
      <section className="pl-glass p-5">
        <div className="mb-4">
          <h2 className="text-base font-bold text-[color:var(--pl-ink)]">Do customers come back?</h2>
          <p className="mt-1 text-sm text-[color:var(--pl-ink-2)]">
            Each row is the month a group of customers first bought; each cell shows how many of them bought again.
          </p>
        </div>
        <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard
            label="Repeat purchase rate"
            value={
              <FigureSlot state={retentionState}>
                {retention.data ? `${retention.data.repeat.repeatRatePct.toFixed(1)}%` : "—"}
              </FigureSlot>
            }
            tone={retention.data && retention.data.repeat.repeatRatePct >= 30 ? "good" : "neutral"}
            icon={<Repeat2 className="h-5 w-5" />}
          />
          <StatCard
            label="Median days to 2nd purchase"
            value={
              <FigureSlot state={retentionState}>
                {retention.data?.repeat.medianDaysToSecondPurchase != null
                  ? String(retention.data.repeat.medianDaysToSecondPurchase)
                  : "—"}
              </FigureSlot>
            }
            icon={<CalendarClock className="h-5 w-5" />}
          />
          <StatCard
            label="Customers who bought"
            value={
              <FigureSlot state={retentionState}>
                {retention.data ? String(retention.data.repeat.customersWithPurchase) : "—"}
              </FigureSlot>
            }
            icon={<Users2 className="h-5 w-5" />}
          />
          <StatCard
            label="Bought more than once"
            value={
              <FigureSlot state={retentionState}>
                {retention.data ? String(retention.data.repeat.repeatCustomers) : "—"}
              </FigureSlot>
            }
            icon={<TrendingUp className="h-5 w-5" />}
          />
        </div>
        {retention.data && <RetentionHeatmap cohorts={retention.data.retention.cohorts} maxOffset={retention.data.retention.maxOffset} />}
      </section>

      {/* What the hours say — only for businesses that track them */}
      <ClientsWorthHaving />

      {/* Cohort grid */}
      <CohortGrid data={cohorts.data} state={figureState(cohorts, cohorts.data != null)} />

      <div className="grid gap-5 xl:grid-cols-[1.4fr_1fr]">
        {/* Top customers by contribution */}
        <section className="pl-glass">
          <div className="border-b border-card-border px-5 py-4">
            <h2 className="text-base font-bold text-foreground">Top customers by contribution profit</h2>
            <p className="mt-1 text-sm text-muted-foreground">Who actually drives profit — after their own costs, before fixed overhead.</p>
          </div>
          <div className="app-scrollbar overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm">
              <thead className="bg-muted/30 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-5 py-3 text-left font-semibold">Customer</th>
                  <th className="px-5 py-3 text-right font-semibold">Orders</th>
                  <th className="px-5 py-3 text-right font-semibold">Lifetime revenue</th>
                  <th className="px-5 py-3 text-right font-semibold">Contribution</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-card-border/70">
                {topByContribution.length === 0 ? (
                  <tr>
                    <td
                      colSpan={4}
                      className={`px-5 py-10 text-center ${customersState === "settled" ? "text-muted-foreground" : "text-[color:var(--pl-amber)]"}`}
                    >
                      {customersState === "settled"
                        ? "No customers with sales yet."
                        : customersState === "loading"
                          ? "Loading…"
                          : figureStateSentence(customersState, "your customers")}
                    </td>
                  </tr>
                ) : (
                  topByContribution.map((p) => (
                    <tr key={p.id}>
                      <td className="px-5 py-3 font-medium text-foreground">{p.displayName}</td>
                      <td className="px-5 py-3 text-right tabular-nums">{p.metrics.orderCount}</td>
                      <td className="px-5 py-3 text-right tabular-nums text-muted-foreground">{formatCents(p.metrics.lifetimeNetRevenueCents)}</td>
                      <td className="px-5 py-3 text-right font-semibold tabular-nums">{formatCents(p.metrics.lifetimeContributionCents)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        {/* At-risk */}
        <section className="pl-glass p-5">
          <h2 className="text-base font-bold text-foreground">Needs attention</h2>
          <p className="mt-1 text-sm text-muted-foreground">Past-due subscriptions and customers who've gone quiet.</p>

          <div className="mt-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Past due</h3>
            {atRisk.pastDue.length === 0 ? (
              subscriptionsState === "settled" ? (
                <p className="mt-1 text-sm text-muted-foreground">None — every subscription is current.</p>
              ) : (
                <p className="mt-1 text-sm text-[color:var(--pl-amber)]">
                  {subscriptionsState === "loading"
                    ? "Checking…"
                    : figureStateSentence(subscriptionsState, "your subscriptions")}
                </p>
              )
            ) : (
              <ul className="mt-2 space-y-1.5">
                {atRisk.pastDue.map((sub) => (
                  <li key={sub.id} className="flex items-center justify-between gap-2 text-sm">
                    <span className="text-foreground">{sub.personName}</span>
                    <span className="text-xs text-muted-foreground">{sub.itemName}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="mt-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Going quiet ({INACTIVE_DAYS}+ days)</h3>
            {atRisk.goingQuiet.length === 0 ? (
              customersState === "settled" ? (
                <p className="mt-1 text-sm text-muted-foreground">Nobody's overdue for a nudge.</p>
              ) : (
                <p className="mt-1 text-sm text-[color:var(--pl-amber)]">
                  {customersState === "loading"
                    ? "Checking…"
                    : figureStateSentence(customersState, "your customers")}
                </p>
              )
            ) : (
              <ul className="mt-2 space-y-1.5">
                {atRisk.goingQuiet.map(({ p, days }) => (
                  <li key={p.id} className="flex items-center justify-between gap-2 text-sm">
                    <span className="text-foreground">{p.displayName}</span>
                    <span className="text-xs text-muted-foreground">{days}d quiet</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <Link href="/setup/people" className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-[color:var(--pl-orange-text)] hover:underline">
            Open People <ArrowRight className="h-4 w-4" />
          </Link>
        </section>
      </div>
    </div>
  );
}

/* `value` is a node rather than a string so a tile can hold `FigureSlot` —
   the words that stand in for a figure are not a figure. */
function StatCard({ label, value, icon, tone }: { label: string; value: React.ReactNode; icon: React.ReactNode; tone?: "good" | "bad" | "neutral" }) {
  const valueColor = tone === "good" ? "text-[color:var(--pl-green)]" : tone === "bad" ? "text-[color:var(--pl-red)]" : "text-foreground";
  return (
    <div className="pl-glass p-5">
      <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-xl bg-[color:var(--pl-orange-tint)] text-primary">{icon}</div>
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`mt-1 text-2xl font-bold tabular-nums ${valueColor}`}>{value}</div>
    </div>
  );
}
