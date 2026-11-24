/**
 * The SECOND demo business: a small builder, fourteen months of sites.
 *
 * The ceramics studio in `demoSeedCore.ts` is an ecommerce shop, and everything
 * built in stages 1–5 — projects, retention, budgets, advances, units, waste,
 * plant — is invisible on it. A builder is the business those features were
 * designed for, so the demo now has one, and the two together are also the
 * honest test of the multi-business restructure: one user, two sets of books
 * that share nothing but a login.
 *
 * ── The story ─────────────────────────────────────────────────────────────
 *
 * Ahmad Builders, Lahore. Four sites, three of them real:
 *
 *   DHA Boundary Wall     finished, and barely made money — steel was repriced
 *                         halfway through a fixed price, which the cost per
 *                         running foot says out loud.
 *   Gulberg Villa Ph. 2   the big one, going well, 5% held back on every stage
 *                         bill and none of it released yet.
 *   Model Town Clinic     going less well: one invoice six weeks overdue, and
 *                         the cost plan already overrun on masonry.
 *   Johar Town Plaza      quoted, nothing spent. A project with no money is a
 *                         real state and the screens have to survive it.
 *
 * Threaded through: cement bought by the bag with the rain damage recorded, a
 * mixer and a pickup being used up over years rather than charged to one month,
 * an advance to a mason crew half drawn down, a customer deposit still sitting
 * unspent, and head office costs that belong to no site at all — which is what
 * makes "before your fixed running costs" mean something on the project screen.
 *
 * Everything posts through the domain services, exactly like the studio seed.
 */
import { db, businessesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { createBusiness, getManualSource } from "../services/business";
import * as catalog from "../services/catalog";
import * as ledger from "../services/ledger";
import * as projects from "../services/project";
import * as budgets from "../services/budget";
import * as advances from "../services/advances";
import { findOrCreatePerson } from "../services/person";

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

export interface ConstructionSummary {
  businessId: string;
  name: string;
  transactionCount: number;
  projectCount: number;
}

export async function runConstructionSeed(userId: string): Promise<ConstructionSummary> {
  const rng = mulberry32(0xb0115e);
  const now = new Date();

  const monthStart = (back: number) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1));

  /** A working moment on day `dayOfMonth` of the month `back` months ago. */
  const at = (back: number, dayOfMonth: number) => {
    const d = new Date(monthStart(back).getTime() + (dayOfMonth - 1) * DAY_MS);
    d.setUTCHours(8 + Math.floor(rng() * 8), Math.floor(rng() * 60), 0, 0);
    return d > now ? new Date(now.getTime() - Math.floor(rng() * 3) * DAY_MS) : d;
  };

  const plus = (date: Date, days: number) => new Date(date.getTime() + days * DAY_MS);
  /** A due date as the plain "YYYY-MM-DD" the ledger stores. */
  const dueOn = (date: Date) => date.toISOString().slice(0, 10);
  const fromToday = (days: number) => dueOn(new Date(now.getTime() + days * DAY_MS));

  const business = await createBusiness(userId, {
    name: "Ahmad Builders",
    businessType: "construction",
    currency: "PKR",
    currencySymbol: "Rs",
  });
  const businessId = business.id;
  const manual = (await getManualSource(businessId))!;

  // A builder is paid by transfer and cheque, not by a card processor. The
  // second channel exists so "where did this money come from" has an answer
  // other than "Manual" on every single row.
  const bank = await catalog.createSource(businessId, { name: "Meezan current account", kind: "bank" });

  // ── Who they build for, and who they buy from ────────────────────────────
  const malik = await findOrCreatePerson(businessId, { name: "Malik Residency", kind: "customer" });
  const askari = await findOrCreatePerson(businessId, { name: "Askari Housing", kind: "customer" });
  const clinic = await findOrCreatePerson(businessId, { name: "Dr Farhan Clinic", kind: "customer" });
  const cementTrader = await findOrCreatePerson(businessId, { name: "Ravi Cement Traders", kind: "vendor" });
  const steelCorner = await findOrCreatePerson(businessId, { name: "Steel Corner", kind: "vendor" });
  const masonCrew = await findOrCreatePerson(businessId, { name: "Nadeem masonry crew", kind: "vendor" });

  // ── Grouping ────────────────────────────────────────────────────────────
  //
  // Categories are the owner's own labels, kept separate from the system type:
  // a builder thinks "on site" versus "head office" long before they think
  // "variable cost", and the budget matches on either.
  const onSite = await catalog.createCategory(businessId, { name: "On site", appliesTo: "expense" });
  const headOffice = await catalog.createCategory(businessId, { name: "Head office", appliesTo: "expense" });

  // ── What they buy, and what one of it IS ────────────────────────────────
  //
  // These are the rows the unit field was built for. A builder buys 240 bags,
  // not "Rs 276,000 of cement", and without the unit neither waste nor cost per
  // unit built can be answered at all.
  const item = (
    name: string,
    unitLabel: string | null,
    rateCents: number | null,
    extra: Partial<Parameters<typeof catalog.findOrCreateExpenseItem>[1]> = {},
  ) =>
    catalog.findOrCreateExpenseItem(businessId, {
      name,
      type: "cogs",
      costNature: "variable",
      behavior: "usage_based",
      categoryId: onSite.id,
      unitLabel,
      defaultAmountCents: rateCents,
      ...extra,
    });

  const cement = await item("Cement", "bag", 115_000, { vendorName: "Ravi Cement Traders" });
  const steel = await item("Steel rebar", "kg", 26_500, { vendorName: "Steel Corner" });
  const bricks = await item("Bricks", "brick", 2_200);
  const sand = await item("Sand and crush", "tonne", 450_000);
  const masonry = await item("Masonry crew", "day", 850_000, { vendorName: "Nadeem masonry crew" });
  const services = await item("Electrical and plumbing", "day", 650_000);

  // Kept apart from the materials on purpose: hire is a day rate that stops when
  // the machine goes back, a purchase is a thing you own for years, and the
  // difference is the whole point of the Assets screen.
  const plantHire = await catalog.findOrCreateExpenseItem(businessId, {
    name: "Plant and equipment hire",
    type: "operational",
    costNature: "variable",
    behavior: "usage_based",
    unitLabel: "day",
    defaultAmountCents: 1_800_000,
    categoryId: onSite.id,
  });
  const plantPurchase = await catalog.findOrCreateExpenseItem(businessId, {
    name: "Plant purchase",
    type: "operational",
    costNature: "fixed",
    behavior: "one_time",
    categoryId: onSite.id,
  });
  const fuel = await catalog.findOrCreateExpenseItem(businessId, {
    name: "Fuel",
    type: "operational",
    costNature: "variable",
    behavior: "usage_based",
    unitLabel: "litre",
    defaultAmountCents: 27_500,
    categoryId: onSite.id,
  });
  const siteServices = await catalog.findOrCreateExpenseItem(businessId, {
    name: "Site services",
    type: "operational",
    costNature: "variable",
    behavior: "usage_based",
    categoryId: onSite.id,
  });
  const permits = await catalog.findOrCreateExpenseItem(businessId, {
    name: "Permits and inspections",
    type: "operational",
    costNature: "variable",
    behavior: "one_time",
    categoryId: onSite.id,
  });

  // ── Head office: real money, belonging to no site ────────────────────────
  const yardRent = await catalog.findOrCreateExpenseItem(businessId, {
    name: "Rent",
    type: "operational",
    costNature: "fixed",
    behavior: "recurring",
    categoryId: headOffice.id,
  });
  const salaries = await catalog.findOrCreateExpenseItem(businessId, {
    name: "Salaries",
    type: "payroll",
    costNature: "fixed",
    behavior: "recurring",
    categoryId: headOffice.id,
  });
  const accounting = await catalog.findOrCreateExpenseItem(businessId, {
    name: "Accounting and legal",
    type: "operational",
    costNature: "fixed",
    behavior: "recurring",
    categoryId: headOffice.id,
  });
  const utilities = await catalog.findOrCreateExpenseItem(businessId, {
    name: "Utilities",
    type: "operational",
    costNature: "semi_variable",
    behavior: "recurring",
    categoryId: headOffice.id,
  });

  let txnCount = 0;
  const post = async (input: Parameters<typeof ledger.createTransaction>[1]) => {
    const result = await ledger.createTransaction(businessId, input);
    txnCount += 1;
    return result;
  };

  const START = 14; // months of history

  // ── The four sites ──────────────────────────────────────────────────────
  const dha = await projects.createProject(businessId, {
    name: "DHA Boundary Wall",
    code: "DHA-11",
    personId: askari.id,
    // Starts active and is closed at the end of this file, because the ledger
    // refuses to book a cost to a finished job — correctly, and the demo has to
    // live under the same rule the app enforces rather than around it.
    status: "active",
    contractValueCents: 180_000_000,
    startDate: dueOn(monthStart(13)),
    endDate: dueOn(monthStart(9)),
    // 420 running feet of wall: the figure that turns a thin margin into a
    // number the owner can price the NEXT wall with.
    outputQty: "420",
    outputUnitLabel: "running foot",
    notes: "Finished under a fixed price agreed before steel moved.",
  });

  const gulberg = await projects.createProject(businessId, {
    name: "Gulberg Villa — Phase 2",
    code: "GV-02",
    personId: malik.id,
    status: "active",
    contractValueCents: 1_350_000_000,
    startDate: dueOn(monthStart(8)),
    expectedEndDate: fromToday(75),
  });

  const modelTown = await projects.createProject(businessId, {
    name: "Model Town Clinic — fit-out",
    code: "MT-07",
    personId: clinic.id,
    status: "active",
    contractValueCents: 320_000_000,
    startDate: dueOn(monthStart(4)),
    expectedEndDate: fromToday(30),
  });

  await projects.createProject(businessId, {
    name: "Johar Town Plaza",
    code: "JT-19",
    status: "quoted",
    contractValueCents: 1_200_000_000,
    // Nothing spent and nothing billed. A quoted job is a real state and every
    // screen has to read correctly with all four figures at zero.
    notes: "Quoted. Waiting on the client's bank.",
  });

  // ── Head office costs, every month, on no site ───────────────────────────
  for (let m = START; m >= 0; m--) {
    const billDay = at(m, 3);
    if (billDay > now) continue;
    const fixed: Array<[string, string, number]> = [
      [yardRent.id, "Yard and office rent", 8_500_000],
      [salaries.id, "Supervisor and office wages", 22_000_000],
      [accounting.id, "Accountant", 2_500_000],
      [utilities.id, "Electricity and water", 1_600_000 + Math.floor(rng() * 500_000)],
    ];
    for (const [expenseItemId, label, unitPriceCents] of fixed) {
      await post({
        direction: "out",
        occurredAt: billDay,
        paidAt: plus(billDay, 2),
        sourceId: bank.id,
        lines: [{ expenseItemId, qty: "1", unitPriceCents, label }],
      });
    }
  }

  // ── Plant bought outright, used up over years ────────────────────────────
  //
  // Three purchases spread over their real lives. Nothing else records them:
  // a spread line IS the asset, which is why there is no assets table.
  const plant: Array<[number, string, number, number]> = [
    [12, "Site pickup — Suzuki Ravi", 185_000_000, 60],
    [10, "Concrete mixer", 48_000_000, 36],
    [6, "Scaffolding set", 26_000_000, 24],
  ];
  for (const [back, label, unitPriceCents, spreadMonths] of plant) {
    const when = at(back, 12);
    if (when > now) continue;
    await post({
      direction: "out",
      occurredAt: when,
      paidAt: when,
      sourceId: bank.id,
      lines: [{ expenseItemId: plantPurchase.id, qty: "1", unitPriceCents, label, spreadMonths }],
    });
  }

  // ── Site costs ──────────────────────────────────────────────────────────
  //
  // Every one of these names its site, which is what makes a project total
  // possible at all. Waste is recorded on the deliveries somebody actually
  // checked and left off the ones nobody did — the report is honest about the
  // difference, and a blanket zero would have been a lie.
  interface Delivery {
    back: number;
    day: number;
    project: string;
    itemId: string;
    qty: string;
    unitPriceCents: number;
    wastedQty?: string;
    label: string;
    vendorId?: string;
  }

  const deliveries: Delivery[] = [
    // ── DHA Boundary Wall: months 13 → 9, fixed price, steel went up ────────
    { back: 13, day: 6, project: dha.id, itemId: cement.id, qty: "160", unitPriceCents: 108_000, wastedQty: "6", label: "Cement — first pour", vendorId: cementTrader.id },
    { back: 13, day: 9, project: dha.id, itemId: steel.id, qty: "900", unitPriceCents: 24_500, label: "Rebar", vendorId: steelCorner.id },
    { back: 12, day: 8, project: dha.id, itemId: bricks.id, qty: "18000", unitPriceCents: 2_050, wastedQty: "620", label: "Bricks", },
    { back: 12, day: 14, project: dha.id, itemId: masonry.id, qty: "18", unitPriceCents: 780_000, label: "Masonry — 18 days", vendorId: masonCrew.id },
    { back: 11, day: 7, project: dha.id, itemId: sand.id, qty: "34", unitPriceCents: 420_000, wastedQty: "1.5", label: "Sand and crush" },
    // Steel repriced mid-job on a fixed-price contract. This is the whole
    // reason the wall barely made money.
    { back: 11, day: 19, project: dha.id, itemId: steel.id, qty: "700", unitPriceCents: 29_500, label: "Rebar — second lot", vendorId: steelCorner.id },
    { back: 10, day: 5, project: dha.id, itemId: masonry.id, qty: "16", unitPriceCents: 800_000, label: "Masonry — finishing", vendorId: masonCrew.id },
    { back: 10, day: 16, project: dha.id, itemId: plantHire.id, qty: "4", unitPriceCents: 1_650_000, label: "Excavator — 4 days" },
    { back: 9, day: 4, project: dha.id, itemId: permits.id, qty: "1", unitPriceCents: 3_200_000, label: "Completion inspection" },

    // ── Gulberg Villa: months 8 → now, the big one ─────────────────────────
    { back: 8, day: 5, project: gulberg.id, itemId: permits.id, qty: "1", unitPriceCents: 6_500_000, label: "Building approval" },
    { back: 8, day: 11, project: gulberg.id, itemId: plantHire.id, qty: "9", unitPriceCents: 1_800_000, label: "Excavator — foundations" },
    { back: 8, day: 12, project: gulberg.id, itemId: fuel.id, qty: "340", unitPriceCents: 27_000, label: "Diesel" },
    { back: 7, day: 6, project: gulberg.id, itemId: cement.id, qty: "400", unitPriceCents: 112_000, wastedQty: "24", label: "Cement — raft", vendorId: cementTrader.id },
    { back: 7, day: 7, project: gulberg.id, itemId: steel.id, qty: "2400", unitPriceCents: 27_000, wastedQty: "38", label: "Rebar — raft and columns", vendorId: steelCorner.id },
    { back: 7, day: 20, project: gulberg.id, itemId: masonry.id, qty: "22", unitPriceCents: 850_000, label: "Masonry — 22 days", vendorId: masonCrew.id },
    { back: 6, day: 9, project: gulberg.id, itemId: bricks.id, qty: "42000", unitPriceCents: 2_200, wastedQty: "1400", label: "Bricks — ground floor" },
    { back: 6, day: 15, project: gulberg.id, itemId: sand.id, qty: "60", unitPriceCents: 450_000, label: "Sand and crush" },
    { back: 5, day: 8, project: gulberg.id, itemId: cement.id, qty: "260", unitPriceCents: 118_000, label: "Cement — slab", vendorId: cementTrader.id },
    { back: 5, day: 18, project: gulberg.id, itemId: masonry.id, qty: "20", unitPriceCents: 850_000, label: "Masonry — 20 days", vendorId: masonCrew.id },
    { back: 4, day: 6, project: gulberg.id, itemId: bricks.id, qty: "36000", unitPriceCents: 2_250, wastedQty: "900", label: "Bricks — first floor" },
    { back: 4, day: 21, project: gulberg.id, itemId: services.id, qty: "14", unitPriceCents: 650_000, label: "Electrical first fix" },
    { back: 3, day: 7, project: gulberg.id, itemId: cement.id, qty: "300", unitPriceCents: 121_000, wastedQty: "18", label: "Cement — plaster", vendorId: cementTrader.id },
    { back: 3, day: 17, project: gulberg.id, itemId: masonry.id, qty: "24", unitPriceCents: 880_000, label: "Masonry — plaster", vendorId: masonCrew.id },
    { back: 2, day: 10, project: gulberg.id, itemId: services.id, qty: "16", unitPriceCents: 680_000, label: "Plumbing and second fix" },
    { back: 2, day: 22, project: gulberg.id, itemId: siteServices.id, qty: "1", unitPriceCents: 2_800_000, label: "Site security and water" },
    { back: 1, day: 8, project: gulberg.id, itemId: cement.id, qty: "180", unitPriceCents: 124_000, wastedQty: "5", label: "Cement — finishing", vendorId: cementTrader.id },
    { back: 1, day: 19, project: gulberg.id, itemId: masonry.id, qty: "18", unitPriceCents: 880_000, label: "Masonry — finishing", vendorId: masonCrew.id },
    { back: 0, day: 4, project: gulberg.id, itemId: fuel.id, qty: "220", unitPriceCents: 28_500, label: "Diesel" },

    // ── Model Town Clinic: months 4 → now, running hot ─────────────────────
    { back: 4, day: 9, project: modelTown.id, itemId: permits.id, qty: "1", unitPriceCents: 2_400_000, label: "Change-of-use permit" },
    { back: 4, day: 14, project: modelTown.id, itemId: bricks.id, qty: "9000", unitPriceCents: 2_250, wastedQty: "410", label: "Partition brickwork" },
    { back: 3, day: 11, project: modelTown.id, itemId: masonry.id, qty: "16", unitPriceCents: 880_000, label: "Masonry — partitions", vendorId: masonCrew.id },
    { back: 3, day: 24, project: modelTown.id, itemId: cement.id, qty: "120", unitPriceCents: 121_000, wastedQty: "9", label: "Cement — screed", vendorId: cementTrader.id },
    { back: 2, day: 12, project: modelTown.id, itemId: services.id, qty: "22", unitPriceCents: 700_000, label: "Medical gas and electrical" },
    // The overrun: masonry was planned at 30 days and is already past 50.
    { back: 1, day: 13, project: modelTown.id, itemId: masonry.id, qty: "21", unitPriceCents: 900_000, label: "Masonry — rework after inspection", vendorId: masonCrew.id },
    { back: 0, day: 6, project: modelTown.id, itemId: siteServices.id, qty: "1", unitPriceCents: 1_400_000, label: "Skip hire and site clean" },
  ];

  for (const d of deliveries) {
    const when = at(d.back, d.day);
    if (when > now) continue;
    await post({
      direction: "out",
      occurredAt: when,
      paidAt: plus(when, 5 + Math.floor(rng() * 10)),
      sourceId: bank.id,
      personId: d.vendorId ?? null,
      lines: [
        {
          expenseItemId: d.itemId,
          qty: d.qty,
          unitPriceCents: d.unitPriceCents,
          label: d.label,
          wastedQty: d.wastedQty ?? null,
          targetType: "project",
          targetId: d.project,
        },
      ],
    });
  }

  // ── Supplier bills still open ───────────────────────────────────────────
  //
  // One badly late and one not due yet, so the payables list has both states
  // and "overdue" is visibly different from "outstanding".
  const lateSteel = at(1, 24);
  if (lateSteel <= now) {
    await post({
      direction: "out",
      occurredAt: lateSteel,
      paidAt: null,
      dueDate: fromToday(-22),
      sourceId: bank.id,
      personId: steelCorner.id,
      referenceNumber: "SC-4471",
      lines: [
        {
          expenseItemId: steel.id,
          qty: "1600",
          unitPriceCents: 28_000,
          label: "Rebar — roof",
          targetType: "project",
          targetId: gulberg.id,
        },
      ],
    });
  }
  const soonCement = at(0, 8);
  if (soonCement <= now) {
    await post({
      direction: "out",
      occurredAt: soonCement,
      paidAt: null,
      dueDate: fromToday(11),
      sourceId: bank.id,
      personId: cementTrader.id,
      referenceNumber: "RCT-9920",
      lines: [
        {
          expenseItemId: cement.id,
          qty: "150",
          unitPriceCents: 124_000,
          wastedQty: "3",
          label: "Cement — top coat",
          targetType: "project",
          targetId: gulberg.id,
        },
      ],
    });
  }

  // ── Money in: stage bills, with money held back ─────────────────────────
  //
  // `billProject` writes TWO ordinary receivables when a percentage is held
  // back — the amount due now and the amount due at sign-off. Not a
  // part-payment, not a new money path: two promises with two dates.
  const markPaid = async (transactionId: string, when: Date) => {
    await ledger.updateTransactionHeader(businessId, transactionId, { paidAt: when });
  };

  // DHA — finished and settled, retention released on handover.
  const dhaStage = await projects.billProject(businessId, dha.id, {
    amountCents: 120_000_000,
    occurredAt: at(11, 2),
    label: "Boundary wall — stage 1",
    dueDate: dueOn(plus(at(11, 2), 30)),
    referenceNumber: "AB-0101",
    retentionPct: "5",
    retentionDueDate: dueOn(monthStart(8)),
  });
  txnCount += dhaStage.transactionIds.length;
  for (const id of dhaStage.transactionIds) await markPaid(id, at(8, 14));

  const dhaFinal = await projects.billProject(businessId, dha.id, {
    amountCents: 60_000_000,
    occurredAt: at(9, 3),
    label: "Boundary wall — final",
    dueDate: dueOn(plus(at(9, 3), 30)),
    referenceNumber: "AB-0102",
    retentionPct: "5",
    retentionDueDate: dueOn(monthStart(7)),
  });
  txnCount += dhaFinal.transactionIds.length;
  for (const id of dhaFinal.transactionIds) await markPaid(id, at(7, 9));

  // Gulberg — three stages billed, the last one still coming, and every
  // retention still held. Rs 300,000 of this contract is money the builder has
  // earned and cannot touch, which is exactly what an owner forgets.
  const gulbergStages: Array<[number, number, number, string]> = [
    [7, 4, 320_000_000, "AB-0201"],
    [4, 4, 320_000_000, "AB-0202"],
    [1, 6, 320_000_000, "AB-0203"],
  ];
  for (const [back, day, amountCents, ref] of gulbergStages) {
    const when = at(back, day);
    if (when > now) continue;
    const stage = await projects.billProject(businessId, gulberg.id, {
      amountCents,
      occurredAt: when,
      label: `Gulberg Villa — stage ${ref.slice(-1)}`,
      dueDate: dueOn(plus(when, 30)),
      referenceNumber: ref,
      retentionPct: "5",
      // Released at handover, which is still ahead of them.
      retentionDueDate: fromToday(105),
    });
    txnCount += stage.transactionIds.length;
    // Only the first two stages have been paid; the newest is inside terms.
    if (back >= 4) await markPaid(stage.transactionIds[0], plus(when, 26 + Math.floor(rng() * 10)));
  }

  // Model Town — one paid, one SIX WEEKS overdue. The row the owed screen exists
  // to put in front of somebody.
  const clinicFirst = await projects.billProject(businessId, modelTown.id, {
    amountCents: 120_000_000,
    occurredAt: at(3, 5),
    label: "Clinic fit-out — stage 1",
    dueDate: dueOn(plus(at(3, 5), 30)),
    referenceNumber: "AB-0301",
  });
  txnCount += clinicFirst.transactionIds.length;
  await markPaid(clinicFirst.transactionIds[0], at(2, 2));

  const clinicLate = await projects.billProject(businessId, modelTown.id, {
    amountCents: 90_000_000,
    occurredAt: at(2, 8),
    label: "Clinic fit-out — stage 2",
    dueDate: fromToday(-43),
    referenceNumber: "AB-0302",
  });
  txnCount += clinicLate.transactionIds.length;

  // ── Small work off the sites ────────────────────────────────────────────
  //
  // Repairs and call-outs belonging to no project. Real income that must NOT
  // land on a site — and the reason the project totals and the P&L are allowed
  // to disagree.
  for (let m = START; m >= 0; m--) {
    if (m % 2 !== 0) continue;
    const when = at(m, 26);
    if (when > now) continue;
    await post({
      direction: "in",
      occurredAt: when,
      paidAt: when,
      sourceId: manual.id,
      lines: [
        {
          label: "Repairs and call-outs",
          qty: "1",
          unitPriceCents: 4_000_000 + Math.floor(rng() * 3_000_000),
        },
      ],
    });
  }

  // ── Money that moved before the work did ────────────────────────────────
  //
  // An advance to the mason crew, half drawn down against their next bill, and
  // a deposit the clinic paid that has not been used yet. Both are cash that
  // has moved and work that has not happened — nothing under accrual, the full
  // amount under cash.
  const crewAdvance = await post({
    direction: "out",
    occurredAt: at(3, 2),
    paidAt: at(3, 2),
    sourceId: bank.id,
    personId: masonCrew.id,
    lines: [
      { label: "Advance to Nadeem crew", qty: "1", unitPriceCents: 30_000_000, isAdvance: true },
    ],
  });

  const crewBill = await post({
    direction: "out",
    occurredAt: at(1, 27),
    paidAt: null,
    dueDate: fromToday(9),
    sourceId: bank.id,
    personId: masonCrew.id,
    referenceNumber: "NC-118",
    lines: [
      {
        label: "Masonry — measured work to date",
        qty: "1",
        unitPriceCents: 52_000_000,
        targetType: "project",
        targetId: gulberg.id,
      },
    ],
  });
  await advances.settleFromAdvance(businessId, {
    transactionId: crewBill.transaction.id,
    advanceTransactionId: crewAdvance.transaction.id,
    // Half of it, so the advance keeps a balance and the bill keeps an amount
    // still owed. Both halves of the arithmetic are then visible on screen.
    amountCents: 15_000_000,
  });

  await post({
    direction: "in",
    occurredAt: at(4, 3),
    paidAt: at(4, 3),
    sourceId: bank.id,
    personId: clinic.id,
    lines: [
      { label: "Deposit from Dr Farhan Clinic", qty: "1", unitPriceCents: 40_000_000, isAdvance: true },
    ],
  });

  // ── The plans ───────────────────────────────────────────────────────────
  //
  // One for the year with a profit goal, and one for a single site. The project
  // budget is deliberately short on masonry, because an overrun the owner can
  // see on the day it happens is the number a builder actually checks.
  const yearStart = `${now.getUTCFullYear()}-01-01`;
  const yearEnd = `${now.getUTCFullYear()}-12-31`;
  await budgets.createBudget(businessId, {
    name: `${now.getUTCFullYear()} plan`,
    periodStart: yearStart,
    periodEnd: yearEnd,
    targetProfitCents: 250_000_000,
    lines: [
      { side: "out", expenseItemId: cement.id, amountCents: 15_000_000, basis: "per_month" },
      { side: "out", expenseItemId: steel.id, amountCents: 10_000_000, basis: "per_month" },
      { side: "out", expenseItemId: bricks.id, amountCents: 20_000_000, basis: "per_month" },
      { side: "out", expenseItemId: masonry.id, amountCents: 15_000_000, basis: "per_month" },
      { side: "out", categoryId: headOffice.id, amountCents: 35_000_000, basis: "per_month" },
      // Everything else that happens on a site: plant, fuel, permits, sand,
      // trades. The item lines above win over this one, so it picks up only
      // what they do not claim — the precedence rule, visible on the screen.
      { side: "out", categoryId: onSite.id, amountCents: 15_000_000, basis: "per_month" },
      // A label line, budgeted without a catalogue entry existing for it —
      // the same right the ledger gives a one-off entry.
      { side: "in", label: "Repairs and call-outs", amountCents: 5_000_000, basis: "per_month" },
      // Matched EXACTLY, so the 5% held back on the same bill lands in the
      // unbudgeted bucket rather than quietly joining this line. Money that
      // matches nothing being SHOWN is the whole point of that bucket.
      { side: "in", label: "Gulberg Villa — stage 1", amountCents: 300_000_000 },
    ],
  });

  await budgets.createBudget(businessId, {
    name: "Gulberg Villa — cost plan",
    scope: "project",
    projectId: gulberg.id,
    periodStart: dueOn(monthStart(8)),
    periodEnd: fromToday(75),
    // Priced with room in it everywhere except the labour, which is where this
    // job is actually going wrong. A plan that is over on every line reads as a
    // bad quote; one line over reads as a problem somebody can go and fix.
    lines: [
      { side: "out", expenseItemId: cement.id, amountCents: 165_000_000 },
      { side: "out", expenseItemId: steel.id, amountCents: 120_000_000 },
      { side: "out", expenseItemId: bricks.id, amountCents: 190_000_000 },
      // Priced at 70 crew days. The site is already past 80.
      { side: "out", expenseItemId: masonry.id, amountCents: 59_500_000 },
      { side: "out", categoryId: onSite.id, amountCents: 95_000_000 },
    ],
  });

  // The wall is finished and paid for. Closed last, once every cost and every
  // stage bill it will ever have is on it.
  await projects.updateProject(businessId, dha.id, { status: "completed" });

  const [row] = await db.select().from(businessesTable).where(eq(businessesTable.id, businessId));

  return {
    businessId,
    name: row.name,
    transactionCount: txnCount,
    projectCount: 4,
  };
}
