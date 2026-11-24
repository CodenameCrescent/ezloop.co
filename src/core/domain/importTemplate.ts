/**
 * The blank file we hand the owner, generated from the same column list the
 * matcher reads. Written rather than checked in as four static files, because
 * a static template is a copy that goes stale the first time a column changes.
 */
import { columnsFor, type ImportKind } from "./importColumns";

/** RFC4180: quote when the cell holds a delimiter, a quote, or a newline. */
function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function templateCsv(kind: ImportKind): string {
  const columns = columnsFor(kind);
  const header = columns.map((c) => csvCell(c.label)).join(",");
  const example = columns.map((c) => csvCell(c.example)).join(",");
  return `${header}\r\n${example}\r\n`;
}

export function templateFilename(kind: ImportKind): string {
  return `profit-loop-${kind.replace(/_/g, "-")}-template.csv`;
}
