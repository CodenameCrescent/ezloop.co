/**
 * Three small judgements the check screen makes before anything is written:
 * which column is which, whether a row is one the owner already has, and
 * whether an inbound line is really a payout.
 *
 * All three are OFFERED, never enforced. The mapping is a starting point the
 * owner corrects with a dropdown; the duplicate flag unticks a row and says
 * why; the payout word sets a row aside for the owner to tick back on. Nothing
 * here decides anything on its own, because every one of these guesses is
 * occasionally wrong and a wrong guess acted on silently is money in the wrong
 * place.
 *
 * Kept apart from `importParse` (which reads one cell) and `importRows` (which
 * reads one row) because nothing here reads a value. It reads the file's SHAPE
 * and the WORDS in a row, and hands the caller something to compare.
 */
import { columnsFor, type ImportKind } from "./importColumns";
import type { Direction } from "./importParse";

/**
 * A header or a description reduced to its words: lowercase, single-spaced,
 * punctuation gone. "Money_In", "Money In" and "money-in" all become "money in".
 *
 * Letters outside a-z are separators here, so an accented or non-Latin header
 * simply fails to match and lands in `ignored` rather than matching the wrong
 * column. Every synonym in importColumns is ASCII, which is what makes that
 * safe: there is nothing for a folded letter to hit by accident.
 *
 * The same fold applies to a description, and there it has a cost worth
 * knowing: anything with no a-z or 0-9 in it reduces to the empty string. A
 * blank description does, so does a placeholder like "-" or "###", and so does
 * a description written wholly in a non-Latin script. All of them therefore
 * share one fingerprint, and any two such rows on the same day, in the same
 * direction, for the same cents look like a repeat of each other — a blank row
 * "matching" a dash, or two Urdu descriptions matching although they say
 * different things. That is the flag doing what it does everywhere else — one
 * row noticed and unticked, never merged, never dropped — so the owner can tick
 * it straight back.
 */
function toWords(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * The form a header is compared in. Matches the shape `importColumns` documents
 * its synonym lists in, which is why those lists are already written lowercase
 * and single-spaced: they are compared against this, never re-normalized.
 *
 * The byte-order mark is REMOVED rather than treated as punctuation. Excel
 * writes one at the front of the first header of a UTF-8 file; it is invisible,
 * so a header carrying one still reads as "Date" to the owner and must read as
 * "date" here. Turning it into a space instead would split a header the owner
 * sees as one word.
 */
export function normalizeHeader(raw: string): string {
  return toWords(raw.replace(/\uFEFF/g, ""));
}

/** A guess at the file's columns, plus every column the guess did not use. */
export interface GuessedMapping {
  /** field -> the header EXACTLY as the file writes it. */
  mapping: Record<string, string>;
  /** Headers no column claimed, in file order. Shown, never swallowed. */
  ignored: string[];
}

/**
 * Which of this file's columns look like which of our fields.
 *
 * Two rules matter more than the matching itself:
 *
 * The header comes back VERBATIM — the file's own string, byte for byte, BOM
 * and odd spacing included. Downstream, `parseTransactionRows` finds the column
 * with an exact, case-sensitive `headers.indexOf(header)`. A tidied-up header
 * would fail that lookup, and the file would be told a column it plainly has
 * "isn't in this file" while every value in it went unread.
 *
 * A header is claimed BY POSITION, not by name. A file with two columns both
 * called "Amount" gives the first to Amount and reports the second as ignored:
 * one of them is mapped, the other is named on screen, and nothing is guessed
 * about which. Claiming by name would have silently mapped both.
 *
 * Columns are tried in `columnsFor` order, so when one header could serve two
 * fields the earlier field wins — the same order the matching screen lists them
 * in, so the owner sees the tie resolved the way the page reads.
 */
export function guessMapping(headers: readonly string[], kind: ImportKind): GuessedMapping {
  const normalized = headers.map((header) => normalizeHeader(header));
  const claimed = headers.map(() => false);
  const mapping: Record<string, string> = {};

  for (const column of columnsFor(kind)) {
    const index = normalized.findIndex(
      (name, position) => !claimed[position] && column.synonyms.includes(name),
    );
    if (index === -1) continue;
    claimed[index] = true;
    mapping[column.field] = headers[index];
  }

  // Everything the guess did not use, named rather than dropped: a column the
  // owner needs that we failed to recognise is only findable if we say we saw it.
  const ignored = headers.filter((_header, position) => !claimed[position]);
  return { mapping, ignored };
}

/**
 * A description reduced to its words, so "Acme, Ltd." and "ACME  LTD" compare
 * equal. Used only for comparison — the owner's own text is what gets stored.
 */
export function normalizeDescription(raw: string): string {
  return toWords(raw);
}

/** The four facts that make a bank line recognisable as one already imported. */
export interface DuplicateKeyInput {
  /** ISO date the money moved. */
  occurredOn: string;
  /** Minor units, as an integer. Never reformatted as a decimal. */
  amountCents: number;
  direction: Direction;
  description: string;
}

/**
 * A fingerprint for spotting a row the owner already has: same day, same
 * direction, same cents, same description once case and punctuation are ignored.
 *
 * NEVER PERSISTED. It is computed in memory, compared against keys built the
 * same way from existing rows, and thrown away. `DECISIONS.md` (2026-08-03)
 * recorded what storing a content fingerprint does: correct a typo and the row
 * stops matching its own past self, so it lands beside the row it was meant to
 * replace and the day counts twice. Hard dedupe is the Order ID going to
 * `external_ref`; this is the soft flag for files that have no id at all.
 *
 * Equal or not equal, never nearly. No edit distance, no similarity score: two
 * identical charges on one day are ordinary and legitimate, so a threshold
 * would either flag those or miss real repeats, and the owner cannot tell from
 * the screen which of the two just happened. Matching rows are reported and
 * unticked — noticed, not decided.
 */
export function duplicateKey(input: DuplicateKeyInput): string {
  return `${input.occurredOn}|${input.direction}|${input.amountCents}|${normalizeDescription(input.description)}`;
}

/**
 * Processors and marketplaces that settle money into a bank account.
 *
 * Data, not logic — extend it freely. Each entry is written the way `toWords`
 * leaves text (lowercase, single-spaced, no punctuation), because that is the
 * form it is compared against: "Checkout.com" is listed as "checkout com" and
 * "iZettle" as "izettle", so both sides of the comparison have had the same
 * fold applied. "stripe inc" earns nothing "stripe" does not; it stays for the
 * same reason "payout from" does, below — this is read as a list of names.
 */
export const KNOWN_PROCESSORS: readonly string[] = [
  "stripe", "paypal", "shopify", "square", "sumup", "zettle", "izettle",
  "etsy", "amazon", "ebay", "gumroad", "lemon squeezy", "paddle", "adyen",
  "wise", "payoneer", "razorpay", "easypaisa", "jazzcash", "worldpay",
  "klarna", "gocardless", "mollie", "braintree", "checkout com", "stripe inc",
];

/**
 * The words a bank prints on a line that is money already recorded as sales.
 *
 * Plurals are spelled out rather than derived. "payout" and "payouts" are two
 * entries, not one entry and a stemming rule, for the same reason the whole
 * module avoids clever matching: a list you can read is a list you can correct.
 *
 * Singular "payment" is absent while plural "payments" is present, and the
 * difference is not an oversight. The plural is how the settling companies are
 * actually named — "STRIPE PAYMENTS UK LTD", "SHOPIFY PAYMENTS", "SumUp
 * Payments Ltd" — whereas the singular is how an ordinary purchase is worded:
 * "PAYPAL PAYMENT", "Card payment Acme Ltd". Adding "payment" here would set
 * aside the shopping. "payment to" is absent for the same reason.
 *
 * Bare "transfer" is absent too: "transfer" on its own is how a customer pays
 * an invoice, which is income, and only "transfer from" reads as a settlement.
 * The phrase "payout from" earns nothing "payout" does not; it stays because
 * this list is read as a vocabulary, not as a regex.
 */
const PAYOUT_WORDS = [
  "payout", "payouts", "payout from",
  "settlement", "settlements",
  "remittance", "remittances",
  "transfer from",
  "deposit", "deposits",
  "payments",
];

/**
 * Does this description read like a processor paying out?
 *
 * A payout word ALONE is not enough, and getting that wrong in the loose
 * direction is what this rule exists to avoid. "TRANSFER FROM ACME LTD" is
 * exactly how a bank prints a customer paying an invoice — the main way a
 * freelancer or a services business is paid — and setting that aside as a
 * payout means an owner who accepts the screen's default never imports their
 * own income. "Settlement fee" is a property-closing cost; "Remittance advice"
 * titles a document you send when PAYING a supplier.
 *
 * So a real payout must name who settled it: the description has to carry a
 * payout word AND a processor's name. That also fixes the tight direction —
 * "STRIPE PAYMENTS UK LTD" and "SHOPIFY PAYMENTS" are what a bank really
 * prints, and a payout-word-only rule missed both.
 *
 * `extraProcessors` is for the channels this business has actually connected,
 * so a marketplace nobody here has heard of still works. Caller text is folded
 * through the same normalizer, so "Lemon Squeezy" and "lemon squeezy" behave
 * identically.
 *
 * Names are matched as WHOLE WORDS in the folded description, not as bare
 * substrings: "TRANSFER FROM BITWISE LTD" contains the letters of "wise" and is
 * a customer paying a bill. Multi-word names still work — the fold leaves
 * single spaces, so "lemon squeezy" is one phrase to look for.
 *
 * Whole words are not the same as certainty, and the list above says so if you
 * read it as English: "square", "wise", "amazon", "paddle" and "mollie" are
 * also ordinary words and surnames. "TRANSFER FROM SQUARE MILE PROPERTIES" and
 * "Transfer from Mollie Jones" therefore still read as payouts although both
 * are customers. That is a narrow residue of the old bug rather than the bug
 * itself — it takes a payout word AND a colliding name, not a payout word
 * alone — and it is why the flag stays an offer.
 *
 * Recognising is not classifying. A payout is money already recorded as sales
 * arriving, so importing it as income counts that money twice — but calling a
 * real sale a payout loses it. So this only ever sets a row aside with the
 * reason spelled out; the owner ticks it back if they meant it.
 */
export function isPayoutLike(description: string, extraProcessors: readonly string[] = []): boolean {
  // Padded, so ` word ` finds the word at either end as well as in the middle.
  const text = ` ${normalizeDescription(description)} `;
  const saysPayout = PAYOUT_WORDS.some((word) => text.includes(` ${word} `));
  if (!saysPayout) return false;

  return [...KNOWN_PROCESSORS, ...extraProcessors]
    .map((name) => normalizeDescription(name))
    .some((name) => name.length > 0 && text.includes(` ${name} `));
}
