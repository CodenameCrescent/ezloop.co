import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Surface } from "@/components/Surface";
import { AnimatedNumber } from "@/components/AnimatedNumber";
import { Sparkline } from "@/components/charts/Sparkline";
import { cn } from "@/lib/utils";
import type { AdSpendEntry, Order } from "@/lib/types";
import { calculateOrderNetRevenue } from "@/lib/finance";
import { type Expense } from "@/lib/legacyStubs";
import { type LeaderRow } from "../dashboardMetrics";

/* ────────────────────────────────────────────────────────────────────────────
   The dashboard was nine sections tall and coloured in five hues, three of
   which meant nothing. It is now five sections on the money palette:

     1. one big number, and a sentence saying what it means
     2. four quiet tiles
     3. one chart
     4. what happened · where it went
     5. what needs attention

   Two blocks did not survive the rewrite, and it is worth saying why:
   "Profit Drivers" shipped the same three pieces of advice to every business
   ("Negotiate with suppliers to lower COGS by 5-8%") with bars floored at 18%
   so an empty one still looked full, and the task list picked BOTH its colour
   and its High/Medium/Low severity from the row's index in an array. Neither
   read anything real. See DESIGN.md — nothing is invented on the owner's
   behalf.

   Every hook below is the one that was here before: this pass changed the
   surface, not the arithmetic (the money pages are queued for their own
   rewrite in R5.1 and this layout survives it).
   ──────────────────────────────────────────────────────────────────────────── */

export type RecentTransaction = {
  id: string;
  title: string;
  tag: string;
  amount: number;
  dateLabel: string;
  tone: "revenue" | "expense" | "neutral";
};

export function safeNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function safeDate(value: unknown): Date | null {
  const date = new Date(String(value ?? ""));
  return Number.isNaN(date.getTime()) ? null : date;
}

export function dateDistanceLabel(date: Date) {
  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const then = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diff = Math.round((start.getTime() - then.getTime()) / 86_400_000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  if (diff < 7) return new Intl.DateTimeFormat("en-US", { weekday: "short" }).format(date);
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(date);
}

export function percentDelta(current: number, previous: number) {
  if (Math.abs(previous) < 0.01) return current > 0 ? 100 : 0;
  return ((current - previous) / Math.abs(previous)) * 100;
}

export function buildTopExpenses(expenses: Expense[], adSpend: AdSpendEntry[]): LeaderRow[] {
  const map = new Map<string, LeaderRow>();
  const add = (label: string, amount: number) => {
    const current = map.get(label) ?? { id: label, label, amount: 0 };
    current.amount += Math.abs(amount);
    map.set(label, current);
  };
  for (const spend of adSpend) add(spend.campaign || spend.platform || "Ads", safeNumber(spend.totalSpend));
  for (const expense of expenses) {
    if (expense.status === "paused") continue;
    add(expense.category || expense.name || "Other Expenses", safeNumber(expense.amount));
  }
  return [...map.values()].sort((a, b) => b.amount - a.amount).slice(0, 4);
}

export function buildRecentTransactions(orders: Order[], expenses: Expense[]): RecentTransaction[] {
  const revenueRows: RecentTransaction[] = orders
    .filter((order) => order.status !== "cancelled")
    .map((order) => {
      const date = safeDate(order.date) ?? new Date(0);
      return {
        id: `order-${order.id}`,
        title: order.productName || order.items?.[0]?.productName || order.customer || "Revenue",
        // "Product" was wrong for half this app's audience: a consulting
        // retainer is not a product. Everything that brought money in is
        // revenue (CLAUDE.md — the app is cross-vertical).
        tag: "Revenue",
        amount: calculateOrderNetRevenue(order),
        dateLabel: dateDistanceLabel(date),
        tone: "revenue",
      };
    });
  const expenseRows: RecentTransaction[] = expenses
    .filter((expense) => expense.status !== "paused")
    .map((expense) => {
      const date = safeDate(expense.date) ?? new Date(0);
      return {
        id: `expense-${expense.id}`,
        title: expense.name || expense.category || "Expense",
        tag: "Expense",
        amount: -Math.abs(safeNumber(expense.amount)),
        dateLabel: dateDistanceLabel(date),
        tone: "expense",
      };
    });
  const at = (row: RecentTransaction) =>
    row.id.startsWith("order-")
      ? safeDate(orders.find((o) => `order-${o.id}` === row.id)?.date)?.getTime() ?? 0
      : safeDate(expenses.find((e) => `expense-${e.id}` === row.id)?.date)?.getTime() ?? 0;
  return [...revenueRows, ...expenseRows].sort((a, b) => at(b) - at(a)).slice(0, 6);
}

/* ── 1 · The one big number ───────────────────────────────────────────────── */

/**
 * The two cost slices are the SAME grey at two strengths, not two colours.
 * Money is the only thing allowed to carry hue here (DESIGN.md rule 2), so
 * "what the goods cost" and "what the bills cost" separate by weight instead.
 */
export const DIRECT_COST_FILL = "var(--pl-ink-3)";
export const EXPENSE_FILL = "color-mix(in srgb, var(--pl-ink-3) 45%, var(--pl-surface))";

/**
 * Text on the brand block, in one place.
 *
 * `--pl-on-hero` is white in light and near-black in dark, because the brand
 * fill flips (DESIGN.md §5) — so nothing inside the hero may name a colour of
 * its own. It is also needed EXPLICITLY on `.t-micro` and friends: those
 * utilities set `color: var(--pl-ink-2)`, which would otherwise win over the
 * colour the surface inherits down.
 */
export const ON_HERO = { color: "var(--pl-on-hero)" } as const;

/**
 * The headline: the number the whole screen exists for, on the brand block.
 *
 * ── Why the figure is no longer green or red ───────────────────────────────
 *
 * It was, and on a white card that was right. On the brand fill there is no
 * green or red that reads, so the figure carries its meaning the two other
 * ways DESIGN.md §3a allows: a SIGN on the number, and the WORD above it —
 * "True profit" or "Lost after costs". Both survive greyscale, which the old
 * green/red pair did not (ΔE 4.9 under deuteranopia). A loss is if anything
 * louder than before: it changes the label, not just the hue.
 *
 * ── Why the line is a running total ────────────────────────────────────────
 *
 * The series buckets sum exactly to the whole-period ladder (the contract says
 * so and the server computes both from the one implementation), so a running
 * total of bucket profit ENDS on the figure printed beside it. The line is
 * therefore not a decoration that happens to share a card — it is the same
 * number, walking to where it got to.
 */
export function ProfitHero({
  trueProfit,
  marginPct,
  delta,
  periodLabel,
  compareNoun,
  trend,
  money,
}: {
  trueProfit: number;
  marginPct: number;
  delta: number;
  periodLabel: string;
  compareNoun: string;
  /** Running-total profit across the period, oldest first. */
  trend: number[];
  money: (value: number) => string;
}) {
  const up = delta >= 0;
  const flat = Math.abs(delta) < 0.05;
  const profitable = trueProfit >= 0;
  const hasTrend = trend.length > 1;

  /* The sign, spelled out. `money()` hands a negative to Intl, which puts the
     minus INSIDE the figure ("Rs -13,005"); on a surface with no colour to
     carry the direction, the sign has to be the first thing read. */
  const heroMoney = (value: number) => (value < 0 ? `−${money(Math.abs(value))}` : money(value));

  return (
    /* The one brand block on the screen. `bordered` is deliberately absent:
       a hairline over a saturated fill reads as a printing error, and the
       block separates from the page by being a different colour entirely. */
    <Surface variant="brand" padding="lg" className="min-h-[13.5rem]">
      <div
        className={cn(
          "grid h-full gap-6 sm:items-center",
          hasTrend && "sm:grid-cols-[minmax(0,1fr)_minmax(0,0.8fr)]",
        )}
      >
        <div className="flex min-w-0 flex-col">
          {/* Deliberately NOT `.t-micro`, which is 12px regular.
              White on the owner's brand gradient runs 2.5–3.3:1, below the
              4.5 this app holds everywhere else, and the fill is fixed — so
              the only lever left is the text itself. Every caption on this
              block is a step larger and a weight heavier than its equivalent
              on a white card. See the note on `--pl-hero-solid` in index.css;
              fading these to 80% white, which is the instinctive move, makes
              it worse. */}
          <p className="text-[13px] font-medium" style={ON_HERO}>
            {profitable ? "True profit" : "Lost after costs"} · {periodLabel}
          </p>

          {/* It counts up. This is the ONLY number on the dashboard that does,
              because the count is what says "this figure is the answer" — put
              it on the four cards below as well and it stops meaning anything
              and just delays the page becoming readable. */}
          <p className="t-hero mt-1" style={ON_HERO}>
            <AnimatedNumber value={trueProfit} format={heroMoney} />
          </p>

          {/* Two plain facts on one line. They were tinted pills, which made
              the hero look like a row of tags rather than a headline — and a
              pill reads as a status, which a margin is not. */}
          <p
            className="mt-2.5 flex flex-wrap items-baseline gap-x-5 gap-y-1 text-[15px] font-medium"
            style={ON_HERO}
          >
            <span className="t-num">
              {flat
                ? `No change ${compareNoun}`
                : `${up ? "+" : "−"}${Math.abs(delta).toFixed(1)}% ${compareNoun}`}
            </span>
            <span className="t-num">{marginPct.toFixed(1)}% profit margin</span>
          </p>

          <Link
            href="/money/profit-loss"
            className="mt-auto inline-flex w-fit items-center gap-1.5 pt-5 text-sm font-semibold underline-offset-4 hover:underline"
            style={ON_HERO}
          >
            View profit &amp; loss report <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>

        {hasTrend && (
          <div className="h-24 min-w-0 sm:h-32">
            <Sparkline
              values={trend}
              tone="inverse"
              fill
              showEnd
              strokeWidth={2.5}
              viewWidth={160}
              viewHeight={64}
              inline
              label={`True profit building up across ${periodLabel}, ending at ${heroMoney(trueProfit)}`}
            />
          </div>
        )}
      </div>
    </Surface>
  );
}
