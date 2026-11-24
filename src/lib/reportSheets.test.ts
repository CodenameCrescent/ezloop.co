import test from "node:test";
import assert from "node:assert/strict";
import {
  buildReportSheets,
  centsToCell,
  documentRows,
  fractionDigitsFor,
  marginPctOf,
  type ReportPayload,
} from "./reportSheets";

/**
 * Every field carries a value distinct from every other field in its own row.
 * A fixture that repeats a value cannot tell a correct column from a swapped
 * one, which is how a sheet with tests can still ship the wrong figure.
 */
function payload(over: Partial<ReportPayload> = {}): ReportPayload {
  return {
    businessName: "Acme",
    currency: "PKR",
    symbol: "Rs",
    periodLabel: "All Time",
    ladder: {
      grossRevenue: 2000000,
      discounts: 100000,
      refunds: 50000,
      netRevenue: 1850000,
      directCosts: 600000,
      contributionProfit: 1250000,
      periodExpenses: 400000,
      trueProfit: 850000,
    },
    // Shaped as the server actually sends them: the KEY is the raw expense
    // type and the label is that key title-cased, which is where "Cogs" came
    // from. The third has a key that is no expense type at all, so the
    // server's own label has to survive.
    expenseGroups: [
      { key: "cogs", label: "Cogs", amountCents: 250000, count: 3 },
      { key: "marketing", label: "Marketing", amountCents: 100000, count: 5 },
      { key: "shipping", label: "Shipping", amountCents: 50000, count: 2 },
    ],
    transactionCount: 42,
    offers: [
      {
        name: "Website build",
        unitsSold: 7,
        netRevenueCents: 1200000,
        contributionProfitCents: 900000,
        marginPct: 62.5,
        refundedCents: 25000,
        transactionCount: 4,
      },
    ],
    // `cogs` and `semi_variable` on purpose: those are the two values the
    // starter catalogue gives every new business, and both used to reach the
    // accountant's file as themselves.
    costs: [
      {
        name: "Stock purchases",
        type: "cogs",
        costNature: "semi_variable",
        spentCents: 300000,
        jobCostCents: 45000,
        shareOfExpensesPct: 61.25,
        transactionCount: 3,
      },
    ],
    ...over,
  };
}

/** Find the row whose first cell equals `label`. */
function row(rows: (string | number)[][], label: string) {
  return rows.find((r) => r[0] === label);
}

test("cents become a major-unit number, never a string", () => {
  // Accountants sum the column, so the cell has to be numeric.
  assert.equal(centsToCell(1850000), 18500);
  assert.equal(centsToCell(-4250), -42.5);
  assert.equal(centsToCell(0), 0);
  assert.equal(typeof centsToCell(1), "number");
});

test("the summary walks the ladder in its fixed order and vocabulary", () => {
  const { summary } = buildReportSheets(payload());
  const labels = summary.map((r) => String(r[0]).trim());
  const ladderLabels = labels.filter((l) =>
    ["Gross revenue", "Net revenue", "Contribution profit", "True profit"].includes(l),
  );
  assert.deepEqual(ladderLabels, [
    "Gross revenue",
    "Net revenue",
    "Contribution profit",
    "True profit",
  ]);
});

test("retired words appear nowhere in any sheet, in any casing", () => {
  // The whole point of the rename: an accountant must not receive a file
  // whose words disagree with the app's.
  //
  // Case-INSENSITIVE, because the way this rule actually broke was neither
  // "COGS" nor "Cogs" being typed by anyone: it was the raw enum `cogs`
  // reaching a cell, and the server's title-cased "Cogs" reaching another. An
  // exact-case check passed the whole time.
  const sheets = buildReportSheets(payload());
  const text = JSON.stringify(sheets).toLowerCase();
  for (const banned of ["cogs", "gross profit", "net profit"]) {
    assert.ok(!text.includes(banned), `"${banned}" must not appear in the export`);
  }
});

test("no label anywhere in the file is a raw enum key", () => {
  // An underscore in a cell is the tell: `semi_variable`, `one_time`,
  // `usage_based` are database values, and a reader who meets one has been
  // handed the schema instead of a word.
  const { summary, offers, costs } = buildReportSheets(payload());
  for (const [sheetName, rows] of [
    ["summary", summary],
    ["offers", offers],
    ["costs", costs],
  ] as const) {
    for (const row of rows) {
      for (const cell of row) {
        assert.ok(
          !(typeof cell === "string" && cell.includes("_")),
          `${sheetName} prints a raw key: ${String(cell)}`,
        );
      }
    }
  }
});

test("an expense type is spelled the same on the Summary sheet and the Costs sheet", () => {
  // One enum, one rendering. The Summary's expense block is labelled from the
  // group KEY through the same map the Costs sheet's Type column uses, so the
  // two cannot disagree about what `cogs` is called a few rows apart.
  const { summary, costs } = buildReportSheets(payload());
  const costType = costs[1][1];
  assert.equal(costType, "Cost of goods");
  const group = summary.find((r) => String(r[0]).trim() === costType);
  assert.ok(group, "the Summary names the type with the very same words");
  assert.equal(group?.[1], 2500);
});

test("every ladder rung reaches the summary as a major-unit number", () => {
  // All eight rungs, in place, with their own figure. Checking only the four
  // named rungs left the sub-rows free to swap: discounts could print refunds
  // and nothing would notice.
  const { summary } = buildReportSheets(payload());
  const start = summary.findIndex((r) => r[0] === "PROFIT LADDER");
  assert.ok(start >= 0, "the ladder block is labelled");
  assert.deepEqual(summary.slice(start + 1, start + 9), [
    ["Gross revenue", 20000],
    ["  Discounts", 1000],
    ["  Refunds", 500],
    ["Net revenue", 18500],
    ["  Direct costs", 6000],
    ["Contribution profit", 12500],
    ["  Period expenses", 4000],
    ["True profit", 8500],
  ]);
});

test("the summary says whose money this is, over what period, in what currency", () => {
  // Provenance is what makes a figure defensible at year end. A file that says
  // the wrong period, or pairs the business name with the "Period" label, is
  // worse than one that says nothing.
  const { summary } = buildReportSheets(payload());
  assert.equal(row(summary, "Business")?.[1], "Acme");
  assert.equal(row(summary, "Period")?.[1], "All Time");
  assert.equal(row(summary, "Currency")?.[1], "PKR");
  assert.equal(row(summary, "Transactions in period")?.[1], 42);
});

test("the generated stamp is unambiguous to a reader a year later", () => {
  // A local "08/09/2026" is August or September depending on the reader.
  const { summary } = buildReportSheets(payload(), new Date("2026-08-27T09:15:00Z"));
  assert.equal(row(summary, "Generated")?.[1], "2026-08-27T09:15:00.000Z");
});

test("the offers sheet carries contribution profit and no true-profit column", () => {
  // Fixed costs are never split across items, so an item-level "profit"
  // column would be an invented figure.
  const { offers } = buildReportSheets(payload());
  const header = offers[0].map(String);
  assert.ok(header.some((h) => h.includes("Contribution profit")));
  assert.ok(!header.some((h) => /true profit/i.test(h)));
  // A bare "Profit" column is the header of the export being replaced, so it
  // is the likeliest regression of all.
  assert.ok(
    !header.some((h) => /^(?!.*contribution).*profit/i.test(h)),
    "no plain profit column: fixed costs are not allocated per item",
  );
  assert.equal(offers[1][0], "Website build");
  assert.equal(offers[1][2], 12000);
  assert.equal(offers[1][3], 9000);
});

test("every cell of an offer row holds the field it claims to", () => {
  const { offers } = buildReportSheets(payload());
  assert.deepEqual(offers[1], ["Website build", 7, 12000, 9000, 62.5, 250, 4]);
});

test("every cell of a cost row holds the field it claims to", () => {
  // The costs sheet is a third of the file. Untested, `spentCents` could reach
  // the cell undivided — a column a hundred times too large.
  const { costs } = buildReportSheets(payload());
  assert.deepEqual(costs[1], [
    "Stock purchases",
    "Cost of goods",
    "A bit of both",
    3000,
    450,
    61.25,
    3,
  ]);
});

test("a cost's type and behaviour print the words the app itself uses", () => {
  // Not new wording invented for the export: these come from lib/domain, the
  // same map the Expenses page renders. An owner asked about a row on this
  // sheet can point at their own screen and see the identical phrase.
  const { costs } = buildReportSheets(
    payload({
      costs: [
        { ...payload().costs[0], type: "payroll", costNature: "fixed" },
        { ...payload().costs[0], type: "operational", costNature: "variable" },
        // A type from before the purpose/behaviour split, and one that is not
        // an expense type at all. Neither may print raw.
        { ...payload().costs[0], type: "variable", costNature: "semi_variable" },
        { ...payload().costs[0], type: "not_a_type", costNature: "sideways" },
      ],
    }),
  );
  assert.deepEqual(
    costs.slice(1).map((r) => [r[1], r[2]]),
    [
      ["People", "Stays the same"],
      ["Running the business", "Grows with sales"],
      ["Variable (old)", "A bit of both"],
      ["Not a type", "Sideways"],
    ],
  );
});

test("both header rows are pinned, and every percentage column is marked (%)", () => {
  // Pinned exactly, like the data rows above, so a rename has to be deliberate.
  //
  // The Offers sheet's last column says what it counts. It is NOT the period's
  // transaction count: a sale carrying three offers counts once on the Summary
  // sheet and three times down this column, so the old header "Transactions"
  // invited a reader to add it up and ask why it disagreed.
  const { offers, costs } = buildReportSheets(payload());
  assert.deepEqual(offers[0], [
    "Offer",
    "Units / sales",
    "Net revenue (Rs)",
    "Contribution profit (Rs)",
    "Contribution margin (%)",
    "Refunded (Rs)",
    "Transactions containing this offer",
  ]);
  assert.deepEqual(costs[0], [
    "Cost",
    "Type",
    "Behaviour",
    "Spent (Rs)",
    "Of which inside sales (Rs)",
    "Share of period expenses (%)",
    "Transactions",
  ]);

  // The "(%)" marker is for the reader, and it must agree with the column kind
  // the renderers act on. Both are derived from the rows rather than restated,
  // so adding a percentage column without marking it fails here too.
  const pctColumns = (header: (string | number)[]) =>
    header.flatMap((h, i) => (String(h).includes("(%)") ? [i] : []));
  const kindColumns = (kinds: string[], kind: string) =>
    kinds.flatMap((k, i) => (k === kind ? [i] : []));
  const { columnKinds } = buildReportSheets(payload());
  assert.deepEqual(pctColumns(offers[0]), [4], "the offers' only percentage is contribution margin");
  assert.deepEqual(pctColumns(costs[0]), [5], "the costs' only percentage is share of expenses");
  assert.deepEqual(kindColumns(columnKinds.offers, "pct"), pctColumns(offers[0]));
  assert.deepEqual(kindColumns(columnKinds.costs, "pct"), pctColumns(costs[0]));
  assert.equal(offers[1][4], 62.5);
  assert.equal(costs[1][5], 61.25);
});

test("every column of a tabular sheet declares what it holds", () => {
  // A column with no kind falls back to whole units, which is how a quantity
  // came to be rounded like money. One kind per header, always.
  const { offers, costs, columnKinds } = buildReportSheets(payload());
  assert.equal(columnKinds.offers.length, offers[0].length);
  assert.equal(columnKinds.costs.length, costs[0].length);
  assert.deepEqual(columnKinds.offers, [
    "text",
    "qty",
    "money",
    "money",
    "pct",
    "money",
    "count",
  ]);
  assert.deepEqual(columnKinds.costs, [
    "text",
    "text",
    "text",
    "money",
    "money",
    "pct",
    "count",
  ]);
});

test("a fractional quantity survives into the rendered document", () => {
  // The bug this test exists for: precision used to be guessed from the header
  // text, so anything that was not a percentage was rounded like money. A
  // freelancer logging 7.5 hours got 7.5 in the workbook and "8" in the PDF —
  // two documents of one report, disagreeing, with the smaller quantities
  // printing "0" beside a real revenue figure.
  const { offers, columnKinds } = buildReportSheets(
    payload({
      offers: [
        { ...payload().offers[0], name: "Consulting", unitsSold: 7.5 },
        { ...payload().offers[0], name: "Site audit", unitsSold: 0.25 },
        { ...payload().offers[0], name: "Mug", unitsSold: 12 },
      ],
    }),
  );
  const rendered = documentRows(offers.slice(1), columnKinds.offers);
  assert.deepEqual(
    rendered.map((r) => r[1]),
    ["7.5", "0.25", "12"],
    "quantities keep their decimals, and whole ones gain none",
  );
  // The other kinds still read as they always did.
  assert.equal(rendered[0][2], "12,000", "money is whole units, grouped");
  assert.equal(rendered[0][4], "62.5", "a percentage keeps its one decimal");
  assert.equal(rendered[0][6], "4", "a count is whole");
});

test("each column kind has one precision, decided here rather than downstream", () => {
  assert.equal(fractionDigitsFor("money"), 0);
  assert.equal(fractionDigitsFor("count"), 0);
  assert.equal(fractionDigitsFor("pct"), 1);
  assert.equal(fractionDigitsFor("qty"), 2);
});

test("a period with nothing in it produces headers and no data rows", () => {
  const { summary, offers, costs } = buildReportSheets(
    payload({ offers: [], costs: [], expenseGroups: [], transactionCount: 0 }),
  );
  assert.equal(offers.length, 1, "header only");
  assert.equal(costs.length, 1, "header only");
  assert.ok(summary.length > 0, "the summary still states the period and the zeroes");
});

test("margin is null when there is no revenue to take a percentage of", () => {
  // A margin on zero revenue is undefined, not zero.
  assert.equal(marginPctOf(0, 0), null);
  assert.equal(marginPctOf(-5000, 1000), null);
  assert.equal(marginPctOf(1850000, 850000), (850000 / 1850000) * 100);
});

test("an undefined margin prints a dash rather than a number", () => {
  const { summary } = buildReportSheets(
    payload({
      ladder: {
        grossRevenue: 0,
        discounts: 0,
        refunds: 0,
        netRevenue: 0,
        directCosts: 0,
        contributionProfit: 0,
        periodExpenses: 400000,
        trueProfit: -400000,
      },
    }),
  );
  assert.equal(row(summary, "True profit margin (%)")?.[1], "—");
});

test("a percentage that is not a number prints a dash on every sheet", () => {
  // NaN survives into a numeric cell and poisons every total the accountant
  // sums it into, and unlike a dash it does not look absent. All three
  // percentage cells go through the same guard.
  const { summary, offers, costs } = buildReportSheets(
    payload({
      ladder: { ...payload().ladder, netRevenue: NaN },
      offers: [{ ...payload().offers[0], marginPct: NaN }],
      costs: [{ ...payload().costs[0], shareOfExpensesPct: NaN }],
    }),
  );
  assert.equal(row(summary, "True profit margin (%)")?.[1], "—");
  assert.equal(offers[1][4], "—");
  assert.equal(costs[1][5], "—");
});

test("expense groups are listed under period expenses, indented and in English", () => {
  const { summary } = buildReportSheets(payload());
  const marketing = summary.find((r) => String(r[0]).trim() === "Marketing");
  assert.ok(marketing, "each expense group gets its own row");
  assert.equal(marketing?.[1], 1000);
  assert.ok(String(marketing?.[0]).startsWith(" "), "group rows are indented under their total");
  // A key that is no expense type keeps the label the server sent rather than
  // losing the row or printing the key.
  const shipping = summary.find((r) => String(r[0]).trim() === "Shipping");
  assert.equal(shipping?.[1], 500);
});

test("the summary's margin is true profit as a share of net revenue, not the reverse", () => {
  // `marginPctOf` in lib/domain takes the same two numbers in the OPPOSITE
  // order and returns the same `number | null`, so swapping the arguments here
  // typechecks and prints 217.65 where 45.95 was meant. Every other margin
  // test in this file survives that swap — the dash cases stay dashes and the
  // pinned ladder slice stops one row short — so the value itself is asserted.
  const { summary } = buildReportSheets(payload());
  assert.equal(row(summary, "True profit margin (%)")?.[1], 45.95);
});

test("the payload's own totals are used, never re-derived from the rows", () => {
  // The offers list is what the server returned for the period; the summary's
  // revenue is the ladder's. They are separate facts and the sheet must not
  // silently reconcile them by summing one into the other.
  const { summary } = buildReportSheets(
    payload({ offers: [] }),
  );
  assert.equal(row(summary, "Net revenue")?.[1], 18500);
});
