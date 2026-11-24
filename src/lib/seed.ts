import type { AppData, Order, AdSpendEntry } from "./types";

function uid(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

// ── Shared constants — verbatim copy of server-side seed.ts definitions ───────
// Any change here must be mirrored in artifacts/api-server/src/lib/seed.ts

export const DEMO_PRODUCTS: Array<{
  name: string;
  category: string | null;
  defaultCostPrice: number;
  defaultSellingPrice: number;
  packagingCost: number;
  defaultShippingCost: number;
  imageColor: string;
  supplier: string | null;
  status: string;
  notes: string | null;
}> = [
  { name: "Wireless Earbuds Pro", category: "Electronics", defaultCostPrice: 850,  defaultSellingPrice: 2499, packagingCost: 60, defaultShippingCost: 120, imageColor: "158 70% 48%", supplier: "Tech Galaxy Imports", status: "active", notes: null },
  { name: "Face Serum 30ml",       category: "Beauty",      defaultCostPrice: 950,  defaultSellingPrice: 3499, packagingCost: 70, defaultShippingCost: 120, imageColor: "330 80% 60%", supplier: "Derma Essentials PK", status: "active", notes: null },
  { name: "Leather Wallet",       category: "Accessories", defaultCostPrice: 420,  defaultSellingPrice: 1299, packagingCost: 45, defaultShippingCost: 90,  imageColor: "38 92% 60%",  supplier: "Karachi Leather Works", status: "active", notes: null },
  { name: "Fashion Sneakers",     category: "Footwear",    defaultCostPrice: 1300, defaultSellingPrice: 2640, packagingCost: 90, defaultShippingCost: 180, imageColor: "217 91% 62%", supplier: "Metro Footwear Co.", status: "active", notes: null },
  { name: "Cotton Kurta",         category: "Apparel",     defaultCostPrice: 680,  defaultSellingPrice: 1199, packagingCost: 55, defaultShippingCost: 130, imageColor: "354 78% 62%", supplier: "Lahore Textile Mills", status: "active", notes: null },
  { name: "USB-C Hub 7-in-1",      category: "Electronics", defaultCostPrice: 1200, defaultSellingPrice: 2199, packagingCost: 60, defaultShippingCost: 120, imageColor: "190 80% 55%", supplier: "Tech Galaxy Imports", status: "active", notes: null },
  { name: "Scented Candle Set",   category: "Home",        defaultCostPrice: 750,  defaultSellingPrice: 1099, packagingCost: 80, defaultShippingCost: 100, imageColor: "25 95% 58%",  supplier: "Aroma Craft Studio", status: "active", notes: null },
  { name: "Gym Water Bottle",     category: "Fitness",     defaultCostPrice: 480,  defaultSellingPrice: 799,  packagingCost: 35, defaultShippingCost: 90,  imageColor: "271 76% 66%", supplier: "FitGear Wholesale", status: "active", notes: null },
];

export const DEMO_EXPENSES: Array<{
  name: string;
  amount: number;
  type: "FIXED" | "VARIABLE" | "CUSTOM";
  frequency: string | null;
  category: string | null;
  note: string | null;
}> = [
  { name: "Office Rent",         amount: 15000, type: "FIXED",  frequency: "Monthly", category: null,        note: "Monthly shop rent — Al-Rehman Arcade" },
  { name: "Staff Salary",        amount: 35000, type: "FIXED",  frequency: "Monthly", category: null,        note: "1 full-time packing assistant" },
  { name: "Packaging Materials", amount: 4200,  type: "FIXED",  frequency: "Weekly",  category: null,        note: "Boxes, bubble wrap, tape, labels" },
  { name: "Barcode Scanner",     amount: 8500,  type: "CUSTOM", frequency: null,      category: "Equipment", note: "One-time purchase — Bluetooth scanner for packing desk" },
];

// ── Internal generators matching server-side logic exactly ────────────────────

const CUSTOMERS: Array<{ name: string; phone: string; weight: number }> = [
  { name: "Ahmed Khan",     phone: "0300-1234567", weight: 9 },
  { name: "Sara Malik",     phone: "0301-2345678", weight: 8 },
  { name: "Bilal Ahmed",    phone: "0302-3456789", weight: 7 },
  { name: "Hira Sheikh",    phone: "0303-4567890", weight: 6 },
  { name: "Usman Tariq",    phone: "0304-5678901", weight: 5 },
  { name: "Ayesha Riaz",    phone: "0305-6789012", weight: 5 },
  { name: "Fahad Iqbal",    phone: "0306-7890123", weight: 4 },
  { name: "Zainab Ali",     phone: "0307-8901234", weight: 4 },
  { name: "Hamza Qureshi",  phone: "0308-9012345", weight: 3 },
  { name: "Mariam Yousuf",  phone: "0309-0123456", weight: 3 },
  { name: "Imran Saeed",    phone: "0310-1234567", weight: 2 },
  { name: "Noor Fatima",    phone: "0311-2345678", weight: 2 },
  { name: "Kashif Mehmood", phone: "0312-3456789", weight: 2 },
  { name: "Sana Rauf",      phone: "0313-4567890", weight: 1 },
  { name: "Junaid Akhtar",  phone: "0316-7890123", weight: 1 },
];

// Sources: Manual / Meta / Shopify — matches server SOURCES
const SOURCES: Array<{ name: string; platform: string; weight: number }> = [
  { name: "Manual",  platform: "Own Store", weight: 50 },
  { name: "Meta",    platform: "Own Store", weight: 35 },
  { name: "Shopify", platform: "Shopify",   weight: 15 },
];

// perDay[dayIdx], dayIdx 0 = 6 days ago, 6 = today
const PRODUCT_ORDER_PLAN: Array<{
  productIndex: number;
  perDay: number[];
  deliveryCost: number;
  adCostFixed: number;
  discountChance: number;
  qty2Chance: number;
  qty3Chance: number;
}> = [
  { productIndex: 0, perDay: [2, 3, 2, 3, 4, 3, 3], deliveryCost: 120, adCostFixed: 125, discountChance: 0.10, qty2Chance: 0.20, qty3Chance: 0.05 },
  { productIndex: 1, perDay: [2, 2, 3, 3, 2, 2, 3], deliveryCost: 120, adCostFixed: 210, discountChance: 0.00, qty2Chance: 0.15, qty3Chance: 0.03 },
  { productIndex: 2, perDay: [2, 2, 2, 2, 2, 2, 2], deliveryCost: 90,  adCostFixed: 78,  discountChance: 0.15, qty2Chance: 0.10, qty3Chance: 0.00 },
  { productIndex: 3, perDay: [1, 2, 1, 1, 1, 1, 1], deliveryCost: 180, adCostFixed: 158, discountChance: 0.05, qty2Chance: 0.08, qty3Chance: 0.00 },
  { productIndex: 4, perDay: [1, 2, 1, 1, 1, 1, 2], deliveryCost: 130, adCostFixed: 96,  discountChance: 0.20, qty2Chance: 0.15, qty3Chance: 0.05 },
  { productIndex: 5, perDay: [0, 1, 1, 0, 1, 1, 1], deliveryCost: 120, adCostFixed: 132, discountChance: 0.00, qty2Chance: 0.00, qty3Chance: 0.00 },
  { productIndex: 6, perDay: [0, 1, 0, 0, 0, 1, 0], deliveryCost: 100, adCostFixed: 110, discountChance: 0.00, qty2Chance: 0.00, qty3Chance: 0.00 },
  { productIndex: 7, perDay: [1, 0, 0, 1, 0, 0, 0], deliveryCost: 90,  adCostFixed: 64,  discountChance: 0.00, qty2Chance: 0.00, qty3Chance: 0.00 },
];

const AD_SPEND_PLAN: Array<{
  meta: number;
  metaProductIndex: number | null;
  google: number;
  googleProductIndex: number | null;
}> = [
  { meta: 1760, metaProductIndex: 0, google: 940,  googleProductIndex: 1 },
  { meta: 1600, metaProductIndex: 0, google: 850,  googleProductIndex: null },
  { meta: 1900, metaProductIndex: 1, google: 1010, googleProductIndex: 0 },
  { meta: 1750, metaProductIndex: 0, google: 930,  googleProductIndex: null },
  { meta: 2100, metaProductIndex: 1, google: 1120, googleProductIndex: 0 },
  { meta: 1820, metaProductIndex: 0, google: 970,  googleProductIndex: 1 },
  { meta: 2000, metaProductIndex: 0, google: 1050, googleProductIndex: null },
];

const REFUND_CASES: Array<{ productIdx: number; daysAgo: number }> = [
  { productIdx: 0, daysAgo: 5 },
  { productIdx: 2, daysAgo: 3 },
  { productIdx: 3, daysAgo: 2 },
];

function weightedPick<T extends { weight: number }>(arr: T[]): T {
  const total = arr.reduce((s, x) => s + x.weight, 0);
  let r = Math.random() * total;
  for (const x of arr) {
    r -= x.weight;
    if (r <= 0) return x;
  }
  return arr[arr.length - 1];
}

function pickQty(qty2Chance: number, qty3Chance: number): number {
  const r = Math.random();
  if (r < qty3Chance) return 3;
  if (r < qty2Chance + qty3Chance) return 2;
  return 1;
}

// ── buildSeed ─────────────────────────────────────────────────────────────────
// Generates an AppData snapshot using the exact same product/order definitions
// as the server seed. Used for local previewing; the authoritative source of truth
// is always POST /api/data/seed (which writes to the database).
export function buildSeed(): AppData {
  const products = DEMO_PRODUCTS.map((p) => ({
    ...p,
    id: uid("prod"),
  }));

  const orders: Order[] = [];
  const adSpend: AdSpendEntry[] = [];

  const today = new Date();
  today.setHours(23, 59, 0, 0);

  // ── Completed & pending orders ───────────────────────────────────────────
  for (const plan of PRODUCT_ORDER_PLAN) {
    const product = products[plan.productIndex];

    for (let dayIdx = 0; dayIdx < 7; dayIdx++) {
      const dayOffset = 6 - dayIdx;
      const day = new Date(today);
      day.setDate(today.getDate() - dayOffset);
      day.setHours(0, 0, 0, 0);

      const count = plan.perDay[dayIdx] ?? 0;
      for (let i = 0; i < count; i++) {
        const time = new Date(day);
        time.setHours(8 + Math.floor(Math.random() * 14));
        time.setMinutes(Math.floor(Math.random() * 60));

        const cust = weightedPick(CUSTOMERS);
        const src = weightedPick(SOURCES);
        const qty = pickQty(plan.qty2Chance, plan.qty3Chance);
        const isPending = dayOffset === 0 && Math.random() < 0.25;
        const discount =
          !isPending && Math.random() < plan.discountChance
            ? Math.round(product.defaultSellingPrice * 0.05)
            : 0;

        orders.push({
          id: uid("ord"),
          customer: cust.name,
          phone: cust.phone,
          source: src.name,
          platform: src.platform,
          externalId: null,
          paymentStatus: isPending ? "unpaid" : "paid",
          sellingPrice: product.defaultSellingPrice * qty,
          costPrice: product.defaultCostPrice * qty,
          discount,
          refundAmount: 0,
          taxAmount: 0,
          shippingCharged: plan.deliveryCost,
          deliveryCost: plan.deliveryCost,
          adCost: plan.adCostFixed,
          date: time.toISOString(),
          status: isPending ? "pending" : "completed",
          notes: null,
          productId: product.id,
          productName: product.name,
          items: [
            {
              id: uid("oi"),
              productId: product.id,
              productName: product.name,
              quantity: qty,
              unitSellingPrice: product.defaultSellingPrice,
              unitCostPrice: product.defaultCostPrice,
            },
          ],
        });
      }
    }
  }

  // ── Refunded orders ──────────────────────────────────────────────────────
  for (const { productIdx, daysAgo } of REFUND_CASES) {
    const product = products[productIdx];
    const plan = PRODUCT_ORDER_PLAN[productIdx];
    const refDay = new Date(today);
    refDay.setDate(today.getDate() - daysAgo);
    refDay.setHours(10 + Math.floor(Math.random() * 6), 30, 0, 0);
    const cust = CUSTOMERS[Math.floor(Math.random() * 5)];
    orders.push({
      id: uid("ord"),
      customer: cust.name,
      phone: cust.phone,
      source: "Meta",
      platform: "Own Store",
      externalId: null,
      paymentStatus: "paid",
      sellingPrice: product.defaultSellingPrice,
      costPrice: product.defaultCostPrice,
      discount: 0,
      refundAmount: product.defaultSellingPrice,
      taxAmount: 0,
      shippingCharged: plan.deliveryCost,
      deliveryCost: plan.deliveryCost,
      adCost: plan.adCostFixed,
      date: refDay.toISOString(),
      status: "refunded",
      notes: "Demo refunded order",
      productId: product.id,
      productName: product.name,
      items: [
        {
          id: uid("oi"),
          productId: product.id,
          productName: product.name,
          quantity: 1,
          unitSellingPrice: product.defaultSellingPrice,
          unitCostPrice: product.defaultCostPrice,
        },
      ],
    });
  }

  // ── Ad spend — Meta + Google, product-tagged, Rs 800–2,500 each ──────────
  for (let dayIdx = 0; dayIdx < 7; dayIdx++) {
    const dayOffset = 6 - dayIdx;
    const day = new Date(today);
    day.setDate(today.getDate() - dayOffset);
    day.setHours(0, 0, 0, 0);
    const plan = AD_SPEND_PLAN[dayIdx];

    adSpend.push({
      id: uid("ad"),
      date: day.toISOString(),
      totalSpend: plan.meta,
      productId: plan.metaProductIndex !== null ? products[plan.metaProductIndex].id : null,
      platform: "Meta",
      campaign: "Retargeting + Prospecting",
      source: "manual",
    });
    adSpend.push({
      id: uid("ad"),
      date: day.toISOString(),
      totalSpend: plan.google,
      productId: plan.googleProductIndex !== null ? products[plan.googleProductIndex].id : null,
      platform: "Google",
      campaign: "Search + Shopping",
      source: "manual",
    });
  }

  return {
    products,
    orders,
    adSpend,
    settings: {
      currency: "PKR",
      currencySymbol: "Rs",
      businessName: "Waven Store",
      plan: "Starter Plan",
      defaultCostPrice: 1000,
      defaultSellingPrice: 2500,
      locale: "en-IN",
      toastsEnabled: true,
      adAttributionPct: 70,
      cashBuffer: 0,
      businessModels: [],
      thresholds: {
        scaleMargin: 30,
        stopScore: 45,
        minOrders: 3,
      },
    },
  };
}
