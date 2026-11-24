/**
 * What a migration file does to data that already exists, read from its SQL.
 * Used by `npm run db:migrate` (migrate.ts) before anything is applied.
 *
 * Deliberately over-cautious: a false alarm costs one read of the file; a
 * missed DROP costs real accounts' records.
 */
export type Severity = "destructive" | "incompatible" | "review";
const CHECKS: Array<{ re: RegExp; severity: Severity; what: string }> = [
  { re: /\bDROP\s+TABLE\b/i, severity: "destructive", what: "drops a table and its rows" },
  { re: /\bDROP\s+SCHEMA\b/i, severity: "destructive", what: "drops a schema" },
  { re: /\bDROP\s+COLUMN\b/i, severity: "destructive", what: "drops a column and its values" },
  { re: /\bTRUNCATE\b/i, severity: "destructive", what: "empties a table" },
  { re: /\bDELETE\s+FROM\b/i, severity: "destructive", what: "deletes rows" },
  { re: /^\s*UPDATE\s/im, severity: "destructive", what: "rewrites existing rows" },
  { re: /\bALTER\s+COLUMN\s+"?[\w]+"?\s+(SET\s+DATA\s+)?TYPE\b/i, severity: "destructive", what: "changes a column's type" },
  { re: /\bRENAME\b/i, severity: "incompatible", what: "renames something the deployed code still uses" },
  { re: /\bSET\s+NOT\s+NULL\b/i, severity: "incompatible", what: "makes a column required (old code / old rows may lack it)" },
  { re: /\bADD\s+COLUMN\b(?![^;]*\bDEFAULT\b)[^;]*\bNOT\s+NULL\b/i, severity: "incompatible", what: "adds a required column with no default" },
  { re: /\bADD\s+CONSTRAINT\b/i, severity: "incompatible", what: "adds a constraint existing rows or deployed code may violate" },
  { re: /\bCREATE\s+UNIQUE\s+INDEX\b/i, severity: "incompatible", what: "adds a uniqueness rule existing rows may violate" },
  { re: /\bDROP\s+(CONSTRAINT|INDEX|TYPE|VIEW|FUNCTION|TRIGGER|POLICY)\b/i, severity: "review", what: "drops a database object" },
  { re: /\bCREATE\s+(UNIQUE\s+)?INDEX\b/i, severity: "review", what: "builds an index — blocks writes to that table while it builds" },
  { re: /\b(DO\s+\$|EXECUTE\b|CREATE\s+(OR\s+REPLACE\s+)?(FUNCTION|TRIGGER|PROCEDURE))/i, severity: "review", what: "runs procedural/dynamic SQL the checks cannot see into" },
];


export function findings(sqlText: string): Array<{ severity: Severity; what: string }> {
  return CHECKS.filter((c) => c.re.test(sqlText)).map(({ severity, what }) => ({ severity, what }));
}


/** Severities that must be named in `--allow=` before applying. `review` is printed, not blocking. */
export function blocking(severity: Severity): boolean {
  return severity === "destructive" || severity === "incompatible";
}
