import Decimal from "decimal.js";
import { parseCsvTable, stableHash } from "./csv";
import { isValidHours, isWorkType, type TimeTargetType, type WorkType } from "./clientProfitability";
import { addHours } from "./timesheet";
import { normalizePersonName } from "./personMatching";

/**
 * Turning somebody else's timesheet export into hours this app can cost.
 *
 * Three rules shape everything here:
 *
 * 1. NOTHING IS GUESSED. A row whose person or target cannot be matched is
 *    reported, not approximated to the nearest name. Importing four hours
 *    against the wrong client is worse than importing nothing, because it is
 *    invisible afterwards.
 *
 * 2. A DAY IS A DAY. Toggl and Clockify export one row per started timer, so a
 *    person can have five rows against one client on one Monday. The grid holds
 *    ONE cell per person/target/day, so those rows are summed into one entry.
 *    Writing five rows would show the grid one figure and hand profitability a
 *    different one — the exact disagreement between screens this codebase
 *    guards against everywhere else.
 *
 * 3. RE-IMPORTING SETTLES, IT DOES NOT STACK. The id identifies the CELL, not
 *    the row content, so re-importing a week after fixing one day updates that
 *    day rather than adding a second copy of it. A content hash would have
 *    looked idempotent and quietly doubled every corrected day.
 */

const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

export const IMPORT_PRESETS = ["toggl", "clockify", "custom"] as const;
export type ImportPreset = (typeof IMPORT_PRESETS)[number];

/** Which column holds what. Every field is a header NAME, not an index. */
export interface ColumnMapping {
  person: string;
  target: string;
  date: string;
  /** Either a decimal number of hours or a HH:MM:SS duration. */
  duration: string;
  description?: string;
  billable?: string;
  workType?: string;
}

/**
 * Header names each tool actually exports. Matched case-insensitively, and the
 * first header present wins — Toggl has renamed columns across versions and an
 * export from either vintage should just work.
 */
const PRESET_COLUMNS: Record<Exclude<ImportPreset, "custom">, Record<keyof ColumnMapping, string[]>> = {
  toggl: {
    person: ["User", "User Name"],
    target: ["Client", "Project"],
    date: ["Start date", "Start Date", "Date"],
    duration: ["Duration", "Duration (h)", "Duration (decimal)"],
    description: ["Description", "Task"],
    billable: ["Billable"],
    workType: ["Tags"],
  },
  clockify: {
    person: ["User", "User Name"],
    target: ["Client", "Project"],
    date: ["Start Date", "Date"],
    duration: ["Duration (decimal)", "Duration (h)", "Duration"],
    description: ["Description"],
    billable: ["Billable"],
    workType: ["Tags"],
  },
};

const findHeader = (headers: string[], candidates: string[]): string | undefined =>
  candidates
    .map((c) => headers.find((h) => h.toLowerCase() === c.toLowerCase()))
    .find((h): h is string => h !== undefined);

/**
 * Works out which tool produced this file from its headers.
 *
 * Both tools export a very similar shape, so the preset mostly decides which
 * duration column to prefer. When neither matches, the owner maps by hand.
 */
export function detectPreset(headers: string[]): ImportPreset {
  const lower = headers.map((h) => h.toLowerCase());
  // Clockify's decimal duration column is its distinguishing header.
  if (lower.includes("duration (decimal)")) return "clockify";
  if (lower.includes("user") && (lower.includes("duration") || lower.includes("duration (h)"))) return "toggl";
  return "custom";
}

/** The best-guess mapping for a file, which the owner can then correct. */
export function suggestMapping(headers: string[], preset: ImportPreset): Partial<ColumnMapping> {
  if (preset === "custom") return {};
  const spec = PRESET_COLUMNS[preset];
  const out: Partial<ColumnMapping> = {};
  for (const key of Object.keys(spec) as Array<keyof ColumnMapping>) {
    const found = findHeader(headers, spec[key]);
    if (found) out[key] = found;
  }
  return out;
}

/**
 * Hours from either shape a timesheet exports: "7.5", or "07:30:00".
 * Returns null when the cell is neither, so the row is reported rather than
 * silently counted as zero.
 */
export function parseDuration(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;

  const clock = value.match(/^(\d+):([0-5]\d)(?::([0-5]\d))?$/);
  if (clock) {
    const [, h, m, s] = clock;
    const hours = new D(h).plus(new D(m).div(60)).plus(new D(s ?? "0").div(3600));
    return hours.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toString();
  }

  // A plain number, allowing the comma decimal separator European exports use.
  const numeric = value.replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(numeric)) return null;
  return new D(numeric).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toString();
}

/** Dates as the two tools write them, normalised to YYYY-MM-DD. */
export function parseImportDate(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  // Already ISO, possibly with a time attached.
  const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  // DD/MM/YYYY, which is what a UK or PK export gives.
  const slash = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (slash) {
    const [, d, m, y] = slash;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  return null;
}

export interface ParsedImportRow {
  /** 1-based line number in the file, so an error points somewhere real. */
  lineNumber: number;
  personName: string;
  targetName: string;
  entryDate: string;
  hours: string;
  billable: boolean;
  workType: WorkType;
  description: string;
}

export interface ImportProblem {
  lineNumber: number;
  reason: string;
}

export interface ParsedImport {
  preset: ImportPreset;
  headers: string[];
  mapping: Partial<ColumnMapping>;
  rows: ParsedImportRow[];
  /** Rows that could not be read at all, with a line number and a reason. */
  problems: ImportProblem[];
}

const TAG_TO_WORK_TYPE: Record<string, WorkType> = {
  rework: "rework",
  redo: "rework",
  build: "build",
  maintenance: "maintenance",
  maintain: "maintenance",
  pitch: "pitching",
  pitching: "pitching",
  sales: "pitching",
  admin: "admin",
  delivery: "delivery",
};

/** A tag column is free text, so only recognised words change the work type. */
function workTypeFromTag(raw: string | undefined): WorkType {
  if (!raw) return "delivery";
  for (const part of raw.toLowerCase().split(/[,;|]/)) {
    const hit = TAG_TO_WORK_TYPE[part.trim()];
    if (hit) return hit;
  }
  return "delivery";
}

function truthy(raw: string | undefined): boolean {
  if (raw === undefined) return true; // no column means assume billable
  return /^(yes|true|1|billable|y)$/i.test(raw.trim());
}

/**
 * Reads a file into rows ready to be matched against real people and targets.
 *
 * Bad rows never stop the good ones: each problem is collected with its line
 * number so the owner sees exactly what will not import and why, rather than
 * one error for the whole file.
 */
export function parseTimeImport(text: string, override?: Partial<ColumnMapping>): ParsedImport {
  const { headers, rows } = parseCsvTable(text);
  const preset = detectPreset(headers);
  const mapping = { ...suggestMapping(headers, preset), ...override };

  const problems: ImportProblem[] = [];
  const parsed: ParsedImportRow[] = [];

  const required: Array<keyof ColumnMapping> = ["person", "target", "date", "duration"];
  const missing = required.filter((key) => !mapping[key]);
  if (headers.length === 0) {
    return { preset, headers, mapping, rows: [], problems: [{ lineNumber: 0, reason: "The file is empty." }] };
  }
  if (missing.length > 0) {
    return {
      preset,
      headers,
      mapping,
      rows: [],
      problems: [{ lineNumber: 0, reason: `Tell us which column holds: ${missing.join(", ")}.` }],
    };
  }

  const indexOf = (name: string | undefined) => (name ? headers.findIndex((h) => h === name) : -1);
  const cols = {
    person: indexOf(mapping.person),
    target: indexOf(mapping.target),
    date: indexOf(mapping.date),
    duration: indexOf(mapping.duration),
    description: indexOf(mapping.description),
    billable: indexOf(mapping.billable),
    workType: indexOf(mapping.workType),
  };

  rows.forEach((row, i) => {
    // +2: one for the header line, one because humans count from 1.
    const lineNumber = i + 2;
    const cell = (index: number) => (index >= 0 ? row[index] ?? "" : "");

    const personName = cell(cols.person).trim();
    const targetName = cell(cols.target).trim();
    if (!personName) return void problems.push({ lineNumber, reason: "No person on this row." });
    if (!targetName) return void problems.push({ lineNumber, reason: "No client or project on this row." });

    const entryDate = parseImportDate(cell(cols.date));
    if (!entryDate) {
      return void problems.push({ lineNumber, reason: `Couldn't read the date "${cell(cols.date)}".` });
    }

    const hours = parseDuration(cell(cols.duration));
    if (!hours) {
      return void problems.push({ lineNumber, reason: `Couldn't read the duration "${cell(cols.duration)}".` });
    }
    if (!isValidHours(hours)) {
      // A zero-length entry is common in exports and simply has nothing to say.
      if (Number(hours) === 0) return;
      return void problems.push({ lineNumber, reason: `${hours} hours is not a possible day.` });
    }

    const tagged = workTypeFromTag(cell(cols.workType));
    const description = cell(cols.description);

    parsed.push({
      lineNumber,
      personName,
      targetName,
      entryDate,
      hours,
      billable: truthy(cols.billable >= 0 ? cell(cols.billable) : undefined),
      workType: isWorkType(tagged) ? tagged : "delivery",
      description,
    });
  });

  return { preset, headers, mapping, rows: parsed, problems };
}

// ---------------------------------------------------------------------------
// From rows to cells
// ---------------------------------------------------------------------------

/** A parsed row once the owner's people and clients have been matched to it. */
export interface ResolvedImportRow extends ParsedImportRow {
  personId: string;
  targetType: TimeTargetType;
  targetId: string;
}

/** One cell of the weekly grid, built from every file row that belongs in it. */
export interface AggregatedEntry {
  personId: string;
  targetType: TimeTargetType;
  targetId: string;
  entryDate: string;
  workType: WorkType;
  billable: boolean;
  /** Every row for this cell, summed exactly. */
  hours: string;
  /** Which lines of the file fed it, so a problem points back at the source. */
  lineNumbers: number[];
  /** The descriptions, joined — what the person said they were doing. */
  note: string | null;
  externalId: string;
}

/**
 * The identity of a CELL, not of a row.
 *
 * This is the whole idempotency design in one function. Hashing the row's
 * content would have been the obvious choice and would have been wrong: fix one
 * day in Toggl, re-export, and the changed row hashes differently, so it lands
 * beside the old one and the day counts twice. Keyed on the cell instead, the
 * same day always resolves to the same id and a re-import restates it.
 *
 * Built from RESOLVED ids rather than the names in the file, so renaming a
 * client in Toggl doesn't orphan everything already imported for them.
 */
export function importExternalId(cell: {
  personId: string;
  targetType: TimeTargetType;
  targetId: string;
  entryDate: string;
  workType: WorkType;
  billable: boolean;
}): string {
  const key = [
    cell.personId,
    cell.targetType,
    cell.targetId,
    cell.entryDate,
    cell.workType,
    cell.billable ? "b" : "n",
  ].join("|");
  return `csv_${stableHash(key)}`;
}

/**
 * Collapses a file's rows into the cells they describe, summing the hours.
 *
 * Work type and billability stay part of the key rather than being averaged
 * away: two hours of rework on a client is the single most useful thing an
 * import can carry, and folding it into the day's delivery total would destroy
 * the measure at the boundary. Cells come back in file order, so a preview
 * reads in the order the owner's file does.
 */
export function aggregateImportRows(rows: ResolvedImportRow[]): AggregatedEntry[] {
  const byCell = new Map<string, AggregatedEntry>();

  for (const row of rows) {
    const key = [row.personId, row.targetType, row.targetId, row.entryDate, row.workType, row.billable].join("|");
    const existing = byCell.get(key);
    if (existing) {
      existing.hours = addHours(existing.hours, row.hours);
      existing.lineNumbers.push(row.lineNumber);
      if (row.description) {
        const notes = existing.note ? existing.note.split("; ") : [];
        if (!notes.includes(row.description)) notes.push(row.description);
        existing.note = notes.join("; ").slice(0, 500);
      }
      continue;
    }
    byCell.set(key, {
      personId: row.personId,
      targetType: row.targetType,
      targetId: row.targetId,
      entryDate: row.entryDate,
      workType: row.workType,
      billable: row.billable,
      hours: row.hours,
      lineNumbers: [row.lineNumber],
      note: row.description || null,
      externalId: importExternalId(row),
    });
  }

  return [...byCell.values()];
}
