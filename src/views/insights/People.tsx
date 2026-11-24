import { useMemo } from "react";
import Link from "next/link";
import { Surface } from "@/components/Surface";
import { SectionHeading } from "@/components/SectionHeading";
import { StatStrip, StatTile } from "@/components/StatTile";
import { DataTable, type Column } from "@/components/DataTable";
import { ChartFrame } from "@/components/charts/ChartFrame";
import { ShareBar } from "@/components/charts/ShareBar";
import { Dumbbell } from "@/components/charts/Dumbbell";
import { slotFor } from "@/lib/chartTone";
import { InsightFeed } from "@/components/InsightFeed";
import { useInsightsPeriod } from "@/lib/insightsContext";
import { useFormatters } from "@/lib/store";
import { useInsights, usePeopleReport } from "@/api/hooks";
import { formatCents } from "@/lib/money";
import { figureState, figureStateSentence } from "@/lib/figureState";
import { MIN_CUSTOMERS_FOR_REPEAT } from "@workspace/domain";
import { cn } from "@/lib/utils";
import type { EndpointResponse, getPeople } from "@workspace/api-contract";

type PeopleData = EndpointResponse<typeof getPeople>;
type QuietRow = PeopleData["goneQuiet"][number];
type CustomerRow = PeopleData["customers"][number];

/**
 * People — "Who pays me, and are they staying?"
 *
 * The concentration bar is the hero, and the sentence under it is the highest-
 * value warning this product can produce for a service business.
 *
 * Deliberately absent: team costs and utilisation (those live in the
 * client-profitability module, not here), CRM or pipeline features of any kind,
 * and individual person records — this links out to them instead.
 */
export default function People() {
  const ctx = useInsightsPeriod();
  const f = useFormatters();
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

  const people = usePeopleReport(apiRange);
  const feed = useInsights(compareRange, range ? `${range.label} vs the period before` : undefined);

  if (!range) return null;
  const money = f.moneyCents;
  const data = people.data;
  /* See Money.tsx — "Working out…" that never ends, on a request that failed
     or stopped and reports `isLoading: false` either way. */
  const peopleState = figureState(people, data != null);

  const quietColumns: Column<QuietRow>[] = [
    {
      key: "name",
      header: "Who",
      render: (row) => <span className="font-medium text-[color:var(--pl-ink)]">{row.name}</span>,
    },
    {
      key: "last",
      header: "Last bought",
      render: (row) => (
        <span className="t-secondary">{new Date(row.lastPurchaseAt).toLocaleDateString()}</span>
      ),
    },
    {
      key: "gap",
      header: "Usually buys every",
      align: "right",
      hideOnMobile: true,
      render: (row) => <span className="t-num t-secondary">{row.usualGapDays} days</span>,
    },
    {
      key: "silent",
      header: "Quiet for",
      align: "right",
      render: (row) => (
        <span className="t-num font-medium text-[color:var(--pl-red)]">{row.daysSince} days</span>
      ),
    },
    {
      key: "worth",
      header: "Was worth",
      align: "right",
      bar: (row) => row.worthPerYearCents,
      render: (row) => <span className="t-num">{money(row.worthPerYearCents)}/yr</span>,
    },
  ];

  const customerColumns: Column<CustomerRow>[] = [
    {
      key: "name",
      header: "Customer",
      render: (row) => <span className="font-medium text-[color:var(--pl-ink)]">{row.name}</span>,
    },
    {
      key: "revenue",
      header: "Paid you",
      align: "right",
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
          style={{ color: row.contributionProfitCents < 0 ? "var(--pl-red)" : "var(--pl-green)" }}
        >
          {money(row.contributionProfitCents)}
        </span>
      ),
    },
    {
      key: "orders",
      header: "Purchases",
      align: "right",
      hideOnMobile: true,
      render: (row) => <span className="t-num t-secondary">{row.lifetimeOrderCount}</span>,
    },
  ];

  return (
    <div className="mx-auto max-w-[1000px] space-y-6 px-4 py-5 sm:px-6">
      {/* `!data` first, so the two reasons for having none are told apart
          before either gets a sentence. */}
      {!data ? (
        <Surface padding="lg">
          {peopleState === "loading" ? (
            <p className="t-secondary">Working out who pays you…</p>
          ) : (
            <p className="t-body text-[color:var(--pl-amber)]">
              {figureStateSentence(peopleState, "who pays you")}
            </p>
          )}
        </Surface>
      ) : data.concentration.segments.length === 0 ? (
        <Surface padding="lg" className="text-center">
          <p className="t-verdict text-[color:var(--pl-ink)]">
            Record a sale against a customer to see who your business rests on.
          </p>
          <Link
            href="/record/transactions"
            className="mt-4 inline-flex items-center rounded-full bg-[color:var(--pl-orange-fill)] px-4 py-2 text-xs font-semibold text-[color:var(--pl-on-orange)] transition-colors hover:bg-[color:var(--pl-orange-hover)]"
          >
            Record a sale
          </Link>
        </Surface>
      ) : (
        <>
          <Surface padding="lg">
            {/* Who the business rests on. Identity colours, and the at-risk
                segment keeps the money-loss tone because THAT one means
                something: losing it would tip the business into a loss. */}
            <ChartFrame
              height={60}
              state="settled"
              empty={data.concentration.segments.length === 0}
              emptyMessage="Record a sale against a customer to see who your business rests on."
              surface={false}
            >
              <ShareBar
                segments={data.concentration.segments.map((s, i) => ({
                  id: s.name,
                  label: s.name,
                  value: s.netRevenueCents,
                  tone: s.atRisk ? "loss" : slotFor(i),
                  muted: s.name.toLowerCase().includes("other") || s.name.toLowerCase().includes("unattributed"),
                }))}
                layout="stacked"
                format={money}
                size="md"
              />
            </ChartFrame>

            {/* The sentence the whole page exists for. Impossible to miss. */}
            <p
              className={cn(
                "t-verdict mt-5",
                data.concentration.losingThemMeansLoss
                  ? "text-[color:var(--pl-red)]"
                  : "text-[color:var(--pl-ink)]",
              )}
            >
              {data.verdict}
            </p>

            {data.biggestVsBest && (
              /* Biggest customer against best customer — the app's signature
                 "your best seller is not your best earner" fact. It was a
                 sentence carrying two names and two figures; side by side on
                 one scale, the gap between the bars IS the point, and the
                 sentence shrinks to the part a chart cannot say. */
              <div className="mt-4">
                <ChartFrame
                  title="Pays the most vs leaves the most"
                  height={90}
                  state="settled"
                  surface={false}
                >
                  <ShareBar
                    segments={[
                      {
                        id: "biggest",
                        label: `${data.biggestVsBest.biggest.name} · pays the most`,
                        value: data.biggestVsBest.biggest.contributionProfitCents,
                        tone: "neutral",
                      },
                      {
                        id: "best",
                        label: `${data.biggestVsBest.best.name} · leaves the most`,
                        value: data.biggestVsBest.best.contributionProfitCents,
                        tone: "gain",
                      },
                    ]}
                    layout="rows"
                    format={money}
                    size="sm"
                  />
                </ChartFrame>
              </div>
            )}
          </Surface>

          <StatStrip columns={3}>
            <StatTile
              label="Buy more than once"
              value={
                data.tiles.repeatRatePct === null ? "—" : `${data.tiles.repeatRatePct.toFixed(0)}%`
              }
              goodDirection="up-is-good"
              hint={
                data.tiles.repeatRatePct === null
                  ? `Needs ${MIN_CUSTOMERS_FOR_REPEAT} customers before this means anything — you have ${data.tiles.customerCount}`
                  : `Of ${data.tiles.customerCount} customers`
              }
            />
            <StatTile
              label="Each customer pays"
              value={
                data.tiles.revenuePerCustomerCents === null
                  ? "—"
                  : money(data.tiles.revenuePerCustomerCents)
              }
              goodDirection="up-is-good"
              hint="On average, this period"
            />
            <StatTile
              label="Gone quiet"
              value={data.tiles.goneQuietCount}
              goodDirection="down-is-good"
              hint={
                data.tiles.goneQuietCount === 0
                  ? "Nobody has broken their habit"
                  : `Worth ${money(data.tiles.goneQuietValueCents)} a year between them`
              }
            />
          </StatStrip>

          {/* The sleeper feature: a NAMED list. Most tools report churn as a
              percentage, and a percentage is not something anybody can act on. */}
          {data.goneQuiet.length > 0 && (
            <section>
              <SectionHeading hint="They used to buy on a rhythm and have stopped">
                Worth chasing
              </SectionHeading>
              <DataTable
                columns={quietColumns}
                rows={data.goneQuiet}
                getRowKey={(row) => row.id}
                caption="Customers who have gone quiet"
              />
            </section>
          )}

          <InsightFeed
            insights={feed.data?.insights ?? []}
            leaks={feed.data?.leaks ?? []}
            totalLeakCents={feed.data?.totalLeakCents ?? 0}
            symbol={f.symbol}
            state={figureState(feed, feed.data != null)}
          />

          <section>
            <SectionHeading
              hint="Ranked by what they paid you this period"
              action={
                <Link
                  href="/setup/people"
                  className="t-body font-semibold text-[color:var(--pl-orange-text)] hover:underline"
                >
                  All people →
                </Link>
              }
            >
              Who paid you
            </SectionHeading>
            <DataTable
              columns={customerColumns}
              rows={data.customers}
              getRowKey={(row) => row.id}
              caption="Customers who paid this period"
              empty={<span className="t-secondary">No sales were recorded against a customer.</span>}
            />
          </section>
        </>
      )}
    </div>
  );
}
