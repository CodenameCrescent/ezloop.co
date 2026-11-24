import jsPDF from "jspdf";
import { documentNumber, documentRows } from "../reportSheets";
import type { ColumnKind } from "../reportSheets";

/** jsPDF instance after autoTable has run has a lastAutoTable property. */
export interface JsPDFWithAutoTable extends jsPDF {
  lastAutoTable: { finalY: number };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * A money string for the PDF, which is a readable summary rather than a thing
 * to sum. It takes MAJOR units out of `centsToCell` and rounds to whole units,
 * as it always did — the workbook is where the exact figure lives — but it now
 * rounds through the shared money rule rather than its own, so no figure in
 * this document is rounded by a second, private decision.
 */
export function fmt(symbol: string, n: number) {
  return `${symbol} ${documentNumber(n, "money")}`;
}

/**
 * The shared sheet rows, formatted for the page.
 *
 * Precision comes from the sheet's own column kinds, declared in
 * `reportSheets.ts` next to the headers they belong to. It used to be inferred
 * HERE by testing each header for "(%)", which meant every column that was not
 * a percentage was treated as money and rounded to whole units — including the
 * Offers sheet's quantity column, so 7.5 hours printed as "8" in the copy the
 * accountant reads while the workbook beside it said 7.5.
 *
 * Still no second list of columns: the kinds arrive from the same call that
 * built the rows, so a column added or moved lands here already described.
 */
export function pdfBody(sheet: (string | number)[][], kinds: ColumnKind[]) {
  return documentRows(sheet.slice(1), kinds);
}
