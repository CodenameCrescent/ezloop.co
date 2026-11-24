import { useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Surface } from "@/components/Surface";
import { SectionHeading } from "@/components/SectionHeading";
import { DataTable, type Column } from "@/components/DataTable";
import { QuadrantMap } from "@/components/QuadrantMap";
import { InsightFeed } from "@/components/InsightFeed";
import { useInsightsPeriod } from "@/lib/insightsContext";
import { useFormatters } from "@/lib/store";
import { useInsights, useOffers } from "@/api/hooks";
import { figureState, figureStateSentence } from "@/lib/figureState";
import { cn } from "@/lib/utils";
import { type OffersData, Podium } from "./Offers.parts/Podium";
type Offer = OffersData["offers"][number];

/**
 * Offers — "What should I sell more of?"
 *
 * Visual first: nobody reads a forty-row table. The podium makes the best
 * earner physically the biggest thing on the screen, and the quadrant map says
 * what to push, fix or kill in one look. The table underneath is the detail,
 * not the argument.
 *
 * "Offers" covers SKUs and service packages alike — the same object: revenue,
 * cost to deliver, margin, volume. The copy never says "products".
 *
 * Deliberately absent: who bought it (that is People), which channel sold it
 * (Marketing), and inventory of any kind.
 */
export default function Offers() {
  const ctx = useInsightsPeriod();
  const f = useFormatters();
  const router = useRouter();
  const navigate = (to: string) => router.push(to);
  const range = ctx?.range;

  const apiRange = useMemo(
    () => (range ? { startDate: range.start.toISOString(), endDate: range.end.toISOString() } : null),
    [range],
  );
  const compareRange = useMemo(
    () =>
      range
        ? {
            startDate: range.start.toISOString(),
            endDate: range.end.toISOString(),
            priorStartDate: range.priorStart.toISOString(),
            priorEndDate: range.priorEnd.toISOString(),
          }
        : null,
    [range],
  );

  const offers = useOffers(apiRange);
  const feed = useInsights(compareRange, range ? `${range.label} vs the period before` : undefined);

  if (!range) return null;
  const money = f.moneyCents;
  const data = offers.data;
  /* See Money.tsx — the same "Working out…" that never ends, on a request that
     failed or stopped and reports `isLoading: false` either way. */
  const offersState = figureState(offers, data != null);

  const columns: Column<Offer>[] = [
    {
      key: "name",
      header: "What you sell",
      render: (row) => <span className="font-medium text-[color:var(--pl-ink)]">{row.name}</span>,
    },
    {
      key: "units",
      header: "Sold",
      align: "right",
      render: (row) => <span className="t-num">{row.unitsSold}</span>,
    },
    {
      key: "revenue",
      header: "Brought in",
      align: "right",
      hideOnMobile: true,
      // The bar behind the figure gives the column its shape at a glance;
      // the digits are still there for the rows the reader cares about.
      bar: (row) => row.netRevenueCents,
      render: (row) => <span className="t-num">{money(row.netRevenueCents)}</span>,
    },
    {
      key: "kept",
      header: "You kept",
      align: "right",
      bar: (row) => row.contributionProfitCents,
      render: (row) => (
        <span
          className="t-num font-medium"
          style={{
            color: row.contributionProfitCents < 0 ? "var(--pl-red)" : "var(--pl-green)",
          }}
        >
          {money(row.contributionProfitCents)}
        </span>
      ),
    },
    {
      key: "margin",
      header: "Of each sale",
      align: "right",
      hideOnMobile: true,
      render: (row) => (
        <span className="t-num text-[color:var(--pl-ink-2)]">
          {row.marginPct === null ? "—" : `${row.marginPct.toFixed(0)}%`}
        </span>
      ),
    },
  ];

  return (
    <div className="mx-auto max-w-[1000px] space-y-6 px-4 py-5 sm:px-6">
      {/* `!data` first, so the two reasons for having none are told apart
          before either gets a sentence. */}
      {!data ? (
        <Surface padding="lg">
          {offersState === "loading" ? (
            <p className="t-secondary">Working out what earns you most…</p>
          ) : (
            <p className="t-body text-[color:var(--pl-amber)]">
              {figureStateSentence(offersState, "what earns you most")}
            </p>
          )}
        </Surface>
      ) : data.offers.length === 0 ? (
        <Surface padding="lg" className="text-center">
          <p className="t-verdict text-[color:var(--pl-ink)]">
            Add the things you sell to see which ones actually make money.
          </p>
          <Link
            href="/setup/revenue"
            className="mt-4 inline-flex items-center rounded-full bg-[color:var(--pl-orange-fill)] px-4 py-2 text-xs font-semibold text-[color:var(--pl-on-orange)] transition-colors hover:bg-[color:var(--pl-orange-hover)]"
          >
            Add what you sell
          </Link>
        </Surface>
      ) : (
        <>
          <Surface padding="lg">
            <p className="t-verdict text-[color:var(--pl-ink)]">{data.verdict}</p>

            {/* The flip stated outright — every other tool ranks by revenue, so
                this is the fact their reports structurally cannot show. */}
            {data.flip && (
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <FlipCard
                  label="Brings in the most money"
                  name={data.flip.revenueLeader.name}
                  value={money(data.flip.revenueLeader.netRevenueCents)}
                  sub={`You kept ${money(data.flip.revenueLeader.contributionProfitCents)}`}
                />
                <FlipCard
                  label="Earns you the most"
                  name={data.flip.profitLeader.name}
                  value={money(data.flip.profitLeader.contributionProfitCents)}
                  sub={`From ${money(data.flip.profitLeader.netRevenueCents)} of sales`}
                  highlight
                />
              </div>
            )}
          </Surface>

          {data.podium.show && (
            <section>
              <SectionHeading hint="Sized by how much each one earns you">
                Your best earners
              </SectionHeading>
              <Podium entries={data.podium.entries} money={money} onSelect={() => navigate("/setup/revenue")} />
            </section>
          )}

          <section>
            <SectionHeading hint="Where each thing sits — push, fix, or drop">
              What to push and what to fix
            </SectionHeading>
            <Surface padding="lg">
              {data.quadrant.missingCosts ? (
                /* The highest-value onboarding prompt in the app: without costs
                   every margin is 100% and the map would be all winners. */
                <div className="py-6 text-center">
                  <p className="t-body text-[color:var(--pl-ink)]">
                    Add costs to the things you sell to see which ones actually make money.
                  </p>
                  <p className="t-secondary mt-1">
                    Right now nothing has a cost recorded, so everything looks equally profitable.
                  </p>
                  <Link
                    href="/setup/revenue"
                    className="mt-4 inline-flex items-center rounded-full bg-[color:var(--pl-orange-fill)] px-4 py-2 text-xs font-semibold text-[color:var(--pl-on-orange)] transition-colors hover:bg-[color:var(--pl-orange-hover)]"
                  >
                    Add costs
                  </Link>
                </div>
              ) : !data.quadrant.show ? (
                <p className="t-secondary py-4 text-center">
                  Once three of the things you sell have sales behind them, this map shows which to
                  push and which to drop.
                </p>
              ) : (
                <>
                  <QuadrantMap
                    data={data.quadrant}
                    symbol={f.symbol}
                    onSelect={() => navigate("/setup/revenue")}
                  />

                  {/* Partial costing is the common case and the more damaging:
                      an uncosted offer reads as a flawless 100% margin, which
                      would park it in Winners on no evidence. Named and kept
                      off, rather than flattered. */}
                  {data.quadrant.uncostedCount > 0 && (
                    <div className="mt-4 rounded-lg bg-[color:var(--pl-amber-tint)] p-3">
                      <p className="t-body text-[color:var(--pl-ink)]">
                        {data.quadrant.uncostedCount === 1
                          ? `${data.quadrant.uncostedNames[0]} isn't on this map — nothing has been costed against it.`
                          : `${data.quadrant.uncostedCount} things you sell aren't on this map — nothing has been costed against them.`}
                      </p>
                      <p className="t-secondary mt-1">
                        {data.quadrant.uncostedNames.slice(0, 4).join(", ")}
                        {data.quadrant.uncostedNames.length > 4 &&
                          ` and ${data.quadrant.uncostedNames.length - 4} more`}
                      </p>
                      <Link
                        href="/setup/revenue"
                        className="t-body mt-1 inline-block font-semibold text-[color:var(--pl-orange-text)] hover:underline"
                      >
                        Add their costs →
                      </Link>
                    </div>
                  )}
                </>
              )}
            </Surface>
          </section>

          <InsightFeed
            insights={feed.data?.insights ?? []}
            leaks={feed.data?.leaks ?? []}
            totalLeakCents={feed.data?.totalLeakCents ?? 0}
            symbol={f.symbol}
            state={figureState(feed, feed.data != null)}
          />

          <section>
            <SectionHeading hint="Ranked by what you keep, not by what it sells for">
              Everything you sell
            </SectionHeading>
            <DataTable
              columns={columns}
              rows={data.offers}
              getRowKey={(row) => row.id}
              onRowClick={() => navigate("/setup/revenue")}
              caption="Everything you sell, ranked by profit"
            />
          </section>
        </>
      )}
    </div>
  );
}

function FlipCard({
  label,
  name,
  value,
  sub,
  highlight,
}: {
  label: string;
  name: string;
  value: string;
  sub: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-lg p-4",
        highlight ? "bg-[color:var(--pl-green-tint)]" : "bg-[color:var(--pl-recessed)]",
      )}
    >
      <p className="t-micro">{label}</p>
      <p className="t-body mt-1 font-semibold text-[color:var(--pl-ink)]">{name}</p>
      <p
        className="t-num mt-1 text-xl font-semibold"
        style={{ color: highlight ? "var(--pl-green)" : "var(--pl-ink)" }}
      >
        {value}
      </p>
      <p className="t-secondary mt-0.5">{sub}</p>
    </div>
  );
}
