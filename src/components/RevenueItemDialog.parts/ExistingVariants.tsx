import { useState } from "react";
import { toast } from "sonner";
import { Plus, CornerDownRight, RotateCcw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useRevenueItems, useAddVariant, useUpdateRevenueItem, apiErrorMessage } from "@/api/hooks";
import { readOptionalMoney } from "@/lib/money";
import { type Item } from "./UseRevenueItemDialogLogic";

/**
 * The variants of an item that already exists.
 *
 * They could previously be set up ONLY while first creating the item; after
 * that the tree was frozen, which is what "can't edit variants" meant. Removing
 * one ARCHIVES it rather than deleting it: a variant may already have sales
 * behind it, and nothing that carries money is ever destroyed (CLAUDE.md).
 *
 * Only direct children are listed. A variant that has variants of its own is
 * opened in its own right — the same dialog, one level down.
 */
export function ExistingVariants({ item, symbol }: { item: Item; symbol: string }) {
  const all = useRevenueItems({});
  const addM = useAddVariant();
  const updateM = useUpdateRevenueItem();
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ name: "", price: "", cost: "" });

  const children = (all.data?.items ?? []).filter((i) => i.parentId === item.id);
  const isVariablePriced = item.pricingModel === "variable";
  // The parent still sells on its own, so the first variant will take that over.
  const willConvert = children.length === 0 && item.unitPriceCents != null;

  function add() {
    if (!draft.name.trim()) { toast.error("Give the variant a name"); return; }
    if (!isVariablePriced && !draft.price.trim()) { toast.error("A variant needs a price — that's what actually sells"); return; }
    addM.mutate({
      id: item.id,
      body: {
        name: draft.name.trim(),
        unitPriceCents: readOptionalMoney("Variant price", draft.price),
        directCostCents: readOptionalMoney("Variant cost", draft.cost),
      },
    }, {
      onSuccess: () => { setDraft({ name: "", price: "", cost: "" }); setAdding(false); toast.success("Variant added"); },
      onError: (err) => toast.error(apiErrorMessage(err, "Could not add that variant")),
    });
  }

  function setArchivedOn(variant: Item, next: boolean) {
    updateM.mutate({ id: variant.id, body: { status: next ? "archived" : "active" } }, {
      onSuccess: () => toast.success(next ? `"${variant.name}" archived` : `"${variant.name}" restored`),
      onError: (err) => toast.error(apiErrorMessage(err, "Could not change that variant")),
    });
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <Label className="text-xs">Variants {children.length > 0 && <span className="font-normal text-muted-foreground">— only these sell</span>}</Label>
        <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs" onClick={() => setAdding((a) => !a)}>
          <Plus className="h-3.5 w-3.5" /> Add variant
        </Button>
      </div>

      {children.length > 0 && (
        <div className="mt-1 space-y-1 rounded-lg border border-card-border p-2">
          {children.map((v) => (
            <div key={v.id} className={`flex items-center gap-2 text-xs ${v.status === "archived" ? "opacity-55" : ""}`}>
              <CornerDownRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate">
                {v.name}
                {v.status === "archived" && <span className="ml-1 text-muted-foreground">· archived</span>}
                {v.hasVariants && <span className="ml-1 text-muted-foreground">· has its own variants</span>}
              </span>
              <span className="shrink-0 tabular-nums text-muted-foreground">
                {v.hasVariants ? "per variant" : v.unitPriceCents == null ? "variable" : `${symbol} ${(v.unitPriceCents / 100).toFixed(2)}`}
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0"
                title={v.status === "archived" ? "Bring this variant back" : "Archive — hides it from pickers, keeps its history"}
                disabled={updateM.isPending}
                onClick={() => setArchivedOn(v, v.status !== "archived")}
              >
                {v.status === "archived" ? <RotateCcw className="h-3.5 w-3.5" /> : <Trash2 className="h-3.5 w-3.5" />}
              </Button>
            </div>
          ))}
        </div>
      )}

      {adding && (
        <div className="mt-1.5 space-y-1.5 rounded-lg border border-card-border p-2">
          {willConvert && (
            <p className="text-[11px] text-[color:var(--pl-amber)]">
              Adding a variant means "{item.name}" stops selling on its own — the price and direct cost move onto
              its variants. Anything already sold keeps what it was sold at.
            </p>
          )}
          <div className="flex items-center gap-1.5">
            <Input className="h-8 flex-[2] text-xs" placeholder="e.g. Large" value={draft.name}
              onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} />
            <Input className="h-8 w-20 text-xs" type="number" placeholder={`${symbol} price`} value={draft.price}
              disabled={isVariablePriced}
              onChange={(e) => setDraft((d) => ({ ...d, price: e.target.value }))} />
            <Input className="h-8 w-20 text-xs" type="number" placeholder="cost" value={draft.cost}
              onChange={(e) => setDraft((d) => ({ ...d, cost: e.target.value }))} />
          </div>
          <div className="flex justify-end gap-1.5">
            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => { setAdding(false); setDraft({ name: "", price: "", cost: "" }); }}>Cancel</Button>
            <Button size="sm" className="h-7 text-xs" onClick={add} disabled={addM.isPending}>{addM.isPending ? "Adding…" : "Add"}</Button>
          </div>
        </div>
      )}

      {children.length === 0 && !adding && (
        <p className="mt-1 text-[11px] text-muted-foreground">
          No variants. Add one if this comes in sizes, colours, or tiers that sell at different prices.
        </p>
      )}
    </div>
  );
}
