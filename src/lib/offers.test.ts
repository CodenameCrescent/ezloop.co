import test from "node:test";
import assert from "node:assert/strict";
import {
  getProductOfferType,
  getPhysicalProductCategory,
  isPhysicalOffer,
  productToOffer,
} from "./offers";
import type { Product } from "./types";

function product(patch: Partial<Product> = {}): Product {
  return {
    id: "prod_1",
    name: "Core Offer",
    category: "Apparel",
    defaultCostPrice: 40,
    defaultSellingPrice: 100,
    packagingCost: 5,
    defaultShippingCost: 10,
    imageColor: "210 90% 55%",
    supplier: "Supplier",
    lowStockAlertLevel: 10,
    status: "active",
    notes: null,
    ...patch,
  };
}

test("maps existing products to physical product offers", () => {
  const existing = product();
  const offer = productToOffer(existing);

  assert.equal(getProductOfferType(existing), "physical_product");
  assert.equal(isPhysicalOffer(existing), true);
  assert.equal(getPhysicalProductCategory(existing), "Apparel");
  assert.equal(offer.offerType, "physical_product");
  assert.equal(offer.offerTypeLabel, "Physical Product");
  assert.equal(offer.supplier, "Supplier");
  assert.equal(offer.price, 100);
  assert.equal(offer.directCost, 40);
});

test("maps non-product offer types through the compatibility category field", () => {
  const service = product({
    category: "offer_type:service",
    supplier: "Should hide",
  });
  const offer = productToOffer(service);

  assert.equal(getProductOfferType(service), "service");
  assert.equal(isPhysicalOffer(service), false);
  assert.equal(getPhysicalProductCategory(service), "");
  assert.equal(offer.offerTypeLabel, "Service");
  assert.equal(offer.supplier, null);
  assert.equal(offer.physicalCategory, null);
});
