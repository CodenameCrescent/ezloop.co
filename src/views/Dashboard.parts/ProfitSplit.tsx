import Link from "next/link";
import { ResponsiveContainer, PieChart, Pie, Cell } from "recharts";
import { SectionHeading } from "@/components/SectionHeading";
import { Surface } from "@/components/Surface";
import { Tag } from "@/components/Tag";
import { ChartFrame } from "@/components/charts/ChartFrame";
import { type ShareSegment, ShareBar } from "@/components/charts/ShareBar";
import { type FigureState, figureStateSentence } from "@/lib/figureState";
import { type LeaderRow } from "../dashboardMetrics";
import { type RecentTransaction, DIRECT_COST_FILL, EXPENSE_FILL } from "./ProfitHero";

/**
 * Where the period's revenue went — a ring and its four rungs.
 *
 * It floats on the page with NO card under it. That is the point: the brand
 * block beside it is the headline, and giving the split its own surface made
 * the two compete for the same job. On the background it reads as the
 * headline's explanation rather than as a second claim.
 */
export function ProfitSplit({
  netRevenue,
  directCosts,
  expenses,
  trueProfit,
  marginPct,
  money,
}: {
  netRevenue: number;
  directCosts: number;
  expenses: number;
  trueProfit: number;
  marginPct: number;
  money: (value: number) => string;
}) {
  const profitable = trueProfit >= 0;

  /**
   * The ring is the period's revenue split into where it went. It shows the
   * two costs SEPARATELY because they are different kinds of money and were
   * previously collapsed into one "Cost you" figure — which then sat on the
   * same screen as a "Money out" tile showing only the expense half. Two
   * numbers, both meaning money leaving, millions apart, with nothing saying
   * why. Naming both rungs is the fix.
   *
   * A loss cannot be a slice of revenue, so it draws as one full red ring
   * instead of a negative wedge.
   */
  const slices = profitable
    ? [
        { name: "Cost you", value: Math.max(0, directCosts), fill: DIRECT_COST_FILL },
        { name: "Expenses", value: Math.max(0, expenses), fill: EXPENSE_FILL },
        { name: "Kept", value: Math.max(0, trueProfit), fill: "var(--pl-green-solid)" },
      ]
    : [{ name: "Overspend", value: 1, fill: "var(--pl-red-solid)" }];
  const hasSplit = slices.some((s) => s.value > 0);

  const rows: Array<{ label: string; value: number; tone?: string; dot?: string; hint?: string }> = [
    { label: "Came in", value: netRevenue },
    { label: "Cost you", value: directCosts, dot: DIRECT_COST_FILL, hint: "what you sold cost you" },
    { label: "Expenses", value: expenses, dot: EXPENSE_FILL, hint: "bills and running costs" },
    {
      label: "Kept",
      value: trueProfit,
      tone: profitable ? "var(--pl-green)" : "var(--pl-red)",
      dot: profitable ? "var(--pl-green-solid)" : "var(--pl-red-solid)",
    },
  ];

  return (
    /* NO Surface. The ring sits straight on the page background beside the
       brand block — see the note above. Wraps on a phone, because the mono
       figures are wider than the space beside the ring and clipping a money
       figure is not an option. */
    <div className="flex flex-wrap items-center gap-x-8 gap-y-6 lg:pl-2">
      <div className="relative h-[160px] w-[160px] shrink-0">
        {hasSplit && (
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={slices}
                dataKey="value"
                innerRadius={56}
                outerRadius={78}
                paddingAngle={slices.length > 1 ? 2 : 0}
                startAngle={90}
                endAngle={-270}
                stroke="none"
                /*
                 * The ring does NOT animate, and that is a correctness
                 * decision rather than a taste one.
                 *
                 * Recharts sweeps the arcs in on mount through
                 * requestAnimationFrame, and it offers no way to land them if
                 * the frames stop coming — which they do in a throttled or
                 * unpainted tab. Caught here with `visibilityState` still
                 * reporting "visible": the sweep froze a few degrees in, and
                 * what was left on screen was a ring claiming this business
                 * spent ~2% of its revenue. A half-drawn ring is a wrong ring,
                 * the same way `AnimatedNumber` decided a half-counted figure
                 * is a wrong figure — and unlike that component, this one
                 * cannot be made to land.
                 *
                 * The hero figure beside it still counts, so the page keeps
                 * the one animated element DESIGN.md §6 allows it.
                 */
                isAnimationActive={false}
              >
                {slices.map((s) => (
                  <Cell key={s.name} fill={s.fill} />
                ))}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
        )}
        {/* The margin restated in the hole, so the ring says what it means. */}
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <div className="text-center">
            <p
              className="t-num text-xl font-semibold"
              style={{ color: profitable ? "var(--pl-green)" : "var(--pl-red)" }}
            >
              {marginPct.toFixed(0)}%
            </p>
            <p className="t-micro">kept</p>
          </div>
        </div>
      </div>

      <dl className="min-w-[12rem] flex-1 space-y-3">
        {rows.map((row) => (
          <div key={row.label} className="flex items-baseline justify-between gap-4">
            <dt className="flex min-w-0 items-baseline gap-2 text-sm text-[color:var(--pl-ink-2)]">
              {row.dot && (
                <span
                  className="h-2 w-2 shrink-0 translate-y-[-1px] rounded-full"
                  style={{ backgroundColor: row.dot }}
                />
              )}
              <span className="min-w-0">
                {row.label}
                {/* Two rows both read as money leaving. The clause is what
                    stops the reader having to guess which is which. */}
                {row.hint && <span className="t-micro block">{row.hint}</span>}
              </span>
            </dt>
            <dd
              className="t-num shrink-0 text-base font-semibold"
              style={{ color: row.tone ?? "var(--pl-ink)" }}
            >
              {money(row.value)}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/* ── 4a · What happened ───────────────────────────────────────────────────── */

export function RecentActivity({
  items,
  money,
  state,
}: {
  items: RecentTransaction[];
  money: (value: number) => string;
  state: FigureState;
}) {
  return (
    <Surface padding="md">
      <SectionHeading
        action={
          <Link
            href="/record/transactions"
            className="text-sm font-medium text-[color:var(--pl-orange-text)] hover:underline"
          >
            View all
          </Link>
        }
      >
        What happened
      </SectionHeading>

      {/* An empty ledger and an unreachable one look identical from here —
          `items` is built from the store's transactions, which fall back to an
          empty array. Only one of the two is something this card knows. */}
      {items.length === 0 && state !== "settled" ? (
        <p className="t-secondary py-6 text-center text-[color:var(--pl-amber)]">
          {state === "loading"
            ? "Loading…"
            : figureStateSentence(state, "what happened")}
        </p>
      ) : items.length === 0 ? (
        <p className="t-secondary py-6 text-center">
          Record a sale or an expense and it will show up here.
        </p>
      ) : (
        <ul className="divide-y divide-[color:var(--pl-hairline)]">
          {items.map((item) => {
            const income = item.amount >= 0;
            return (
              <li key={item.id} className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-[color:var(--pl-ink)]">
                      {item.title}
                    </p>
                    <p className="t-micro mt-0.5">{item.dateLabel}</p>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <Tag tone={income ? "green" : "neutral"}>{item.tag}</Tag>
                  <span
                    className="t-num text-sm font-semibold"
                    style={{ color: income ? "var(--pl-green)" : "var(--pl-ink)" }}
                  >
                    {income ? "+" : "−"}
                    {money(Math.abs(item.amount))}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Surface>
  );
}

/* ── 4b · Where it went ───────────────────────────────────────────────────── */

/**
 * The two leader lists were the same hand-rolled bar the app drew in eight
 * places. They are `ShareBar` now — the money tone for each direction, since
 * these ARE money and not categories.
 */
export function WhereMoneyWent({
  topRevenues,
  topExpenses,
  money,
  state,
}: {
  topRevenues: LeaderRow[];
  topExpenses: LeaderRow[];
  money: (value: number) => string;
  state: FigureState;
}) {
  const toSegments = (rows: LeaderRow[], tone: "gain" | "neutral"): ShareSegment[] =>
    rows.map((row) => ({ id: row.id, label: row.label, value: row.amount, tone }));

  /* Both `empty` flags used to read `!loading && rows.length === 0`, and both
     messages are sentences about the business. With `loading` false for a
     failed or paused request, an owner who had traded all month was told "No
     income recorded in this period." The frame now decides from the state, and
     never reaches `emptyMessage` unless the request actually settled. */
  return (
    <Surface padding="md" className="flex flex-col gap-6">
      <ChartFrame
        title="Brought in"
        hint="Biggest lines this period"
        height={120}
        state={state}
        empty={topRevenues.length === 0}
        emptyMessage="No income recorded in this period."
        surface={false}
      >
        <ShareBar segments={toSegments(topRevenues, "gain")} layout="rows" format={money} size="sm" />
      </ChartFrame>

      <ChartFrame
        title="Went out"
        height={120}
        state={state}
        empty={topExpenses.length === 0}
        emptyMessage="No spending recorded in this period."
        surface={false}
      >
        <ShareBar segments={toSegments(topExpenses, "neutral")} layout="rows" format={money} size="sm" />
      </ChartFrame>
    </Surface>
  );
}
