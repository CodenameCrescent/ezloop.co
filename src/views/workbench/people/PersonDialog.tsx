import { AlertTriangle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { formatCents } from "@/lib/money";
import { type PersonDialogProps, usePersonDialogLogic, Field } from "./PersonDialog.parts/UsePersonDialogLogic";
export type { PersonCreateBody, SetupPayload } from "./PersonDialog.parts/UsePersonDialogLogic";


// ── Add / edit person dialog ──────────────────────────────────────────────────
export function PersonDialog({
  open,
  editing,
  kind,
  candidates,
  moduleOn,
  symbol,
  onOpenExisting,
  saving,
  onOpenChange,
  onSubmit,
}: PersonDialogProps) {
  const {
    displayName,
    setDisplayName,
    company,
    setCompany,
    email,
    setEmail,
    phone,
    setPhone,
    notes,
    setNotes,
    archived,
    matches,
    offersSetup,
    setupOpen,
    setSetupOpen,
    pay,
    suggestedOverhead,
    setPay,
    terms,
    setTerms,
    submit,
  } = usePersonDialogLogic({ open, editing, kind, candidates, moduleOn, onSubmit });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit person" : `Add ${kind}`}</DialogTitle>
          <DialogDescription>People link to the ledger so lifetime value and history stay accurate.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name">
            <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="e.g. Ayesha Khan" autoFocus />
          </Field>
          <Field label="Company">
            <Input value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Optional" />
          </Field>
          <Field label="Email">
            <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Optional" />
          </Field>
          <Field label="Phone">
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Optional" />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Notes">
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" rows={2} />
            </Field>
          </div>

          {archived.matches.length > 0 && (
            <div className="rounded-lg border border-card-border bg-muted/30 p-3 sm:col-span-2">
              <p className="text-xs font-medium">
                {archived.matches.length === 1 ? "You archived this one." : "You archived these."}
              </p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                Adding a new record leaves their history where it is. Restoring brings the record back with everything
                already on it.
              </p>
              <div className="mt-2 space-y-1">
                {archived.matches.slice(0, 4).map((m) => (
                  <div key={m.person.id} className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <span className="min-w-0">
                      <span className="font-medium">{m.person.displayName}</span>
                      <span className="ml-1.5 text-muted-foreground">{m.reason}</span>
                      {m.person.metrics.lifetimeNetRevenueCents > 0 && (
                        <span className="ml-1.5 tabular-nums text-muted-foreground">
                          · {formatCents(m.person.metrics.lifetimeNetRevenueCents)} so far
                        </span>
                      )}
                    </span>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-6 shrink-0 px-2 text-[11px]"
                      disabled={archived.restoring}
                      onClick={() => archived.restore(m.person.id, m.person.displayName)}
                    >
                      Restore
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {matches.length > 0 && (
            <div className="rounded-lg bg-[color:var(--pl-amber-tint)] p-3 sm:col-span-2">
              <div className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[color:var(--pl-amber)]" />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium">
                    You may already have {matches.length === 1 ? "this person" : "one of these"}.
                  </p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    Adding a second record splits their history — lifetime value and past orders stay on the old one.
                  </p>
                  <div className="mt-2 space-y-1">
                    {matches.map((m) => (
                      <div key={m.person.id} className="flex flex-wrap items-center justify-between gap-2 text-xs">
                        <span className="min-w-0">
                          <span className="font-medium">{m.person.displayName}</span>
                          <span className="ml-1.5 text-muted-foreground">{m.reason}</span>
                          {m.person.metrics.lifetimeNetRevenueCents > 0 && (
                            <span className="ml-1.5 tabular-nums text-muted-foreground">
                              · {formatCents(m.person.metrics.lifetimeNetRevenueCents)} so far
                            </span>
                          )}
                        </span>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-6 shrink-0 px-2 text-[11px]"
                          onClick={() => onOpenExisting(m.person.id)}
                        >
                          Open this one
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {offersSetup && (
            <div className="rounded-lg border border-card-border p-3 sm:col-span-2">
              {!setupOpen ? (
                <button
                  type="button"
                  className="flex w-full items-center justify-between text-left"
                  onClick={() => {
                    setSetupOpen(true);
                    if (kind === "employee" && !pay.overhead && suggestedOverhead != null) {
                      setPay((s) => ({ ...s, overhead: String(suggestedOverhead / 100) }));
                    }
                  }}
                >
                  <span className="text-xs font-medium">
                    {kind === "customer" ? "Also set up their agreed terms" : "Also record what they're paid"}
                  </span>
                  <span className="text-xs text-muted-foreground">Optional · add</span>
                </button>
              ) : kind === "customer" ? (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-muted-foreground">Agreed terms</span>
                    <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px]" onClick={() => setSetupOpen(false)}>
                      Skip
                    </Button>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    What they agreed to pay, and how long it should take. This is what makes them a client — without it
                    they are a customer with orders and nothing to judge them against.
                  </p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <div>
                      <Label className="text-xs">Status</Label>
                      <Select value={terms.status} onValueChange={(v) => setTerms((s) => ({ ...s, status: v }))}>
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="active">Active</SelectItem>
                          <SelectItem value="completed">Finished</SelectItem>
                          <SelectItem value="churned">Churned</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div />
                    <div>
                      <Label className="text-xs">Agreed amount ({symbol})</Label>
                      <div className="flex gap-1">
                        <Input
                          className="h-8 text-xs"
                          type="number"
                          placeholder="Optional"
                          value={terms.amount}
                          onChange={(e) => setTerms((s) => ({ ...s, amount: e.target.value }))}
                        />
                        <Select value={terms.amountPeriod} onValueChange={(v) => setTerms((s) => ({ ...s, amountPeriod: v }))}>
                          <SelectTrigger className="h-8 w-28 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="total">in total</SelectItem>
                            <SelectItem value="monthly">a month</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div>
                      <Label className="text-xs">Agreed hours</Label>
                      <div className="flex gap-1">
                        <Input
                          className="h-8 text-xs"
                          placeholder="Optional"
                          value={terms.hours}
                          onChange={(e) => setTerms((s) => ({ ...s, hours: e.target.value }))}
                        />
                        <Select value={terms.hoursPeriod} onValueChange={(v) => setTerms((s) => ({ ...s, hoursPeriod: v }))}>
                          <SelectTrigger className="h-8 w-28 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="total">in total</SelectItem>
                            <SelectItem value="monthly">a month</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-muted-foreground">What their time costs</span>
                    <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px]" onClick={() => setSetupOpen(false)}>
                      Skip
                    </Button>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    Left blank, their hours cost nothing — and every job they touch looks more profitable than it is.
                  </p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <div>
                      <Label className="text-xs">Paid as</Label>
                      <Select value={pay.costType} onValueChange={(v) => setPay((s) => ({ ...s, costType: v }))}>
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="salaried">Salaried</SelectItem>
                          <SelectItem value="hourly">Hourly</SelectItem>
                          <SelectItem value="contractor">Contractor</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-xs">
                        {pay.costType === "salaried" ? `Monthly pay (${symbol})` : `Hourly rate (${symbol})`}
                      </Label>
                      {pay.costType === "salaried" ? (
                        <Input
                          className="h-8 text-xs"
                          type="number"
                          value={pay.monthly}
                          onChange={(e) => setPay((s) => ({ ...s, monthly: e.target.value }))}
                        />
                      ) : (
                        <Input
                          className="h-8 text-xs"
                          type="number"
                          value={pay.hourly}
                          onChange={(e) => setPay((s) => ({ ...s, hourly: e.target.value }))}
                        />
                      )}
                    </div>
                    <div>
                      <Label className="text-xs">Overhead share ({symbol}/month)</Label>
                      <Input
                        className="h-8 text-xs"
                        type="number"
                        value={pay.overhead}
                        onChange={(e) => setPay((s) => ({ ...s, overhead: e.target.value }))}
                      />
                      {suggestedOverhead != null && (
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          Suggested from your fixed costs: {formatCents(suggestedOverhead, symbol)} a month each.
                        </p>
                      )}
                    </div>
                    <div>
                      <Label className="text-xs">Billable hours a month</Label>
                      <Input
                        className="h-8 text-xs"
                        value={pay.target}
                        onChange={(e) => setPay((s) => ({ ...s, target: e.target.value }))}
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={saving}>
            {saving ? "Saving…" : editing ? "Save" : "Add"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
