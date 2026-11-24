import { ChevronDown, CornerDownRight, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TYPES, PRICING, BILLING_CYCLES, type CompDraft, type VariantDraft, newKey, type RevenueItemDialogProps, useRevenueItemDialogLogic } from "./RevenueItemDialog.parts/UseRevenueItemDialogLogic";
import { ExistingVariants } from "./RevenueItemDialog.parts/ExistingVariants";

const COST_HINT: Record<string, string> = {
  product: "Materials, packaging, shipping",
  service: "Subcontractor, software, hours",
  subscription: "Hosting, support, processor fee",
  rental: "Maintenance, cleaning",
  commission: "Platform cut, referral fee",
  royalty: "Licensing, distribution",
  other: "Any direct cost or fee",
};
const newVariant = (): VariantDraft => ({ key: newKey(), name: "", price: "", cost: "", children: [] });

/** Apply `fn` to the node with `key` anywhere in the tree. */
function editNode(nodes: VariantDraft[], key: string, fn: (n: VariantDraft) => VariantDraft): VariantDraft[] {
  return nodes.map((n) => (n.key === key ? fn(n) : { ...n, children: editNode(n.children, key, fn) }));
}

function removeNode(nodes: VariantDraft[], key: string): VariantDraft[] {
  return nodes.filter((n) => n.key !== key).map((n) => ({ ...n, children: removeNode(n.children, key) }));
}


export function RevenueItemDialog({ open, onOpenChange, editItem, symbol }: RevenueItemDialogProps) {
  const {
    name,
    setName,
    type,
    setType,
    pricingModel,
    setPricingModel,
    categoryListId,
    category,
    setCategory,
    categories,
    showBillingCycle,
    billingCycle,
    setBillingCycle,
    isTiered,
    hasVariants,
    tiers,
    setTiers,
    isGroupRow,
    priceRupees,
    setPriceRupees,
    directCost,
    setDirectCost,
    setVariants,
    variants,
    setAdvanced,
    advanced,
    sources,
    sourceLinks,
    setSourceLinks,
    newChannel,
    setNewChannel,
    addChannel,
    createSourceM,
    comps,
    setComps,
    notes,
    setNotes,
    archived,
    setArchived,
    save,
    pending,
  } = useRevenueItemDialogLogic({ open, onOpenChange, editItem });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] max-w-lg overflow-y-auto">
        <DialogHeader><DialogTitle>{editItem ? "Edit revenue item" : "Add revenue item"}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label>Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Logo design" /></div>

          <div className="grid grid-cols-2 gap-2">
            <div><Label>Type</Label>
              <Select value={type} onValueChange={(v) => setType(v as (typeof TYPES)[number])}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{TYPES.map((t) => <SelectItem key={t} value={t} className="capitalize">{t}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>Pricing</Label>
              <Select value={pricingModel} onValueChange={(v) => setPricingModel(v as (typeof PRICING)[number])}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{PRICING.map((p) => <SelectItem key={p} value={p} className="capitalize">{p.replace("_", " ")}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label>Category</Label>
              <Input list={categoryListId} value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Optional" />
              <datalist id={categoryListId}>
                {(categories.data ?? []).map((c) => <option key={c.id} value={c.name} />)}
              </datalist>
            </div>
            {showBillingCycle && (
              <div><Label>Billing cycle</Label>
                <Select value={billingCycle} onValueChange={(v) => setBillingCycle(v as (typeof BILLING_CYCLES)[number])}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{BILLING_CYCLES.map((b) => <SelectItem key={b} value={b} className="capitalize">{b}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            )}
          </div>

          {isTiered && !hasVariants && (
            <div className="rounded-lg border border-card-border p-3">
              <div className="mb-1.5 flex items-center justify-between">
                <Label className="text-xs">Tiers</Label>
                <span className="text-[10px] text-muted-foreground">Price per unit, up to a quantity</span>
              </div>
              {tiers.map((t) => (
                <div key={t.key} className="mb-1.5 flex items-center gap-1.5">
                  <span className="text-xs text-muted-foreground">up to</span>
                  <Input className="w-20" placeholder="qty" value={t.upTo} onChange={(e) => setTiers((p) => p.map((x) => x.key === t.key ? { ...x, upTo: e.target.value } : x))} />
                  <span className="text-xs text-muted-foreground">at</span>
                  <Input className="flex-1" type="number" placeholder={`${symbol} 0.00`} value={t.price} onChange={(e) => setTiers((p) => p.map((x) => x.key === t.key ? { ...x, price: e.target.value } : x))} />
                  <Button variant="ghost" size="icon" onClick={() => setTiers((p) => p.filter((x) => x.key !== t.key))}><Trash2 className="h-4 w-4" /></Button>
                </div>
              ))}
              <Button variant="outline" size="sm" className="gap-1" onClick={() => setTiers((p) => [...p, { key: newKey(), upTo: "", price: "" }])}>
                <Plus className="h-3.5 w-3.5" /> Add tier
              </Button>
              <p className="mt-1.5 text-[10px] text-muted-foreground">Leave the last quantity blank for "and above".</p>
            </div>
          )}

          {!hasVariants && !isTiered && !isGroupRow && (
            <div className="grid grid-cols-2 gap-2">
              <div><Label>Price {pricingModel === "variable" ? "(set per sale)" : `(${symbol})`}</Label>
                <Input type="number" value={priceRupees} disabled={pricingModel === "variable"} onChange={(e) => setPriceRupees(e.target.value)} placeholder="0.00" /></div>
              <div><Label>Direct cost ({symbol})</Label>
                <Input type="number" value={directCost} onChange={(e) => setDirectCost(e.target.value)} placeholder="0.00" />
                <p className="mt-0.5 text-[10px] text-muted-foreground">{COST_HINT[type]}</p>
              </div>
            </div>
          )}

          {editItem ? (
            <ExistingVariants item={editItem} symbol={symbol} />
          ) : (
            <div>
              <div className="flex items-center justify-between">
                <Label className="text-xs">Variants {hasVariants && <span className="font-normal text-muted-foreground">— only the deepest level sells</span>}</Label>
                <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs" onClick={() => setVariants((p) => [...p, newVariant()])}>
                  <Plus className="h-3.5 w-3.5" /> Add variant
                </Button>
              </div>
              {variants.length > 0 && (
                <div className="mt-1 space-y-1.5 rounded-lg border border-card-border p-2">
                  {variants.map((v) => (
                    <VariantRow key={v.key} node={v} depth={0} symbol={symbol}
                      onChange={(key, fn) => setVariants((p) => editNode(p, key, fn))}
                      onRemove={(key) => setVariants((p) => removeNode(p, key))} />
                  ))}
                </div>
              )}
            </div>
          )}

          <button className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground" onClick={() => setAdvanced((a) => !a)}>
            <ChevronDown className={`h-3.5 w-3.5 transition-transform ${advanced ? "rotate-180" : ""}`} /> Advanced: channels, other costs, description
          </button>

          {advanced && (
            <div className="space-y-3 rounded-lg border border-card-border p-3">
              <div>
                <Label className="text-xs">Where you sell it</Label>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {(sources.data ?? []).map((s) => {
                    const on = sourceLinks.includes(s.id);
                    return (
                      <button key={s.id} onClick={() => setSourceLinks((p) => on ? p.filter((x) => x !== s.id) : [...p, s.id])}
                        className={`rounded-full px-2.5 py-1 text-xs ${on ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>{s.name}</button>
                    );
                  })}
                </div>
                <div className="mt-1.5 flex gap-1.5">
                  <Input className="h-8 text-xs" placeholder="Add a channel — e.g. Fiverr, Outlet X" value={newChannel}
                    onChange={(e) => setNewChannel(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addChannel(); } }} />
                  <Button variant="outline" size="sm" onClick={addChannel} disabled={createSourceM.isPending || !newChannel.trim()}>Add</Button>
                </div>
              </div>

              <div>
                <div className="mb-1 flex items-center justify-between">
                  <Label className="text-xs">Other costs {editItem ? "(add new)" : ""}</Label>
                  <span className="text-[10px] text-muted-foreground">Fees on top of the direct cost</span>
                </div>
                {comps.map((c) => (
                  <div key={c.key} className="mb-1.5 flex gap-1.5">
                    <Input className="flex-[2]" placeholder="Name" value={c.name} onChange={(e) => setComps((p) => p.map((x) => x.key === c.key ? { ...x, name: e.target.value } : x))} />
                    <Select value={c.calcType} onValueChange={(v) => setComps((p) => p.map((x) => x.key === c.key ? { ...x, calcType: v as CompDraft["calcType"] } : x))}>
                      <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
                      <SelectContent><SelectItem value="fixed_per_unit">{symbol}/unit</SelectItem><SelectItem value="percent_of_price">% price</SelectItem></SelectContent>
                    </Select>
                    <Input className="w-16" placeholder={c.calcType === "fixed_per_unit" ? "0.00" : "%"} value={c.value} onChange={(e) => setComps((p) => p.map((x) => x.key === c.key ? { ...x, value: e.target.value } : x))} />
                    <Button variant="ghost" size="icon" onClick={() => setComps((p) => p.filter((x) => x.key !== c.key))}><Trash2 className="h-4 w-4" /></Button>
                  </div>
                ))}
                <Button variant="outline" size="sm" className="gap-1" onClick={() => setComps((p) => [...p, { key: newKey(), name: "", calcType: "fixed_per_unit", value: "", isFee: false, sourceId: "" }])}>
                  <Plus className="h-3.5 w-3.5" /> Add cost
                </Button>
              </div>

              <div>
                <Label className="text-xs">Description</Label>
                <Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Anything you want to remember about this item." />
              </div>

              {editItem && (
                <label className="flex items-start gap-2 text-xs">
                  <input type="checkbox" className="mt-0.5" checked={archived} onChange={(e) => setArchived(e.target.checked)} />
                  <span>
                    Archived — hide it from pickers without touching past transactions.
                    {editItem.hasVariants && " Its variants are hidden and restored with it."}
                  </span>
                </label>
              )}
            </div>
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

/** One node of the variant tree. Price and cost appear only on leaves — the rows that actually sell. */
function VariantRow({ node, depth, symbol, onChange, onRemove }: {
  node: VariantDraft;
  depth: number;
  symbol: string;
  onChange: (key: string, fn: (n: VariantDraft) => VariantDraft) => void;
  onRemove: (key: string) => void;
}) {
  const isLeaf = node.children.length === 0;
  return (
    <div style={{ marginLeft: depth * 14 }}>
      <div className="flex items-center gap-1.5">
        {depth > 0 && <CornerDownRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
        <Input className="h-8 flex-[2] text-xs" placeholder={depth === 0 ? "e.g. Black" : "e.g. Medium"} value={node.name}
          onChange={(e) => onChange(node.key, (n) => ({ ...n, name: e.target.value }))} />
        {isLeaf && (
          <>
            <Input className="h-8 w-20 text-xs" type="number" placeholder={`${symbol} price`} value={node.price}
              onChange={(e) => onChange(node.key, (n) => ({ ...n, price: e.target.value }))} />
            <Input className="h-8 w-20 text-xs" type="number" placeholder="cost" value={node.cost}
              onChange={(e) => onChange(node.key, (n) => ({ ...n, cost: e.target.value }))} />
          </>
        )}
        <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" title="Add a variant inside this one"
          onClick={() => onChange(node.key, (n) => ({ ...n, children: [...n.children, newVariant()] }))}>
          <Plus className="h-3.5 w-3.5" />
        </Button>
        <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => onRemove(node.key)}><Trash2 className="h-3.5 w-3.5" /></Button>
      </div>
      {node.children.map((c) => (
        <div key={c.key} className="mt-1.5">
          <VariantRow node={c} depth={depth + 1} symbol={symbol} onChange={onChange} onRemove={onRemove} />
        </div>
      ))}
    </div>
  );
}
