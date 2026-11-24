import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowRight, RotateCcw, Archive } from "lucide-react";
import type { BusinessSummaryShape } from "@workspace/api-contract";
import { Surface } from "@/components/Surface";
import { FigureSlot } from "@/components/FigureSlot";
import { figureState } from "@/lib/figureState";
import { useUpdateBusiness, useBusinessPnl } from "@/api/hooks";
import { BUSINESS_TYPE_OPTIONS } from "@/lib/businessTypes";
import { switchBusiness } from "@/lib/currentBusiness";
import { formatCents } from "@/lib/money";
import { cn } from "@/lib/utils";

/**
 * Every set of books this account owns, and the way between them.
 *
 * Sits ABOVE the app: no sidebar, no period filter, no business selected. This
 * is the one screen that is about the account rather than about a business, so
 * rendering it inside the app shell would have meant showing one business's
 * navigation while asking which business you want.
 */

/** This month, in the format the reports endpoints take. */
export function thisMonthRange(): { startDate: string; endDate: string } {
  const now = new Date();
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return {
    startDate: iso(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))),
    endDate: iso(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0))),
  };
}

export function typeLabel(value: string): string {
  return BUSINESS_TYPE_OPTIONS.find((option) => option.value === value)?.label ?? value;
}

/**
 * One business, with a figure that makes the card worth reading.
 *
 * The figure is THIS BUSINESS's true profit this month, asked for with this
 * business's id and printed with this business's own symbol. That pairing looks
 * like the one CLAUDE.md bans — `formatCents(x, symbol)` — and is the exception
 * it exists to allow: the ban is on taking cents from the server and a symbol
 * from settings, which describe different things. Here both come off the same
 * business, so they cannot disagree. `useFormatters()` would be the bug on this
 * screen, since it is bound to whichever business is currently selected.
 */
export function BusinessCard({ business, isCurrent }: { business: BusinessSummaryShape; isCurrent: boolean }) {
  const queryClient = useQueryClient();
  const updateBusiness = useUpdateBusiness();
  const range = useMemo(thisMonthRange, []);
  const archived = business.archivedAt !== null;
  const pnl = useBusinessPnl(business.id, archived ? {} : range);
  const [actionError, setActionError] = useState<string | null>(null);

  /**
   * The server refuses to archive the last open business, and this is where
   * that refusal becomes visible. Without it the button did nothing at all: the
   * request 400'd, the list did not change, and the only way to find out why was
   * the network tab. A control that silently declines reads as broken software.
   */
  function toggleArchived() {
    setActionError(null);
    updateBusiness.mutate(
      { id: business.id, body: { archived: !archived } },
      {
        onError: (error) => {
          const message = (error as { data?: { error?: { message?: string } } })?.data?.error?.message;
          setActionError(message ?? "That didn't save. Try again in a moment.");
        },
      },
    );
  }

  const profit = pnl.data?.ladder.trueProfit;
  const state = figureState(pnl, profit != null);

  return (
    <Surface
      variant={isCurrent ? "hero" : "default"}
      padding="md"
      className={cn("flex flex-col gap-4", archived && "opacity-60")}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="t-section truncate text-[color:var(--pl-ink)]">{business.name}</h2>
          <p className="t-micro mt-1 text-[color:var(--pl-ink-3)]">
            {typeLabel(business.businessType)} · {business.currency}
            {isCurrent && " · open now"}
            {archived && " · archived"}
          </p>
        </div>
      </div>

      <div>
        <p className="t-micro text-[color:var(--pl-ink-3)]">Profit this month</p>
        {archived ? (
          // No figure is offered for an archived business rather than a stale
          // one: it is not being traded, so "this month" describes nothing.
          <p className="t-title mt-1 text-[color:var(--pl-ink-3)]">—</p>
        ) : (
          <p className="t-title mt-1 text-[color:var(--pl-ink)]">
            <FigureSlot state={state}>
              <span
                className={cn(
                  profit != null && profit > 0 && "text-[color:var(--pl-green)]",
                  profit != null && profit < 0 && "text-[color:var(--pl-red)]",
                )}
              >
                {/* Sign as well as colour: green and red do not separate under
                    colour blindness, so the direction has to be readable in
                    greyscale too (DESIGN.md §3a). */}
                {profit == null
                  ? "—"
                  : `${profit > 0 ? "+" : profit < 0 ? "-" : ""}${formatCents(Math.abs(profit), business.currencySymbol)}`}
              </span>
            </FigureSlot>
          </p>
        )}
      </div>

      <div className="mt-auto flex items-center gap-2">
        {!archived && (
          <button
            type="button"
            onClick={() => switchBusiness(business.id, queryClient)}
            className="pl-press inline-flex flex-1 items-center justify-center gap-2 rounded-[length:var(--pl-r-full)] bg-[color:var(--pl-orange)] px-4 py-2 font-semibold text-[color:var(--pl-on-orange)]"
          >
            {isCurrent ? "Continue" : "Open"}
            <ArrowRight className="h-4 w-4" />
          </button>
        )}
        <button
          type="button"
          onClick={toggleArchived}
          disabled={updateBusiness.isPending}
          title={archived ? "Bring this business back" : "Archive this business"}
          className={cn(
            "pl-press inline-flex items-center justify-center gap-2 rounded-[length:var(--pl-r-full)] border border-[color:var(--pl-grid-line)] px-4 py-2 text-[color:var(--pl-ink-2)] transition-colors hover:bg-[color:var(--pl-recessed)]",
            archived && "flex-1",
          )}
        >
          {archived ? <RotateCcw className="h-4 w-4" /> : <Archive className="h-4 w-4" />}
          {archived && "Restore"}
        </button>
      </div>

      {actionError && (
        // Amber, not red: colour means money, and a refused action is not money
        // lost (DESIGN.md §2, §9).
        <p className="t-micro text-[color:var(--pl-amber)]" role="alert">
          {actionError}
        </p>
      )}
    </Surface>
  );
}
