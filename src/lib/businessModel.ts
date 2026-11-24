import type { BusinessModel, Product, Settings } from "./types";
import { isPhysicalOffer, type OfferType } from "./offers";

export const BUSINESS_MODEL_OPTIONS: {
  value: BusinessModel;
  label: string;
  description: string;
}[] = [
  {
    value: "products",
    label: "Products",
    description: "Physical goods you buy or make and then sell.",
  },
  {
    value: "services",
    label: "Services",
    description: "Service packages, direct delivery costs, and rates.",
  },
  {
    value: "subscriptions",
    label: "Subscriptions",
    description: "Recurring plans and subscription revenue.",
  },
  {
    value: "freelance_projects",
    label: "Freelance/Projects",
    description: "Client work, projects, retainers, and project revenue.",
  },
  {
    value: "digital_products",
    label: "Digital Products",
    description: "Downloads, courses, templates, and other digital offers.",
  },
  {
    value: "mixed",
    label: "Mixed Business",
    description: "Show all offer types and flexible workflows.",
  },
];

const BUSINESS_MODEL_VALUES = new Set<BusinessModel>(
  BUSINESS_MODEL_OPTIONS.map((option) => option.value),
);

export function hasPhysicalProductOffers(products: Product[] = []): boolean {
  return products.some(isPhysicalOffer);
}

export function normalizeBusinessModels(value: unknown): BusinessModel[] {
  if (!Array.isArray(value)) return [];
  const models = value.filter((model): model is BusinessModel =>
    typeof model === "string" && BUSINESS_MODEL_VALUES.has(model as BusinessModel),
  );
  return Array.from(new Set(models));
}

export function getEffectiveBusinessModels(
  settings?: Partial<Settings> | null,
  products: Product[] = [],
): BusinessModel[] {
  const stored = normalizeBusinessModels(settings?.businessModels);
  if (stored.length) return stored;
  if (hasPhysicalProductOffers(products)) return ["products"];
  return ["mixed"];
}

export function hasBusinessModel(
  settingsOrModels: Partial<Settings> | BusinessModel[] | undefined | null,
  model: BusinessModel,
  products: Product[] = [],
): boolean {
  const models = Array.isArray(settingsOrModels)
    ? normalizeBusinessModels(settingsOrModels)
    : getEffectiveBusinessModels(settingsOrModels, products);
  return models.includes("mixed") || models.includes(model);
}

export function getAllowedOfferTypes(models: BusinessModel[]): OfferType[] {
  if (models.includes("mixed")) {
    return [
      "physical_product",
      "digital_product",
      "service",
      "subscription",
      "project",
      "package",
      "retainer",
      "custom",
    ];
  }

  const allowed = new Set<OfferType>(["custom"]);
  if (models.includes("products")) allowed.add("physical_product");
  if (models.includes("services")) {
    allowed.add("service");
    allowed.add("package");
  }
  if (models.includes("subscriptions")) allowed.add("subscription");
  if (models.includes("freelance_projects")) {
    allowed.add("project");
    allowed.add("service");
    allowed.add("retainer");
  }
  if (models.includes("digital_products")) allowed.add("digital_product");
  return Array.from(allowed);
}

