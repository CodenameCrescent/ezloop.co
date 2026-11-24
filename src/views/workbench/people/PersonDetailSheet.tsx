import { useState } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { formatCents } from "@/lib/money";
import { figureState, figureStateSentence } from "@/lib/figureState";
import { ClientTerms, PayRate } from "@/components/PersonTerms";
import { useStore } from "@/lib/store";
import { recurrenceLabel } from "@workspace/domain";
import { apiErrorMessage, usePersonDetail, useUpdatePerson } from "@/api/hooks";
import type { PersonShape } from "@workspace/api-contract";
import { fmtDate } from "./columns";

// ── Person detail sheet ───────────────────────────────────────────────────────
export function PersonDetailSheet({
  id,
  onClose,
  onEdit,
}: {
  id: string | null;
  onClose: () => void;
  onEdit: (p: PersonShape) => void;
}) {
  const detail = usePersonDetail(id);
  const person = detail.data?.person;
  /*
   * "Not found" is a verdict on the record, and it was the fallback for every
   * state that was not `isLoading` — which a failed and a paused request both
   * leave false. So a customer who exists, whose row the owner just clicked,
   * was reported as missing from their own books because one request did not
   * land. Of everything this pass touched, this is the claim furthest from the
   * truth: the other pages understate a business, this one denies a person in
   * it exists.
   */
  const detailState = figureState(detail, detail.data != null);
  const transactions = detail.data?.transactions ?? [];
  const commitments = detail.data?.commitments ?? [];
  const statusM = useUpdatePerson();
  /** Held while the owner reads what archiving will NOT stop. */
  const [confirming, setConfirming] = useState(false);

  /**
   * The panel stays OPEN after archiving, showing the archived state and a
   * Restore beside it. Closing on archive would be tidier and worse: the row
   * behind it has just disappeared from the list, so an accidental archive
   * would leave nothing to undo it from until the toggle is found.
   */
  function setStatus(p: PersonShape, status: "active" | "archived") {
    statusM.mutate(
      { id: p.id, body: { status } },
      {
        onSuccess: () => {
          setConfirming(false);
          toast.success(
            status === "archived"
              ? `${p.displayName} archived — out of your pickers, still on every past transaction`
              : `${p.displayName} is back in your lists`,
          );
        },
        onError: (e) => toast.error(apiErrorMessage(e, "Could not change that")),
      },
    );
  }

  /**
   * Archiving warns, and then does what was asked.
   *
   * The engine reads the schedule, not the person, so archiving somebody with a
   * live subscription is a perfectly reasonable thing to want and a surprising
   * thing to discover later. Naming what will keep posting is the whole fix —
   * blocking it would make the owner hunt for a schedule screen to satisfy a
   * rule the app invented.
   */
  function archive(p: PersonShape) {
    if (commitments.length > 0) setConfirming(true);
    else setStatus(p, "archived");
  }
  // The client/team sections only exist when that module is on — the same gate
  // the sidebar uses, applied to the sections rather than to a whole screen.
  const { settings } = useStore();
  const clientProfitabilityOn = settings.features?.client_profitability ?? false;
  const symbol = settings.currencySymbol ?? "Rs";

  return (
    <Sheet open={!!id} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        {!person ? (
          <>
            {/* A panel with no title is an unnamed dialog to a screen reader, and
                this branch is on screen for the whole of every load. The title
                tracks the state for the same reason the body does — a reader
                who cannot see the panel gets told "not found" or "couldn't
                load" exactly as truthfully as one who can. */}
            <SheetTitle className="sr-only">
              {detailState === "loading"
                ? "Loading person"
                : detailState === "settled"
                  ? "Person not found"
                  : "Couldn't load this person"}
            </SheetTitle>
            <div className="py-12 text-center text-muted-foreground">
              {detailState === "loading" ? (
                "Loading…"
              ) : detailState === "settled" ? (
                "Not found"
              ) : (
                <>
                  <p className="text-[color:var(--pl-amber)]">
                    {figureStateSentence(detailState, "this person")}
                  </p>
                  {detailState === "failed" && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="mt-3"
                      onClick={() => detail.refetch()}
                    >
                      Try again
                    </Button>
                  )}
                </>
              )}
            </div>
          </>
        ) : (
          <>
            <SheetHeader>
              <SheetTitle className="flex items-center gap-2">
                {person.displayName}
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium capitalize text-muted-foreground">{person.kind}</span>
                {person.status === "archived" && (
                  <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">archived</span>
                )}
              </SheetTitle>
              <SheetDescription>
                {[person.email, person.phone, person.company].filter(Boolean).join(" · ") || "No contact details"}
              </SheetDescription>
            </SheetHeader>

            {/* What used to be the Clients and Team screens, shown on the
                person they were always describing. Only when the module is on. */}
            {clientProfitabilityOn && person.kind === "customer" && (
              <ClientTerms personId={person.id} symbol={symbol} />
            )}
            {clientProfitabilityOn && person.kind === "employee" && (
              <PayRate personId={person.id} symbol={symbol} />
            )}

            <div className="mt-4 grid grid-cols-2 gap-3">
              {person.kind === "vendor" ? (
                <>
                  <Stat label="Total spend" value={formatCents(person.metrics.vendorSpendCents)} />
                  <Stat label="Bills" value={String(person.metrics.orderCount)} />
                </>
              ) : (
                <>
                  <Stat label="Lifetime revenue" value={formatCents(person.metrics.lifetimeNetRevenueCents)} />
                  <Stat label="Lifetime contribution (true LTV)" value={formatCents(person.metrics.lifetimeContributionCents)} />
                  <Stat label="Orders" value={String(person.metrics.orderCount)} />
                  <Stat label="Active subscriptions" value={String(person.metrics.activeSubscriptions)} />
                </>
              )}
              <Stat label="Cohort" value={person.cohortMonth ?? "—"} />
              <Stat label="First activity" value={fmtDate(person.metrics.firstActivityAt)} />
            </div>

            {person.notes && (
              <div className="mt-4 rounded-xl border border-card-border bg-muted/20 p-3 text-sm text-muted-foreground">{person.notes}</div>
            )}

            {/* Same promise Expenses makes about an archived item, said about a
                person: it takes them out of the pickers and touches nothing that
                already happened. Their transactions, hours and terms all stay. */}
            <div className="mt-5 rounded-lg border border-card-border p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-muted-foreground">
                    {person.status === "archived" ? "Archived" : "Archive"}
                  </div>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    {person.status === "archived"
                      ? "Hidden from pickers. Past transactions are untouched — restore them any time."
                      : "Hide them from pickers without touching past transactions."}
                  </p>
                  {person.status !== "archived" && commitments.length > 0 && (
                    <p className="mt-1 text-[11px] font-medium text-[color:var(--pl-amber)]">
                      {commitments.length === 1 ? "1 live charge" : `${commitments.length} live charges`} would keep
                      posting.
                    </p>
                  )}
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 shrink-0 text-xs"
                  disabled={statusM.isPending}
                  onClick={() => (person.status === "archived" ? setStatus(person, "active") : archive(person))}
                >
                  {person.status === "archived" ? "Restore" : "Archive"}
                </Button>
              </div>
            </div>

            <div className="mt-6">
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-foreground">Transaction history</h3>
                <Button size="sm" variant="outline" onClick={() => onEdit(person)}>
                  Edit
                </Button>
              </div>
              <div className="overflow-hidden rounded-xl border border-card-border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/30 text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 text-left font-semibold">Date</th>
                      <th className="px-3 py-2 text-left font-semibold">Item</th>
                      <th className="px-3 py-2 text-right font-semibold">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-card-border/70">
                    {transactions.length === 0 ? (
                      <tr>
                        <td colSpan={3} className="px-3 py-6 text-center text-muted-foreground">
                          No transactions yet.
                        </td>
                      </tr>
                    ) : (
                      transactions.map((t) => (
                        <tr key={t.id}>
                          <td className="px-3 py-2 text-muted-foreground">{fmtDate(t.occurredAt)}</td>
                          <td className="px-3 py-2">
                            <span className="text-foreground">{t.displayName}</span>
                            {t.origin === "recurring_engine" && (
                              <span className="ml-1.5 rounded bg-[color:var(--pl-orange-tint)] px-1 py-0.5 text-[10px] font-medium text-primary">recurring</span>
                            )}
                          </td>
                          <td className={`px-3 py-2 text-right tabular-nums ${t.direction === "in" ? "text-[color:var(--pl-green)]" : "text-foreground"}`}>
                            {t.direction === "in" ? "" : "−"}
                            {formatCents(t.amountCents)}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
            <Dialog open={confirming} onOpenChange={setConfirming}>
              <DialogContent className="sm:max-w-lg">
                <DialogHeader>
                  <DialogTitle>Archiving won't stop these</DialogTitle>
                  <DialogDescription>
                    {person.displayName} will disappear from your pickers, but these keep posting on their own — they
                    run off the schedule, not the person.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-2">
                  {commitments.map((c) => (
                    <div
                      key={c.scheduleId}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-card-border p-2.5 text-sm"
                    >
                      <div className="min-w-0">
                        <div className="font-medium text-foreground">
                          {c.itemName}
                          <span className="ml-1.5 rounded bg-muted px-1 py-0.5 text-[10px] font-medium text-muted-foreground">
                            {c.kind === "subscription" ? "subscription" : "recurring"}
                          </span>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {recurrenceLabel(c.interval, c.intervalCount)} · next on {fmtDate(c.nextRunAt)}
                        </div>
                      </div>
                      <div className="shrink-0 text-right tabular-nums">
                        <div className={`font-semibold ${c.direction === "in" ? "text-[color:var(--pl-green)]" : "text-foreground"}`}>
                          {c.amountCents == null ? (
                            <span className="text-xs font-normal text-muted-foreground">item price</span>
                          ) : (
                            <>
                              {c.direction === "in" ? "" : "−"}
                              {formatCents(c.amountCents, symbol)}
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  To stop them, pause or cancel each one on the Recurring screen. Archiving is still fine if you'd
                  rather leave them running.
                </p>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setConfirming(false)}>
                    Cancel
                  </Button>
                  <Button disabled={statusM.isPending} onClick={() => setStatus(person, "archived")}>
                    {statusM.isPending ? "Archiving…" : "Archive anyway"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="pl-glass rounded-xl p-3">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-0.5 font-semibold tabular-nums text-foreground">{value}</div>
    </div>
  );
}
