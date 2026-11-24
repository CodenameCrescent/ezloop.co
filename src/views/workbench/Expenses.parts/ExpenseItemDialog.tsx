import { useId, useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { useCategories, usePeople, useCreateExpenseItem, useUpdateExpenseItem, apiErrorMessage } from "@/api/hooks";
import { MoneyInputError, readOptionalMoney } from "@/lib/money";
import { EXPENSE_PURPOSES, COST_NATURES, type ExpensePurpose, type CostNature, defaultNatureFor, EXPENSE_PURPOSE_LABELS, COST_NATURE_LABELS } from "@workspace/domain";
import type { EndpointResponse } from "@workspace/api-contract";
import type { listExpenseItems } from "@workspace/api-contract";

export type Item = EndpointResponse<typeof listExpenseItems>["items"][number];

/**
 * What the money is FOR. Behaviour lives in its own control — an agency
 * retainer is marketing AND stays the same, which one list could never say.
 * The domain owns both vocabularies so the server and this page can't drift.
 */
export const TYPES = EXPENSE_PURPOSES;
export const NATURES = COST_NATURES;
export const BEHAVIORS = ["one_time", "recurring", "usage_based"] as const;

export function ExpenseItemDialog({ open, onOpenChange, editItem, symbol }: { open: boolean; onOpenChange: (v: boolean) => void; editItem: Item | null; symbol: string }) {
  const router = useRouter();
  const navigate = (to: string) => router.push(to);
  const categoryListId = useId();
  const vendorListId = useId();
  const categories = useCategories("expense");
  const vendors = usePeople("vendor");
  const createM = useCreateExpenseItem();
  const updateM = useUpdateExpenseItem();
  const [name, setName] = useState("");
  const [type, setType] = useState<ExpensePurpose>("operational");
  const [costNature, setCostNature] = useState<CostNature>(defaultNatureFor("operational"));
  /**
   * True once the owner has touched the nature control. Until then, picking a
   * purpose moves the nature to that purpose's usual answer; afterwards it
   * never moves on its own, so a deliberate "marketing, stays the same" is not
   * silently undone by re-filing the expense.
   */
  const [natureTouched, setNatureTouched] = useState(false);
  const [behavior, setBehavior] = useState<(typeof BEHAVIORS)[number]>("one_time");
  const [amountRupees, setAmountRupees] = useState("");
  /** What one of it IS. Empty means it is an amount, not a quantity. */
  const [unitLabel, setUnitLabel] = useState("");
  const [vendor, setVendor] = useState("");
  const [category, setCategory] = useState("");
  const [notes, setNotes] = useState("");
  const [archived, setArchived] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (editItem) {
      // A row written before purpose and behaviour were split can still carry
      // one of the old conflated types; land it on a real purpose so saving
      // does not fail on a value the write path no longer accepts.
      const purpose: ExpensePurpose = (EXPENSE_PURPOSES as readonly string[]).includes(editItem.type)
        ? (editItem.type as ExpensePurpose)
        : editItem.type === "fixed"
          ? "operational"
          : "custom";
      setName(editItem.name); setType(purpose); setCostNature(editItem.costNature); setNatureTouched(true);
      setBehavior(editItem.behavior as (typeof BEHAVIORS)[number]);
      setAmountRupees(editItem.defaultAmountCents == null ? "" : String(editItem.defaultAmountCents / 100)); setVendor(editItem.vendorName ?? "");
      setUnitLabel(editItem.unitLabel ?? "");
      setCategory(editItem.categoryName ?? ""); setNotes(editItem.notes ?? ""); setArchived(editItem.status === "archived");
    } else {
      setName(""); setType("operational"); setCostNature(defaultNatureFor("operational")); setNatureTouched(false);
      setBehavior("one_time"); setAmountRupees(""); setVendor("");
      setCategory(""); setNotes(""); setArchived(false);
    }
  }, [open, editItem]);

  function pickType(next: ExpensePurpose) {
    setType(next);
    if (!natureTouched) setCostNature(defaultNatureFor(next));
  }

  function save() {
    // A money box that is not an amount is named here, by the label printed
    // beside it — the server can only answer "Invalid request".
    try {
      buildAndSave();
    } catch (err) {
      if (err instanceof MoneyInputError) { toast.error(err.message); return; }
      throw err;
    }
  }

  function buildAndSave() {
    if (!name.trim()) { toast.error("Name is required"); return; }
    const body = {
      name: name.trim(), type, costNature, behavior,
      defaultAmountCents: readOptionalMoney("Usual amount", amountRupees),
      unitLabel: unitLabel.trim() || null,
      vendorName: vendor.trim() || null,
      categoryName: category.trim() || null,
      notes: notes.trim() || null,
      ...(editItem ? { status: archived ? ("archived" as const) : ("active" as const) } : {}),
    };
    const onErr = (err: unknown) => toast.error(apiErrorMessage(err, "Could not save"));
    if (editItem) updateM.mutate({ id: editItem.id, body }, { onSuccess: () => { toast.success("Updated"); onOpenChange(false); }, onError: onErr });
    else
      createM.mutate(body, {
        onSuccess: () => {
          onOpenChange(false);
          // A recurring expense (rent, payroll, software) wants a schedule.
          if (behavior === "recurring") {
            toast.success("Created", {
              description: "Recurring expense — set up a schedule so it posts on time, every time?",
              action: { label: "Set up recurring", onClick: () => navigate("/record/recurring") },
            });
          } else {
            toast.success("Created");
          }
        },
        onError: onErr,
      });
  }

  const pending = createM.isPending || updateM.isPending;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>{editItem ? "Edit expense item" : "Add expense item"}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label>Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Studio rent" /></div>
          <div className="grid grid-cols-2 gap-2">
            <div><Label>What it's for</Label>
              <Select value={type} onValueChange={(v) => pickType(v as ExpensePurpose)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{TYPES.map((t) => <SelectItem key={t} value={t}>{EXPENSE_PURPOSE_LABELS[t]}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>Behavior</Label>
              <Select value={behavior} onValueChange={(v) => setBehavior(v as (typeof BEHAVIORS)[number])}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{BEHAVIORS.map((b) => <SelectItem key={b} value={b} className="capitalize">{b.replace(/_/g, " ")}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          {/* The break-even flag. Its own control because it answers a different
              question from the one above — and every combination is legal. */}
          <div>
            <Label>Does this grow when you sell more?</Label>
            <Select
              value={costNature}
              onValueChange={(v) => { setCostNature(v as CostNature); setNatureTouched(true); }}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {NATURES.map((n) => <SelectItem key={n} value={n}>{COST_NATURE_LABELS[n].label}</SelectItem>)}
              </SelectContent>
            </Select>
            <p className="mt-1 text-xs text-muted-foreground">{COST_NATURE_LABELS[costNature].help}</p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label>{unitLabel.trim() ? `Cost per ${unitLabel.trim()} (${symbol})` : `Default amount (${symbol})`}</Label>
              <Input type="number" value={amountRupees} onChange={(e) => setAmountRupees(e.target.value)} placeholder="Optional" />
            </div>
            {/*
              The one field that turns "Rs 50,000 of cement" into "200 bags at
              Rs 250" — which is how a builder already thinks, and the only shape
              that makes waste and cost per unit answerable at all.

              Left empty for anything that is an AMOUNT rather than a quantity.
              Rent is Rs 50,000, not 1 rent, and inventing a unit for it would
              ask a question with no sensible answer.
            */}
            <div>
              <Label>Counted in (optional)</Label>
              <Input
                value={unitLabel}
                onChange={(e) => setUnitLabel(e.target.value)}
                placeholder="bag, day, litre…"
              />
              <p className="mt-1 text-[11px] text-muted-foreground">
                {unitLabel.trim()
                  ? `Entry will ask how many ${unitLabel.trim()}s, and work out the total.`
                  : "Leave empty for things you buy as an amount rather than a quantity, like rent."}
              </p>
            </div>
            <div>
              <Label>Vendor</Label>
              {/* Pick from existing vendors so a typo doesn't silently create a duplicate person. */}
              <Input list={vendorListId} value={vendor} onChange={(e) => setVendor(e.target.value)} placeholder="Optional" />
              <datalist id={vendorListId}>
                {(vendors.data?.items ?? []).map((p) => <option key={p.id} value={p.displayName} />)}
              </datalist>
            </div>
          </div>
          <div>
            <Label>Category</Label>
            <Input list={categoryListId} value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Optional" />
            <datalist id={categoryListId}>
              {(categories.data ?? []).map((c) => <option key={c.id} value={c.name} />)}
            </datalist>
          </div>
          <div>
            <Label>Notes</Label>
            <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Anything you want to remember about this expense." />
          </div>
          {editItem && (
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} />
              Archived — hide it from pickers without touching past transactions
            </label>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={pending}>{pending ? "Saving…" : "Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
