import { type ImportFailedRowShape } from "@workspace/api-contract";
import { type ImportKind } from "@workspace/domain";
import { countInUnit, endStop } from "./ChannelAnswer";

/**
 * What to say when the import stopped part-way, and what it says about the rows
 * the owner had ticked back in.
 *
 * ── Why a failed import cannot simply be tried again ──────────────────────
 *
 * The write is not atomic and cannot be made so: `createTransaction` opens its
 * own database transaction per order, so each one that got through before the
 * failure is real, committed money (`csvImportCommit.ts` says this at length).
 * The batch is still stamped and the error raised afterwards, so what landed is
 * recorded — but the screen came back live with no hint that any of it had.
 *
 * A retry is mostly safe on its own, because re-reading the file re-detects
 * those rows as duplicates and sets them aside. **`includeKeys` is the
 * exception**: a forced key overrides that skip, and a forced row with no Order
 * ID in it has no `unique(source_id, external_ref)` behind it to stop the second
 * attempt writing it again. Narrow, and a money-doubling path.
 *
 * So the ticks are dropped on the way out of a failure and this says so. A tick
 * is a decision made against a picture that may no longer be true, and it is one
 * click to make it again — whereas the same sale twice in the books is a number
 * the owner has to find before they can fix it.
 *
 * The count is unticked in the SCREEN'S OWN unit, because the rows the owner
 * ticked are orders on a grouped file, and it must not promise anything about
 * what did land: only the ledger knows that, so the sentence sends them to look
 * rather than telling them.
 *
 * ── And when the server wrote nothing at all, it says so by saying less ───
 *
 * "Some of your file may already have been saved" is a hedge, and a hedge is the
 * right default for a write that is not atomic. But it is not true of every
 * failure: a commit refused BEFORE the loop — the import lock already held by
 * another upload, a file too big, a channel that is not this business's — has
 * written no money whatsoever, and telling an owner their books may have moved
 * when they demonstrably have not is its own kind of dishonesty. It also sends
 * them off to check something there is nothing to check.
 *
 * So on those, the sentence is the server's own and stops. It does not assert
 * the opposite either — "nothing was saved" would be a claim of its own, and the
 * one refusal that can coincide with money landing is the lock: another import
 * for this business was demonstrably writing at that moment, possibly of this
 * very file in another tab. Saying less is honest at both. `refusedBeforeWriting`
 * is how the caller knows which it is.
 *
 * The ticks come off EITHER WAY, and that is not an oversight. The guard is
 * against a second attempt writing a forced row twice, and "this request wrote
 * nothing" does not rule that out — the lock refusal is exactly the case where
 * someone else's commit may have written the rows this one is holding ticks for.
 * One click to make a tick again; a sale twice in the books has to be found
 * before it can be fixed.
 */
export function commitFailedSentence(
  message: string,
  unticked: number,
  unit: "rows" | "orders",
  wroteNothing: boolean,
): string {
  const said = endStop(message);
  const base = wroteNothing
    ? said
    : `${said} Some of your file may already have been saved, so check your books before trying again.`;
  if (unticked <= 0) return base;
  const tickBack = unticked === 1 ? "tick it back in" : "tick them back in";
  const landed = unticked === 1 ? "it didn't land" : "they didn't land";
  return `${base} We've unticked the ${countInUnit(unticked, unit)} you'd brought in by hand — ${tickBack} only if ${landed}.`;
}

/** How many kept names to print before counting the rest. Display only. */
export const NAMES_SHOWN = 6;

/**
 * What the undo DID, including what it left behind and why.
 *
 * **One sentence, two screens.** The check step says it seconds after the import
 * with the figures still up; Settings says it days later off a filename. They
 * are the same statement about the same server answer, so there is one of it —
 * the second copy had already drifted (it gated on the NAMES rather than the
 * count, so it said nothing at all when rows were kept and none could be named,
 * and it joined the list uncapped).
 *
 * ── The three things it has to get right ──────────────────────────────────
 *
 * **The verb, because the two halves really do different things.** A
 * transaction import is VOIDED — the rows stay in the books, out of every total.
 * A catalogue import is ARCHIVED, and only the rows nothing has used yet
 * (`csvImportBatches.ts`). "Removed" would be false for both.
 *
 * **The count in the unit the screen was counting in.** `removed` is one per
 * thing the server undid, which on a grouped file is one per ORDER — so the noun
 * is carried in, never assumed, exactly as it is on the way up.
 *
 * **`kept` for the figure, `keptNames` for the names.** They arrive the same
 * length from every path on the server, but writing the sentence off both means
 * a long list can be cut for display without the count turning into a lie about
 * it — and a kept row that somehow arrives unnamed still gets counted rather
 * than silently dropping out of the sentence.
 */
export function undoneSentence(input: {
  removed: number;
  kept: number;
  keptNames: readonly string[];
  kind: ImportKind;
  unit: "rows" | "orders";
}): string {
  const verb = input.kind === "transactions" ? "taken back out" : "put away";
  const first = `Undone — ${countInUnit(input.removed, input.unit)} ${verb}.`;
  if (input.kept <= 0) return first;

  const shown = input.keptNames.slice(0, NAMES_SHOWN);
  const rest = input.kept - shown.length;
  const named =
    shown.length === 0
      ? input.kept === 1
        ? "one of them"
        : `${input.kept.toLocaleString("en-US")} of them`
      : rest > 0
        ? `${shown.join(", ")} and ${rest.toLocaleString("en-US")} more`
        : shown.join(", ");
  // One kept row is "it". The subject stays "something else", so the VERB does
  // not move — only the thing it refers to.
  const them = input.kept === 1 ? "it" : "them";
  return `${first} We left ${named} alone, because something else in your books already refers to ${them}.`;
}

/** RFC4180, the same rule `templateCsv` writes the blank sheet with. */
export function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** The column we add. Their own columns keep their own names, untouched. */
export const PROBLEM_COLUMN = "Problem";

/**
 * The rows we couldn't read, written back out as a spreadsheet to fix.
 *
 * **Built in the browser, and that is allowed here.** The rule it might look
 * like it breaks — the UI never computes money — is about DERIVING figures, and
 * nothing is derived: every cell is echoed back exactly as the server read it
 * out of the file, and the only column this adds is the reason the server
 * already wrote in English. It is presentation, the same as rendering those
 * cells on screen, so it does not need a round trip.
 *
 * Two things it must not do, both of which a naive version gets wrong:
 *
 *   · **Drop a cell.** A ragged row with more cells than the file had headers
 *     is exactly the sort of row that fails, and this is the file the owner is
 *     about to correct — so the width is the widest thing present, not the
 *     header count, and the extra header cells are left blank rather than
 *     invented.
 *   · **"Fix" a value.** The cells go back verbatim. Prefixing a leading `=`
 *     to defuse a spreadsheet formula, trimming a stray space, normalising a
 *     date — each one silently changes the data the owner is re-uploading.
 *     These cells came out of their own file and go straight back into it.
 */
export function failuresCsv(
  headers: readonly string[],
  failures: readonly ImportFailedRowShape[],
): string {
  const width = failures.reduce((widest, row) => Math.max(widest, row.cells.length), headers.length);
  const headerRow = Array.from({ length: width }, (_, index) => headers[index] ?? "");
  const lines = [[...headerRow, PROBLEM_COLUMN].map(csvCell).join(",")];
  for (const failure of failures) {
    const cells = Array.from({ length: width }, (_, index) => failure.cells[index] ?? "");
    lines.push([...cells, failure.reason].map(csvCell).join(","));
  }
  return `${lines.join("\r\n")}\r\n`;
}
