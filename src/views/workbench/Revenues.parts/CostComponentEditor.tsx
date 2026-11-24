import { useState } from "react";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { useAddCostComponent, useUpdateCostComponent, useCloseCostComponent, apiErrorMessage, useRevenueItem } from "@/api/hooks";
import { readMoney, MoneyInputError, formatCents } from "@/lib/money";
import { formatQuantity } from "@workspace/domain";
import type { EndpointResponse } from "@workspace/api-contract";
import type { listRevenueItems } from "@workspace/api-contract";

export type Item = EndpointResponse<typeof listRevenueItems>["items"][number];

/**
 * The costs sitting on one item, and the three things you can do to them.
 *
 * The endpoints for all three existed and were reachable from no screen at all,
 * so the effective-dated cost story — the reason editing a cost never restates
 * last month's profit — had been built and left unusable.
 *
 * Editing does NOT overwrite. It closes the version that was open and opens its
 * successor from today, which is why the wording says "from today" and why
 * anything already sold keeps the cost frozen onto its line. Retiring closes
 * the open version with no successor; the history stays.
 */
export function CostComponentEditor({
  itemId,
  components,
  symbol,
  money,
}: {
  itemId: string;
  components: Array<{ id: string; name: string; calcType: string; valueCents: number | null; valueRate: string | null; isFee: boolean | null }>;
  symbol: string;
  money: (c: number) => string;
}) {
  const addM = useAddCostComponent();
  const updateM = useUpdateCostComponent();
  const closeM = useCloseCostComponent();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<{ name: string; calcType: "fixed_per_unit" | "percent_of_price"; value: string }>({
    name: "",
    calcType: "fixed_per_unit",
    value: "",
  });

  const onErr = (fallback: string) => (err: unknown) => toast.error(apiErrorMessage(err, fallback));

  function startEdit(c: { id: string; calcType: string; valueCents: number | null; valueRate: string | null }) {
    setEditingId(c.id);
    setEditValue(c.calcType === "fixed_per_unit" ? String((c.valueCents ?? 0) / 100) : c.valueRate ?? "");
  }

  function saveEdit(c: { id: string; calcType: string }) {
    if (!editValue.trim()) { toast.error("Give it a value"); return; }
    let body: { valueCents: number } | { valueRate: string };
    try {
      body = c.calcType === "fixed_per_unit" ? { valueCents: readMoney("Cost", editValue) } : { valueRate: editValue.trim() };
    } catch (err) {
      if (err instanceof MoneyInputError) { toast.error(err.message); return; }
      throw err;
    }
    updateM.mutate({ id: c.id, body }, {
      onSuccess: () => { setEditingId(null); toast.success("Cost updated from today — what you've already sold keeps its old cost"); },
      onError: onErr("Could not update that cost"),
    });
  }

  function add() {
    if (!draft.name.trim()) { toast.error("Give the cost a name"); return; }
    if (!draft.value.trim()) { toast.error("Give it a value"); return; }
    let amount: { valueCents: number } | { valueRate: string };
    try {
      amount = draft.calcType === "fixed_per_unit" ? { valueCents: readMoney("Cost", draft.value) } : { valueRate: draft.value.trim() };
    } catch (err) {
      if (err instanceof MoneyInputError) { toast.error(err.message); return; }
      throw err;
    }
    addM.mutate({
      id: itemId,
      body: {
        name: draft.name.trim(),
        calcType: draft.calcType,
        ...amount,
        isFee: draft.calcType !== "fixed_per_unit",
      },
    }, {
      onSuccess: () => { setDraft({ name: "", calcType: "fixed_per_unit", value: "" }); setAdding(false); toast.success("Cost added"); },
      onError: onErr("Could not add that cost"),
    });
  }

  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <span className="text-xs font-semibold text-muted-foreground">Costs on this item</span>
        <Button size="sm" variant="ghost" className="h-7 gap-1 px-2 text-xs" onClick={() => setAdding((a) => !a)}>
          <Plus className="h-3.5 w-3.5" /> Add
        </Button>
      </div>

      {components.length === 0 && !adding && (
        <p className="text-xs text-muted-foreground">No costs yet — add materials, a platform fee, or anything else this item costs you.</p>
      )}

      <div className="space-y-1">
        {components.map((c) => (
          <div key={c.id} className="rounded-lg border border-card-border px-2 py-1.5 text-xs">
            {editingId === c.id ? (
              <div className="flex items-center gap-1.5">
                <span className="min-w-0 flex-1 truncate">{c.name}</span>
                <Input className="h-7 w-24 text-xs" type="number" autoFocus value={editValue} onChange={(e) => setEditValue(e.target.value)} />
                <span className="text-muted-foreground">{c.calcType === "fixed_per_unit" ? symbol : "%"}</span>
                <Button size="sm" className="h-7 text-xs" disabled={updateM.isPending} onClick={() => saveEdit(c)}>Save</Button>
                <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setEditingId(null)}>Cancel</Button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate">
                  {c.name}
                  {(c.isFee ?? c.calcType !== "fixed_per_unit") && <span className="ml-1 text-muted-foreground">(fee)</span>}
                </span>
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {c.calcType === "fixed_per_unit" ? `−${money(c.valueCents ?? 0)}` : `−${c.valueRate}%`}
                </span>
                <button className="shrink-0 text-muted-foreground hover:text-foreground" title="Change this cost from today" onClick={() => startEdit(c)}>
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button
                  className="shrink-0 text-muted-foreground hover:text-destructive"
                  title="Stop applying this cost. What you've already sold keeps it."
                  disabled={closeM.isPending}
                  onClick={() => closeM.mutate(c.id, {
                    onSuccess: () => toast.success(`"${c.name}" won't apply to new sales`),
                    onError: onErr("Could not retire that cost"),
                  })}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      {adding && (
        <div className="mt-1.5 space-y-1.5 rounded-lg border border-card-border p-2">
          <div className="flex items-center gap-1.5">
            <Input className="h-7 flex-[2] text-xs" placeholder="e.g. Packaging" value={draft.name}
              onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} />
            <Select value={draft.calcType} onValueChange={(v) => setDraft((d) => ({ ...d, calcType: v as typeof d.calcType }))}>
              <SelectTrigger className="h-7 w-24 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="fixed_per_unit">{symbol}/unit</SelectItem>
                <SelectItem value="percent_of_price">% price</SelectItem>
              </SelectContent>
            </Select>
            <Input className="h-7 w-16 text-xs" type="number" placeholder={draft.calcType === "fixed_per_unit" ? "0.00" : "%"} value={draft.value}
              onChange={(e) => setDraft((d) => ({ ...d, value: e.target.value }))} />
          </div>
          <div className="flex justify-end gap-1.5">
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setAdding(false)}>Cancel</Button>
            <Button size="sm" className="h-7 text-xs" disabled={addM.isPending} onClick={add}>{addM.isPending ? "Adding…" : "Add"}</Button>
          </div>
        </div>
      )}

      <p className="mt-1 text-[10px] text-muted-foreground">
        Changing a cost applies from today onward. Everything you've already sold keeps the cost it was sold at.
      </p>
    </div>
  );
}

export function Stat({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg bg-muted/40 p-2"><div className="text-xs text-muted-foreground">{label}</div><div className="font-semibold tabular-nums">{value}</div></div>;
}

export function RevenueItemDetail({ id, onClose, onEdit, money, symbol, range }: {
  id: string | null; onClose: () => void; onEdit: (it: Item) => void; money: (c: number) => string; symbol: string; range: { startDate?: string; endDate?: string };
}) {
  const detail = useRevenueItem(id, range);
  const d = detail.data;
  const item = d?.item;
  const unitCost = item?.openComponents.reduce((s, c) => s + (c.calcType === "fixed_per_unit" ? c.valueCents ?? 0 : 0), 0) ?? 0;
  const price = item?.unitPriceCents ?? 0;

  return (
    <Sheet open={!!id} onOpenChange={(v) => !v && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader><SheetTitle>{item?.name ?? "Item"}</SheetTitle></SheetHeader>
        {item && d && (
          <div className="mt-4 space-y-5 text-sm">
            <Button size="sm" variant="outline" onClick={() => onEdit(item as unknown as Item)}>Edit</Button>

            <div className="flex justify-between">
              <span className="text-muted-foreground">Category</span>
              <span>{item.categoryName ?? "—"}</span>
            </div>

            {/* Noticed, never corrected. The app cannot tell whether the pricing
                model is wrong or the entries are — only the owner can. */}
            {d.stats.unitMismatch && (
              <div className="rounded-lg bg-[color:var(--pl-amber-tint)] p-3 text-xs">
                {d.stats.unitMismatch === "priced_fixed_sold_by_unit" ? (
                  <>
                    <p className="font-medium">This is priced as “{item.pricingModel.replace("_", " ")}” but sold by the {item.unitLabel}.</p>
                    <p className="mt-1 text-muted-foreground">
                      Sales record varying numbers of {item.unitLabel}s, which is how an hourly item behaves. If that's
                      what it is, change Pricing to “hourly” — nothing already recorded changes either way.
                    </p>
                  </>
                ) : (
                  <>
                    <p className="font-medium">This is priced hourly, but every sale records exactly one {item.unitLabel}.</p>
                    <p className="mt-1 text-muted-foreground">
                      Either the hours aren't being entered, or this isn't really hourly. Worth a look — nothing already
                      recorded changes either way.
                    </p>
                  </>
                )}
                <Button size="sm" variant="outline" className="mt-2 h-7 text-xs" onClick={() => onEdit(item as unknown as Item)}>
                  Open pricing
                </Button>
              </div>
            )}

            <div className="rounded-lg border border-card-border p-3">
              <div className="mb-2 text-xs font-semibold text-muted-foreground">Unit economics</div>
              <div className="flex justify-between"><span>Price</span><span className="tabular-nums">{item.unitPriceCents == null ? "variable" : money(price)}</span></div>
              {item.openComponents.map((c) => (
                <div key={c.id} className="flex justify-between text-muted-foreground"><span>· {c.name}{(c.isFee ?? c.calcType !== "fixed_per_unit") ? " (fee)" : ""}</span>
                  <span className="tabular-nums">{c.calcType === "fixed_per_unit" ? `−${money(c.valueCents ?? 0)}` : `−${c.valueRate}%`}</span></div>
              ))}
              {item.unitPriceCents != null && (
                <div className="mt-1 flex justify-between border-t border-card-border pt-1 font-semibold"><span>Per-unit contribution</span><span className="tabular-nums">{money(price - unitCost)}</span></div>
              )}
            </div>

            <CostComponentEditor itemId={item.id} components={item.openComponents} symbol={symbol} money={money} />

            <div className="grid grid-cols-2 gap-2">
              <Stat label="Sold" value={d.stats.unitsSold === 0 ? "—" : formatQuantity(String(d.stats.unitsSold), item.unitLabel)} />
              <Stat label="Net revenue" value={money(d.stats.netRevenueCents)} />
              <Stat label="Contribution" value={money(d.stats.contributionProfitCents)} />
              <Stat label="Margin" value={d.stats.marginPct == null ? "—" : `${d.stats.marginPct.toFixed(0)}%`} />
              <Stat label="Refund rate" value={`${d.stats.refundRatePct.toFixed(0)}%`} />
              <Stat label="Transactions" value={String(d.stats.transactionCount)} />
            </div>

            {d.perSource.length > 0 && (
              <div>
                <div className="mb-1 text-xs font-semibold text-muted-foreground">Per source</div>
                {d.perSource.map((s) => (
                  <div key={s.sourceId} className="flex justify-between"><span>{s.sourceName}</span><span className="tabular-nums">{money(s.netRevenueCents)} · {money(s.contributionProfitCents)}</span></div>
                ))}
              </div>
            )}

            <div>
              <div className="mb-1 text-xs font-semibold text-muted-foreground">Cost component history</div>
              {d.componentHistory.map((c) => (
                <div key={c.id} className="flex justify-between text-xs">
                  <span>{c.name}{c.sourceName ? ` · ${c.sourceName}` : ""}</span>
                  <span className="text-muted-foreground">
                    {c.calcType === "fixed_per_unit" ? formatCents(c.valueCents ?? 0, symbol) : `${c.valueRate}%`}
                    {" · "}{new Date(c.effectiveFrom).toLocaleDateString()}{c.effectiveTo ? `–${new Date(c.effectiveTo).toLocaleDateString()}` : " (open)"}
                  </span>
                </div>
              ))}
              {d.componentHistory.length === 0 && <p className="text-xs text-muted-foreground">No cost components.</p>}
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
