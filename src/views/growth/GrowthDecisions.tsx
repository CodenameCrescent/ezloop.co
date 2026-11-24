import { useMemo, useState } from "react";
import { AlertTriangle, Lightbulb } from "lucide-react";
import { TopBar } from "@/components/TopBar";
import { buildPeriodRange } from "@/lib/period";
import { generateInsights } from "@/lib/insightsEngine";
import { buildGrowthActionsFromInsights, loadGrowthActionState, saveGrowthActionState, updateGrowthActionStatus, type GrowthAction, type GrowthActionStatus, type StoredGrowthActionMap } from "@/lib/growthActions";
import { useStore } from "@/lib/store";
import { figureStateSentence } from "@/lib/figureState";
import { FigureSlot } from "@/components/FigureSlot";
import { STATUS_LABELS, ActionCard } from "./GrowthDecisions.parts/ActionCard";

type StatusFilter = "all" | GrowthActionStatus;

function StatusButton({
  status,
  active,
  onClick,
}: {
  status: StatusFilter;
  active: boolean;
  onClick: () => void;
}) {
  const label = status === "all" ? "All" : STATUS_LABELS[status];
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
        active
          ? "bg-[color:var(--pl-orange-tint)] text-[color:var(--pl-orange-text)]"
          : "bg-[color:var(--pl-recessed)] text-[color:var(--pl-ink-2)] hover:text-[color:var(--pl-ink)]"
      }`}
    >
      {label}
    </button>
  );
}

function EmptyState({ hasData }: { hasData: boolean }) {
  return (
    <div className="flex flex-col items-center gap-4 rounded-2xl border border-card-border bg-card p-12 text-center">
      <Lightbulb className="h-12 w-12 text-muted-foreground/25" />
      <div>
        <p className="text-base font-medium">
          {hasData ? "No growth actions triggered yet" : "No business data yet"}
        </p>
        <p className="mt-1 max-w-md text-sm text-muted-foreground">
          {hasData
            ? "Insights did not find a strong enough action signal for this period. Keep adding transactions as the picture changes."
            : "Add business data first to create growth actions."}
        </p>
      </div>
    </div>
  );
}

export default function GrowthDecisions() {
  /*
   * `dataState` rather than `isLoading`.
   *
   * Every figure on this page is derived from the store's arrays, and those
   * fall back to empty when a request fails or pauses exactly as they do for a
   * brand-new business. So a store that could not load produced four confident
   * zeros in the tiles — "Open actions 0", "High priority 0" — and then an
   * empty state telling the owner to go and record something. The store now
   * says WHY it is empty and this page reads that instead.
   */
  const { orders, products, adSpend, expenses, customerMerges, dataState } = useStore();
  const [storedState, setStoredState] = useState<StoredGrowthActionMap>(() =>
    loadGrowthActionState(),
  );
  const [filter, setFilter] = useState<StatusFilter>("all");
  const range = useMemo(() => buildPeriodRange("this-month"), []);
  const hasData = orders.length > 0 || expenses.length > 0 || adSpend.length > 0;

  const insights = useMemo(
    () =>
      generateInsights({
        orders,
        products,
        adSpend,
        expenses,
        customerMerges,
        range,
      }),
    [orders, products, adSpend, expenses, customerMerges, range],
  );

  const actions = useMemo(
    () => buildGrowthActionsFromInsights(insights, storedState),
    [insights, storedState],
  );

  const filteredActions = useMemo(
    () => (filter === "all" ? actions : actions.filter((action) => action.status === filter)),
    [actions, filter],
  );

  const counts = useMemo(
    () => ({
      all: actions.length,
      pending: actions.filter((action) => action.status === "pending").length,
      in_progress: actions.filter((action) => action.status === "in_progress").length,
      done: actions.filter((action) => action.status === "done").length,
      ignored: actions.filter((action) => action.status === "ignored").length,
    }),
    [actions],
  );

  function handleStatusChange(action: GrowthAction, status: GrowthActionStatus) {
    const nextState = updateGrowthActionStatus(storedState, action, status);
    setStoredState(nextState);
    saveGrowthActionState(nextState);
  }

  return (
    <>
      <TopBar
        title="Action Plan"
        subtitle="Recommended actions generated from plain-English insights."
      />
      <div className="space-y-6 px-4 py-4 sm:px-8 sm:py-6">
        <div className="grid gap-3 sm:grid-cols-4">
          <div className="rounded-2xl border border-card-border bg-card p-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Open actions
            </div>
            {/* `tabular-nums` stays on the figure and never on the words that
                stand in for it — see FigureSlot. */}
            <div className="mt-2 text-3xl font-bold">
              <FigureSlot state={dataState}>
                <span className="tabular-nums">{counts.pending + counts.in_progress}</span>
              </FigureSlot>
            </div>
          </div>
          <div className="rounded-2xl border border-card-border bg-card p-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              High priority
            </div>
            <div className="mt-2 text-3xl font-bold text-[color:var(--pl-red)]">
              <FigureSlot state={dataState}>
                <span className="tabular-nums">
                  {actions.filter((action) => action.priority === "high").length}
                </span>
              </FigureSlot>
            </div>
          </div>
          <div className="rounded-2xl border border-card-border bg-card p-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Done
            </div>
            <div className="mt-2 text-3xl font-bold text-[color:var(--pl-green)]">
              <FigureSlot state={dataState}>
                <span className="tabular-nums">{counts.done}</span>
              </FigureSlot>
            </div>
          </div>
          <div className="rounded-2xl border border-card-border bg-card p-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Insight-backed
            </div>
            <div className="mt-2 text-3xl font-bold">
              <FigureSlot state={dataState}>
                <span className="tabular-nums">{actions.length}</span>
              </FigureSlot>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {(["all", "pending", "in_progress", "done", "ignored"] as StatusFilter[]).map((status) => (
            <StatusButton
              key={status}
              status={status}
              active={filter === status}
              onClick={() => setFilter(status)}
            />
          ))}
        </div>

        <div className="rounded-xl border border-card-border bg-card/50 px-4 py-3">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <p className="text-xs leading-relaxed text-muted-foreground">
              Actions are generated from current Insights rules. Each action uses a stable
              insight ID, so changing status does not create duplicate actions on refresh.
            </p>
          </div>
        </div>

        {dataState === "loading" ? (
          <div className="grid gap-4 lg:grid-cols-2">
            {Array.from({ length: 4 }).map((_, index) => (
              <div
                key={index}
                className="h-72 animate-pulse rounded-2xl border border-card-border bg-card"
              />
            ))}
          </div>
        ) : dataState !== "settled" ? (
          /* `EmptyState` below branches on `hasData` to tell a new business
             from a quiet one — and both of its sentences are claims about the
             business, reached from arrays that are empty for a third reason
             entirely. */
          <div className="rounded-2xl border border-card-border bg-card p-10 text-center text-sm text-[color:var(--pl-amber)]">
            {figureStateSentence(dataState, "your action plan")}
          </div>
        ) : actions.length === 0 ? (
          <EmptyState hasData={hasData} />
        ) : filteredActions.length === 0 ? (
          <div className="rounded-2xl border border-card-border bg-card p-10 text-center text-sm text-muted-foreground">
            No actions in this status.
          </div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {filteredActions.map((action) => (
              <ActionCard
                key={action.id}
                action={action}
                onStatusChange={handleStatusChange}
              />
            ))}
          </div>
        )}
      </div>
    </>
  );
}
