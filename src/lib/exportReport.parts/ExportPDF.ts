import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { buildReportSheets, marginPctOf, centsToCell, documentNumber, expenseTypeLabel } from "../reportSheets";
import type { ReportPayload } from "../reportSheets";
import { type JsPDFWithAutoTable, fmt, pdfBody } from "./PdfBody";

// ─── PDF Export ───────────────────────────────────────────────────────────────

export function exportPDF(payload: ReportPayload) {
  // One clock for the whole document, bound before anything reads it: the
  // header stamp, the sheet rows and the filename cannot disagree, even on a
  // download fired across midnight.
  const generatedAt = new Date();
  // The same rows the workbook gets, so a column added to one lands in both.
  const sheets = buildReportSheets(payload, generatedAt);
  const symbol = payload.symbol;
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });

  const PRIMARY: [number, number, number] = [16, 185, 129];
  const DARK: [number, number, number] = [15, 23, 42];
  const MUTED: [number, number, number] = [100, 116, 139];

  let y = 18;

  // Header bar
  doc.setFillColor(...PRIMARY);
  doc.rect(0, 0, 210, 12, "F");

  doc.setTextColor(255, 255, 255);
  doc.setFontSize(9);
  doc.setFont("helvetica", "bold");
  doc.text("PROFIT LOOP", 10, 8);

  doc.setFont("helvetica", "normal");
  // ISO-8601, UTC — the same stamp the workbook's Generated row carries, for
  // the same reason. Two outputs of one report must not date themselves
  // differently, and a local "08/09/2026" is August or September depending on
  // where the reader sits, with no zone recorded to settle it.
  doc.text(`Generated ${generatedAt.toISOString()}`, 200, 8, { align: "right" });

  y = 22;

  // Title + period
  doc.setTextColor(...DARK);
  doc.setFontSize(18);
  doc.setFont("helvetica", "bold");
  doc.text("Money Report", 10, y);

  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(...MUTED);
  doc.text(`${payload.businessName}  ·  Period: ${payload.periodLabel}`, 10, y + 6);

  y += 16;

  // ── KPI Cards ─────────────────────────────────────────────────────────────
  // Argument order: net revenue first, profit second. See the caution on
  // `marginPctOf` — the same-named helper in lib/domain takes them reversed.
  const marginPct = marginPctOf(payload.ladder.netRevenue, payload.ladder.trueProfit);
  const kpis = [
    {
      label: "Net revenue",
      value: fmt(symbol, centsToCell(payload.ladder.netRevenue)),
      sub: `${payload.transactionCount} transactions`,
    },
    {
      label: "Contribution profit",
      value: fmt(symbol, centsToCell(payload.ladder.contributionProfit)),
      sub: "After direct costs",
    },
    {
      label: "True profit",
      value: fmt(symbol, centsToCell(payload.ladder.trueProfit)),
      sub: payload.ladder.trueProfit >= 0 ? "Profitable" : "At a loss",
    },
    {
      label: "True profit margin",
      // A dash with no explanation is the one thing a reader cannot check. The
      // sub-line says why the figure is absent, because the file outlives the
      // session that made it.
      value: marginPct == null ? "—" : `${marginPct.toFixed(1)}%`,
      sub:
        marginPct == null
          ? "No revenue to measure"
          : marginPct >= 20
            ? "Healthy"
            : marginPct >= 0
              ? "Slim"
              : "Loss",
    },
  ];

  const cardW = 44;
  const cardH = 20;
  const gap = 4;
  const startX = 10;

  kpis.forEach((kpi, i) => {
    const x = startX + i * (cardW + gap);
    doc.setFillColor(248, 250, 252);
    doc.roundedRect(x, y, cardW, cardH, 2, 2, "F");
    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.2);
    doc.roundedRect(x, y, cardW, cardH, 2, 2, "S");

    doc.setFontSize(7);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...MUTED);
    doc.text(kpi.label.toUpperCase(), x + 3, y + 5);

    doc.setFontSize(9);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...DARK);
    doc.text(kpi.value, x + 3, y + 12);

    doc.setFontSize(7);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...MUTED);
    doc.text(kpi.sub, x + 3, y + 17);
  });

  y += cardH + 10;

  // ── Costs & Expenses Breakdown ─────────────────────────────────────────────
  doc.setFontSize(11);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...DARK);
  doc.text("Costs & Expenses Breakdown", 10, y);
  y += 6;

  // Two authoritative integer rungs added together — composition, not
  // recomputation. It stays integer until `centsToCell`.
  const totalCostsCents = payload.ladder.directCosts + payload.ladder.periodExpenses;
  const share = (cents: number) =>
    totalCostsCents > 0 ? `${((cents / totalCostsCents) * 100).toFixed(1)}%` : "—";

  autoTable(doc, {
    startY: y,
    head: [["Cost", `Amount (${symbol})`, "% of total costs"]],
    body: [
      [
        "Direct costs",
        documentNumber(centsToCell(payload.ladder.directCosts), "money"),
        share(payload.ladder.directCosts),
      ],
      [
        "Period expenses",
        documentNumber(centsToCell(payload.ladder.periodExpenses), "money"),
        share(payload.ladder.periodExpenses),
      ],
      // A breakdown OF the row above, not further costs on top of it. Two
      // things say so, because an indent alone does not: two spaces of 8pt
      // Helvetica is about 1.6mm, which is far too thin a cue to carry the
      // difference between a cost and a restatement of one.
      //
      // First the words "of which", which cannot be misread at any font size.
      // Second the blank share cell: each group's share of total costs is
      // arithmetically true on its own, but printing it makes the % column sum
      // to roughly 200% directly above a footer asserting 100%. A figure that
      // invites a wrong total is one this project omits rather than prints —
      // the same rule `pct()` in reportSheets.ts applies to a margin it cannot
      // stand behind. Blank, the % column is a true partition of the footer,
      // and every amount is still present and traceable.
      //
      // Labelled through `expenseTypeLabel` for the same reason the sheets are:
      // the group's server-supplied label is the raw enum title-cased, so this
      // row read "of which: Cogs" — a word the app does not say, and a
      // different spelling of the value the Costs sheet prints.
      ...payload.expenseGroups.map((g) => [
        `  of which: ${expenseTypeLabel(g.key, g.label)}`,
        documentNumber(centsToCell(g.amountCents), "money"),
        "",
      ]),
    ],
    foot: [
      [
        "Total costs (direct + period expenses)",
        documentNumber(centsToCell(totalCostsCents), "money"),
        totalCostsCents > 0 ? "100%" : "—",
      ],
    ],
    headStyles: { fillColor: PRIMARY, fontSize: 8, fontStyle: "bold" },
    footStyles: {
      fillColor: [241, 245, 249],
      textColor: DARK,
      fontStyle: "bold",
      fontSize: 8,
    },
    bodyStyles: { fontSize: 8 },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    margin: { left: 10, right: 10 },
    columnStyles: { 1: { halign: "right" }, 2: { halign: "right" } },
  });

  y = (doc as JsPDFWithAutoTable).lastAutoTable.finalY + 10;

  // ── Offer Breakdown ────────────────────────────────────────────────────────
  // Item-level output stops at contribution profit: fixed costs are never
  // allocated per offer, so there is no true-profit column here by design.
  if (payload.offers.length > 0) {
    doc.setFontSize(11);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...DARK);
    doc.text("Offer Breakdown", 10, y);
    y += 6;

    autoTable(doc, {
      startY: y,
      head: [sheets.offers[0]],
      body: pdfBody(sheets.offers, sheets.columnKinds.offers),
      headStyles: { fillColor: PRIMARY, fontSize: 8, fontStyle: "bold" },
      bodyStyles: { fontSize: 8 },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      margin: { left: 10, right: 10 },
      columnStyles: {
        1: { halign: "right" },
        2: { halign: "right" },
        3: { halign: "right" },
        4: { halign: "right" },
        5: { halign: "right" },
        6: { halign: "right" },
      },
    });

    y = (doc as JsPDFWithAutoTable).lastAutoTable.finalY + 10;
  }

  // ── Cost Ledger ────────────────────────────────────────────────────────────
  if (payload.costs.length > 0) {
    if (y > 230) {
      doc.addPage();
      y = 20;
    }

    doc.setFontSize(11);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...DARK);
    doc.text("Operating Cost Ledger", 10, y);
    y += 6;

    autoTable(doc, {
      startY: y,
      head: [sheets.costs[0]],
      body: pdfBody(sheets.costs, sheets.columnKinds.costs),
      headStyles: { fillColor: PRIMARY, fontSize: 8, fontStyle: "bold" },
      bodyStyles: { fontSize: 8 },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      margin: { left: 10, right: 10 },
      columnStyles: {
        3: { halign: "right" },
        4: { halign: "right" },
        5: { halign: "right" },
        6: { halign: "right" },
      },
    });
  }

  // Footer on every page
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(7);
    doc.setTextColor(...MUTED);
    doc.text(
      `Page ${i} of ${pageCount}  ·  Profit Loop  ·  ${payload.periodLabel}`,
      105,
      292,
      { align: "center" },
    );
  }

  const slug = payload.periodLabel.toLowerCase().replace(/\s+/g, "-");
  doc.save(`profit-report-${slug}-${generatedAt.toISOString().slice(0, 10)}.pdf`);
}
