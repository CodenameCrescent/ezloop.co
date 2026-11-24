import type { BusinessType } from "@workspace/domain";
import type { CostNature, ExpenseBehavior, ExpenseItemPurpose } from "@workspace/db";

/**
 * The expense types a brand-new business starts with, chosen by business type.
 *
 * This is a CONVENIENCE, never a permission: expense types stay user-created
 * and unlimited for every business type (DECISIONS, 2026-07-27). Nothing here
 * restricts what anyone may add — a freelancer simply shouldn't be handed
 * "COD fee" on day one, and a shop shouldn't have to invent "Rent" itself.
 *
 * Every row states its cost nature explicitly rather than leaning on the
 * purpose default, because the defaults are only a coin-flip on broad buckets:
 * courier fees and rent are both "running the business", and only one of them
 * grows with sales. Break-even is only as good as these classifications, and
 * these are the first ones an owner ever sees.
 */

export interface StarterExpenseType {
  name: string;
  type: ExpenseItemPurpose;
  costNature: CostNature;
  behavior: ExpenseBehavior;
  /**
   * What one of it IS, for the things that are genuinely counted. Set only
   * where a quantity is the natural way to buy it — rent is an amount, cement
   * is 200 bags — because a unit on something nobody counts turns fast entry
   * into a question with no good answer.
   */
  unitLabel?: string;
}

/** Overheads every business carries, whatever it sells. */
const SHARED: StarterExpenseType[] = [
  { name: "Rent", type: "operational", costNature: "fixed", behavior: "recurring" },
  { name: "Salaries", type: "payroll", costNature: "fixed", behavior: "recurring" },
  { name: "Software subscriptions", type: "operational", costNature: "fixed", behavior: "recurring" },
  { name: "Utilities", type: "operational", costNature: "semi_variable", behavior: "recurring" },
  { name: "Accounting and legal", type: "operational", costNature: "fixed", behavior: "recurring" },
  { name: "Bank and payment fees", type: "operational", costNature: "variable", behavior: "usage_based" },
  { name: "Advertising", type: "marketing", costNature: "variable", behavior: "usage_based" },
];

const BY_BUSINESS_TYPE: Record<BusinessType, StarterExpenseType[]> = {
  /**
   * A builder's costs are mostly VARIABLE and mostly attach to a site: more
   * work means more concrete, more subcontractors, more plant on hire. What
   * stays fixed is the yard and the head office, which are in SHARED. Getting
   * this split right is what makes break-even mean anything for them.
   */
  construction: [
    ...SHARED,
    // Units on the ones that are genuinely COUNTED. A builder buys 200 bags,
    // not "Rs 50,000 of cement", and the unit is what makes waste and cost per
    // unit answerable at all. Site services and permits get none: they are
    // amounts, not quantities, and inventing a unit for them would ask the
    // owner a question with no sensible answer.
    { name: "Materials", type: "cogs", costNature: "variable", behavior: "usage_based", unitLabel: "unit" },
    { name: "Subcontractors", type: "cogs", costNature: "variable", behavior: "usage_based", unitLabel: "day" },
    { name: "Plant and equipment hire", type: "operational", costNature: "variable", behavior: "usage_based", unitLabel: "day" },
    { name: "Fuel", type: "operational", costNature: "variable", behavior: "usage_based", unitLabel: "litre" },
    { name: "Site services", type: "operational", costNature: "variable", behavior: "usage_based" },
    { name: "Permits and inspections", type: "operational", costNature: "variable", behavior: "one_time" },
    { name: "Safety and protective equipment", type: "operational", costNature: "variable", behavior: "usage_based" },
    { name: "Tool and equipment repairs", type: "maintenance", costNature: "semi_variable", behavior: "usage_based" },
  ],
  /**
   * A factory's line is the mirror image: raw materials and consumables scale
   * with output, while the machines that make it are a fixed cost of being open
   * at all. Scrap is its own row on purpose — it is the number that tells a
   * manufacturer whether the process is under control.
   */
  manufacturing: [
    ...SHARED,
    { name: "Raw materials", type: "cogs", costNature: "variable", behavior: "usage_based", unitLabel: "kg" },
    { name: "Consumables", type: "cogs", costNature: "variable", behavior: "usage_based", unitLabel: "unit" },
    { name: "Packaging", type: "cogs", costNature: "variable", behavior: "usage_based" },
    { name: "Freight and delivery", type: "cogs", costNature: "variable", behavior: "usage_based" },
    { name: "Machine maintenance", type: "maintenance", costNature: "semi_variable", behavior: "recurring" },
    { name: "Factory utilities", type: "operational", costNature: "semi_variable", behavior: "recurring" },
    { name: "Quality control and scrap", type: "operational", costNature: "variable", behavior: "usage_based" },
  ],
  ecommerce: [
    ...SHARED,
    { name: "Packaging", type: "cogs", costNature: "variable", behavior: "usage_based" },
    { name: "Courier and delivery", type: "cogs", costNature: "variable", behavior: "usage_based" },
    { name: "Stock purchases", type: "cogs", costNature: "variable", behavior: "usage_based" },
    { name: "Warehouse and storage", type: "operational", costNature: "fixed", behavior: "recurring" },
    { name: "Returns and restocking", type: "operational", costNature: "variable", behavior: "usage_based" },
  ],
  service: [
    ...SHARED,
    { name: "Contractors and freelancers", type: "payroll", costNature: "variable", behavior: "usage_based" },
    { name: "Client project costs", type: "cogs", costNature: "variable", behavior: "usage_based" },
    { name: "Equipment and tools", type: "maintenance", costNature: "variable", behavior: "one_time" },
    { name: "Training and certification", type: "operational", costNature: "variable", behavior: "one_time" },
    { name: "Insurance", type: "operational", costNature: "fixed", behavior: "recurring" },
  ],
};

export function starterExpenseTypes(businessType: BusinessType): StarterExpenseType[] {
  return BY_BUSINESS_TYPE[businessType] ?? BY_BUSINESS_TYPE.ecommerce;
}
