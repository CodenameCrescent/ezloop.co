import type { Product } from "./types";

export const OFFER_TYPES = [
  { value: "physical_product", label: "Physical Product" },
  { value: "digital_product", label: "Digital Product" },
  { value: "service", label: "Service" },
  { value: "subscription", label: "Subscription" },
  { value: "project", label: "Project" },
  { value: "package", label: "Package" },
  { value: "retainer", label: "Retainer" },
  { value: "custom", label: "Custom Revenue Source" },
] as const;

export type OfferType = (typeof OFFER_TYPES)[number]["value"];

const OFFER_TYPE_VALUES = new Set<string>(OFFER_TYPES.map((item) => item.value));
const OFFER_TYPE_CATEGORY_PREFIX = "offer_type:";

export function isOfferType(value: unknown): value is OfferType {
  return typeof value === "string" && OFFER_TYPE_VALUES.has(value);
}

export function offerTypeLabel(type: OfferType): string {
  return OFFER_TYPES.find((item) => item.value === type)?.label ?? "Custom Revenue Source";
}

export function getProductOfferType(product: Product): OfferType {
  const raw = product.category ?? "";
  const encoded = raw.startsWith(OFFER_TYPE_CATEGORY_PREFIX)
    ? raw.slice(OFFER_TYPE_CATEGORY_PREFIX.length)
    : "";
  return isOfferType(encoded) ? encoded : "physical_product";
}

export function productCategoryForOfferType(type: OfferType): string | null {
  return type === "physical_product" ? null : `${OFFER_TYPE_CATEGORY_PREFIX}${type}`;
}

export function isPhysicalOffer(productOrType: Product | OfferType): boolean {
  const type =
    typeof productOrType === "string" ? productOrType : getProductOfferType(productOrType);
  return type === "physical_product";
}

export function getProductOfferTypeLabel(product: Product): string {
  return offerTypeLabel(getProductOfferType(product));
}

export function getPhysicalProductCategory(product: Product): string {
  return product.category?.startsWith(OFFER_TYPE_CATEGORY_PREFIX) ? "" : product.category ?? "";
}

export interface OfferView {
  id: string;
  product: Product;
  name: string;
  offerType: OfferType;
  offerTypeLabel: string;
  price: number;
  directCost: number;
  status: "active" | "inactive";
  notes: string | null;
  isPhysicalProduct: boolean;
  supplier: string | null;
  physicalCategory: string | null;
}

export function productToOffer(product: Product): OfferView {
  const offerType = getProductOfferType(product);
  const isPhysicalProduct = offerType === "physical_product";
  return {
    id: product.id,
    product,
    name: product.name,
    offerType,
    offerTypeLabel: offerTypeLabel(offerType),
    price: product.defaultSellingPrice,
    directCost: product.defaultCostPrice,
    status: product.status === "active" ? "active" : "inactive",
    notes: product.notes,
    isPhysicalProduct,
    supplier: isPhysicalProduct ? product.supplier : null,
    physicalCategory: isPhysicalProduct ? getPhysicalProductCategory(product) || null : null,
  };
}
