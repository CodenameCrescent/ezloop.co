import * as XLSX from "xlsx";
import { buildReportSheets } from "./reportSheets";
import type { ReportPayload } from "./reportSheets";
export { exportPDF } from "./exportReport.parts/ExportPDF";

/*
 * This file renders a report. It does not work one out.
 *
 * Every figure arrives as authoritative integer cents on a `ReportPayload` the
 * server computed over the whole period. Nothing here re-derives a total from
 * rows — that is how the old export came to describe roughly a quarter of the
 * business, having been handed at most 200 transactions and asked to do sums.
 * The only arithmetic permitted is `centsToCell`, which must be the LAST money
 * operation on a figure. Its result may still be formatted for display —
 * grouped by `pdfNumber`, rounded to whole units by `fmt` — but it may never
 * become an operand of further money math.
 *
 * STANDING NOTE — do not add currency conversion here. The currency setting is
 * a LABEL, not a conversion: the server already returns cents in the business's
 * base currency and `payload.symbol` only names it. An exported file is the
 * worst possible place to restate figures through a rate, because it outlives
 * the session and records nothing about which rate was used or when it was
 * read. A year later, an accountant could not tell a converted figure from a
 * base one, and would have no way to check either.
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface DateRange {
  startDate: Date;
  endDate: Date;
  label: string;
}

// ─── Date range presets ───────────────────────────────────────────────────────

export function buildDateRange(preset: "today" | "week" | "month" | "90days" | "all"): DateRange | undefined {
  const now = new Date();
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);

  if (preset === "all") return undefined;

  if (preset === "today") {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return { startDate: start, endDate: end, label: "Today" };
  }

  if (preset === "week") {
    const dayOfWeek = now.getDay();
    const diffToMonday = (dayOfWeek === 0 ? -6 : 1 - dayOfWeek);
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() + diffToMonday);
    return { startDate: start, endDate: end, label: "This Week" };
  }

  if (preset === "month") {
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    return { startDate: start, endDate: end, label: "This Month" };
  }

  if (preset === "90days") {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 89);
    return { startDate: start, endDate: end, label: "Last 90 Days" };
  }

  return undefined;
}

// ─── Excel Export ─────────────────────────────────────────────────────────────

export function exportExcel(payload: ReportPayload) {
  // One clock. The Generated row and the filename's date are the two things a
  // reader uses to place this file in time, and a download fired across
  // midnight UTC could otherwise name one day while stating the next — leaving
  // a workbook that contradicts itself and cannot be reconciled a year later.
  const generatedAt = new Date();
  const { summary, offers, costs } = buildReportSheets(payload, generatedAt);
  const wb = XLSX.utils.book_new();

  const summarySheet = XLSX.utils.aoa_to_sheet(summary);
  summarySheet["!cols"] = [{ wch: 40 }, { wch: 20 }];
  XLSX.utils.book_append_sheet(wb, summarySheet, "Summary");

  const offerSheet = XLSX.utils.aoa_to_sheet(offers);
  offerSheet["!cols"] = [
    { wch: 30 },
    { wch: 14 },
    { wch: 20 },
    { wch: 24 },
    { wch: 22 },
    { wch: 16 },
    // Wide enough for its own heading: a column whose header is cut off is a
    // column the reader has to guess the meaning of, which is the whole reason
    // this one is no longer called "Transactions".
    { wch: 32 },
  ];
  XLSX.utils.book_append_sheet(wb, offerSheet, "Offers");

  const costSheet = XLSX.utils.aoa_to_sheet(costs);
  costSheet["!cols"] = [
    { wch: 30 },
    { wch: 14 },
    { wch: 14 },
    { wch: 18 },
    { wch: 26 },
    { wch: 26 },
    { wch: 14 },
  ];
  XLSX.utils.book_append_sheet(wb, costSheet, "Costs");

  const slug = payload.periodLabel.toLowerCase().replace(/\s+/g, "-");
  XLSX.writeFile(wb, `profit-report-${slug}-${generatedAt.toISOString().slice(0, 10)}.xlsx`);
}
