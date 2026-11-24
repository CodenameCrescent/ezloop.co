import { toast } from "sonner";
import { Plus, Trash2, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiErrorMessage } from "@/api/hooks";
import { formatCents } from "@/lib/money";
import { todayInputValue } from "@/lib/period";
import { emptyLine, OTHER_CURRENCY, type QuickAddProps } from "./QuickAdd.parts/DraftFromTransaction";
import { useQuickAddLogic } from "./QuickAdd.parts/UseQuickAddLogic";
import { CurrencyPicker } from "./QuickAdd.parts/CurrencyPicker";
import { QuickAddLineRow, AdvancedFields } from "./QuickAdd.parts/QuickAddLineRow";
export { draftFromTransaction } from "./QuickAdd.parts/DraftFromTransaction";
export type { QuickAddDraft } from "./QuickAdd.parts/DraftFromTransaction";


export function QuickAdd({ open, onOpenChange, initial }: QuickAddProps) {
  const {
    reset,
    templates,
    activeTemplateId,
    setActiveTemplateId,
    applyDraft,
    deleteTemplateM,
    f,
    typedIn,
    chooseCurrency,
    fxRate,
    setFxRate,
    fxLookup,
    suggestedRate,
    preview,
    lines,
    revCatalog,
    expCatalog,
    setLineDirection,
    setLines,
    updateLine,
    selectItem,
    moneySymbol,
    showAdvanced,
    categories,
    hasRevenue,
    paid,
    targetGroups,
    updateShare,
    removeShare,
    addShare,
    setShowAdvanced,
    date,
    setDate,
    sourceId,
    setSourceId,
    sources,
    customer,
    setCustomer,
    people,
    archivedMatches,
    reference,
    setReference,
    notes,
    setNotes,
    orderDiscountRupees,
    setOrderDiscountRupees,
    taxPaidRupees,
    setTaxPaidRupees,
    taxReclaimable,
    setTaxReclaimable,
    setPaid,
    dueDate,
    setDueDate,
    paidDate,
    setPaidDate,
    savingTemplate,
    templateName,
    setTemplateName,
    saveAsTemplate,
    createTemplateM,
    setSavingTemplate,
    body,
    save,
    createM,
    moneyProblem,
  } = useQuickAddLogic({ open, onOpenChange, initial });

  return (
    <Dialog open={open} onOpenChange={(v) => (v ? onOpenChange(true) : (reset(), onOpenChange(false)))}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Quick add</DialogTitle>
        </DialogHeader>

        {(templates.data?.items.length ?? 0) > 0 && (
          <div className="flex items-center gap-2">
            <Select
              value={activeTemplateId || "__none__"}
              onValueChange={(v) => {
                if (v === "__none__") { setActiveTemplateId(""); return; }
                const tmpl = templates.data?.items.find((t) => t.id === v);
                if (tmpl) { setActiveTemplateId(v); applyDraft(tmpl.payload); }
              }}
            >
              <SelectTrigger className="flex-1"><SelectValue placeholder="Start from template…" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">Start from template…</SelectItem>
                {(templates.data?.items ?? []).map((t) => (
                  <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {activeTemplateId && (
              <Button
                variant="ghost"
                size="icon"
                title="Delete this template"
                onClick={() =>
                  deleteTemplateM.mutate(activeTemplateId, {
                    onSuccess: () => { toast.success("Template deleted"); setActiveTemplateId(""); },
                    onError: (err) => toast.error(apiErrorMessage(err, "Could not delete template")),
                  })
                }
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </div>
        )}

        <div className="space-y-3">
          {f.currency !== OTHER_CURRENCY && (
            <CurrencyPicker f={f} typedIn={typedIn} chooseCurrency={chooseCurrency} fxRate={fxRate} setFxRate={setFxRate} fxLookup={fxLookup} suggestedRate={suggestedRate} preview={preview} />
          )}

          {lines.map((line) => <QuickAddLineRow key={line.key} line={line} revCatalog={revCatalog} expCatalog={expCatalog} typedIn={typedIn} setLineDirection={setLineDirection} lines={lines} setLines={setLines} updateLine={updateLine} selectItem={selectItem} moneySymbol={moneySymbol} showAdvanced={showAdvanced} categories={categories} hasRevenue={hasRevenue} paid={paid} targetGroups={targetGroups} updateShare={updateShare} removeShare={removeShare} addShare={addShare} />)}

          <div className="flex items-center justify-between">
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setLines((p) => [...p, emptyLine("in")])} className="gap-1">
                <Plus className="h-4 w-4" /> Money in
              </Button>
              <Button variant="outline" size="sm" onClick={() => setLines((p) => [...p, emptyLine("out")])} className="gap-1">
                <Plus className="h-4 w-4" /> Cost / expense
              </Button>
            </div>
            <button className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground" onClick={() => setShowAdvanced((s) => !s)}>
              More <ChevronDown className={`h-3 w-3 transition-transform ${showAdvanced ? "rotate-180" : ""}`} />
            </button>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs text-muted-foreground">Date it happened</Label>
              <Input type="date" max={todayInputValue()} value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Added from</Label>
              <Select value={sourceId || "__default__"} onValueChange={(v) => setSourceId(v === "__default__" ? "" : v)}>
                <SelectTrigger><SelectValue placeholder="Manual" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__default__">Manual</SelectItem>
                  {(sources.data ?? []).map((s) => (
                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {hasRevenue && (
            <div>
              <Label className="text-xs text-muted-foreground">Customer (optional)</Label>
              <Input list="qa-people" placeholder="Name" value={customer} onChange={(e) => setCustomer(e.target.value)} />
              <datalist id="qa-people">{(people.data?.items ?? []).map((p) => <option key={p.id} value={p.displayName} />)}</datalist>
              {/* The picker cannot offer an archived person, but this box takes
                  free text — and that name still resolves to them on save. */}
              {archivedMatches.matches.map((m) => (
                <div key={m.person.id} className="mt-1.5 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-[color:var(--pl-amber-tint)] px-2.5 py-1.5">
                  <span className="min-w-0 text-[11px] text-muted-foreground">
                    <span className="font-medium text-foreground">{m.person.displayName}</span> is archived. This sale
                    still goes on their record — restore them to see it.
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-6 shrink-0 px-2 text-[11px]"
                    disabled={archivedMatches.restoring}
                    onClick={() => archivedMatches.restore(m.person.id, m.person.displayName)}
                  >
                    Restore
                  </Button>
                </div>
              ))}
            </div>
          )}

          {showAdvanced && (
            <AdvancedFields reference={reference} setReference={setReference} notes={notes} setNotes={setNotes} hasRevenue={hasRevenue} orderDiscountRupees={orderDiscountRupees} setOrderDiscountRupees={setOrderDiscountRupees} taxPaidRupees={taxPaidRupees} setTaxPaidRupees={setTaxPaidRupees} taxReclaimable={taxReclaimable} setTaxReclaimable={setTaxReclaimable} />
          )}

          <div className="space-y-3 rounded-lg border border-card-border p-3">
            <div className="flex items-center justify-between">
              <div>
                <Label className="text-sm">Has it been paid?</Label>
                <p className="text-[11px] text-muted-foreground">
                  {paid
                    ? "Money has already changed hands."
                    : "Still counts toward profit — it just hasn't reached your cash yet."}
                </p>
              </div>
              <Switch checked={paid} onCheckedChange={setPaid} />
            </div>
            {!paid && (
              <div>
                <Label className="text-xs text-muted-foreground">When is it due?</Label>
                <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Optional. With a date it can show as late; without one it just shows as
                  outstanding — which is the truth when nothing was agreed.
                </p>
              </div>
            )}
            {paid && (
              <div>
                <Label className="text-xs text-muted-foreground">Date it was paid</Label>
                <Input type="date" max={todayInputValue()} value={paidDate} onChange={(e) => setPaidDate(e.target.value)} />
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Only change this if the money moved on a different day from the one above.
                </p>
              </div>
            )}
          </div>

          {/* Live preview — server-computed, identical to the saved drawer. */}
          {preview && (
            <div className="space-y-1 rounded-lg bg-muted/50 p-3 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">Net revenue</span><span className="tabular-nums">{formatCents(preview.netRevenueCents)}</span></div>
              {preview.costBreakdown.map((c) => (
                <div key={c.name} className="flex justify-between text-xs text-muted-foreground">
                  <span>· {c.name}{c.kind === "fee" ? " (fee)" : ""}</span><span className="tabular-nums">−{formatCents(c.totalCents)}</span>
                </div>
              ))}
              {hasRevenue && (
                <div className="flex justify-between border-t border-card-border pt-1 font-semibold">
                  <span>Contribution profit</span><span className="tabular-nums">{formatCents(preview.contributionProfitCents)}</span>
                </div>
              )}
            </div>
          )}
        </div>

        {savingTemplate && (
          <div className="flex items-center gap-2">
            <Input placeholder="Template name (e.g. Weekly client invoice)" value={templateName} onChange={(e) => setTemplateName(e.target.value)} />
            <Button size="sm" onClick={saveAsTemplate} disabled={createTemplateM.isPending}>Save</Button>
            <Button size="sm" variant="ghost" onClick={() => { setSavingTemplate(false); setTemplateName(""); }}>Cancel</Button>
          </div>
        )}

        <DialogFooter className="gap-2 sm:justify-between">
          {!savingTemplate ? (
            <button className="text-xs text-muted-foreground hover:text-foreground" onClick={() => setSavingTemplate(true)} disabled={!body}>
              Save as template
            </button>
          ) : <span />}
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => { reset(); onOpenChange(false); }}>Cancel</Button>
            {/* Still clickable when a money box is wrong — pressing it says
                which one, where a greyed-out button would say nothing. */}
            <Button onClick={save} disabled={createM.isPending || (!body && !moneyProblem)}>{createM.isPending ? "Saving…" : "Record"}</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
