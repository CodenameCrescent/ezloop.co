import { useState } from "react";
import { Clock, Check, X, Pencil } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiErrorMessage, useConfirmPending, useEditPendingAmount, useSkipPending, useTransactions } from "@/api/hooks";
import { formatCents, MoneyInputError, readMoney } from "@/lib/money";

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString();
}

/**
 * The confirm_first pending queue: recurring posts waiting for approval.
 * Renders nothing when the queue is empty, so it can be dropped onto the
 * Dashboard and the Transactions page unconditionally. Compact mode is the
 * Dashboard card; the full mode is a standalone panel.
 */
export function PendingRecurringQueue({ compact }: { compact?: boolean }) {
  const pending = useTransactions({ status: "pending", origin: "recurring_engine", limit: 50 });
  const confirmM = useConfirmPending();
  const skipM = useSkipPending();
  const editM = useEditPendingAmount();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editRupees, setEditRupees] = useState("");

  const items = pending.data?.items ?? [];
  if (items.length === 0) return null;

  function confirm(id: string) {
    confirmM.mutate(id, {
      onSuccess: () => toast.success("Posted to the ledger"),
      onError: (e) => toast.error(apiErrorMessage(e, "Could not confirm")),
    });
  }
  function skip(id: string) {
    skipM.mutate(id, {
      onSuccess: () => toast.success("Skipped"),
      onError: (e) => toast.error(apiErrorMessage(e, "Could not skip")),
    });
  }
  function saveEdit(id: string) {
    // Name the box rather than letting the server answer "Invalid request".
    let amountCents: number;
    try {
      amountCents = readMoney("Amount", editRupees);
    } catch (err) {
      if (err instanceof MoneyInputError) { toast.error(err.message); return; }
      throw err;
    }
    editM.mutate(
      { id, amountCents },
      {
        onSuccess: () => {
          toast.success("Amount updated");
          setEditingId(null);
        },
        onError: (e) => toast.error(apiErrorMessage(e, "Could not update")),
      },
    );
  }

  // An ordinary card, not an amber slab. A whole tinted panel for a routine
  // to-do shouted louder than the profit figure above it.
  return (
    <section className="pl-surface overflow-hidden">
      <div className="flex items-center gap-2 px-5 pb-2 pt-4">
        <Clock className="h-4 w-4 text-[color:var(--pl-ink-2)]" />
        <h2 className="t-section text-[color:var(--pl-ink)]">
          {items.length} recurring {items.length === 1 ? "charge" : "charges"} waiting for you
        </h2>
      </div>
      <div className="divide-y divide-[color:var(--pl-hairline)]">
        {items.map((t) => (
          <div key={t.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 font-medium text-foreground">
                <span className={`h-1.5 w-1.5 rounded-full ${t.direction === "in" ? "bg-[color:var(--pl-green-solid)]" : "bg-[color:var(--pl-red-solid)]"}`} />
                {t.displayName}
              </div>
              <div className="text-xs text-muted-foreground">
                Scheduled {fmtDate(t.occurredAt)}
                {t.personName ? ` · ${t.personName}` : ""} · {t.sourceName}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {editingId === t.id ? (
                <>
                  <Input
                    type="number"
                    value={editRupees}
                    onChange={(e) => setEditRupees(e.target.value)}
                    className="h-8 w-28"
                    autoFocus
                  />
                  <Button size="sm" onClick={() => saveEdit(t.id)} disabled={editM.isPending || !editRupees.trim()}>
                    Save
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>
                    Cancel
                  </Button>
                </>
              ) : (
                <>
                  <span className="tabular-nums font-semibold text-foreground">{formatCents(t.amountCents)}</span>
                  {!compact && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="gap-1.5"
                      onClick={() => {
                        setEditingId(t.id);
                        setEditRupees(String(t.amountCents / 100));
                      }}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                      Edit
                    </Button>
                  )}
                  <Button size="sm" variant="outline" className="gap-1.5" onClick={() => skip(t.id)} disabled={skipM.isPending}>
                    <X className="h-3.5 w-3.5" />
                    Skip
                  </Button>
                  <Button size="sm" className="gap-1.5" onClick={() => confirm(t.id)} disabled={confirmM.isPending}>
                    <Check className="h-3.5 w-3.5" />
                    Confirm
                  </Button>
                </>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
