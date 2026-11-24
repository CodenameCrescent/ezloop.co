/**
 * A CSV reader, written rather than installed.
 *
 * The spec asks before adding a parsing dependency; this is the answer. Toggl
 * and Clockify exports are well-formed RFC4180, and the awkward parts of that
 * format — a comma inside a quoted field, a newline inside a quoted field, a
 * doubled quote meaning a literal one — are a few lines each and fully
 * testable. The domain keeps its single dependency.
 *
 * What this deliberately does NOT do: streaming, encoding detection, or
 * delimiter guessing beyond comma/semicolon/tab. A timesheet export is a small
 * file with a known shape, and pretending otherwise would be more code with
 * more ways to be subtly wrong.
 */

/** A byte-order mark, which spreadsheet exports love and parsers hate. */
const BOM = "﻿";

export type CsvDelimiter = "," | ";" | "\t";

/**
 * Guesses the delimiter from the header line. European exports use semicolons
 * and Clockify can emit tabs; getting this wrong turns the whole file into one
 * column, which is a confusing failure rather than an obvious one.
 */
export function detectDelimiter(text: string): CsvDelimiter {
  const firstLine = text.replace(BOM, "").split(/\r?\n/, 1)[0] ?? "";
  const counts: Array<[CsvDelimiter, number]> = [
    [",", (firstLine.match(/,/g) ?? []).length],
    [";", (firstLine.match(/;/g) ?? []).length],
    ["\t", (firstLine.match(/\t/g) ?? []).length],
  ];
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 0 ? counts[0][0] : ",";
}

/**
 * Parses CSV text into rows of cells.
 *
 * Blank lines are dropped: exports frequently end with one, and an empty row
 * would otherwise read as a row of empty fields and fail validation for no
 * reason the owner could act on.
 */
export function parseCsv(text: string, delimiter?: CsvDelimiter): string[][] {
  const input = text.startsWith(BOM) ? text.slice(1) : text;
  const sep = delimiter ?? detectDelimiter(input);

  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];

    if (inQuotes) {
      if (char === '"') {
        // A doubled quote inside a quoted field is one literal quote.
        if (input[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cell += char;
      }
      continue;
    }

    if (char === '"' && cell === "") {
      inQuotes = true;
    } else if (char === sep) {
      row.push(cell);
      cell = "";
    } else if (char === "\n" || char === "\r") {
      // Consume CRLF as one break.
      if (char === "\r" && input[i + 1] === "\n") i += 1;
      row.push(cell);
      cell = "";
      if (row.some((c) => c.trim() !== "")) rows.push(row);
      row = [];
    } else {
      cell += char;
    }
  }

  // Whatever is left when the text ends is the final cell of the final row.
  row.push(cell);
  if (row.some((c) => c.trim() !== "")) rows.push(row);

  return rows.map((r) => r.map((c) => c.trim()));
}

/** Header row plus the rest, which is how every importer actually wants it. */
export function parseCsvTable(text: string): { headers: string[]; rows: string[][] } {
  const all = parseCsv(text);
  if (all.length === 0) return { headers: [], rows: [] };
  const [headers, ...rows] = all;
  return { headers, rows };
}

/**
 * A small, stable, non-cryptographic hash (FNV-1a, run twice).
 *
 * Used to build an import id from a stable key, so the same key in a
 * re-exported file produces the same id and the database recognises it. A
 * random id would make every re-import a fresh set of entries, which is the
 * bug idempotency exists to prevent.
 *
 * TWO passes with different starting values, concatenated, giving 64 bits
 * rather than 32. That is not padding: at 32 bits, a business with 10,000 time
 * entries has better than a 1-in-100 chance that two different days collide —
 * and a collision here means one day silently overwriting another, which is
 * exactly the kind of quiet wrong number this module exists to avoid. 64 bits
 * puts it beyond reach.
 */
export function stableHash(input: string): string {
  const fnv = (basis: number) => {
    let hash = basis;
    for (let i = 0; i < input.length; i += 1) {
      hash ^= input.charCodeAt(i);
      // 32-bit FNV prime multiply, kept in range without BigInt.
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash.toString(36).padStart(7, "0");
  };
  return `${fnv(0x811c9dc5)}${fnv(0x9dc5811c)}`;
}
