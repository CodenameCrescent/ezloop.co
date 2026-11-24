/**
 * A RICH demo dataset — eighteen months of a plausible business, built so that
 * every page and every rule in the app has something true to show.
 *
 * This is NOT the correctness fixture. `seedCore.ts` is: every figure in it is
 * hand-computed and asserted to the cent, and it must stay small enough to
 * verify by reading. This file is the opposite — deliberately large and messy,
 * shaped like a real trading history so the Insights pages can be judged on
 * something other than four transactions.
 *
 * Everything posts through the domain services. No raw SQL, no invented
 * columns: if a scenario cannot be produced by the same calls the UI makes,
 * it does not belong here.
 *
 * ── The story, month by month ─────────────────────────────────────────────
 *
 * A ceramics-and-design studio that sells online, at markets, and takes on
 * branding work. It grows through the year, and then a few things go wrong in
 * ways that are individually invisible and collectively expensive:
 *
 *   −18 … −8   Steady growth. Builds the history every baseline needs.
 *   −7         A bad kiln batch: refunds spike well above normal.
 *   −6         A discount blitz that moves volume and very little margin.
 *   −5         Clay gets dearer. The mug's price never moves. (★ staleness)
 *   −4         Ad spend doubles; profit does not follow.
 *   −3         Revenue climbs and profit falls — the classic trap.
 *   −2, −1     Recovery: the best two months of the year.
 *   0          The current, partial month.
 *
 * Threaded through all of it: one client worth a third of the book, customers
 * who quietly stop buying, invoices nobody chased, a marketplace fee creeping
 * up, and a sticker pack that has lost money on every unit since the day it
 * launched.
 */
import { formatMoney, type ProfitLadder } from "@workspace/domain";
import { db, businessesTable, clientEngagementsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { uid } from "../lib/uid";
import { createBusiness, getManualSource } from "../services/business";
import * as catalog from "../services/catalog";
import * as ledger from "../services/ledger";
import { findOrCreatePerson } from "../services/person";
import { logAdSpend } from "../services/adSpend";

/** Deterministic jitter — the same demo every run, so screenshots stay stable. */
function mulberry32(seed: number) {
  return function next() {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DAY_MS = 24 * 60 * 60 * 1000;

export interface DemoSummary {
  businessId: string;
  name: string;
  transactionCount: number;
  monthsCovered: number;
  ladderThisYear: ProfitLadder;
}

export async function runDemoSeed(userId: string): Promise<DemoSummary> {
  const rng = mulberry32(0xc0ffee);
  const now = new Date();

  /** Start of the month `back` months before the current one. */
  const monthStart = (back: number) => {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1));
    return d;
  };

  /** A jittered working moment on day `dayOfMonth` of the month `back` months ago. */
  const at = (back: number, dayOfMonth: number) => {
    const base = monthStart(back);
    const d = new Date(base.getTime() + (dayOfMonth - 1) * DAY_MS);
    d.setUTCHours(9 + Math.floor(rng() * 8), Math.floor(rng() * 60), 0, 0);
    // Never post into the future: the current month is only partly through.
    return d > now ? new Date(now.getTime() - Math.floor(rng() * 3) * DAY_MS) : d;
  };

  const plus = (date: Date, days: number) => new Date(date.getTime() + days * DAY_MS);

  // The wipe belongs to the CLI now, not here: a user gets TWO demo businesses
  // and each seeder wiping first would leave whichever ran last.
  const business = await createBusiness(userId, {
    name: "Clayfield Studio",
    businessType: "ecommerce",
    currency: "PKR",
    currencySymbol: "Rs",
  });
  const businessId = business.id;
  const manual = (await getManualSource(businessId))!;

  // ── Channels ──────────────────────────────────────────────────────────────
  const etsy = await catalog.createSource(businessId, {
    name: "Etsy shop",
    kind: "ecommerce_store",
    platformFeePercent: "6.5",
  });
  const market = await catalog.createSource(businessId, { name: "Weekend market", kind: "manual" });
  const fiverr = await catalog.createSource(businessId, {
    name: "Fiverr — studio",
    kind: "marketplace",
    platformFeePercent: "20",
  });

  // ── Categories ────────────────────────────────────────────────────────────
  const madeGoods = await catalog.createCategory(businessId, { name: "Made goods", appliesTo: "revenue" });
  const services = await catalog.createCategory(businessId, { name: "Studio services", appliesTo: "revenue" });

  const START = 18; // months of history

  // ── What the studio sells ─────────────────────────────────────────────────
  //
  // Deliberately spread across the quadrant: a winner, a trap, a hidden gem,
  // dead weight, one that loses money on every unit, and one with no costs at
  // all so the "not on this map" prompt has something to name.

  const mug = await catalog.createRevenueItem(businessId, {
    name: "Ceramic mug",
    type: "product",
    pricingModel: "per_unit",
    unitPriceCents: 250_000,
    categoryId: madeGoods.id,
  });
  const clay = await catalog.addCostComponent(businessId, mug.id, {
    name: "Clay + glaze",
    calcType: "fixed_per_unit",
    valueCents: 80_000,
    effectiveFrom: at(START, 1),
  });
  await catalog.addCostComponent(businessId, mug.id, {
    name: "Etsy fee",
    calcType: "percent_of_price",
    valueRate: "6.5",
    sourceId: etsy.id,
    isFee: true,
    effectiveFrom: at(START, 1),
  });
  // Etsy lists it higher AND charges a fee — which is what makes the mug two
  // separate price histories rather than one noisy series.
  await catalog.setRevenueItemSourceLinks(businessId, mug.id, [
    { sourceId: etsy.id, priceOverrideCents: 280_000, externalId: "etsy-listing-88231" },
  ]);

  const tote = await catalog.createRevenueItem(businessId, {
    name: "Leather tote",
    type: "product",
    pricingModel: "per_unit",
    unitPriceCents: 1_400_000,
    categoryId: madeGoods.id,
  });
  await catalog.addCostComponent(businessId, tote.id, {
    name: "Hide + hardware",
    calcType: "fixed_per_unit",
    valueCents: 1_100_000, // 21% margin — sells well, keeps almost nothing → TRAP
    effectiveFrom: at(START, 1),
  });

  const candle = await catalog.createRevenueItem(businessId, {
    name: "Signature candle",
    type: "product",
    pricingModel: "per_unit",
    unitPriceCents: 450_000,
    categoryId: madeGoods.id,
  });
  await catalog.addCostComponent(businessId, candle.id, {
    name: "Wax + wick",
    calcType: "fixed_per_unit",
    valueCents: 120_000, // 73% — barely sells, keeps plenty → HIDDEN GEM
    effectiveFrom: at(START, 1),
  });

  const branding = await catalog.createRevenueItem(businessId, {
    name: "Branding package",
    type: "service",
    pricingModel: "fixed",
    unitPriceCents: 18_000_000,
    categoryId: services.id,
  });
  await catalog.addCostComponent(businessId, branding.id, {
    name: "Freelance illustrator",
    calcType: "fixed_per_unit",
    valueCents: 7_000_000,
    effectiveFrom: at(START, 1),
  });
  await catalog.addCostComponent(businessId, branding.id, {
    name: "Fiverr cut",
    calcType: "percent_of_price",
    valueRate: "20",
    sourceId: fiverr.id,
    isFee: true,
    effectiveFrom: at(START, 1),
  });

  const stickers = await catalog.createRevenueItem(businessId, {
    name: "Sticker pack",
    type: "product",
    pricingModel: "per_unit",
    unitPriceCents: 80_000,
    categoryId: madeGoods.id,
  });
  await catalog.addCostComponent(businessId, stickers.id, {
    name: "Print run",
    calcType: "fixed_per_unit",
    valueCents: 95_000, // loses Rs 1.50 on every single one → LOSING MONEY
    effectiveFrom: at(START, 1),
  });

  const giftWrap = await catalog.createRevenueItem(businessId, {
    name: "Gift wrapping",
    type: "product",
    pricingModel: "per_unit",
    unitPriceCents: 50_000,
    categoryId: madeGoods.id,
  });
  await catalog.addCostComponent(businessId, giftWrap.id, {
    name: "Paper + ribbon",
    calcType: "fixed_per_unit",
    valueCents: 38_000, // barely sells, keeps little → DEAD WEIGHT
    effectiveFrom: at(START, 1),
  });

  // No cost components at all — the quadrant must exclude it and NAME it.
  const studioHire = await catalog.createRevenueItem(businessId, {
    name: "Studio hire",
    type: "service",
    pricingModel: "hourly",
    unitPriceCents: 600_000,
    categoryId: services.id,
  });

  const workshop = await catalog.createRevenueItem(businessId, {
    name: "Pottery workshop",
    type: "service",
    pricingModel: "fixed",
    unitPriceCents: 750_000,
    categoryId: services.id,
  });
  await catalog.addCostComponent(businessId, workshop.id, {
    name: "Materials per head",
    calcType: "fixed_per_unit",
    valueCents: 220_000,
    effectiveFrom: at(START, 1),
  });

  // ── What it spends on ─────────────────────────────────────────────────────
  const rent = await catalog.findOrCreateExpenseItem(businessId, {
    name: "Studio rent",
    type: "operational",
    costNature: "fixed",
    behavior: "recurring",
  });
  const payroll = await catalog.findOrCreateExpenseItem(businessId, {
    name: "Part-time help",
    type: "payroll",
    costNature: "fixed",
    behavior: "recurring",
  });
  const software = await catalog.findOrCreateExpenseItem(businessId, {
    name: "Software subscriptions",
    type: "operational",
    costNature: "fixed",
    behavior: "recurring",
  });
  const packaging = await catalog.findOrCreateExpenseItem(businessId, {
    name: "Packaging",
    type: "operational",
    costNature: "variable",
    behavior: "usage_based",
  });
  const kiln = await catalog.findOrCreateExpenseItem(businessId, {
    name: "Kiln repairs",
    type: "maintenance",
    costNature: "variable",
    behavior: "one_time",
  });
  // Kit that lasts years, kept apart from repairs on purpose: repairs belong to
  // the month they happen, equipment belongs to the months it is used in. The
  // demo needs both so the difference is visible on one screen.
  // One bill a month covering work on several clients — the split bill.
  const design = await catalog.findOrCreateExpenseItem(businessId, {
    name: "Freelance design",
    type: "operational",
    costNature: "variable",
  });
  const equipment = await catalog.findOrCreateExpenseItem(businessId, {
    name: "Equipment",
    type: "operational",
    costNature: "fixed",
    behavior: "one_time",
  });

  // ── The people who pay ────────────────────────────────────────────────────
  //
  // One dominant client (concentration), a handful of regulars with real
  // rhythms, and a long tail — enough that the repeat rate is meaningful.
  const person = (name: string) => findOrCreatePerson(businessId, { name, kind: "customer" });

  const northwind = await person("Northwind Hotels"); // the big one
  const belmont = await person("Belmont & Co");
  const vero = await person("Vero Studio");
  const harborCafe = await person("Harbor Café");

  // The demo studio sells products AND services — branding, studio hire,
  // workshops — so the client-profitability view belongs to it. It defaults off
  // because the business type is ecommerce, which would hide every client
  // figure this dataset exists to show, including who costs what to serve.
  await db
    .update(businessesTable)
    .set({ featureOverrides: { client_profitability: true } })
    .where(eq(businessesTable.id, businessId));

  // The four service clients get a live engagement, which is what makes them
  // targetable by an hour OR a cost. Without one, "who was this for?" offers
  // only products and internal buckets, and the whole point of splitting a
  // bill — finding out what a client really costs — cannot be demonstrated.
  await db
    .insert(clientEngagementsTable)
    .values(
      [northwind, belmont, vero, harborCafe].map((client) => ({
        id: uid("eng"),
        businessId,
        personId: client.id,
        engagementStatus: "active",
      })),
    )
    .onConflictDoNothing();

  const allRegulars = await Promise.all(
    [
      "Aisha Rahman", "Ben Okafor", "Clara Diaz", "Dev Patel", "Elena Sokolov",
      "Farid Haddad", "Grace Lin", "Hugo Martins", "Ingrid Olsen", "Jonas Weber",
      "Kavya Nair", "Liam Byrne", "Maya Cohen", "Nils Andersen", "Omar Farouk",
      "Priya Sharma", "Quinn Doyle", "Rosa Iglesias", "Samir Khan", "Tara Nolan",
      "Umar Siddiqui", "Vera Novak", "Wren Ashby", "Yusuf Demir",
    ].map(person),
  );

  /**
   * The buyers the ongoing rhythm draws from.
   *
   * The last four are held back deliberately: they get their own fading
   * purchase history below, and letting the random picker keep touching them
   * would refresh their last-purchase date and erase the very thing the
   * gone-quiet list exists to show.
   */
  const regulars = allRegulars.slice(0, 20);
  const faders = allRegulars.slice(20);

  let txnCount = 0;
  const sale = async (input: Parameters<typeof ledger.createTransaction>[1]) => {
    const result = await ledger.createTransaction(businessId, input);
    txnCount += 1;
    return result;
  };

  // ── Fixed costs, every month ──────────────────────────────────────────────
  //
  // Paid promptly — which is half of what makes the payment-habit gap real.
  for (let m = START; m >= 0; m--) {
    const billDay = at(m, 2);
    if (billDay > now) continue;
    await sale({
      direction: "out",
      occurredAt: billDay,
      paidAt: plus(billDay, 3),
      sourceId: manual.id,
      lines: [{ expenseItemId: rent.id, qty: "1", unitPriceCents: 6_500_000, label: "Studio rent" }],
    });
    await sale({
      direction: "out",
      occurredAt: billDay,
      paidAt: plus(billDay, 5),
      sourceId: manual.id,
      lines: [{ expenseItemId: payroll.id, qty: "1", unitPriceCents: 12_000_000, label: "Part-time help" }],
    });
    // Never repriced, never reviewed — the silent subscription bleed.
    await sale({
      direction: "out",
      occurredAt: billDay,
      paidAt: plus(billDay, 2),
      sourceId: manual.id,
      lines: [{ expenseItemId: software.id, qty: "1", unitPriceCents: 1_850_000, label: "Software subscriptions" }],
    });
    // ── One freelance invoice, SPLIT across the clients it was really for ──
    //
    // The contractor bills one figure a month for work on three books. Landed
    // whole it is a real cost belonging to nobody, and every client shows as
    // costing nothing to serve — which is how this looked before Phase 5.
    // Northwind takes the biggest share because Northwind is the biggest book.
    const designDay = at(m, 18);
    if (designDay <= now) {
      await sale({
        direction: "out",
        occurredAt: designDay,
        paidAt: plus(designDay, 7),
        sourceId: manual.id,
        lines: [
          {
            expenseItemId: design.id,
            qty: "1",
            unitPriceCents: 3_000_000,
            label: "Freelance design",
            split: [
              { targetType: "client", targetId: northwind.id, weight: "50" },
              { targetType: "client", targetId: belmont.id, weight: "30" },
              { targetType: "client", targetId: vero.id, weight: "20" },
            ],
          },
        ],
      });
    }
    await sale({
      direction: "out",
      occurredAt: at(m, 12),
      paidAt: plus(at(m, 12), 4),
      sourceId: manual.id,
      lines: [{ expenseItemId: packaging.id, qty: "1", unitPriceCents: 600_000 + Math.floor(rng() * 400_000), label: "Packaging" }],
    });
  }

  // ── THE COST RISE: clay gets dearer five months ago, price never follows ──
  await catalog.updateCostComponent(businessId, clay.id, {
    valueCents: 115_000,
    effectiveFrom: at(5, 1),
  });

  // ── The marketplace fee creeps up four months ago ─────────────────────────
  const brandingComponents = await catalog.listCostComponents(branding.id);
  const fiverrCut = brandingComponents.find((c) => c.name === "Fiverr cut" && c.effectiveTo === null)!;
  await catalog.updateCostComponent(businessId, fiverrCut.id, {
    valueRate: "27",
    effectiveFrom: at(4, 1),
  });

  // ── The monthly trading rhythm ────────────────────────────────────────────
  //
  // `scale` drives the growth arc; the special months bend it.
  const monthShape = (m: number) => {
    if (m >= 13) return 0.55;
    if (m >= 10) return 0.75;
    if (m >= 8) return 0.95;
    if (m === 7) return 1.05; // refund spike month — sales fine, refunds not
    if (m === 6) return 1.35; // discount blitz: volume up, margin down
    if (m === 5) return 1.1;
    if (m === 4) return 1.15; // ad splurge
    if (m === 3) return 1.45; // revenue up…
    if (m === 2) return 1.5;
    if (m === 1) return 1.6; // best month
    return 0.6; // current month, part-way through
  };

  for (let m = START; m >= 0; m--) {
    const scale = monthShape(m);
    const mugRuns = Math.max(4, Math.round(14 * scale));

    // Mugs, direct — the channel whose price never answered the cost rise.
    for (let i = 0; i < mugRuns; i++) {
      const when = at(m, 3 + i * 3);
      if (when > now) break;
      const buyer = regulars[Math.floor(rng() * regulars.length)];
      await sale({
        direction: "in",
        occurredAt: when,
        // Card sales clear in a few days. Nothing settles instantly, and
        // pretending it does would erase the payment-habit gap entirely.
        paidAt: plus(when, 3),
        sourceId: rng() > 0.5 ? manual.id : market.id,
        personId: buyer.id,
        lines: [{ revenueItemId: mug.id, qty: String(3 + Math.floor(rng() * 4)) }],
      });
    }

    // Mugs on Etsy — its own price and its own fee: a second price history.
    for (let i = 0; i < Math.max(2, Math.round(9 * scale)); i++) {
      const when = at(m, 6 + i * 5);
      if (when > now) break;
      await sale({
        direction: "in",
        occurredAt: when,
        paidAt: plus(when, 14),
        sourceId: etsy.id,
        personId: regulars[Math.floor(rng() * regulars.length)].id,
        lines: [{ revenueItemId: mug.id, qty: "1" }],
      });
    }

    // Totes — the trap: real money in, very little kept.
    for (let i = 0; i < Math.max(2, Math.round(7 * scale)); i++) {
      const when = at(m, 5 + i * 4);
      if (when > now) break;
      await sale({
        direction: "in",
        occurredAt: when,
        paidAt: plus(when, rng() > 0.6 ? 14 : 3),
        sourceId: rng() > 0.6 ? etsy.id : manual.id,
        personId: regulars[Math.floor(rng() * regulars.length)].id,
        lines: [{ revenueItemId: tote.id, qty: "1" }],
      });
    }

    // Candles — the hidden gem: hardly sells, keeps nearly everything.
    if (m % 2 === 0) {
      const when = at(m, 17);
      if (when <= now) {
        await sale({
          direction: "in",
          occurredAt: when,
          paidAt: when,
          sourceId: market.id,
          personId: regulars[Math.floor(rng() * regulars.length)].id,
          lines: [{ revenueItemId: candle.id, qty: "4" }],
        });
      }
    }

    // Stickers and gift wrap — the two that should probably go.
    const smallDay = at(m, 9);
    if (smallDay <= now) {
      await sale({
        direction: "in",
        occurredAt: smallDay,
        paidAt: smallDay,
        sourceId: market.id,
        lines: [
          { revenueItemId: stickers.id, qty: String(6 + Math.floor(rng() * 6)) },
          { revenueItemId: giftWrap.id, qty: "2" },
        ],
      });
    }

    // Workshops — steady service income.
    if (m % 2 === 1) {
      const when = at(m, 21);
      if (when <= now) {
        await sale({
          direction: "in",
          occurredAt: when,
          paidAt: plus(when, 21),
          sourceId: manual.id,
          personId: regulars[Math.floor(rng() * regulars.length)].id,
          lines: [{ revenueItemId: workshop.id, qty: String(6 + Math.floor(rng() * 5)) }],
        });
      }
    }

    // Studio hire — the uncosted one.
    if (m % 3 === 0) {
      const when = at(m, 24);
      if (when <= now) {
        await sale({
          direction: "in",
          occurredAt: when,
          paidAt: plus(when, 10),
          sourceId: manual.id,
          personId: harborCafe.id,
          lines: [{ revenueItemId: studioHire.id, qty: "6" }],
        });
      }
    }

    // ── The big client: branding work, invoiced, paid SLOWLY ───────────────
    //
    // Northwind is a third of the book and takes about five weeks to pay,
    // while every bill above went out within a week. That gap is the whole
    // point of the payment-habit rule.
    const northwindJobs = Math.max(1, Math.round(2 * scale));
    for (let i = 0; i < northwindJobs; i++) {
      const when = at(m, 8 + i * 6);
      if (when > now) break;
      const paid = plus(when, 33 + Math.floor(rng() * 8));
      await sale({
        direction: "in",
        occurredAt: when,
        paidAt: paid > now ? null : paid,
        sourceId: fiverr.id,
        personId: northwind.id,
        referenceNumber: `INV-${1000 + m * 10 + i}`,
        lines: [{ revenueItemId: branding.id, qty: "1" }],
      });
    }

    // The smaller agencies — same slow terms, smaller books.
    for (const [i, who] of [belmont, vero].entries()) {
      if ((m + i) % 2 !== 0) continue;
      const when = at(m, 15 + i * 5);
      if (when > now) continue;
      const paid = plus(when, 36);
      await sale({
        direction: "in",
        occurredAt: when,
        paidAt: paid > now ? null : paid,
        sourceId: manual.id,
        personId: who.id,
        referenceNumber: `INV-${2000 + m * 10 + i}`,
        lines: [{ revenueItemId: branding.id, qty: "1" }],
      });
    }
  }

  // ── Month −7: the bad kiln batch. Refunds well above normal. ─────────────
  const badBatchDay = at(7, 10);
  for (let i = 0; i < 4; i++) {
    const original = await sale({
      direction: "in",
      occurredAt: plus(badBatchDay, i),
      paidAt: plus(badBatchDay, i),
      sourceId: etsy.id,
      personId: regulars[i].id,
      lines: [{ revenueItemId: mug.id, qty: "4" }],
    });
    await ledger.createRefund(businessId, {
      transactionId: original.transaction.id,
      requests: original.lines
        .filter((l) => l.revenueItemId === mug.id)
        .map((l) => ({
          lineId: l.id,
          qtyRefunded: "4",
          amountRefundedCents: l.unitPriceCents * 4,
          // Cracked goods cannot go back on the shelf, so nothing is recovered.
          restocked: false,
        })),
      occurredAt: plus(badBatchDay, i + 5),
      notes: "Cracked in the kiln — full refund",
    });
    txnCount += 1;
  }
  // And the repair bill that came with it.
  await sale({
    direction: "out",
    occurredAt: at(7, 18),
    paidAt: at(7, 20),
    sourceId: manual.id,
    lines: [{ expenseItemId: kiln.id, qty: "1", unitPriceCents: 4_800_000, label: "Kiln element replacement" }],
  });

  // ── Month −6: the discount blitz ─────────────────────────────────────────
  for (let i = 0; i < 22; i++) {
    const when = at(6, 1 + (i % 26));
    if (when > now) break;
    await sale({
      direction: "in",
      occurredAt: when,
      paidAt: when,
      sourceId: etsy.id,
      personId: regulars[(i + 3) % regulars.length].id,
      discountCode: "SPRING25",
      orderDiscountCents: 900_000,
      lines: [
        { revenueItemId: mug.id, qty: "3" },
        { revenueItemId: candle.id, qty: "1", lineDiscountCents: 150_000 },
      ],
    });
  }

  // ── Invoices nobody chased ───────────────────────────────────────────────
  for (const [i, who] of [belmont, vero, harborCafe].entries()) {
    const when = at(3, 6 + i * 4);
    if (when > now) continue;
    await sale({
      direction: "in",
      occurredAt: when,
      paidAt: null, // still outstanding, well past thirty days
      sourceId: manual.id,
      personId: who.id,
      referenceNumber: `INV-${3100 + i}`,
      lines: [{ revenueItemId: workshop.id, qty: "3" }],
    });
  }

  // ── Customers who quietly stopped ────────────────────────────────────────
  //
  // Four regulars with a real monthly rhythm whose last purchase is months
  // back. They have a habit, and it broke — which is exactly what the
  // gone-quiet list is for.
  for (const [i, who] of faders.entries()) {
    for (let m = 14; m >= 6 + i; m -= 1) {
      const when = at(m, 11);
      if (when > now) continue;
      await sale({
        direction: "in",
        occurredAt: when,
        paidAt: when,
        sourceId: manual.id,
        personId: who.id,
        lines: [{ revenueItemId: mug.id, qty: "2" }],
      });
    }
  }

  // ── Ad spend: modest for most of the year, then a splurge ─────────────────
  for (let m = START; m >= 0; m--) {
    const when = at(m, 5);
    if (when > now) continue;
    const splurge = m === 4 || m === 3;
    await logAdSpend(businessId, {
      platform: "Meta Ads",
      spentOn: when,
      amountCents: splurge ? 6_200_000 : 1_400_000 + Math.floor(rng() * 400_000),
      campaign: splurge ? "Spring push — broad" : "Always-on retargeting",
    });
    await logAdSpend(businessId, {
      platform: "Google Ads",
      spentOn: plus(when, 1),
      amountCents: splurge ? 3_800_000 : 900_000 + Math.floor(rng() * 300_000),
    });
    txnCount += 2;
  }

  // ── Month −4: the classic trap, made explicit ────────────────────────────
  //
  // A burst of tote sales — real revenue at a 21% margin — landing in the same
  // month as the ad splurge and a second-kiln deposit. Revenue climbs, profit
  // falls, and nothing on a sales report explains why. This is the single most
  // valuable thing the app can catch, so the demo has to contain one.
  for (let i = 0; i < 14; i++) {
    const when = at(4, 2 + i * 2);
    if (when > now) break;
    await sale({
      direction: "in",
      occurredAt: when,
      paidAt: plus(when, 14),
      sourceId: etsy.id,
      personId: regulars[(i + 7) % regulars.length].id,
      lines: [{ revenueItemId: tote.id, qty: "2" }],
    });
  }
  // The Rs 95,000 kiln, SPREAD over 24 months. Bought outright in this month,
  // paid for in this month — but it will be fired for two years, so charging
  // the whole thing here would have said the month was a disaster when it was
  // an investment. The cash view still shows the full Rs 95,000 leaving.
  await sale({
    direction: "out",
    occurredAt: at(4, 14),
    paidAt: at(4, 16),
    sourceId: manual.id,
    lines: [
      { expenseItemId: equipment.id, qty: "1", unitPriceCents: 9_500_000, label: "Second kiln", spreadMonths: 24 },
    ],
  });

  // ── A chargeback, so the adjustment path is represented ──────────────────
  const disputed = await sale({
    direction: "in",
    occurredAt: at(2, 9),
    paidAt: at(2, 9),
    sourceId: etsy.id,
    personId: regulars[5].id,
    lines: [{ revenueItemId: tote.id, qty: "1" }],
  });
  await ledger.createRefund(businessId, {
    transactionId: disputed.transaction.id,
    requests: disputed.lines.map((l) => ({
      lineId: l.id,
      qtyRefunded: "1",
      amountRefundedCents: l.unitPriceCents,
      // The tote came back, so its cost is recovered — the credit bar on the
      // waterfall exists for exactly this.
      restocked: true,
    })),
    adjustmentType: "chargeback",
    chargebackFeeCents: 250_000,
    occurredAt: at(2, 19),
    notes: "Card dispute — item not received",
  });
  txnCount += 1;

  const { computePnl } = await import("../services/read");
  const yearStart = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
  const pnl = await computePnl(businessId, userId, { start: yearStart, end: now });

  return {
    businessId,
    name: business.name,
    transactionCount: txnCount,
    monthsCovered: START + 1,
    ladderThisYear: pnl.ladder,
  };
}

/** Pretty-print for the CLI. */
export function describeLadder(ladder: ProfitLadder, symbol = "Rs "): string[] {
  const line = (label: string, cents: number) =>
    `  ${label.padEnd(24)}${formatMoney(cents, { symbol }).padStart(16)}`;
  return [
    line("Money in", ladder.grossRevenue),
    line("− Discounts", ladder.discounts),
    line("− Refunds", ladder.refunds),
    line("Net revenue", ladder.netRevenue),
    line("Contribution profit", ladder.contributionProfit),
    line("− Running costs", ladder.periodExpenses),
    line("True profit", ladder.trueProfit),
  ];
}
