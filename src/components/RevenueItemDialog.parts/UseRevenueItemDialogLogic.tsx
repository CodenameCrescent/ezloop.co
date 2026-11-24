import { useId, useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useSources, useCategories, useCreateSource, useCreateRevenueItem, useUpdateRevenueItem, apiErrorMessage } from "@/api/hooks";
import { readOptionalMoney, MoneyInputError, readMoney } from "@/lib/money";
import type { EndpointResponse, EndpointBody } from "@workspace/api-contract";
import type { listRevenueItems, createRevenueItem } from "@workspace/api-contract";

export type Item = EndpointResponse<typeof listRevenueItems>["items"][number];
export type CreateBody = EndpointBody<typeof createRevenueItem>;
export type VariantBody = NonNullable<CreateBody["variants"]>[number];

export const TYPES = ["product", "service", "subscription", "rental", "commission", "royalty", "other"] as const;
export const PRICING = ["fixed", "per_unit", "hourly", "variable", "tiered"] as const;
export const BILLING_CYCLES = ["daily", "weekly", "monthly", "quarterly", "yearly"] as const;
/** Types whose price repeats on a cadence — the only ones that ask for a billing cycle. */
export const CADENCE_TYPES: ReadonlyArray<(typeof TYPES)[number]> = ["subscription", "rental"];

export interface CompDraft { key: string; name: string; calcType: "fixed_per_unit" | "percent_of_price"; value: string; isFee: boolean; sourceId: string }
export interface TierDraft { key: string; upTo: string; price: string }
/** A node in the variant tree. Only nodes without children are sellable, so only they carry price and cost. */
export interface VariantDraft { key: string; name: string; price: string; cost: string; children: VariantDraft[] }

export const newKey = () => Math.random().toString(36).slice(2);

export function toVariantBody(nodes: VariantDraft[]): VariantBody[] {
  return nodes
    .filter((n) => n.name.trim())
    .map((n) => {
      const children = toVariantBody(n.children);
      if (children.length) return { name: n.name.trim(), variants: children };
      return {
        name: n.name.trim(),
        unitPriceCents: readOptionalMoney(`Price for "${n.name.trim()}"`, n.price),
        directCostCents: readOptionalMoney(`Cost for "${n.name.trim()}"`, n.cost),
      };
    });
}

/** Every leaf needs a price — that's the row a sale is actually recorded against. */
export function findPricelessLeaf(nodes: VariantDraft[], trail: string[] = []): string | null {
  for (const n of nodes) {
    if (!n.name.trim()) continue;
    const path = [...trail, n.name.trim()];
    if (n.children.some((c) => c.name.trim())) {
      const deeper = findPricelessLeaf(n.children, path);
      if (deeper) return deeper;
    } else if (!n.price.trim()) {
      return path.join(" / ");
    }
  }
  return null;
}
export type RevenueItemDialogProps = {
  open: boolean; onOpenChange: (v: boolean) => void; editItem: Item | null; symbol: string;
};

/** RevenueItemDialog's state and handlers, kept out of its render so each file stays short. */
export function useRevenueItemDialogLogic({ open, onOpenChange, editItem }: Pick<RevenueItemDialogProps, "open" | "onOpenChange" | "editItem">) {
  const router = useRouter();
  const navigate = (to: string) => router.push(to);
  const categoryListId = useId();
  const sources = useSources();
  const categories = useCategories("revenue");
  const createSourceM = useCreateSource();
  const createM = useCreateRevenueItem();
  const updateM = useUpdateRevenueItem();

  const [name, setName] = useState("");
  const [type, setType] = useState<(typeof TYPES)[number]>("product");
  const [pricingModel, setPricingModel] = useState<(typeof PRICING)[number]>("per_unit");
  const [priceRupees, setPriceRupees] = useState("");
  const [directCost, setDirectCost] = useState("");
  const [category, setCategory] = useState("");
  const [billingCycle, setBillingCycle] = useState<(typeof BILLING_CYCLES)[number]>("monthly");
  const [tiers, setTiers] = useState<TierDraft[]>([]);
  const [variants, setVariants] = useState<VariantDraft[]>([]);
  const [advanced, setAdvanced] = useState(false);
  const [comps, setComps] = useState<CompDraft[]>([]);
  const [sourceLinks, setSourceLinks] = useState<string[]>([]);
  const [newChannel, setNewChannel] = useState("");
  const [notes, setNotes] = useState("");
  const [archived, setArchived] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (editItem) {
      setName(editItem.name);
      setType(editItem.type as (typeof TYPES)[number]);
      setPricingModel(editItem.pricingModel as (typeof PRICING)[number]);
      setPriceRupees(editItem.unitPriceCents == null ? "" : String(editItem.unitPriceCents / 100));
      setDirectCost(editItem.directCostCents == null ? "" : String(editItem.directCostCents / 100));
      setCategory(editItem.categoryName ?? "");
      setBillingCycle((editItem.defaultBillingCycle ?? "monthly") as (typeof BILLING_CYCLES)[number]);
      setTiers((editItem.tiers ?? []).map((t) => ({ key: newKey(), upTo: t.upToQty ?? "", price: String(t.unitPriceCents / 100) })));
      setNotes(editItem.notes ?? "");
      setSourceLinks(editItem.sources.map((s) => s.sourceId));
      setVariants([]);
      setComps([]);
      setArchived(editItem.status === "archived");
    } else {
      setName(""); setType("product"); setPricingModel("per_unit"); setPriceRupees(""); setDirectCost("");
      setCategory(""); setBillingCycle("monthly"); setTiers([]); setVariants([]);
      setNotes(""); setComps([]); setSourceLinks([]); setNewChannel(""); setAdvanced(false);
      setArchived(false);
    }
  }, [open, editItem]);

  const hasVariants = variants.some((v) => v.name.trim());
  /**
   * Editing a row that already groups variants. It carries neither price nor
   * cost of its own — the leaves do — so those boxes must not appear: the
   * server refuses them, and a box that cannot be saved is worse than no box.
   */
  const isGroupRow = !!editItem?.hasVariants;
  const isTiered = pricingModel === "tiered";
  const needsPrice = pricingModel !== "variable" && !isTiered && !hasVariants && !isGroupRow;
  const showBillingCycle = CADENCE_TYPES.includes(type);

  function addChannel() {
    const trimmed = newChannel.trim();
    if (!trimmed) return;
    const existing = (sources.data ?? []).find((s) => s.name.toLowerCase() === trimmed.toLowerCase());
    if (existing) {
      setSourceLinks((p) => (p.includes(existing.id) ? p : [...p, existing.id]));
      setNewChannel("");
      return;
    }
    createSourceM.mutate({ name: trimmed, kind: "manual" }, {
      onSuccess: (created) => { setSourceLinks((p) => [...p, created.id]); setNewChannel(""); },
      onError: (err) => toast.error(apiErrorMessage(err, "Could not add that channel")),
    });
  }

  /**
   * Everything a money box on this form can be wrong about, said by the name on
   * the box. Reaching the server with a half-typed figure got "Invalid request"
   * back, which named nothing.
   */
  function save() {
    try {
      buildAndSave();
    } catch (err) {
      if (err instanceof MoneyInputError) { toast.error(err.message); return; }
      throw err;
    }
  }

  function buildAndSave() {
    if (!name.trim()) { toast.error("Name is required"); return; }
    if (needsPrice && !priceRupees.trim()) { toast.error("Price is required"); return; }
    if (isTiered && !hasVariants && tiers.filter((t) => t.price.trim()).length === 0) {
      toast.error("Add at least one tier, or pick a different pricing model");
      return;
    }
    if (hasVariants) {
      const priceless = findPricelessLeaf(variants);
      if (priceless) { toast.error(`"${priceless}" needs a price — that's what actually sells`); return; }
    }

    const tierBody = isTiered && !hasVariants
      ? tiers.filter((t) => t.price.trim()).map((t) => ({ upToQty: t.upTo.trim() || null, unitPriceCents: readMoney("Tier price", t.price) }))
      : null;

    const base = {
      name: name.trim(),
      type,
      pricingModel,
      categoryName: category.trim() || null,
      defaultBillingCycle: showBillingCycle ? billingCycle : null,
      notes: notes.trim() || null,
    };
    const onErr = (err: unknown) => toast.error(apiErrorMessage(err, "Could not save"));

    const componentBody = comps.filter((c) => c.name.trim()).map((c) => ({
      name: c.name.trim(),
      calcType: c.calcType,
      ...(c.calcType === "fixed_per_unit" ? { valueCents: readMoney(`Cost "${c.name.trim()}"`, c.value || "0") } : { valueRate: c.value || "0" }),
      isFee: c.isFee,
      ...(c.sourceId ? { sourceId: c.sourceId } : {}),
    }));

    if (editItem) {
      updateM.mutate({
        id: editItem.id,
        body: {
          ...base,
          // A parent of variants carries no price of its own; the server enforces the same rule.
          unitPriceCents: isGroupRow ? undefined : pricingModel === "variable" ? null : readMoney("Price", priceRupees || "0"),
          // This box is how a variant's cost is edited — a variant IS a revenue
          // item. Leaving it out was silently discarding what the owner typed.
          directCostCents: isGroupRow ? undefined : readOptionalMoney("Direct cost", directCost),
          ...(componentBody.length ? { components: componentBody } : {}),
          tiers: tierBody,
          status: archived ? ("archived" as const) : ("active" as const),
          sourceLinks: sourceLinks.map((sourceId) => ({ sourceId })),
        },
      }, {
        onSuccess: () => { toast.success("Item updated"); onOpenChange(false); },
        onError: onErr,
      });
      return;
    }

    const body: CreateBody = {
      ...base,
      unitPriceCents: hasVariants || pricingModel === "variable" ? null : tierBody ? tierBody[0].unitPriceCents : readMoney("Price", priceRupees || "0"),
      directCostCents: hasVariants ? null : readOptionalMoney("Direct cost", directCost),
      tiers: tierBody,
      variants: hasVariants ? toVariantBody(variants) : undefined,
      components: componentBody,
      sourceLinks: sourceLinks.map((sourceId) => ({ sourceId })),
    };
    createM.mutate(body, {
      onSuccess: () => {
        onOpenChange(false);
        // Subscriptions and rentals almost always repeat — offer to automate it now.
        if (CADENCE_TYPES.includes(type)) {
          toast.success("Item created", {
            description: "This usually repeats. Set up a recurring schedule so it posts automatically?",
            action: { label: "Set up recurring", onClick: () => navigate("/record/recurring") },
          });
        } else {
          toast.success("Item created");
        }
      },
      onError: onErr,
    });
  }

  const pending = createM.isPending || updateM.isPending;

  return {
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
  };
}
