/**
 * Reading the cells of an uploaded file.
 *
 * Every rule here exists because some real export does it. The one thing this
 * module will never do is guess quietly: a cell it cannot read comes back with
 * a reason a non-technical owner can act on, and a value with more precision
 * than a penny is refused rather than rounded, because rounding somebody's
 * money without telling them is the failure this whole feature must not have.
 */
import Decimal from "decimal.js";

export type DecimalStyle = "dot" | "comma";
export type Direction = "in" | "out";

export type ParsedMoney = { ok: true; cents: number } | { ok: false; reason: string };
export type ParsedDate = { ok: true; iso: string } | { ok: false; reason: string };

/**
 * Currency symbols and codes exports put around a number.
 *
 * Applied AFTER the sign has been taken off, never before: a trailing "-" and
 * a unicode minus both look like currency to this pattern, so stripping first
 * would turn "45.00-" and "−45.00" into positive forty-five.
 */
const CURRENCY = /(^[^\d\-−+(.,\s]+|[^\d)\s]+$)/g;

/**
 * The trailing run of letters on a cell, so a DR/CR suffix can be read as the
 * SIGN it is before CURRENCY eats it as a code.
 *
 * A UK bank statement with a single Amount column writes "45.00 DR" for money
 * out and "45.00 CR" for money in. CURRENCY cannot tell DR from USD, so
 * stripping first made a debit and a credit the same positive number, with
 * nothing left on the result to say a suffix had been dropped — a cost
 * imported as income, unrecoverably. The letters mean here exactly what they
 * mean in OUT_WORDS / IN_WORDS below.
 *
 * The WHOLE run has to be the word, never just its tail: IDR, SCR and XDR are
 * real currency codes ending in those two letters, and reading the rupiah as a
 * debit would be the same bug pointing the other way. A trailing full stop
 * ("45.00 Dr.") is part of the abbreviation, not of the number.
 */
const DIRECTION_SUFFIX = /([A-Za-z]+)\.?$/;

/**
 * Whether the OTHER style's separator is sitting in this cell.
 *
 * The LAST group a separator opens is always a full three digits, in every
 * grouping convention there is. In a dot column "45,50" is therefore not four
 * thousand five hundred and fifty with a stray comma — it is a European cell in
 * the wrong column, and dropping its comma multiplies somebody's money by a
 * hundred in silence. The comma column has the identical hole mirrored, where
 * "45.50" would read as four thousand five hundred and fifty. Both refuse.
 *
 * Only the LAST group is held to three, and the earlier ones may be two or
 * three, because the three-everywhere rule is a Western rule. South Asia — this
 * product's home market, base currency PKR, money counted in paisa — groups by
 * lakh and crore: "12,34,567.89", "1,00,000". Demanding three of every group
 * refused the ordinary format of an Indian or Pakistani export, every row of
 * it. "1,234,567.89" and "12,34,567.89" now both read; "45,50" still refuses,
 * which is the whole point of the guard.
 */
function groupingIsMalformed(text: string, style: DecimalStyle): boolean {
  // Only asked of a cell that is otherwise digits and separators. Anything else
  // is not an amount at all, and the plainer "isn't a number" below is a truer
  // account of it than a lecture about thousands separators.
  if (!/^[\d.,\s]+$/.test(text) || !/\d/.test(text)) return false;
  // How many digits follow each separator, in the order they appear.
  const groups = [...text.matchAll(style === "comma" ? /\.(\d*)/g : /,(\d*)/g)]
    .map((match) => match[1].length);
  if (groups.length === 0) return false;
  // The last separator is the one that has to be a full three, because it is
  // the one a misread decimal point would be sitting in.
  if (groups[groups.length - 1] !== 3) return true;
  return groups.slice(0, -1).some((digits) => digits !== 2 && digits !== 3);
}

/**
 * Decides how a COLUMN writes its decimals, from all of its cells at once.
 *
 * Per-cell inference reads the same column two ways: "1,234" is thousands in a
 * column that also holds "1,234.56" and a decimal in one that holds "45,50".
 * Only the column knows.
 */
export function inferDecimalStyle(cells: string[]): DecimalStyle {
  let commaDecimalEvidence = 0;
  let dotEvidence = 0;
  for (const raw of cells) {
    const cell = raw.trim();
    if (!cell) continue;
    if (cell.includes(".") && cell.includes(",")) {
      // Whichever comes LAST is the decimal point.
      if (cell.lastIndexOf(",") > cell.lastIndexOf(".")) commaDecimalEvidence += 1;
      else dotEvidence += 1;
      continue;
    }
    if (cell.includes(".")) dotEvidence += 1;
    else if (cell.includes(",")) {
      // A comma followed by exactly two digits, and nothing after, reads as a
      // decimal. Three digits is a thousands separator.
      if (/,\d{2}$/.test(cell)) commaDecimalEvidence += 1;
      else dotEvidence += 1;
    }
  }
  return commaDecimalEvidence > dotEvidence ? "comma" : "dot";
}

export function parseMoneyCell(raw: string, style: DecimalStyle): ParsedMoney {
  const original = raw.trim();
  if (!original) return { ok: true, cents: 0 };

  let text = original;
  let negative = false;
  let positive = false;

  // The DR/CR suffix before anything else — see the note on DIRECTION_SUFFIX.
  let marked: Direction | null = null;
  const suffix = text.match(DIRECTION_SUFFIX);
  if (suffix) {
    const word = suffix[1].toLowerCase();
    if (word === "dr" || word === "cr") {
      marked = word === "dr" ? "out" : "in";
      text = text.slice(0, text.length - suffix[0].length).trim();
    }
  }

  // Signs next, currency after them — see the note on CURRENCY above.
  if (/^\(.*\)$/.test(text)) { negative = true; text = text.slice(1, -1).trim(); }
  if (/[-−]$/.test(text)) { negative = true; text = text.slice(0, -1).trim(); }
  if (/^[-−]/.test(text)) { negative = true; text = text.slice(1).trim(); }
  // A leading plus is an explicit claim about the sign, not decoration, so it
  // is remembered rather than merely dropped — see the contradiction check.
  if (/^\+/.test(text)) { positive = true; text = text.slice(1).trim(); }

  if (marked !== null) {
    // "-45.00 CR" and "+45.00 DR" say money out and money in in the same
    // breath. Picking one would be a guess about a sign, which is the failure
    // the suffix check exists to stop, so the cell is handed back instead.
    //
    // Both ways round: a written plus claims a direction exactly as a minus or
    // a bracket does, so resolving "+45.00 DR" quietly while refusing
    // "-45.00 CR" would be the same guess, made only when it happened to point
    // the other way. A cell with no sign of its own ("45.00 DR") is not a
    // contradiction — the suffix is the only thing claiming anything.
    if ((negative && marked === "in") || (positive && marked === "out")) {
      return { ok: false, reason: `Amount "${original}" is marked as both money in and money out` };
    }
    negative = marked === "out";
  }

  text = text.replace(CURRENCY, "").trim();

  if (groupingIsMalformed(text, style)) {
    const separator = style === "comma" ? "full stop" : "comma";
    return {
      ok: false,
      reason: `Amount "${original}" can't be read: in this column the ${separator} separates thousands, so it needs exactly three digits after it`,
    };
  }

  // Strip the thousands separator, then normalize the decimal point to a dot.
  text = style === "comma"
    ? text.replace(/[.\s ]/g, "").replace(",", ".")
    : text.replace(/[,\s ]/g, "");

  if (!/^\d*\.?\d*$/.test(text) || text === "" || text === ".") {
    return { ok: false, reason: `Amount isn't a number: "${original}"` };
  }

  const value = new Decimal(text);
  // Asked BEFORE multiplying. times() rounds its result to Decimal.precision,
  // so asking the product whether it is a whole number asks it after the
  // rounding has already happened — 45.0000000000000000001 came back as a flat
  // 4500. Raising the precision only moves that threshold further out; refusing
  // the extra digits up front removes the whole class.
  if (value.decimalPlaces() > 2) {
    return { ok: false, reason: `Amount "${original}" is more precise than a penny` };
  }
  const n = value.times(100).toNumber();
  if (!Number.isSafeInteger(n)) return { ok: false, reason: `Amount "${original}" is too large` };
  // Nobody means negative zero. It survives JSON and SQL unharmed, but it fails
  // a strict comparison against 0 in every test downstream.
  return { ok: true, cents: negative && n !== 0 ? -n : n };
}

export type DateOrder = "dmy" | "mdy";

/**
 * Every month word an export actually writes: the full name and its
 * abbreviation, each spelled out.
 *
 * Looked up WHOLE, never by prefix. A prefix match reads "Decision" as December
 * and "Junk" as June, so a free-text column mis-mapped as the date column came
 * back as a plausible, wrong date instead of a refusal — and nothing on screen
 * would have said so.
 */
const MONTHS: Record<string, number> = {
  jan: 1, january: 1,
  feb: 2, february: 2,
  mar: 3, march: 3,
  apr: 4, april: 4,
  may: 5,
  jun: 6, june: 6,
  jul: 7, july: 7,
  aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  oct: 10, october: 10,
  nov: 11, november: 11,
  dec: 12, december: 12,
};

/**
 * A date written as three numbers, which is the only shape whose meaning the
 * order setting can change. Shared by the parser and the inference below so
 * that both agree, to the character, on what counts as one.
 */
const NUMERIC_DATE = /^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})$/;

/** Refuses 31 February instead of letting it roll into 3 March. */
function toIso(year: number, month: number, day: number, original: string): ParsedDate {
  // A year outside four digits is a corrupt cell, not a date in antiquity: it
  // used to escape as ok, so "03/04/999" became the ISO-shaped non-ISO string
  // "999-04-03". It also keeps Date.UTC out of the range where it silently
  // rewrites years under 100 as 19xx.
  if (year < 1000 || year > 9999) {
    return { ok: false, reason: `That date can't exist: "${original}"` };
  }
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return { ok: false, reason: `That date can't exist: "${original}"` };
  }
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day > daysInMonth) return { ok: false, reason: `That date can't exist: "${original}"` };
  const pad = (n: number, width: number) => String(n).padStart(width, "0");
  return { ok: true, iso: `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}` };
}

export function parseDateCell(raw: string, order: DateOrder): ParsedDate {
  const original = raw.trim();
  if (!original) return { ok: false, reason: "No date found" };

  const iso = original.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s].*)?$/);
  if (iso) return toIso(Number(iso[1]), Number(iso[2]), Number(iso[3]), original);

  // A hyphen separates the parts as readily as a space: "3-Apr-2026" is what
  // banks and Excel export, and it used to be refused outright.
  const named = original.match(/^(\d{1,2})[\s-]+([A-Za-z]+),?[\s-]+(\d{2,4})$/)
    ?? original.match(/^([A-Za-z]+)[\s-]+(\d{1,2}),?[\s-]+(\d{2,4})$/);
  if (named) {
    const monthWord = /^\d/.test(named[1]) ? named[2] : named[1];
    const dayText = /^\d/.test(named[1]) ? named[1] : named[2];
    const month = MONTHS[monthWord.toLowerCase()];
    if (month) return toIso(expandYear(Number(named[3])), month, Number(dayText), original);
  }

  const numeric = original.match(NUMERIC_DATE);
  if (numeric) {
    const a = Number(numeric[1]);
    const b = Number(numeric[2]);
    const [day, month] = order === "dmy" ? [a, b] : [b, a];
    return toIso(expandYear(Number(numeric[3])), month, day, original);
  }

  return { ok: false, reason: `Date isn't readable: "${original}"` };
}

function expandYear(year: number): number {
  return year >= 100 ? year : 2000 + year;
}

/**
 * Works out whether a column of dates is day-first or month-first.
 *
 * 03/04/2026 is two different days depending on who exported it, and the file
 * never says which. A number over 12 in one position cannot be a month, so a
 * single such cell settles the whole column; without one the column really is
 * ambiguous, and `certain: false` is what lets the screen ask the owner rather
 * than book three months of sales on the wrong days.
 */
export function inferDateOrder(cells: string[]): { order: DateOrder; certain: boolean } {
  let dayFirst = 0;
  let monthFirst = 0;
  let undecided = 0;
  for (const raw of cells) {
    const numeric = raw.trim().match(NUMERIC_DATE);
    // ISO and named-month cells read the same either way, so they cast no vote.
    if (!numeric) continue;
    const a = Number(numeric[1]);
    const b = Number(numeric[2]);
    // Over 12 in both positions is an impossible date in either reading; it is
    // corrupt rather than evidence, and must not out-vote the real cells.
    if (a > 12 && b > 12) continue;
    if (a > 12) dayFirst += 1;
    else if (b > 12) monthFirst += 1;
    else undecided += 1;
  }
  if (dayFirst > 0 && monthFirst === 0) return { order: "dmy", certain: true };
  if (monthFirst > 0 && dayFirst === 0) return { order: "mdy", certain: true };
  // Nothing in the column depends on the order — an all-ISO column, say — so
  // the setting cannot change a single reading and there is nothing to ask.
  if (dayFirst === 0 && monthFirst === 0 && undecided === 0) return { order: "dmy", certain: true };
  // Ambiguous throughout, or a column mixing both formats: day-first is the
  // commoner export, but say plainly that it is a guess.
  return { order: "dmy", certain: false };
}

/**
 * The words a Type or Direction column uses to say which way the money went.
 *
 * Bank statements say credit and debit, shop exports say sale and expense, and
 * an owner filling in our own template writes whichever they think in — so all
 * three vocabularies are read, and anything else returns null rather than
 * being assumed to be income.
 */
const IN_WORDS = new Set(["sale", "sales", "income", "revenue", "credit", "cr", "deposit", "in", "received", "payment received", "refund received"]);
const OUT_WORDS = new Set(["purchase", "expense", "expenses", "cost", "debit", "dr", "withdrawal", "out", "paid", "bill", "payment"]);

export function parseDirectionWord(raw: string): Direction | null {
  const word = raw.trim().toLowerCase().replace(/\s+/g, " ");
  if (!word) return null;
  if (IN_WORDS.has(word)) return "in";
  if (OUT_WORDS.has(word)) return "out";
  return null;
}
