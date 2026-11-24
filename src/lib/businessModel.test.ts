import test from "node:test";
import assert from "node:assert/strict";
import {
  getAllowedOfferTypes,
  getEffectiveBusinessModels,
  hasPhysicalProductOffers,
} from "./businessModel";
import type { Product } from "./types";

function product(patch: Partial<Product>): Product {
  return {
    id: "prod_1",
    name: "Offer",
    category: null,
    defaultCostPrice: 0,
    defaultSellingPrice: 0,
    packagingCost: 0,
    defaultShippingCost: 0,
    imageColor: "210 8% 50%",
    supplier: null,
    lowStockAlertLevel: 10,
    status: "active",
    notes: null,
    ...patch,
  };
}

test("spots a physical product offer among service offers", () => {
  const products = [
    product({ id: "service", category: "offer_type:service" }),
    product({ id: "physical", category: "Apparel", sku: "APP-1" }),
  ];

  assert.equal(hasPhysicalProductOffers(products), true);
});

test("finds no physical product offer in service-only data", () => {
  const products = [
    product({ id: "service", category: "offer_type:service" }),
    product({ id: "retainer", category: "offer_type:retainer" }),
  ];

  assert.equal(hasPhysicalProductOffers(products), false);
});

test("defaults empty workspaces to mixed business", () => {
  assert.deepEqual(getEffectiveBusinessModels({ businessModels: [] }, []), ["mixed"]);
});

test("limits offer types to selected business models", () => {
  assert.deepEqual(getAllowedOfferTypes(["services"]), ["custom", "service", "package"]);
  assert.ok(getAllowedOfferTypes(["mixed"]).includes("subscription"));
});
