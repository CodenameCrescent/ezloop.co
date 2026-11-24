import { IMPORT_MAPPING_UNUSABLE } from "@workspace/api-contract";
import { parseDateCell, type DateOrder, type TotalsMode } from "@workspace/domain";
import { countInUnit } from "./importModel.parts/ChannelAnswer";
export { channelAnswer, answersForNewFile, continueBlocked, countInUnit, whatLands } from "./importModel.parts/ChannelAnswer";
export type { OwnerAnswers } from "./importModel.parts/ChannelAnswer";
export { commitFailedSentence, undoneSentence, PROBLEM_COLUMN, failuresCsv } from "./importModel.parts/CommitFailedSentence";

/**
 * The decisions the import flow makes that are not React.
 *
 * Everything in here is a plain function over plain values, so the questions
 * that decide what an owner sees — is this refusal one a dropdown can fix? does
 * this file need a channel picked for it? which of their own dates should we
 * quote back at them? — can be asked in a test instead of by clicking through a
 * dialog. None of it parses money, and none of it decides anything the server
 * decides: the server reads the file and this reads the server's answer.
 */

/**
 * Radix's Select cannot hold an empty string as a value, so "not in my file"
 * needs a stand-in. The same `__none__` every other picker in this app uses.
 * Never shown; the option's LABEL is what the owner reads.
 */
export const NOT_IN_FILE = "__none__";

/**
 * Was this refusal "we cannot read your file with these columns"?
 *
 * The one refusal the matching screen can fix, so the one that must not leave
 * the owner on the upload step. Asked of the CODE, never of the message: a
 * message is prose and prose gets reworded, wrapped and prefixed, and the day
 * that happened the fall-through would have stopped firing with nothing on
 * screen to say so. See `IMPORT_MAPPING_UNUSABLE` in the contract.
 */
export function isMappingRefusal(code: string | null): boolean {
  return code === IMPORT_MAPPING_UNUSABLE;
}

/**
 * Which way the dates are being read right now, and whether the owner still has
 * a say in it.
 *
 * Two rules, and the first outranks the second:
 *
 *   · **The file settled it** (`dateOrderCertain`) — a day over 12 somewhere in
 *     their date column makes the other reading impossible. The file's reading
 *     is what the server used and there is nothing to change, so no control.
 *   · **Otherwise the owner's answer is in force**, and it is read from the
 *     ANSWER rather than from the last preview. That matters for how the screen
 *     feels: the sentence used to be built from `preview.dateOrder`, so clicking
 *     [Change] moved nothing for 300 ms plus a round trip, and a second click
 *     inside that window recomputed from the same unchanged reading, set the
 *     same value, and sent nothing at all. The control simply looked broken.
 *
 * Unanswered and unsettled, the file's own guess is what is on screen — with the
 * control offered, which is the whole point of asking.
 */
export function dateQuestion(
  preview: { dateOrder: DateOrder; dateOrderCertain: boolean } | null,
  answered: DateOrder | undefined,
): { reading: DateOrder; changeable: boolean } {
  if (preview === null) return { reading: answered ?? "dmy", changeable: false };
  if (preview.dateOrderCertain) return { reading: preview.dateOrder, changeable: false };
  return { reading: answered ?? preview.dateOrder, changeable: true };
}

/**
 * The owner's answers as one string, so two sets of them can be compared.
 *
 * Used for two jobs on the matching screen: deciding whether anything has
 * actually changed since the last request (so arriving on the screen re-asks
 * nothing), and telling one request's answer from another's.
 *
 * Canonical, not `JSON.stringify` of the object as it stands: the mapping's keys
 * move about as fields are pointed somewhere else and back, and a key order is
 * not a change of answer. Absent and blank are folded together, exactly as the
 * server reads them.
 */
export function answersSignature(answers: {
  mapping: Record<string, string>;
  dateOrder: DateOrder | undefined;
  totalsAre: TotalsMode | undefined;
  sourceId: string | undefined;
}): string {
  const fields = Object.keys(answers.mapping)
    .sort()
    .map((field) => [field, answers.mapping[field]]);
  return JSON.stringify([
    fields,
    answers.dateOrder ?? null,
    answers.totalsAre ?? null,
    answers.sourceId ?? null,
  ]);
}

/**
 * Is this answer still the one the screen asked for?
 *
 * Two dropdown changes 300 ms apart with a round trip longer than that put two
 * re-previews in flight, and nothing about HTTP promises they come back in the
 * order they went out. The older answer landing second used to overwrite the
 * newer one: the counts, the failures, the date certainty and the totals
 * question would all revert to the previous mapping while the list of unused
 * columns — computed in the browser — stayed current. A screen whose entire
 * promise is that you see it before it happens, showing a picture of a mapping
 * the owner had already moved on from, with Continue able to unblock on it.
 *
 * So every request carries the signature it was fired with, and its answer is
 * shown only while that is still the latest thing sent. A dropped answer costs
 * nothing: the newer request is already on its way and will replace the picture
 * wholesale.
 */
export function isCurrentRequest(sentSignature: string, latestSent: string | null): boolean {
  return sentSignature === latestSent;
}

/**
 * A date from their own file whose meaning the day/month setting actually
 * changes — or null, when no cell in the column depends on it.
 *
 * Found by asking, not by pattern-matching: a cell qualifies when reading it
 * day-first and month-first give two different days. That is the property the
 * question is about, and `parseDateCell` is the server's own reader, so a cell
 * this picks out is a cell the server really would read two ways.
 *
 * The alternative — quoting a made-up `03/04/2026` — is worse than useless here.
 * The owner is being asked to confirm something about THEIR file, and a stock
 * example gives them nothing to check it against.
 */
export function ambiguousDateCell(cells: readonly string[]): string | null {
  for (const cell of cells) {
    const dmy = parseDateCell(cell, "dmy");
    const mdy = parseDateCell(cell, "mdy");
    if (dmy.ok && mdy.ok && dmy.iso !== mdy.iso) return cell;
  }
  return null;
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/**
 * An ISO date as a person writes it: `2026-04-03` → `3 April 2026`.
 *
 * Spelled out rather than formatted by locale on purpose. The whole point of
 * the sentence this appears in is to settle whether `03/04` is April or March,
 * and answering it in a format that is itself ambiguous — or that reads
 * differently on a laptop set to another country — would settle nothing.
 */
export function spellDate(iso: string): string | null {
  const parts = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!parts) return null;
  const month = MONTHS[Number(parts[2]) - 1];
  if (month === undefined) return null;
  return `${Number(parts[3])} ${month} ${Number(parts[1])}`;
}

/** How we read one of their cells, in their words and ours. Null if we can't. */
export function dateReading(cell: string, order: DateOrder): string | null {
  const parsed = parseDateCell(cell, order);
  return parsed.ok ? spellDate(parsed.iso) : null;
}

/**
 * A channel name worth offering for a file called `stripe-payouts-jan.csv`.
 *
 * A starting point the owner can overtype, not a decision: the extension goes,
 * separators become spaces, and each word gets a capital. Words with no letter
 * in them go too — `monzo_2026_01.csv` is an account called Monzo exported in
 * January, and "Monzo" is the name of the channel while "Monzo 2026 01" is the
 * name of one download. A file with nothing but digits in it leaves nothing
 * behind, so the field simply starts blank rather than suggesting "2026 01".
 */
export function channelNameFromFilename(filename: string): string {
  const stem = filename.replace(/\.[^.]+$/, "");
  const words = stem
    .split(/[^A-Za-z0-9]+/)
    .filter((word) => word !== "" && /[A-Za-z]/.test(word));
  if (words.length === 0) return "";
  return words
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(" ")
    .slice(0, 255);
}

/**
 * Why the counts on screen are smaller than the file is long.
 *
 * **It does not name an order count, and that is the whole point.** It used to:
 * "1,140 rows make 412 orders.", where the 412 was `ready + skipped + failed`
 * added up in the browser. Those three do not share a unit. Ready and skipped
 * are ORDERS — one per group — but `failed` mixes the two heights of failure:
 * a row the parser could not read is counted once per ROW
 * (`csvImport.ts` `parseTransactionRows`), while a group the grouper or the
 * ledger refused is counted once per GROUP. Ten unreadable rows out of a file
 * whose other 1,130 make 400 orders therefore printed "1,140 rows make 410
 * orders", which is not a figure about anything.
 *
 * There is no correct order total to put there instead — the server does not
 * send one, and it cannot be recovered from three counts two of which are in
 * one unit and one in another. So the sentence stops claiming one. It states
 * the row count, which the server does send exactly (`sourceRowCount`), and
 * explains the grouping rule that makes the tiles above it smaller.
 */
export function groupedNote(rowCount: number): string {
  const rows = `${rowCount.toLocaleString("en-US")} ${rowCount === 1 ? "row" : "rows"}`;
  return `${rows}, grouped into orders — rows sharing an Order ID count as one.`;
}

/**
 * Which way the dates will be read when this import is written.
 *
 * **The owner's answer, and the PREVIEW'S reading when they have not given one.**
 * That second half is the whole reason this exists. The answer starts
 * `undefined` (see `ImportDialog`) so the matching screen can tell "they chose
 * day-first" from "nobody has been asked", and commit's `dateOrder` is a
 * REQUIRED field — so something has to fill the gap.
 *
 * It must be the preview's reading and not a literal like `"dmy"`. The preview
 * is the picture the owner just read and approved; a literal would post a
 * reading they were never shown, and this is the field that decides whether
 * `03/04/2026` is April or March. Leaving it out entirely and letting the server
 * re-infer gets the same answer *usually*, and usually is not good enough for
 * the thing that decides what date lands in the ledger.
 *
 * The server still overrules both whenever the file has settled the question
 * itself (`dateOrderCertain`), which is right — only it has just re-read the
 * column.
 */
export function commitDateOrder(
  answered: DateOrder | undefined,
  preview: { dateOrder: DateOrder },
): DateOrder {
  return answered ?? preview.dateOrder;
}

/**
 * Why nothing will be brought in, and the one thing to do about it.
 *
 * Every branch names a control the owner can actually reach from where they are
 * standing. "Nothing to import" on its own is the dead end this whole flow was
 * built to end.
 */
export function nothingToImportHint(input: { skipped: number; failed: number }): string {
  const tick = "Tick anything you want to bring in anyway.";
  const back = "Go Back to change how we're reading your file";
  if (input.skipped > 0 && input.failed > 0) {
    return `Nothing will be brought in. ${tick} Or ${back} — the rows we couldn't read are listed below.`;
  }
  if (input.skipped > 0) {
    return `Nothing will be brought in — every one of these looks like one you already have. ${tick}`;
  }
  if (input.failed > 0) {
    return `Nothing will be brought in. ${back}, or download the rows below, fix them in your spreadsheet and start again.`;
  }
  return "There's nothing in this file to bring in.";
}

/**
 * Did the server turn this commit away before it wrote a single row?
 *
 * **Asked of the STATUS, because that is the only part of a failure that carries
 * the answer.** Not the message, which is prose written for the owner and gets
 * reworded; not the error code, which would mean listing by hand every code that
 * happens to be raised early today and re-listing it whenever a new refusal is
 * added.
 *
 * A 4xx is the server saying "I am not doing this", and on the commit route
 * every one of them is raised before the write loop starts — checked in
 * `csvImportCommit.ts` rather than assumed. `buildPlan` refuses the file before
 * the batch row is even inserted; the advisory lock refuses ahead of that again
 * (`invalid` → 400); and nothing inside the loop can reach a 4xx, because every
 * error a row raises is caught and counted as a failed row rather than thrown.
 * Auth, business scope and body validation all sit in front of the route.
 *
 * Everything else keeps the hedge, and each for a reason:
 *
 *   · **5xx** is the partial write this exists to warn about. The one the
 *     import raises itself is `unavailable` → 503, thrown AFTER the loop broke
 *     and after the batch was stamped, precisely so that what landed is
 *     recoverable — which means something usually did.
 *   · **No status at all** is a request that never got an answer: offline, DNS,
 *     a connection cut mid-flight. The server may well have finished the whole
 *     import and had nowhere to say so. That is the most dangerous case for a
 *     retry, not the safest.
 */
export function refusedBeforeWriting(status: number | null): boolean {
  return status !== null && status >= 400 && status < 500;
}

/** "282 rows imported. 18 skipped." — what happened, in the file's own unit. */
export function importedSentence(
  counts: { created: number; skipped: number; failed: number },
  unit: "rows" | "orders",
): string {
  const parts = [`${countInUnit(counts.created, unit)} imported.`];
  if (counts.skipped > 0) parts.push(`${counts.skipped.toLocaleString("en-US")} skipped.`);
  if (counts.failed > 0) parts.push(`${counts.failed.toLocaleString("en-US")} couldn't be read.`);
  return parts.join(" ");
}

/**
 * Which line of their spreadsheet this is — "Row 4", or the several rows one
 * order was built from.
 *
 * Not printed as a range. A group's rows are the rows that shared an Order ID
 * and a file is under no obligation to keep those together, so "Rows 4–9" would
 * be a claim about six lines when only three of them are involved.
 */
export function rowLabel(rowNumbers: readonly number[]): string {
  if (rowNumbers.length === 0) return "";
  if (rowNumbers.length === 1) return `Row ${rowNumbers[0]}`;
  const shown = rowNumbers.slice(0, 5).join(", ");
  const rest = rowNumbers.length - 5;
  return rest > 0 ? `Rows ${shown} +${rest} more` : `Rows ${shown}`;
}

/** `sales-jan.csv` → `sales-jan-couldnt-read.csv`. Theirs, so they can tell it apart. */
export function failuresFilename(filename: string): string {
  const stem = filename.replace(/\.[^.]+$/, "").trim();
  return `${stem === "" ? "import" : stem}-couldnt-read.csv`;
}
