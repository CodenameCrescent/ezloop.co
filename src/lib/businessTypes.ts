import type { BusinessType } from "@workspace/domain";

/**
 * The two questions asked when a business is created, and again in Settings.
 *
 * Shared rather than written twice: the wording is what an owner uses to decide
 * which one they are, and two lists would eventually describe the same choice
 * differently on the screen that creates a business and the screen that changes
 * it. Only two types today; retail and digital are deferred and cheap to add.
 */
export const BUSINESS_TYPE_OPTIONS: { value: BusinessType; label: string; description: string }[] = [
  {
    value: "ecommerce",
    label: "Ecommerce",
    description: "You ship physical orders. Unlocks order outcomes, returns, courier and COD costs.",
  },
  {
    value: "service",
    label: "Service",
    description: "You sell time, projects, or subscriptions. Shipping and returns stay hidden.",
  },
  {
    value: "construction",
    label: "Construction",
    description: "You work site by site. Unlocks projects, so costs and invoices belong to a job.",
  },
  {
    value: "manufacturing",
    label: "Manufacturing",
    description: "You make things in batches. Unlocks production runs and cost per unit made.",
  },
];

/**
 * Common currencies, offered as a starting point rather than a limit — Settings
 * lets an owner type any symbol afterwards.
 *
 * The code and the symbol travel together on purpose. They are two halves of one
 * choice, and letting them be picked separately is how a business ends up
 * labelled "PKR" and printed with "$". Neither converts anything: the server
 * already reports in the business's own currency, so this pair is a LABEL
 * (CLAUDE.md).
 */
export const CURRENCY_OPTIONS: { code: string; symbol: string; label: string }[] = [
  { code: "PKR", symbol: "Rs", label: "Pakistani rupee" },
  { code: "INR", symbol: "₹", label: "Indian rupee" },
  { code: "USD", symbol: "$", label: "US dollar" },
  { code: "EUR", symbol: "€", label: "Euro" },
  { code: "GBP", symbol: "£", label: "Pound sterling" },
  { code: "AED", symbol: "AED", label: "UAE dirham" },
  { code: "SAR", symbol: "SAR", label: "Saudi riyal" },
  { code: "CAD", symbol: "CA$", label: "Canadian dollar" },
  { code: "AUD", symbol: "A$", label: "Australian dollar" },
];

export function currencySymbolFor(code: string): string {
  return CURRENCY_OPTIONS.find((option) => option.code === code)?.symbol ?? code;
}
