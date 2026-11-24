/**
 * The exported report, as rows — and nothing else.
 *
 * This module is the whole reason the download can be trusted. Every figure it
 * receives has already been computed by the server; its only job is to lay them
 * out. It deliberately holds no raw transactions, so nothing here can quietly
 * re-derive a total from a truncated list — which is exactly how the old export
 * came to describe a quarter of the business.
 *
 * Kept apart from `exportReport.ts` so the decisions (which rows, which words,
 * which figure belongs where, and to how many decimal places) are testable
 * without generating a file. XLSX and jsPDF are libraries; asserting they were
 * called proves nothing about the numbers.
 */

import { COST_NATURE_LABELS, EXPENSE_PURPOSE_LABELS } from "@workspace/domain";
import type { CostNature, StoredPurpose } from "@workspace/domain";

/** Every figure crossing this boundary is integer cents. */
export interface ReportLadder {
  grossRevenue: number;
  discounts: number;
  refunds: number;
  netRevenue: number;
  directCosts: number;
  contributionProfit: number;
  periodExpenses: number;
  trueProfit: number;
}

export interface ReportGroup {
  key: string;
  label: string;
  amountCents: number;
  count: number;
}

export interface ReportOffer {
  name: string;
  unitsSold: number;
  netRevenueCents: number;
  contributionProfitCents: number;
  marginPct: number | null;
  refundedCents: number;
  transactionCount: number;
}

export interface ReportCost {
  name: string;
  type: string;
  costNature: string;
  spentCents: number;
  jobCostCents: number;
  shareOfExpensesPct: number;
  transactionCount: number;
}

export interface ReportPayload {
  businessName: string;
  currency: string;
  symbol: string;
  periodLabel: string;
  ladder: ReportLadder;
  expenseGroups: ReportGroup[];
  transactionCount: number;
  offers: ReportOffer[];
  costs: ReportCost[];
}

/**
 * What a column holds, which is the only thing that decides how precisely it
 * may be printed.
 *
 * This used to be guessed downstream, in `exportReport.ts`, by testing the
 * header text for "(%)": percentages kept a decimal and EVERYTHING ELSE was
 * rounded to whole units. That was written for money and quietly applied to
 * quantities, so a freelancer's 7.5 hours reached the workbook as 7.5 and the
 * PDF as "8", and a half-unit quantity printed "0" beside a real revenue
 * figure. Two documents of one report disagreeing is the kind of thing an
 * accountant finds a year later with nobody left to ask.
 *
 * So the kind is declared here, beside the header it belongs to, and both
 * renderers read it.
 */
export type ColumnKind = "text" | "money" | "pct" | "qty" | "count";

/** A column's heading and what it holds, written on one line so they cannot drift apart. */
interface ReportColumn {
  header: string;
  kind: ColumnKind;
}

export interface ReportSheets {
  summary: (string | number)[][];
  offers: (string | number)[][];
  costs: (string | number)[][];
  /**
   * What each column of the two tabular sheets holds, in column order.
   *
   * The Summary sheet is absent on purpose: it is a label/value list whose
   * second column holds money on one row, a percentage on the next and a count
   * on another, so "the kind of column 2" is not a question with an answer.
   * Nothing renders it as a table.
   */
  columnKinds: { offers: ColumnKind[]; costs: ColumnKind[] };
}

/**
 * How many decimal places a kind may show in a RENDERED document (the PDF).
 *
 * Money is whole units: the PDF is read, not summed, and the workbook is where
 * the paisa live. Percentages keep one place, because rounding 62.5% to 63%
 * throws away the digit that separates two offers. Quantities keep up to two,
 * because they are genuinely fractional — 7.5 hours, 0.25 of a day — and a
 * quantity is not money, so rounding it is not conservatism, it is a wrong
 * number printed next to a right one. Counts are whole by definition.
 */
export function fractionDigitsFor(kind: ColumnKind): number {
  if (kind === "pct") return 1;
  if (kind === "qty") return 2;
  return 0;
}

/** A number as a rendered-document cell: grouped, at its kind's precision. */
export function documentNumber(value: number, kind: ColumnKind): string {
  return value.toLocaleString("en-US", { maximumFractionDigits: fractionDigitsFor(kind) });
}

/**
 * Sheet data rows formatted for a rendered document.
 *
 * The sheets themselves carry raw numbers because a spreadsheet cell must be
 * summable; a PDF cell is read, so it is formatted — here, at the last possible
 * point, against the same column kinds the headers were built from. Strings
 * (labels, and the "—" a missing percentage prints) pass through untouched.
 */
export function documentRows(
  rows: (string | number)[][],
  kinds: ColumnKind[],
): string[][] {
  return rows.map((row) =>
    row.map((cell, i) =>
      typeof cell === "number" ? documentNumber(cell, kinds[i] ?? "text") : cell,
    ),
  );
}

/** A key with no label of its own, made readable rather than printed raw. */
function humanise(key: string): string {
  const spaced = key.replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * The words for an expense's `type` and `costNature`.
 *
 * These are enum keys in the database, and they used to reach the accountant's
 * file as themselves: the Costs sheet printed `cogs` and `semi_variable` while
 * the Summary sheet, a few rows away, rendered the SAME enum as "Cogs" — one
 * value, two spellings, one workbook. And `cogs` is a word this app does not
 * say anywhere else, by architecture rule.
 *
 * The labels are the app's own, taken from `lib/domain` rather than invented
 * here, so the file and the screen call a cost the same thing. An owner asked
 * about a row can point at the Expenses page and see the identical words.
 */
export function expenseTypeLabel(type: string, fallback?: string): string {
  return (
    EXPENSE_PURPOSE_LABELS[type as StoredPurpose] ?? fallback ?? humanise(type)
  );
}

export function costNatureLabel(nature: string): string {
  return COST_NATURE_LABELS[nature as CostNature]?.label ?? humanise(nature);
}

/**
 * Cents to a spreadsheet cell. THE ONLY division in this module, and the last
 * thing that happens to a figure before it is written — an accountant sums the
 * column, so the cell must be a number rather than a formatted string. Nothing
 * downstream calculates with the result.
 */
export function centsToCell(cents: number): number {
  return cents / 100;
}

/**
 * A margin needs something to be a percentage OF. Zero or negative net revenue
 * gives no denominator worth having — a refund-heavy period can produce a
 * number here that is arithmetically available and means nothing.
 *
 * CAUTION, argument order: revenue first, profit second. `marginPctOf` in
 * `lib/domain/src/ruleCatalogue.ts` is a different function of the same name
 * taking the SAME two numbers in the OPPOSITE order, and returning the same
 * `number | null`. Calling either with the other's order typechecks cleanly and
 * silently returns the reciprocal — 217.6% where 45.9% was meant.
 */
export function marginPctOf(netRevenueCents: number, profitCents: number): number | null {
  if (netRevenueCents <= 0) return null;
  return (profitCents / netRevenueCents) * 100;
}

/**
 * A percentage as a cell. A missing margin prints a dash, and so does a
 * non-finite one: NaN and Infinity survive into a numeric cell and poison every
 * total the accountant sums that column into, and unlike a dash they do not
 * look absent. Absent beats wrong. This is the last guard before the file —
 * upstream is a React memo on a page with no tests.
 */
function pct(value: number | null): string | number {
  return value == null || !Number.isFinite(value) ? "—" : Number(value.toFixed(2));
}

const offerColumns = (symbol: string): ReportColumn[] => [
  { header: "Offer", kind: "text" },
  // A quantity, not a count: hours, kilograms and fractions of a day all land
  // here. It keeps its decimals in both outputs.
  { header: "Units / sales", kind: "qty" },
  { header: `Net revenue (${symbol})`, kind: "money" },
  { header: `Contribution profit (${symbol})`, kind: "money" },
  { header: "Contribution margin (%)", kind: "pct" },
  { header: `Refunded (${symbol})`, kind: "money" },
  // NOT the period's transaction count and it must not read as one: a sale
  // carrying three offers counts once on the Summary sheet and three times
  // down this column, so "Transactions" invited a sum that could never match.
  { header: "Transactions containing this offer", kind: "count" },
];

const costColumns = (symbol: string): ReportColumn[] => [
  { header: "Cost", kind: "text" },
  { header: "Type", kind: "text" },
  { header: "Behaviour", kind: "text" },
  { header: `Spent (${symbol})`, kind: "money" },
  { header: `Of which inside sales (${symbol})`, kind: "money" },
  { header: "Share of period expenses (%)", kind: "pct" },
  { header: "Transactions", kind: "count" },
];

export function buildReportSheets(
  payload: ReportPayload,
  generatedAt: Date = new Date(),
): ReportSheets {
  const { ladder, symbol } = payload;

  const summary: (string | number)[][] = [
    ["Profit Loop — Money Report", ""],
    ["Business", payload.businessName],
    ["Period", payload.periodLabel],
    // ISO-8601, UTC. A report is opened a year later by someone who was not in
    // the room: a local "08/09/2026" is August or September depending on where
    // the reader sits, and a local clock time with no offset reconciles against
    // nothing. The Z is the point of the row.
    ["Generated", generatedAt.toISOString()],
    ["Currency", payload.currency],
    [""],
    // The ladder, in its fixed order. The vocabulary is the app's own and is
    // not ours to reword here (CLAUDE.md).
    ["PROFIT LADDER", `Amount (${symbol})`],
    ["Gross revenue", centsToCell(ladder.grossRevenue)],
    ["  Discounts", centsToCell(ladder.discounts)],
    ["  Refunds", centsToCell(ladder.refunds)],
    ["Net revenue", centsToCell(ladder.netRevenue)],
    ["  Direct costs", centsToCell(ladder.directCosts)],
    ["Contribution profit", centsToCell(ladder.contributionProfit)],
    ["  Period expenses", centsToCell(ladder.periodExpenses)],
    ["True profit", centsToCell(ladder.trueProfit)],
    ["True profit margin (%)", pct(marginPctOf(ladder.netRevenue, ladder.trueProfit))],
    [""],
    ["Transactions in period", payload.transactionCount],
  ];

  if (payload.expenseGroups.length > 0) {
    summary.push([""], ["PERIOD EXPENSES BY TYPE", `Amount (${symbol})`]);
    for (const g of payload.expenseGroups) {
      // Labelled from the group's KEY, which is the raw expense type, through
      // the same map the Costs sheet uses — so the two sheets name a type
      // identically. The server's own title-cased label is the fallback for a
      // key that is not an expense type at all.
      summary.push([`  ${expenseTypeLabel(g.key, g.label)}`, centsToCell(g.amountCents)]);
    }
  }

  const offerCols = offerColumns(symbol);
  const costCols = costColumns(symbol);

  const offers: (string | number)[][] = [
    offerCols.map((c) => c.header),
    ...payload.offers.map((o) => [
      o.name,
      o.unitsSold,
      centsToCell(o.netRevenueCents),
      centsToCell(o.contributionProfitCents),
      pct(o.marginPct),
      centsToCell(o.refundedCents),
      o.transactionCount,
    ]),
  ];

  const costs: (string | number)[][] = [
    costCols.map((c) => c.header),
    ...payload.costs.map((c) => [
      c.name,
      expenseTypeLabel(c.type),
      costNatureLabel(c.costNature),
      centsToCell(c.spentCents),
      centsToCell(c.jobCostCents),
      pct(c.shareOfExpensesPct),
      c.transactionCount,
    ]),
  ];

  return {
    summary,
    offers,
    costs,
    columnKinds: {
      offers: offerCols.map((c) => c.kind),
      costs: costCols.map((c) => c.kind),
    },
  };
}
