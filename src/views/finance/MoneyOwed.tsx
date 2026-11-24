import { useState } from "react";
import { Check, Loader2, Wallet } from "lucide-react";
import type { EndpointResponse, getOwed, OwedStateShape } from "@workspace/api-contract";
import { TopBar } from "@/components/TopBar";
import { MoneyTabBar } from "@/components/MoneyTabBar";
import { Surface } from "@/components/Surface";
import { Reveal, Stagger } from "@/components/Reveal";
import { FigureSlot } from "@/components/FigureSlot";
import { figureState } from "@/lib/figureState";
import { useFormatters } from "@/lib/store";
import { useMarkPaid, useOpenAdvances, useOwed, useSettleFromAdvance } from "@/api/hooks";
import { cn } from "@/lib/utils";

/**
 * Who owes you, and who you owe.
 *
 * NO PERIOD FILTER, and the page says so. Every other Money screen answers "how
 * did this month go"; this one answers "what is outstanding right now", and a
 * debt does not stop existing because the header is showing August. Filtering
 * it would hide the oldest invoices, which are the only ones worth a phone call.
 */

type OwedReport = EndpointResponse<typeof getOwed>;
type Side = OwedReport["incoming"];
type Row = Side["rows"][number];

/**
 * How a row reads. Amber for overdue rather than red, because red in this app
 * means money LOST (DESIGN.md §2) and a late invoice is money still expected —
 * the wrong alarm entirely. Every state also carries words, so the tag never
 * relies on its colour alone.
 */
const STATE_TAG: Record<OwedStateShape, { label: string; className: string }> = {
  overdue: { label: "Overdue", className: "bg-[color:var(--pl-amber-tint)] text-[color:var(--pl-amber)]" },
  due_soon: { label: "Due soon", className: "bg-[color:var(--pl-recessed)] text-[color:var(--pl-ink)]" },
  not_due: { label: "Not due yet", className: "bg-[color:var(--pl-recessed)] text-[color:var(--pl-ink-2)]" },
  no_due_date: { label: "No due date", className: "bg-[color:var(--pl-recessed)] text-[color:var(--pl-ink-3)]" },
};

function lateness(row: Row): string {
  if (row.state === "overdue") {
    return row.daysOverdue === 1 ? "1 day late" : `${row.daysOverdue} days late`;
  }
  // For everything else the honest measure is how long it has been waiting.
  // Saying "0 days late" about a bill nobody set a date for is a claim about an
  // agreement that was never made.
  return row.daysOutstanding === 1 ? "1 day old" : `${row.daysOutstanding} days old`;
}

function OwedList({
  side,
  title,
  emptyMessage,
  state,
  direction,
}: {
  side: Side | undefined;
  title: string;
  emptyMessage: string;
  state: ReturnType<typeof figureState>;
  /** Which way this list's money moves — advances may only settle their own way. */
  direction: "in" | "out";
}) {
  const f = useFormatters();
  const markPaid = useMarkPaid();
  const settleFromAdvance = useSettleFromAdvance();
  const advances = useOpenAdvances();
  const [settling, setSettling] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  /**
   * Advances facing the same way, biggest first.
   *
   * A customer's deposit does not pay a supplier — the server refuses it — so
   * offering the wrong ones would be an action that always fails.
   */
  const usable = (advances.data?.items ?? []).filter((advance) => advance.direction === direction);

  const rows = side?.rows ?? [];

  return (
    <Surface padding="none" className="overflow-hidden">
      <div className="border-b border-[color:var(--pl-grid-line)] p-5">
        <h2 className="t-section text-[color:var(--pl-ink)]">{title}</h2>
        <p className="t-title mt-2 text-[color:var(--pl-ink)]">
          <FigureSlot state={state}>{f.moneyCents(side?.totalCents ?? 0)}</FigureSlot>
        </p>
        {state === "settled" && side && side.count > 0 && (
          <p className="t-micro mt-1 text-[color:var(--pl-ink-2)]">
            {side.count === 1 ? "1 entry" : `${side.count} entries`}
            {side.overdueCount > 0 && (
              <>
                {" · "}
                <span className="text-[color:var(--pl-amber)]">
                  {f.moneyCents(side.overdueCents)} past its date
                </span>
              </>
            )}
          </p>
        )}
      </div>

      {state === "settled" && rows.length === 0 && (
        <p className="t-secondary p-5 text-[color:var(--pl-ink-2)]">{emptyMessage}</p>
      )}

      {error && (
        <p className="t-secondary px-5 pt-4 text-[color:var(--pl-amber)]" role="alert">
          {error}
        </p>
      )}

      {rows.length > 0 && (
        <ul className="divide-y divide-[color:var(--pl-grid-line)]">
          {rows.map((row) => {
            const tag = STATE_TAG[row.state];
            const busy = settling === row.id && (markPaid.isPending || settleFromAdvance.isPending);
            return (
              <li key={row.id} className="flex flex-wrap items-center gap-3 p-4 sm:flex-nowrap">
                <div className="min-w-0 flex-1">
                  <p className="t-secondary truncate font-medium text-[color:var(--pl-ink)]">
                    {row.personName ?? row.displayName}
                  </p>
                  <p className="t-micro mt-0.5 truncate text-[color:var(--pl-ink-3)]">
                    {row.personName ? `${row.displayName} · ` : ""}
                    {lateness(row)}
                    {row.referenceNumber ? ` · ${row.referenceNumber}` : ""}
                  </p>
                </div>

                <span className={cn("t-micro shrink-0 rounded-[length:var(--pl-r-sm)] px-2 py-1", tag.className)}>
                  {tag.label}
                </span>

                <span className="t-num shrink-0 text-[color:var(--pl-ink)]">{f.moneyCents(row.amountCents)}</span>

                {/* Offered only when there is an advance that could actually
                    cover it. A button that always fails is worse than none. */}
                {usable.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setSettling(row.id);
                      setError(null);
                      settleFromAdvance.mutate(
                        { id: row.id, body: { advanceTransactionId: usable[0].id } },
                        {
                          onError: (err) => {
                            const message = (err as { data?: { error?: { message?: string } } })?.data?.error
                              ?.message;
                            setError(message ?? "That didn't work. Try again in a moment.");
                          },
                        },
                      );
                    }}
                    disabled={busy}
                    title={`Use ${f.moneyCents(usable[0].remainingCents)} from ${usable[0].personName ?? usable[0].displayName}`}
                    className="pl-press inline-flex shrink-0 items-center gap-1.5 rounded-[length:var(--pl-r-full)] border border-[color:var(--pl-grid-line)] px-3 py-1.5 text-[color:var(--pl-ink-2)] transition-colors hover:bg-[color:var(--pl-recessed)] disabled:opacity-50"
                  >
                    <Wallet className="h-3.5 w-3.5" />
                    <span className="t-micro">Use paid ahead</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => {
                    setSettling(row.id);
                    setError(null);
                    markPaid.mutate(row.id);
                  }}
                  disabled={busy}
                  className="pl-press inline-flex shrink-0 items-center gap-1.5 rounded-[length:var(--pl-r-full)] border border-[color:var(--pl-grid-line)] px-3 py-1.5 text-[color:var(--pl-ink-2)] transition-colors hover:bg-[color:var(--pl-recessed)] disabled:opacity-50"
                >
                  {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                  <span className="t-micro">Mark paid</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Surface>
  );
}

/** How long the money has been waiting, as a strip. Reads left to right, worst on the right. */
function AgingStrip({ side, state }: { side: Side | undefined; state: ReturnType<typeof figureState> }) {
  const f = useFormatters();
  if (state !== "settled" || !side || side.count === 0) return null;

  return (
    <div className="grid grid-cols-3 divide-x divide-[color:var(--pl-grid-line)]">
      {side.buckets.map((bucket) => (
        <div key={bucket.label} className="p-4">
          <p className="t-micro text-[color:var(--pl-ink-3)]">{bucket.label}</p>
          <p className="t-secondary mt-1 font-semibold text-[color:var(--pl-ink)]">{f.moneyCents(bucket.cents)}</p>
          <p className="t-micro text-[color:var(--pl-ink-3)]">
            {bucket.count === 1 ? "1 entry" : `${bucket.count} entries`}
          </p>
        </div>
      ))}
    </div>
  );
}

/**
 * Money that has already moved but has not become anything yet.
 *
 * Its own block rather than a third column, because it is a different KIND of
 * fact from the two lists beside it: those are promises outstanding, this is
 * cash that has changed hands and is waiting for work. Netting it against
 * either would hide both.
 */
function PaidAheadBlock() {
  const f = useFormatters();
  const advances = useOpenAdvances();
  const state = figureState(advances, advances.data != null);
  const items = advances.data?.items ?? [];

  if (state === "settled" && items.length === 0) return null;

  return (
    <Surface padding="none" className="overflow-hidden">
      <div className="flex items-start gap-3 border-b border-[color:var(--pl-grid-line)] p-5">
        <span className="rounded-[length:var(--pl-r-md)] bg-[color:var(--pl-recessed)] p-2 text-[color:var(--pl-ink-2)]">
          <Wallet className="h-4 w-4" />
        </span>
        <div>
          <h2 className="t-section text-[color:var(--pl-ink)]">Paid ahead</h2>
          <p className="t-micro mt-0.5 text-[color:var(--pl-ink-3)]">
            Money that has moved but has not become a cost or a sale yet. It counts as cash,
            never as profit, until a bill arrives to settle it against.
          </p>
        </div>
      </div>

      <ul className="divide-y divide-[color:var(--pl-grid-line)]">
        {items.map((advance) => (
          <li key={advance.id} className="flex flex-wrap items-center gap-3 p-4 sm:flex-nowrap">
            <div className="min-w-0 flex-1">
              <p className="t-secondary truncate font-medium text-[color:var(--pl-ink)]">
                {advance.personName ?? advance.displayName}
              </p>
              <p className="t-micro mt-0.5 truncate text-[color:var(--pl-ink-3)]">
                {advance.personName ? `${advance.displayName} · ` : ""}
                {advance.direction === "out" ? "You paid ahead" : "You are holding this"}
                {advance.usedCents > 0 && ` · ${f.moneyCents(advance.usedCents)} used`}
              </p>
            </div>
            <span className="t-num shrink-0 text-[color:var(--pl-ink)]">
              {f.moneyCents(advance.remainingCents)}
            </span>
          </li>
        ))}
      </ul>
    </Surface>
  );
}

export default function MoneyOwed() {
  const owed = useOwed();
  const state = figureState(owed, owed.data != null);

  return (
    <>
      <TopBar
        title="Money owed"
        subtitle="Everything outstanding right now, in both directions"
      />
      <MoneyTabBar />
      <div className="app-page-shell">
        <Surface variant="hero" padding="md">
          <p className="t-secondary text-[color:var(--pl-ink-2)]">
            {/* Said once, at the top, because the header's period picker is
                right above it and would otherwise look like it applies. */}
            This page ignores the dates at the top of the screen. A bill nobody has
            paid is outstanding whichever month you are looking at.
          </p>
        </Surface>

        <Stagger className="grid gap-5 xl:grid-cols-2">
          <Reveal className="space-y-4">
            <OwedList
              side={owed.data?.incoming}
              direction="in"
              title="Coming to you"
              emptyMessage="Every sale has been paid for. Nothing is waiting."
              state={state}
            />
            <Surface variant="bordered">
              <AgingStrip side={owed.data?.incoming} state={state} />
            </Surface>
          </Reveal>

          <Reveal className="space-y-4">
            <OwedList
              side={owed.data?.outgoing}
              direction="out"
              title="You owe"
              emptyMessage="Nothing outstanding. Every bill you have entered is settled."
              state={state}
            />
            <Surface variant="bordered">
              <AgingStrip side={owed.data?.outgoing} state={state} />
            </Surface>
          </Reveal>
        </Stagger>

        <PaidAheadBlock />
      </div>
    </>
  );
}
