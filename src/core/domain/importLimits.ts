/**
 * What an uploaded file is allowed to BE, in one place both sides can read.
 *
 * These used to live in `api-server/src/services/csvImport.ts`, which is the
 * right place for the server to enforce them and the wrong place for anything
 * else to learn them: the browser cannot import an Express service, so an
 * upload screen that wanted to refuse a 40 MB file before spending a minute
 * sending it had only one option — copy the digits. Two numbers that must agree
 * and cannot check each other is exactly how this cap went wrong twice already
 * (once sized against the wrong platform limit, once counting characters where
 * the platform counts bytes).
 *
 * So the number and the sentence that states it live here, in the one package
 * both the server and the frontend already depend on, and the service imports
 * them. The server still ENFORCES them — the browser's check is a courtesy that
 * saves an upload, never the thing that decides.
 *
 * `MAX_ROWS` deliberately stays in the service. It has exactly one reader, so
 * there is nothing for it to disagree with: the browser does not count rows,
 * because the browser does not parse the file authoritatively.
 */

/**
 * How much CSV we will read, in BYTES.
 *
 * BYTES, not characters: `vercel.json` rewrites all of `/api/(.*)` to one
 * serverless function and the platform refuses a body over 4.5 MB before our
 * code runs, and what the platform counts is bytes. The same sentence is one
 * byte per character in English and three in Japanese, Hindi or Urdu, so a cap
 * in characters has to be sized for its worst case and every Latin file pays a
 * multiplier it never uses. Counting what the platform counts deletes that.
 *
 * Three megabytes was measured, not guessed: a file built to sit exactly on
 * this cap, `JSON.stringify`d into the real commit body with its mapping and
 * filename, arrives at 3.55 MB on the wire in the heaviest real shape (a
 * 60-column export with every field quoted) — clear of 4.5 MB, and under the
 * 4 MB body parser in `routes/imports.ts`, which is this number plus a
 * megabyte of headroom so a file just OVER the cap is still read and answered
 * in words instead of a bare 413. The long version of that arithmetic is in
 * `csvImport.ts`, beside the check that enforces it.
 *
 * The BROWSER measures this with `File.size`, which is already a byte count, so
 * the two sides agree without either converting anything.
 */
export const MAX_CSV_BYTES = 3 * 1024 * 1024;

/**
 * The one sentence for a file over the cap.
 *
 * Built FROM the constant rather than written beside it, so moving the cap
 * cannot leave a message advertising the old one — which is a thing that has
 * happened here, and which reads to an owner as the product lying about its own
 * rules.
 */
export const CSV_TOO_BIG_MESSAGE = `That file is over ${MAX_CSV_BYTES / (1024 * 1024)} MB — try splitting it by month.`;

/** The one sentence for a file that is not a spreadsheet export at all. */
export const NOT_A_CSV_MESSAGE = "Only CSV files can be imported.";

/**
 * Does this filename look like something we can read?
 *
 * `.txt` is in because bank exports are routinely named that way and are plain
 * CSV inside. The test is on what the owner actually NAMED the file, before any
 * sanitising: sanitising truncates, and a legitimate 200-character name must
 * not be refused for a rule about its last four characters.
 */
export function looksLikeCsvFilename(filename: string): boolean {
  return /\.(csv|txt)$/i.test(filename.trim());
}
