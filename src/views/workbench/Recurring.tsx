import { useState } from "react";
import { Plus, RefreshCw, Repeat2, Pause, Play, X, Pencil } from "lucide-react";
import { toast } from "sonner";
import { TopBar } from "@/components/TopBar";
import { DataTable, EmptyState, type Column } from "@/components/DataTable";
import { Tag, type TagTone } from "@/components/Tag";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatCents, MoneyInputError, readMoney } from "@/lib/money";
import { figureState, FIGURE_STATE_COPY } from "@/lib/figureState";
import { apiErrorMessage, useEditScheduleFuture, useRecurringSchedules, useSetScheduleStatus } from "@/api/hooks";
import type { RecurringScheduleShape } from "@workspace/api-contract";
import { type Interval, NewRecurringDialog, Fld } from "./Recurring.parts/NewRecurringDialog";

function fmtDate(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString() : "—";
}

const STATUS_TONE: Record<RecurringScheduleShape["status"], TagTone> = {
  active: "green",
  paused: "amber",
  canceled: "neutral",
  completed: "neutral",
};

export default function WorkbenchRecurring() {
  const schedulesQuery = useRecurringSchedules();
  const setStatusM = useSetScheduleStatus();
  const editM = useEditScheduleFuture();
  const [addOpen, setAddOpen] = useState(false);
  const [editSchedule, setEditSchedule] = useState<RecurringScheduleShape | null>(null);

  const schedules = schedulesQuery.data ?? [];
  /*
   * "No recurring schedules yet" is a statement about the business, and it was
   * reached from `!isLoading` — false for a request that failed and for one
   * that stopped dead. An owner whose rent and payroll post automatically was
   * being told nothing repeats, on the one screen whose job is to prove that
   * money is still being posted without them.
   */
  const schedulesState = figureState(schedulesQuery, schedulesQuery.data != null);

  const scheduleColumns: Column<RecurringScheduleShape>[] = [
    {
      key: "what",
      header: "What",
      render: (s) => (
        <span>
          <span className="flex items-center gap-2 font-semibold text-[color:var(--pl-ink)]">
            {/* Direction as a dot AND the amount's own sign below — money is
                never colour alone. */}
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{ background: s.direction === "in" ? "var(--pl-green-solid)" : "var(--pl-red-solid)" }}
            />
            {s.itemName}
          </span>
          {s.personName && <span className="t-micro block">{s.personName}</span>}
        </span>
      ),
    },
    {
      key: "often",
      header: "How often",
      hideOnMobile: true,
      render: (s) => (
        <span className="t-secondary">
          {s.intervalCount > 1 ? `Every ${s.intervalCount} ` : ""}
          {intervalNoun(s.interval, s.intervalCount)}
          {s.anchorDay ? ` · day ${s.anchorDay}` : ""}
        </span>
      ),
    },
    {
      key: "amount",
      header: "Amount",
      align: "right",
      bar: (s) => s.amountCents,
      render: (s) =>
        s.amountCents == null ? (
          <span className="t-secondary">item default</span>
        ) : (
          <span className="t-num font-semibold">
            {s.direction === "in" ? "+" : "−"}
            {formatCents(Math.abs(s.amountCents))}
          </span>
        ),
    },
    { key: "next", header: "Next run", hideOnMobile: true, render: (s) => <span className="t-secondary">{s.status === "active" ? fmtDate(s.nextRunAt) : "—"}</span> },
    { key: "last", header: "Last posted", hideOnMobile: true, render: (s) => <span className="t-secondary">{fmtDate(s.lastPostedAt)}</span> },
    { key: "posting", header: "Posting", hideOnMobile: true, render: (s) => <Tag>{s.postingMode === "auto_post" ? "Auto-post" : "Confirm first"}</Tag> },
    { key: "status", header: "Status", render: (s) => <Tag tone={STATUS_TONE[s.status]}>{s.status}</Tag> },
    {
      key: "actions",
      header: "",
      align: "right",
      render: (s) => (
        <span className="flex items-center justify-end gap-1">
          {s.status === "active" && (
            <IconBtn title="Pause" onClick={() => setStatus(s, "paused")}>
              <Pause className="h-3.5 w-3.5" />
            </IconBtn>
          )}
          {s.status === "paused" && (
            <IconBtn title="Resume" onClick={() => setStatus(s, "active")}>
              <Play className="h-3.5 w-3.5" />
            </IconBtn>
          )}
          {(s.status === "active" || s.status === "paused") && (
            <>
              <IconBtn title="Edit amount (this and future)" onClick={() => setEditSchedule(s)}>
                <Pencil className="h-3.5 w-3.5" />
              </IconBtn>
              <IconBtn title="Cancel" onClick={() => setStatus(s, "canceled")}>
                <X className="h-3.5 w-3.5" />
              </IconBtn>
            </>
          )}
        </span>
      ),
    },
  ];

  function setStatus(s: RecurringScheduleShape, status: "active" | "paused" | "canceled") {
    setStatusM.mutate(
      { id: s.id, status },
      {
        onSuccess: () => toast.success(status === "canceled" ? "Schedule canceled" : status === "paused" ? "Schedule paused" : "Schedule resumed"),
        onError: (e) => toast.error(apiErrorMessage(e, "Could not update schedule")),
      },
    );
  }

  return (
    <>
      <TopBar
        title="Recurring"
        subtitle="Subscriptions, rent, payroll, and any repeating money — posted automatically by the engine."
        primaryAction={
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" className="gap-2" onClick={() => setAddOpen(true)}>
              <Plus className="h-4 w-4" />
              New recurring
            </Button>
            <Button variant="outline" size="sm" className="gap-2" onClick={() => schedulesQuery.refetch()}>
              <RefreshCw className="h-4 w-4" />
              Refresh
            </Button>
          </div>
        }
      />

      <div className="app-page-shell">
        <section className="pl-glass">
          <div className="border-b border-card-border px-5 py-4">
            <h2 className="flex items-center gap-2 text-base font-bold text-foreground">
              <Repeat2 className="h-4 w-4 text-primary" />
              Recurring schedules
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              The engine posts each schedule on its next run date. Confirm-first schedules land in the pending queue instead of posting straight away.
            </p>
          </div>
          <div className="app-scrollbar overflow-x-auto">
            <DataTable<RecurringScheduleShape>
              columns={scheduleColumns}
              rows={schedules}
              getRowKey={(s) => s.id}
              empty={
                schedulesState === "loading" ? undefined : schedulesState !== "settled" ? (
                  /* No "Try again" button here: the page's own Refresh in the
                     header already is one, and two controls for one action on
                     one screen is the sprawl the header was meant to end. */
                  <EmptyState
                    title={
                      schedulesState === "offline"
                        ? FIGURE_STATE_COPY.offline.why
                        : "Couldn't load your schedules."
                    }
                    hint={
                      schedulesState === "offline"
                        ? "Your schedules will appear when you're back online."
                        : `${FIGURE_STATE_COPY.failed.why} Use Refresh above to try again.`
                    }
                  />
                ) : (
                  <EmptyState
                    title="No recurring schedules yet"
                    hint="Create one to automate money that repeats — rent, retainers, subscriptions."
                  />
                )
              }
            />
          </div>
        </section>
      </div>

      <NewRecurringDialog open={addOpen} onOpenChange={setAddOpen} />

      {editSchedule && (
        <EditAmountDialog
          schedule={editSchedule}
          saving={editM.isPending}
          onClose={() => setEditSchedule(null)}
          onSave={(amountCents) =>
            editM.mutate(
              { id: editSchedule.id, amountCents },
              {
                onSuccess: () => {
                  toast.success("Updated — this and future occurrences use the new amount");
                  setEditSchedule(null);
                },
                onError: (e) => toast.error(apiErrorMessage(e, "Could not update")),
              },
            )
          }
        />
      )}
    </>
  );
}

function intervalNoun(interval: Interval, count: number): string {
  const nouns: Record<Interval, string> = { daily: "day", weekly: "week", monthly: "month", quarterly: "quarter", yearly: "year" };
  const n = nouns[interval];
  return count > 1 ? `${n}s` : n;
}

function IconBtn({ title, onClick, children }: { title: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-muted hover:text-foreground"
    >
      {children}
    </button>
  );
}

function EditAmountDialog({
  schedule,
  saving,
  onClose,
  onSave,
}: {
  schedule: RecurringScheduleShape;
  saving: boolean;
  onClose: () => void;
  onSave: (amountCents: number) => void;
}) {
  const [rupees, setRupees] = useState(schedule.amountCents != null ? String(schedule.amountCents / 100) : "");

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit amount</DialogTitle>
          <DialogDescription>
            This closes the current schedule at its last posted date and starts a new one — history stays untouched, only this and future occurrences change.
          </DialogDescription>
        </DialogHeader>
        <Fld label="New amount">
          <Input type="number" value={rupees} onChange={(e) => setRupees(e.target.value)} autoFocus />
        </Fld>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => { try { onSave(readMoney("Amount", rupees)); } catch (err) { if (err instanceof MoneyInputError) toast.error(err.message); else throw err; } }} disabled={saving || !rupees.trim()}>
            {saving ? "Saving…" : "Save this & future"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
