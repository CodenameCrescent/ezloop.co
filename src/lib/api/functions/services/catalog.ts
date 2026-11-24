import {
  billingCycleValues,
  categoriesTable,
  categoryAppliesToValues,
  costCalcTypeValues,
  costComponentsTable,
  db,
  defaultUnitLabelByType,
  expenseBehaviorValues,
  expenseItemPurposeValues,
  expenseItemsTable,
  pricingModelValues,
  revenueItemSourcesTable,
  revenueItemTypeValues,
  revenueItemsTable,
  sourceKindValues,
  sourceStatusValues,
  sourcesTable,
  type BillingCycle,
  type CostCalcType,
  type CostNature,
  type ExpenseBehavior,
  type ExpenseItemPurpose,
  type PricingModel,
  type PricingTier,
  type RevenueItemType,
  type SourceKind,
  type SourceStatus,
} from "@workspace/db";
import { defaultNatureFor, isCostNature } from "@workspace/domain";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { uid } from "../lib/uid";
import { invalid, notFound } from "./errors";
import { assertOwnedRefs } from "./ownership";
import { findOrCreatePerson } from "./person";

/**
 * Catalog CRUD. Catalog entries describe the business; they never move money
 * by themselves (CLAUDE.md). Cost components are effective-dated and never
 * mutated in place — see updateCostComponent.
 */

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------

export async function createSource(
  businessId: string,
  input: { name: string; kind: SourceKind; platformFeePercent?: string | null; defaultCurrency?: string },
) {
  if (!input.name.trim()) throw invalid("Source name is required");
  if (!sourceKindValues.includes(input.kind)) throw invalid(`Unknown source kind "${input.kind}"`);
  const [source] = await db
    .insert(sourcesTable)
    .values({
      id: uid("src"),
      businessId,
      name: input.name.trim(),
      kind: input.kind,
      platformFeePercent: input.platformFeePercent ?? null,
      defaultCurrency: input.defaultCurrency ?? "PKR",
    })
    .returning();
  return source;
}

export async function getSource(businessId: string, sourceId: string) {
  const [source] = await db
    .select()
    .from(sourcesTable)
    .where(and(eq(sourcesTable.businessId, businessId), eq(sourcesTable.id, sourceId)));
  if (!source) throw notFound("Source");
  return source;
}

export async function listSources(businessId: string) {
  return db.select().from(sourcesTable).where(eq(sourcesTable.businessId, businessId)).orderBy(asc(sourcesTable.name));
}

export async function updateSource(
  businessId: string,
  sourceId: string,
  input: { name?: string; platformFeePercent?: string | null; status?: SourceStatus },
) {
  await getSource(businessId, sourceId);
  if (input.status && !sourceStatusValues.includes(input.status)) throw invalid(`Unknown status "${input.status}"`);
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (input.name !== undefined) {
    if (!input.name.trim()) throw invalid("Source name is required");
    patch.name = input.name.trim();
  }
  if (input.platformFeePercent !== undefined) patch.platformFeePercent = input.platformFeePercent ?? null;
  if (input.status !== undefined) patch.status = input.status;
  const [updated] = await db
    .update(sourcesTable)
    .set(patch)
    .where(and(eq(sourcesTable.businessId, businessId), eq(sourcesTable.id, sourceId)))
    .returning();
  return updated;
}

/**
 * Which category tags each picker may offer.
 *
 * The `time` buckets (Admin, Sales & pitching, …) are deliberately in none of
 * them: they absorb labour, not money, and offering one as the category for a
 * sale files revenue under an internal bucket where no money report expects it.
 */
const USABLE_TAGS: Record<"revenue" | "expense" | "money", ReadonlyArray<(typeof categoryAppliesToValues)[number]>> = {
  revenue: ["revenue", "both"],
  expense: ["expense", "both"],
  money: ["revenue", "expense", "both"],
};

export type CategoryPicker = keyof typeof USABLE_TAGS;

export async function listCategories(businessId: string, usableFor?: CategoryPicker) {
  const rows = await db
    .select()
    .from(categoriesTable)
    .where(eq(categoriesTable.businessId, businessId))
    .orderBy(asc(categoriesTable.name));
  if (!usableFor) return rows;
  const allowed = new Set<string>(USABLE_TAGS[usableFor]);
  return rows.filter((row) => allowed.has(row.appliesTo));
}

/**
 * A category with this name, whatever case it was typed in.
 *
 * Case-SENSITIVE matching is what split "Waven" and "waven" into two
 * categories, each holding part of the same revenue. Nobody types a label
 * meaning to make a second one, so the comparison folds case; the name is
 * stored exactly as it was first typed, because that is the owner's spelling.
 */
async function findCategoryByName(businessId: string, name: string) {
  const [existing] = await db
    .select()
    .from(categoriesTable)
    .where(
      and(
        eq(categoriesTable.businessId, businessId),
        sql`lower(${categoriesTable.name}) = ${name.trim().toLowerCase()}`,
      ),
    );
  return existing ?? null;
}

/** Find a category by name or create it — used when the UI free-types a category. */
export async function findOrCreateCategory(
  businessId: string,
  name: string | null | undefined,
  appliesTo: "revenue" | "expense" | "both" = "both",
): Promise<string | null> {
  const trimmed = name?.trim();
  if (!trimmed) return null;
  const existing = await findCategoryByName(businessId, trimmed);
  if (!existing) {
    const created = await createCategory(businessId, { name: trimmed, appliesTo });
    return created.id;
  }
  /**
   * A money label must never resolve to an internal time bucket.
   *
   * Typing "Admin" as the category for a product would otherwise file that
   * revenue under the bucket that absorbs unbillable hours — a place no money
   * report goes looking, and one the owner cannot see it in. Refuse by name
   * rather than quietly reusing the row, and rather than minting a second
   * "Admin", which would put two categories with one name back in the database
   * the merge in step 4 just took out.
   */
  if (existing.appliesTo === "time") {
    throw invalid(
      `"${existing.name}" is one of your internal time categories — pick a different name for this one`,
    );
  }
  return existing.id;
}

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

export async function createCategory(
  businessId: string,
  input: { name: string; parentId?: string | null; appliesTo?: (typeof categoryAppliesToValues)[number] },
) {
  if (!input.name.trim()) throw invalid("Category name is required");
  const appliesTo = input.appliesTo ?? "both";
  if (!categoryAppliesToValues.includes(appliesTo)) throw invalid(`Unknown applies_to "${appliesTo}"`);
  // The same guard as find-or-create, on the direct path too — otherwise the
  // endpoint remains a way to re-split a category by changing its capitals.
  const clash = await findCategoryByName(businessId, input.name);
  if (clash) {
    throw invalid(
      clash.appliesTo === "time"
        ? `"${clash.name}" is one of your internal time categories — pick a different name`
        : `You already have a category called "${clash.name}"`,
    );
  }
  if (input.parentId) {
    const [parent] = await db
      .select()
      .from(categoriesTable)
      .where(and(eq(categoriesTable.businessId, businessId), eq(categoriesTable.id, input.parentId)));
    if (!parent) throw notFound("Parent category");
  }
  const [category] = await db
    .insert(categoriesTable)
    .values({ id: uid("cat"), businessId, name: input.name.trim(), parentId: input.parentId ?? null, appliesTo })
    .returning();
  return category;
}

// ---------------------------------------------------------------------------
// Revenue items
// ---------------------------------------------------------------------------

/** The reserved component name behind the UI's single "direct cost" number. */
export const DIRECT_COST_COMPONENT_NAME = "Direct cost";

/** Billing cycle is a default for the recurring schedule; only cadence-shaped types carry one. */
const BILLING_CYCLE_TYPES: RevenueItemType[] = ["subscription", "rental"];

function validateBillingCycle(type: RevenueItemType, cycle: BillingCycle | null | undefined): BillingCycle | null {
  if (cycle === null || cycle === undefined) return null;
  if (!billingCycleValues.includes(cycle)) throw invalid(`Unknown billing cycle "${cycle}"`);
  if (!BILLING_CYCLE_TYPES.includes(type)) throw invalid("Billing cycle only applies to subscription or rental items");
  return cycle;
}

function validateTiers(pricingModel: PricingModel, tiers: PricingTier[] | null | undefined): PricingTier[] | null {
  if (!tiers || tiers.length === 0) return null;
  if (pricingModel !== "tiered") throw invalid("Tiers are only allowed with the tiered pricing model");
  let prevQty: number | null = null;
  tiers.forEach((tier, i) => {
    if (!Number.isSafeInteger(tier.unitPriceCents) || tier.unitPriceCents < 0) {
      throw invalid("Tier price must be non-negative integer cents");
    }
    if (tier.upToQty === null) {
      if (i !== tiers.length - 1) throw invalid("Only the last tier can be open-ended");
      return;
    }
    if (!/^\d+(\.\d+)?$/.test(tier.upToQty)) throw invalid("Tier quantity must be a non-negative decimal string");
    const qty = Number(tier.upToQty);
    if (prevQty !== null && qty <= prevQty) throw invalid("Tier quantities must increase");
    prevQty = qty;
  });
  return tiers;
}

export async function createRevenueItem(
  businessId: string,
  input: {
    name: string;
    type: RevenueItemType;
    pricingModel: PricingModel;
    unitPriceCents?: number | null;
    parentId?: string | null;
    /** True = this node has variants: it groups, it doesn't sell, so it carries no price. */
    isGroup?: boolean;
    categoryId?: string | null;
    currency?: string;
    unitLabel?: string;
    defaultBillingCycle?: BillingCycle | null;
    tiers?: PricingTier[] | null;
    notes?: string | null;
  },
) {
  if (!input.name.trim()) throw invalid("Item name is required");
  if (!revenueItemTypeValues.includes(input.type)) throw invalid(`Unknown revenue item type "${input.type}"`);
  if (!pricingModelValues.includes(input.pricingModel)) throw invalid(`Unknown pricing model "${input.pricingModel}"`);
  const defaultBillingCycle = validateBillingCycle(input.type, input.defaultBillingCycle);
  const tiers = validateTiers(input.pricingModel, input.tiers);

  let unitPriceCents = input.unitPriceCents ?? null;
  if (input.isGroup) {
    if (unitPriceCents !== null) throw invalid("An item with variants carries no price of its own — price the variants");
  } else if (input.pricingModel === "variable") {
    // Null price is allowed exactly when the price varies per engagement.
    if (unitPriceCents !== null) throw invalid("Variable-priced items must not carry a fixed unit price");
  } else if (unitPriceCents === null) {
    // Tiered items fall back to their first tier as the base price.
    if (tiers) unitPriceCents = tiers[0].unitPriceCents;
    else throw invalid(`Pricing model "${input.pricingModel}" requires a unit price`);
  }
  if (unitPriceCents !== null && (!Number.isSafeInteger(unitPriceCents) || unitPriceCents < 0)) {
    throw invalid("Unit price must be non-negative integer cents");
  }

  const name = input.name.trim();
  const parentId = input.parentId ?? null;
  if (parentId) await getRevenueItem(businessId, parentId);
  await assertOwnedRefs(businessId, { categoryIds: [input.categoryId] });

  try {
    const [item] = await db
      .insert(revenueItemsTable)
      .values({
        id: uid("ri"),
        businessId,
        parentId,
        name,
        type: input.type,
        pricingModel: input.pricingModel,
        unitPriceCents,
        categoryId: input.categoryId ?? null,
        currency: input.currency ?? "PKR",
        unitLabel: input.unitLabel ?? defaultUnitLabelByType[input.type],
        defaultBillingCycle,
        tiersJson: tiers,
        notes: input.notes ?? null,
      })
      .returning();
    return item;
  } catch (err) {
    // Names are unique among roots, and among siblings under one parent.
    if (isUniqueViolation(err)) {
      throw invalid(parentId ? `"${name}" already exists on this item` : `You already have an item called "${name}"`);
    }
    throw err;
  }
}

function isUniqueViolation(err: unknown): boolean {
  const code = (err as { code?: string })?.code ?? (err as { cause?: { code?: string } })?.cause?.code;
  return code === "23505";
}

/** Sugar behind the form's one "direct cost" field: a single fixed_per_unit component. */
export async function setDirectCost(businessId: string, revenueItemId: string, valueCents: number) {
  return addCostComponent(businessId, revenueItemId, {
    name: DIRECT_COST_COMPONENT_NAME,
    calcType: "fixed_per_unit",
    valueCents,
    isFee: false,
  });
}

/**
 * The open "Direct cost" version, matched on exactly the predicate that
 * `directCostOf` in read.ts uses to fill the form's box. The two must agree:
 * the number the owner sees is the version an edit re-versions.
 */
async function findOpenDirectCost(revenueItemId: string) {
  const [open] = await db
    .select()
    .from(costComponentsTable)
    .where(
      and(
        eq(costComponentsTable.revenueItemId, revenueItemId),
        eq(costComponentsTable.name, DIRECT_COST_COMPONENT_NAME),
        eq(costComponentsTable.calcType, "fixed_per_unit"),
        isNull(costComponentsTable.sourceId),
        isNull(costComponentsTable.effectiveTo),
      ),
    );
  return open ?? null;
}

/**
 * The form's one "direct cost" number, applied to an item that already exists.
 *
 * Never an overwrite. The component is effective-dated, so a changed value
 * closes the open version and opens its successor (CLAUDE.md), and `null`
 * retires it with no successor. Every unit already sold keeps the cost that was
 * frozen onto its line — editing today's cost never restates last month's
 * profit.
 */
export async function setDirectCostEffective(
  businessId: string,
  revenueItemId: string,
  valueCents: number | null,
) {
  await getRevenueItem(businessId, revenueItemId);
  if (valueCents !== null && (await revenueItemHasVariants(revenueItemId))) {
    throw invalid("An item with variants carries no direct cost of its own — cost the variants");
  }

  const open = await findOpenDirectCost(revenueItemId);
  if (valueCents === null) {
    if (open) await closeCostComponent(businessId, open.id);
    return;
  }
  if (!open) {
    await setDirectCost(businessId, revenueItemId, valueCents);
    return;
  }
  // Saving the form without touching the box must not litter the history with
  // versions that changed nothing.
  if (open.valueCents === valueCents) return;
  await updateCostComponent(businessId, open.id, { valueCents });
}

export interface VariantNodeInput {
  name: string;
  unitPriceCents?: number | null;
  directCostCents?: number | null;
  variants?: VariantNodeInput[];
}

function assertUniqueSiblingNames(nodes: VariantNodeInput[]) {
  const seen = new Set<string>();
  for (const node of nodes) {
    const key = node.name.trim().toLowerCase();
    if (seen.has(key)) throw invalid(`Variant name "${node.name.trim()}" is used twice at the same level`);
    seen.add(key);
  }
}

/**
 * Create an item together with its variant tree. Only leaves are sellable:
 * every node with children is stored price-less, and prices/direct costs are
 * written on the leaves. Shared traits (type, category, pricing model,
 * currency, unit label, billing cycle) are inherited from the root.
 */
export async function createRevenueItemWithVariants(
  businessId: string,
  input: Parameters<typeof createRevenueItem>[1] & {
    directCostCents?: number | null;
    variants?: VariantNodeInput[];
  },
) {
  const hasVariants = (input.variants?.length ?? 0) > 0;
  if (hasVariants && input.directCostCents != null) {
    throw invalid("An item with variants carries no direct cost of its own — cost the variants");
  }

  const root = await createRevenueItem(businessId, { ...input, isGroup: hasVariants });

  if (!hasVariants) {
    if (input.directCostCents != null) await setDirectCost(businessId, root.id, input.directCostCents);
    return root;
  }

  const createLevel = async (parentId: string, nodes: VariantNodeInput[]) => {
    assertUniqueSiblingNames(nodes);
    for (const node of nodes) {
      const nodeHasVariants = (node.variants?.length ?? 0) > 0;
      if (nodeHasVariants && node.directCostCents != null) {
        throw invalid(`"${node.name}" has further variants — cost its variants instead`);
      }
      const child = await createRevenueItem(businessId, {
        name: node.name,
        type: input.type,
        pricingModel: input.pricingModel,
        unitPriceCents: node.unitPriceCents ?? null,
        parentId,
        isGroup: nodeHasVariants,
        categoryId: input.categoryId ?? null,
        currency: input.currency,
        unitLabel: input.unitLabel,
        defaultBillingCycle: input.defaultBillingCycle ?? null,
        tiers: null,
        notes: null,
      });
      if (!nodeHasVariants && node.directCostCents != null) {
        await setDirectCost(businessId, child.id, node.directCostCents);
      }
      if (nodeHasVariants) await createLevel(child.id, node.variants!);
    }
  };
  await createLevel(root.id, input.variants!);
  return root;
}

/** Every id in this item's subtree, the item itself first. */
async function revenueItemSubtreeIds(businessId: string, rootId: string): Promise<string[]> {
  const all = await db
    .select({ id: revenueItemsTable.id, parentId: revenueItemsTable.parentId })
    .from(revenueItemsTable)
    .where(eq(revenueItemsTable.businessId, businessId));
  const childrenOf = new Map<string, string[]>();
  for (const row of all) {
    if (!row.parentId) continue;
    childrenOf.set(row.parentId, [...(childrenOf.get(row.parentId) ?? []), row.id]);
  }
  const out: string[] = [];
  const walk = (id: string) => {
    out.push(id);
    for (const child of childrenOf.get(id) ?? []) walk(child);
  };
  walk(rootId);
  return out;
}

/**
 * Add a variant to an item that already exists.
 *
 * The first variant CONVERTS its parent. Only leaves sell, so a parent that
 * carried a price of its own must stop carrying one, and its open direct cost
 * is retired rather than left applying to a row nothing can be sold against.
 * Neither touches history: every line already written holds a frozen snapshot.
 *
 * Shared traits are inherited from the parent, never sent by the caller, so a
 * variant cannot drift away from the thing it is a variant of.
 */
export async function addVariant(
  businessId: string,
  parentId: string,
  input: { name: string; unitPriceCents?: number | null; directCostCents?: number | null },
) {
  const parent = await getRevenueItem(businessId, parentId);
  const name = input.name.trim();
  if (!name) throw invalid("Variant name is required");

  const siblings = await db
    .select({ name: revenueItemsTable.name })
    .from(revenueItemsTable)
    .where(and(eq(revenueItemsTable.businessId, businessId), eq(revenueItemsTable.parentId, parentId)));
  if (siblings.some((s) => s.name.trim().toLowerCase() === name.toLowerCase())) {
    throw invalid(`"${name}" already exists on this item`);
  }

  // The variant is the row a sale is recorded against, so it needs a price —
  // unless the whole item is priced per engagement.
  const pricingModel = parent.pricingModel as PricingModel;
  const unitPriceCents = input.unitPriceCents ?? null;
  if (pricingModel !== "variable" && unitPriceCents === null) {
    throw invalid(`"${name}" needs a price — that's what actually sells`);
  }

  const child = await createRevenueItem(businessId, {
    name,
    type: parent.type as RevenueItemType,
    pricingModel,
    unitPriceCents,
    parentId,
    categoryId: parent.categoryId,
    currency: parent.currency,
    unitLabel: parent.unitLabel,
    defaultBillingCycle: (parent.defaultBillingCycle as BillingCycle | null) ?? null,
    tiers: null,
    notes: null,
  });
  if (input.directCostCents != null) await setDirectCost(businessId, child.id, input.directCostCents);

  if (siblings.length === 0) {
    // This is the conversion: the parent has just stopped being sellable.
    if (parent.unitPriceCents !== null) {
      await db
        .update(revenueItemsTable)
        .set({ unitPriceCents: null, updatedAt: new Date() })
        .where(and(eq(revenueItemsTable.businessId, businessId), eq(revenueItemsTable.id, parentId)));
    }
    const openDirect = await findOpenDirectCost(parentId);
    if (openDirect) await closeCostComponent(businessId, openDirect.id);
  }

  // A new variant of a hidden product stays hidden — it must not turn up in a
  // picker its parent was deliberately taken out of.
  if (parent.status === "archived") {
    await db
      .update(revenueItemsTable)
      .set({ status: "archived", updatedAt: new Date() })
      .where(eq(revenueItemsTable.id, child.id));
  }
  return child;
}

/** True when the item has at least one variant — it groups, it doesn't sell. */
export async function revenueItemHasVariants(itemId: string): Promise<boolean> {
  const [child] = await db
    .select({ id: revenueItemsTable.id })
    .from(revenueItemsTable)
    .where(eq(revenueItemsTable.parentId, itemId))
    .limit(1);
  return Boolean(child);
}

export async function getRevenueItem(businessId: string, itemId: string) {
  const [item] = await db
    .select()
    .from(revenueItemsTable)
    .where(and(eq(revenueItemsTable.businessId, businessId), eq(revenueItemsTable.id, itemId)));
  if (!item) throw notFound("Revenue item");
  return item;
}

export async function updateRevenueItem(
  businessId: string,
  itemId: string,
  input: {
    name?: string;
    type?: RevenueItemType;
    pricingModel?: PricingModel;
    unitPriceCents?: number | null;
    categoryId?: string | null;
    unitLabel?: string;
    defaultBillingCycle?: BillingCycle | null;
    tiers?: PricingTier[] | null;
    notes?: string | null;
    status?: "active" | "archived";
  },
) {
  const item = await getRevenueItem(businessId, itemId);
  const nextPricingModel = input.pricingModel ?? (item.pricingModel as PricingModel);
  const nextType = input.type ?? (item.type as RevenueItemType);
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (input.name !== undefined) {
    if (!input.name.trim()) throw invalid("Item name is required");
    patch.name = input.name.trim();
  }
  if (input.type !== undefined) {
    if (!revenueItemTypeValues.includes(input.type)) throw invalid(`Unknown revenue item type "${input.type}"`);
    patch.type = input.type;
  }
  if (input.pricingModel !== undefined) patch.pricingModel = input.pricingModel;
  if (input.unitPriceCents !== undefined) {
    const price = input.unitPriceCents;
    if (await revenueItemHasVariants(itemId)) {
      if (price !== null) throw invalid("An item with variants carries no price of its own — price the variants");
    } else if (nextPricingModel === "variable") {
      if (price !== null) throw invalid("Variable-priced items must not carry a fixed unit price");
    } else if (price === null) {
      throw invalid(`Pricing model "${nextPricingModel}" requires a unit price`);
    } else if (!Number.isSafeInteger(price) || price < 0) {
      throw invalid("Unit price must be non-negative integer cents");
    }
    patch.unitPriceCents = price;
  }
  if (input.defaultBillingCycle !== undefined) {
    patch.defaultBillingCycle = validateBillingCycle(nextType, input.defaultBillingCycle);
  }
  if (input.tiers !== undefined) {
    patch.tiersJson = validateTiers(nextPricingModel, input.tiers);
  }
  if (input.categoryId !== undefined) {
    await assertOwnedRefs(businessId, { categoryIds: [input.categoryId] });
    patch.categoryId = input.categoryId ?? null;
  }
  if (input.unitLabel !== undefined) patch.unitLabel = input.unitLabel;
  if (input.notes !== undefined) patch.notes = input.notes ?? null;
  if (input.status !== undefined) patch.status = input.status;

  const [updated] = await db
    .update(revenueItemsTable)
    .set(patch)
    .where(and(eq(revenueItemsTable.businessId, businessId), eq(revenueItemsTable.id, itemId)))
    .returning();

  /**
   * Variants follow their parent.
   *
   * Archiving only the parent would hide the group while leaving every variant
   * in the pickers — and the variants are the rows that actually sell, so the
   * product would go on selling after being put away. Restoring works the same
   * way round: "this is back" means all of it.
   *
   * Nothing is deleted and no money moves. Status is a visibility flag; past
   * transactions keep their lines, their names and their frozen costs.
   */
  if (input.status !== undefined) {
    const descendants = (await revenueItemSubtreeIds(businessId, itemId)).filter((id) => id !== itemId);
    if (descendants.length > 0) {
      await db
        .update(revenueItemsTable)
        .set({ status: input.status, updatedAt: new Date() })
        .where(and(eq(revenueItemsTable.businessId, businessId), inArray(revenueItemsTable.id, descendants)));
    }
  }
  return updated;
}

/** Replace an item's source links with the given set (add/update/remove). */
export async function setRevenueItemSourceLinks(
  businessId: string,
  itemId: string,
  links: Array<{ sourceId: string; priceOverrideCents?: number | null; externalId?: string | null }>,
) {
  await getRevenueItem(businessId, itemId);
  const wanted = new Map(links.map((l) => [l.sourceId, l]));
  for (const l of links) await getSource(businessId, l.sourceId);

  const existing = await db.select().from(revenueItemSourcesTable).where(eq(revenueItemSourcesTable.revenueItemId, itemId));
  const existingBySource = new Map(existing.map((e) => [e.sourceId, e]));

  for (const [sourceId, link] of wanted) {
    const found = existingBySource.get(sourceId);
    if (found) {
      await db
        .update(revenueItemSourcesTable)
        .set({ priceOverrideCents: link.priceOverrideCents ?? null, externalId: link.externalId ?? null, updatedAt: new Date() })
        .where(eq(revenueItemSourcesTable.id, found.id));
    } else {
      await db.insert(revenueItemSourcesTable).values({
        id: uid("ris"),
        revenueItemId: itemId,
        sourceId,
        priceOverrideCents: link.priceOverrideCents ?? null,
        externalId: link.externalId ?? null,
      });
    }
  }
  for (const e of existing) {
    if (!wanted.has(e.sourceId)) await db.delete(revenueItemSourcesTable).where(eq(revenueItemSourcesTable.id, e.id));
  }
}

// ---------------------------------------------------------------------------
// Expense items
// ---------------------------------------------------------------------------

/**
 * The nature to store. The owner's choice always wins; when they didn't make
 * one, the purpose's usual nature fills in rather than a blanket default, so a
 * quickly-added "Payroll" lands as fixed without anyone thinking about it.
 */
function resolveCostNature(chosen: CostNature | undefined, purpose: ExpenseItemPurpose): CostNature {
  if (chosen === undefined) return defaultNatureFor(purpose);
  if (!isCostNature(chosen)) throw invalid(`Unknown cost nature "${chosen}"`);
  return chosen;
}

export async function createExpenseItem(
  businessId: string,
  input: {
    name: string;
    type: ExpenseItemPurpose;
    costNature?: CostNature;
    behavior?: ExpenseBehavior;
    defaultAmountCents?: number | null;
    /** What one of it is — "bag", "day", "tonne". Null when it is not counted. */
    unitLabel?: string | null;
    categoryId?: string | null;
    vendorName?: string | null;
    currency?: string;
    notes?: string | null;
  },
) {
  if (!input.name.trim()) throw invalid("Item name is required");
  // The legacy "fixed"/"variable" types fail here by construction: they are
  // natures, and letting one back in would re-merge the two axes.
  if (!expenseItemPurposeValues.includes(input.type)) throw invalid(`Unknown expense item type "${input.type}"`);
  const costNature = resolveCostNature(input.costNature, input.type);
  const behavior = input.behavior ?? "one_time";
  if (!expenseBehaviorValues.includes(behavior)) throw invalid(`Unknown behavior "${behavior}"`);
  if (
    input.defaultAmountCents !== null &&
    input.defaultAmountCents !== undefined &&
    (!Number.isSafeInteger(input.defaultAmountCents) || input.defaultAmountCents < 0)
  ) {
    throw invalid("Default amount must be non-negative integer cents");
  }

  const name = input.name.trim();
  // Names are unique per business. Say so in words: every business now starts
  // with a seeded list, so typing an existing name is an ordinary mistake and
  // must not surface as a database constraint error.
  const clash = await findExpenseItemByName(businessId, name);
  if (clash) throw invalid(`You already have an expense called "${clash.name}"`);
  await assertOwnedRefs(businessId, { categoryIds: [input.categoryId] });

  const vendorPersonId = input.vendorName?.trim()
    ? (await findOrCreatePerson(businessId, { name: input.vendorName.trim(), kind: "vendor" })).id
    : null;

  const [item] = await db
    .insert(expenseItemsTable)
    .values({
      id: uid("ei"),
      businessId,
      name,
      type: input.type,
      costNature,
      behavior,
      defaultAmountCents: input.defaultAmountCents ?? null,
      categoryId: input.categoryId ?? null,
      vendorPersonId,
      currency: input.currency ?? "PKR",
      notes: input.notes ?? null,
      unitLabel: input.unitLabel?.trim() || null,
    })
    .returning();
  return item;
}

export async function findExpenseItemByName(businessId: string, name: string) {
  const [item] = await db
    .select()
    .from(expenseItemsTable)
    .where(and(eq(expenseItemsTable.businessId, businessId), eq(expenseItemsTable.name, name.trim())));
  return item ?? null;
}

/**
 * Create, or adopt the row that already carries this name. Used by seeding and
 * demo data, which now run against businesses that start with a starter list —
 * a plain create would collide on names like "Software subscriptions".
 */
export async function findOrCreateExpenseItem(
  businessId: string,
  input: Parameters<typeof createExpenseItem>[1],
) {
  const existing = await findExpenseItemByName(businessId, input.name);
  if (!existing) return createExpenseItem(businessId, input);
  return updateExpenseItem(businessId, existing.id, {
    type: input.type,
    costNature: input.costNature,
    behavior: input.behavior,
    defaultAmountCents: input.defaultAmountCents ?? null,
    // Only when the caller said so. Every other field here is overwritten
    // wholesale because a seeder owns the row it is describing — but the
    // starter list already sets units on the things a trade counts, and a
    // caller that simply has no opinion must not silently erase one.
    ...(input.unitLabel !== undefined ? { unitLabel: input.unitLabel } : {}),
    categoryId: input.categoryId ?? null,
    notes: input.notes ?? null,
  });
}

export async function getExpenseItem(businessId: string, itemId: string) {
  const [item] = await db
    .select()
    .from(expenseItemsTable)
    .where(and(eq(expenseItemsTable.businessId, businessId), eq(expenseItemsTable.id, itemId)));
  if (!item) throw notFound("Expense item");
  return item;
}

export async function updateExpenseItem(
  businessId: string,
  itemId: string,
  input: {
    name?: string;
    type?: ExpenseItemPurpose;
    costNature?: CostNature;
    behavior?: ExpenseBehavior;
    defaultAmountCents?: number | null;
    unitLabel?: string | null;
    categoryId?: string | null;
    vendorName?: string | null;
    notes?: string | null;
    status?: "active" | "archived";
  },
) {
  await getExpenseItem(businessId, itemId);
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (input.name !== undefined) {
    if (!input.name.trim()) throw invalid("Item name is required");
    patch.name = input.name.trim();
  }
  if (input.type !== undefined) {
    if (!expenseItemPurposeValues.includes(input.type)) throw invalid(`Unknown expense item type "${input.type}"`);
    patch.type = input.type;
  }
  // Changing the purpose never silently re-natures the row: an owner who set
  // "marketing, fixed" for a retainer keeps fixed when they re-file it.
  if (input.costNature !== undefined) {
    if (!isCostNature(input.costNature)) throw invalid(`Unknown cost nature "${input.costNature}"`);
    patch.costNature = input.costNature;
  }
  if (input.behavior !== undefined) {
    if (!expenseBehaviorValues.includes(input.behavior)) throw invalid(`Unknown behavior "${input.behavior}"`);
    patch.behavior = input.behavior;
  }
  if (input.defaultAmountCents !== undefined) patch.defaultAmountCents = input.defaultAmountCents ?? null;
  // Changing the word does NOT restate history: every line froze its own unit
  // at write time, so past purchases keep the word they were counted in.
  if (input.unitLabel !== undefined) patch.unitLabel = input.unitLabel?.trim() || null;
  if (input.categoryId !== undefined) {
    await assertOwnedRefs(businessId, { categoryIds: [input.categoryId] });
    patch.categoryId = input.categoryId ?? null;
  }
  if (input.vendorName !== undefined) {
    patch.vendorPersonId = input.vendorName?.trim()
      ? (await findOrCreatePerson(businessId, { name: input.vendorName.trim(), kind: "vendor" })).id
      : null;
  }
  if (input.notes !== undefined) patch.notes = input.notes ?? null;
  if (input.status !== undefined) patch.status = input.status;

  const [updated] = await db
    .update(expenseItemsTable)
    .set(patch)
    .where(and(eq(expenseItemsTable.businessId, businessId), eq(expenseItemsTable.id, itemId)))
    .returning();
  return updated;
}

// ---------------------------------------------------------------------------
// Cost components (effective-dated; never mutated in place)
// ---------------------------------------------------------------------------

function validateComponentValue(calcType: CostCalcType, valueCents: number | null, valueRate: string | null) {
  if (!costCalcTypeValues.includes(calcType)) throw invalid(`Unknown calc type "${calcType}"`);
  if (calcType === "fixed_per_unit") {
    if (valueCents === null || valueRate !== null) throw invalid("fixed_per_unit takes value_cents only");
    if (!Number.isSafeInteger(valueCents) || valueCents < 0) throw invalid("value_cents must be non-negative integer cents");
  } else {
    if (valueRate === null || valueCents !== null) throw invalid(`${calcType} takes value_rate only`);
    if (!/^\d+(\.\d+)?$/.test(valueRate)) throw invalid("value_rate must be a non-negative decimal string");
  }
}

export async function addCostComponent(
  businessId: string,
  revenueItemId: string,
  input: {
    name: string;
    calcType: CostCalcType;
    valueCents?: number | null;
    valueRate?: string | null;
    isFee?: boolean | null;
    sourceId?: string | null;
    effectiveFrom?: Date;
  },
) {
  await getRevenueItem(businessId, revenueItemId);
  if (!input.name.trim()) throw invalid("Component name is required");
  const valueCents = input.valueCents ?? null;
  const valueRate = input.valueRate ?? null;
  validateComponentValue(input.calcType, valueCents, valueRate);
  if (input.sourceId) await getSource(businessId, input.sourceId);

  const [component] = await db
    .insert(costComponentsTable)
    .values({
      id: uid("cc"),
      revenueItemId,
      name: input.name.trim(),
      calcType: input.calcType,
      valueCents,
      valueRate,
      isFee: input.isFee ?? null,
      sourceId: input.sourceId ?? null,
      effectiveFrom: input.effectiveFrom ?? new Date(),
      effectiveTo: null,
    })
    .returning();
  return component;
}

/**
 * The effective-dated edit: closes the open version at `effectiveFrom` and
 * inserts the successor. Historical transactions keep their frozen snapshots;
 * only lines created after `effectiveFrom` see the new values.
 */
export async function updateCostComponent(
  businessId: string,
  componentId: string,
  input: {
    valueCents?: number | null;
    valueRate?: string | null;
    isFee?: boolean | null;
    effectiveFrom?: Date;
  },
) {
  const [current] = await db.select().from(costComponentsTable).where(eq(costComponentsTable.id, componentId));
  if (!current) throw notFound("Cost component");
  await getRevenueItem(businessId, current.revenueItemId); // business scoping
  if (current.effectiveTo !== null) throw invalid("Only the open version of a component can be edited");

  const effectiveFrom = input.effectiveFrom ?? new Date();
  if (effectiveFrom.getTime() < current.effectiveFrom.getTime()) {
    throw invalid("The new version cannot start before the current one");
  }

  const valueCents = input.valueCents !== undefined ? input.valueCents : current.valueCents;
  const valueRate = input.valueRate !== undefined ? input.valueRate : current.valueRate;
  validateComponentValue(current.calcType as CostCalcType, valueCents, valueRate);

  return db.transaction(async (tx) => {
    await tx
      .update(costComponentsTable)
      .set({ effectiveTo: effectiveFrom, updatedAt: new Date() })
      .where(and(eq(costComponentsTable.id, current.id), isNull(costComponentsTable.effectiveTo)));
    const [next] = await tx
      .insert(costComponentsTable)
      .values({
        id: uid("cc"),
        revenueItemId: current.revenueItemId,
        name: current.name,
        calcType: current.calcType,
        valueCents,
        valueRate,
        isFee: input.isFee !== undefined ? input.isFee : current.isFee,
        sourceId: current.sourceId,
        effectiveFrom,
        effectiveTo: null,
      })
      .returning();
    return next;
  });
}

/** Every version (open and closed) for an item — the input to snapshot building. */
export async function listCostComponents(revenueItemId: string) {
  return db.select().from(costComponentsTable).where(eq(costComponentsTable.revenueItemId, revenueItemId));
}

/** Retire a component: close the open version with no successor. History stays frozen. */
export async function closeCostComponent(businessId: string, componentId: string, effectiveTo?: Date) {
  const [current] = await db.select().from(costComponentsTable).where(eq(costComponentsTable.id, componentId));
  if (!current) throw notFound("Cost component");
  await getRevenueItem(businessId, current.revenueItemId);
  if (current.effectiveTo !== null) throw invalid("This component version is already closed");
  const closeAt = effectiveTo ?? new Date();
  if (closeAt.getTime() < current.effectiveFrom.getTime()) throw invalid("Close date cannot be before the version started");
  const [closed] = await db
    .update(costComponentsTable)
    .set({ effectiveTo: closeAt, updatedAt: new Date() })
    .where(and(eq(costComponentsTable.id, componentId), isNull(costComponentsTable.effectiveTo)))
    .returning();
  return closed;
}

export async function getCostComponentSource(businessId: string, componentId: string) {
  const [component] = await db.select().from(costComponentsTable).where(eq(costComponentsTable.id, componentId));
  if (!component) throw notFound("Cost component");
  await getRevenueItem(businessId, component.revenueItemId);
  return component;
}
