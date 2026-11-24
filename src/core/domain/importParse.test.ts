import test from "node:test";
import assert from "node:assert/strict";
import {
  inferDecimalStyle, parseMoneyCell, inferDateOrder, parseDateCell, parseDirectionWord,
} from "./importParse";

const dot = "dot" as const;

test("plain decimals become cents", () => {
  assert.deepEqual(parseMoneyCell("45.00", dot), { ok: true, cents: 4500 });
  assert.deepEqual(parseMoneyCell("45", dot), { ok: true, cents: 4500 });
  assert.deepEqual(parseMoneyCell("0.07", dot), { ok: true, cents: 7 });
});

test("thousands separators are dropped", () => {
  assert.deepEqual(parseMoneyCell("1,234.56", dot), { ok: true, cents: 123456 });
  assert.deepEqual(parseMoneyCell("1 234.56", dot), { ok: true, cents: 123456 });
});

test("European style reads the comma as the decimal point", () => {
  assert.deepEqual(parseMoneyCell("1.234,56", "comma"), { ok: true, cents: 123456 });
  assert.deepEqual(parseMoneyCell("45,50", "comma"), { ok: true, cents: 4550 });
});

test("currency symbols and codes are stripped from either end", () => {
  assert.deepEqual(parseMoneyCell("£45.00", dot), { ok: true, cents: 4500 });
  assert.deepEqual(parseMoneyCell("$1,234.56", dot), { ok: true, cents: 123456 });
  assert.deepEqual(parseMoneyCell("45.00 USD", dot), { ok: true, cents: 4500 });
  assert.deepEqual(parseMoneyCell("Rs 45.00", dot), { ok: true, cents: 4500 });
});

test("accounting brackets mean negative", () => {
  assert.deepEqual(parseMoneyCell("(45.00)", dot), { ok: true, cents: -4500 });
  assert.deepEqual(parseMoneyCell("(1,234.56)", dot), { ok: true, cents: -123456 });
});

test("minus signs, including the unicode one, mean negative", () => {
  assert.deepEqual(parseMoneyCell("-45.00", dot), { ok: true, cents: -4500 });
  assert.deepEqual(parseMoneyCell("−45.00", dot), { ok: true, cents: -4500 });
  assert.deepEqual(parseMoneyCell("45.00-", dot), { ok: true, cents: -4500 });
});

test("a blank cell is zero, not an error", () => {
  assert.deepEqual(parseMoneyCell("", dot), { ok: true, cents: 0 });
  assert.deepEqual(parseMoneyCell("   ", dot), { ok: true, cents: 0 });
});

test("a value with more precision than a penny is refused, never rounded", () => {
  // Rounding here would be a silent change to somebody's money.
  const result = parseMoneyCell("45.001", dot);
  assert.equal(result.ok, false);
  assert.match(result.ok === false ? result.reason : "", /penny|precise/i);
});

test("junk is refused with the value quoted back", () => {
  const result = parseMoneyCell("N/A", dot);
  assert.equal(result.ok, false);
  assert.match(result.ok === false ? result.reason : "", /N\/A/);
});

test("the decimal style is decided per column, not per cell", () => {
  // A column holding both proves the comma is a thousands separator.
  assert.equal(inferDecimalStyle(["1,234.56", "45.00", "9"]), "dot");
  // A column where commas are always followed by exactly two digits, and no
  // dot ever appears, is European.
  assert.equal(inferDecimalStyle(["45,50", "1.234,56", "9,00"]), "comma");
  // Ambiguous or empty falls back to dot, the commoner export.
  assert.equal(inferDecimalStyle(["45", ""]), "dot");
});

test("a comma column with three trailing digits is thousands, not decimal", () => {
  assert.equal(inferDecimalStyle(["1,234", "5,678"]), "dot");
});

test("ISO dates parse regardless of the order setting", () => {
  assert.deepEqual(parseDateCell("2026-04-03", "mdy"), { ok: true, iso: "2026-04-03" });
  assert.deepEqual(parseDateCell("2026-04-03T14:22:00Z", "dmy"), { ok: true, iso: "2026-04-03" });
});

test("slash dates follow the order they were told", () => {
  assert.deepEqual(parseDateCell("03/04/2026", "dmy"), { ok: true, iso: "2026-04-03" });
  assert.deepEqual(parseDateCell("03/04/2026", "mdy"), { ok: true, iso: "2026-03-04" });
  assert.deepEqual(parseDateCell("03.04.2026", "dmy"), { ok: true, iso: "2026-04-03" });
  assert.deepEqual(parseDateCell("3-4-2026", "dmy"), { ok: true, iso: "2026-04-03" });
});

test("two-digit years land in this century", () => {
  assert.deepEqual(parseDateCell("03/04/26", "dmy"), { ok: true, iso: "2026-04-03" });
});

test("named months need no order at all", () => {
  assert.deepEqual(parseDateCell("3 Apr 2026", "mdy"), { ok: true, iso: "2026-04-03" });
  assert.deepEqual(parseDateCell("April 3, 2026", "dmy"), { ok: true, iso: "2026-04-03" });
});

test("an impossible date is refused rather than rolled over", () => {
  // Date() would turn 31 February into 3 March. That is a wrong day in the
  // ledger, silently.
  const result = parseDateCell("31/02/2026", "dmy");
  assert.equal(result.ok, false);
  assert.match(result.ok === false ? result.reason : "", /31\/02\/2026/);
});

test("a blank date is refused with a readable reason", () => {
  const result = parseDateCell("", "dmy");
  assert.equal(result.ok, false);
  assert.match(result.ok === false ? result.reason : "", /no date/i);
});

test("a day over 12 anywhere in the column settles the order", () => {
  assert.deepEqual(inferDateOrder(["13/04/2026", "03/04/2026"]), { order: "dmy", certain: true });
  assert.deepEqual(inferDateOrder(["04/13/2026", "04/03/2026"]), { order: "mdy", certain: true });
});

test("an all-ambiguous column guesses day-first and admits it is guessing", () => {
  assert.deepEqual(inferDateOrder(["03/04/2026", "05/06/2026"]), { order: "dmy", certain: false });
});

test("an ISO-only column is certain and its order is irrelevant", () => {
  assert.deepEqual(inferDateOrder(["2026-04-03", "2026-05-01"]), { order: "dmy", certain: true });
});

test("direction words are read in both banking and shop vocabulary", () => {
  for (const word of ["sale", "Sale", "income", "credit", "CR", "deposit", "payment received"]) {
    assert.equal(parseDirectionWord(word), "in", word);
  }
  for (const word of ["purchase", "Expense", "debit", "DR", "withdrawal", "bill"]) {
    assert.equal(parseDirectionWord(word), "out", word);
  }
  assert.equal(parseDirectionWord("banana"), null);
  assert.equal(parseDirectionWord(""), null);
});

// ---------------------------------------------------------------------------
// Round 1 review fixes. Each block below pins a case that used to come back
// wrong or refused, so the next edit to this module cannot quietly undo it.
// ---------------------------------------------------------------------------

const reasonOf = (result: { ok: true } | { ok: false; reason: string }) =>
  result.ok === false ? result.reason : "";

test("a trailing DR or CR is the sign, so a debit is not imported as income", () => {
  // A UK bank statement with one Amount column writes the direction here, and
  // getting it wrong turns a cost into income with nothing left to recover it.
  assert.deepEqual(parseMoneyCell("45.00 DR", dot), { ok: true, cents: -4500 });
  assert.deepEqual(parseMoneyCell("45.00 CR", dot), { ok: true, cents: 4500 });
  assert.deepEqual(parseMoneyCell("45.00CR", dot), { ok: true, cents: 4500 });
  assert.deepEqual(parseMoneyCell("45.00 dr", dot), { ok: true, cents: -4500 });
  assert.deepEqual(parseMoneyCell("45.00 Dr.", dot), { ok: true, cents: -4500 });
  assert.deepEqual(parseMoneyCell("£1,234.56 DR", dot), { ok: true, cents: -123456 });
});

test("a currency code that ends in those letters is still a currency code", () => {
  // IDR, SCR and XDR are real. Reading the rupiah as a debit would be the same
  // wrong sign pointing the other way.
  assert.deepEqual(parseMoneyCell("45.00 IDR", dot), { ok: true, cents: 4500 });
  assert.deepEqual(parseMoneyCell("45.00 SCR", dot), { ok: true, cents: 4500 });
  assert.deepEqual(parseMoneyCell("45.00 XDR", dot), { ok: true, cents: 4500 });
  assert.deepEqual(parseMoneyCell("45.00 USD", dot), { ok: true, cents: 4500 });
});

test("a suffix that agrees with the sign already there is fine", () => {
  assert.deepEqual(parseMoneyCell("(45.00) DR", dot), { ok: true, cents: -4500 });
  assert.deepEqual(parseMoneyCell("-45.00 DR", dot), { ok: true, cents: -4500 });
  assert.deepEqual(parseMoneyCell("+45.00 CR", dot), { ok: true, cents: 4500 });
});

test("a cell marked money in and money out at once is refused, not guessed", () => {
  for (const raw of ["(45.00) CR", "-45.00 CR"]) {
    const result = parseMoneyCell(raw, dot);
    assert.equal(result.ok, false, raw);
    assert.match(reasonOf(result), /both money in and money out/);
  }
});

test("the other style's separator is refused, never multiplied by a hundred", () => {
  // "45,50" in a dot column is a European cell in the wrong column. Dropping
  // its comma booked forty-five fifty as four thousand five hundred and fifty.
  const wrongInDot = parseMoneyCell("45,50", dot);
  assert.equal(wrongInDot.ok, false);
  assert.match(reasonOf(wrongInDot), /45,50/);
  assert.match(reasonOf(wrongInDot), /thousands/);

  // The comma column has the identical hole mirrored.
  const wrongInComma = parseMoneyCell("45.50", "comma");
  assert.equal(wrongInComma.ok, false);
  assert.match(reasonOf(wrongInComma), /45\.50/);
  assert.match(reasonOf(wrongInComma), /thousands/);

  // Real thousands separators, in either style, are untouched.
  assert.deepEqual(parseMoneyCell("1,234", dot), { ok: true, cents: 123400 });
  assert.deepEqual(parseMoneyCell("12,345,678.90", dot), { ok: true, cents: 1234567890 });
  assert.deepEqual(parseMoneyCell("1 234.56", dot), { ok: true, cents: 123456 });
  assert.deepEqual(parseMoneyCell("1.234", "comma"), { ok: true, cents: 123400 });
  assert.deepEqual(parseMoneyCell("1.234,56", "comma"), { ok: true, cents: 123456 });
});

test("junk is told it isn't a number, not lectured about separators", () => {
  // The separator rule above only judges cells that are otherwise digits and
  // separators, so a mis-mapped text column still gets the reason that fits it.
  for (const raw of ["N/A", "hello, world", "n/a", "-"]) {
    const result = parseMoneyCell(raw, dot);
    assert.equal(result.ok, false, raw);
    assert.match(reasonOf(result), /isn't a number/, raw);
  }
});

test("no number of extra digits can be rounded into a penny", () => {
  // The guard used to inspect the result of multiplying by 100, which decimal.js
  // had already rounded to 20 significant digits — so 21 digits of nonsense came
  // back as a clean 4500. It is asked before the multiply now, so there is no
  // threshold left to walk past.
  for (const raw of [
    "45.001",
    "45.000000000000000001",
    "45.0000000000000000001",
    "44.999999999999999999",
    "44.9999999999999999999",
  ]) {
    const result = parseMoneyCell(raw, dot);
    assert.equal(result.ok, false, raw);
    assert.match(reasonOf(result), /penny|precise/i, raw);
  }
  // Two decimal places and fewer still convert exactly.
  assert.deepEqual(parseMoneyCell("9007199254740.99", dot), { ok: true, cents: 900719925474099 });
});

test("minus nothing is nothing, not negative zero", () => {
  const result = parseMoneyCell("-0.00", dot);
  assert.deepEqual(result, { ok: true, cents: 0 });
  assert.ok(result.ok === true && Object.is(result.cents, 0), "cents must be 0, not -0");
});

test("a sign inside the currency symbol is refused, never read as positive", () => {
  // No number is wrong here: all four fail loudly. Pinned so the sign-first,
  // currency-second ordering above cannot be "tidied" into silence.
  for (const raw of ["£-45.00", "$-45.00", "$ -45.00", "$(45.00)"]) {
    const result = parseMoneyCell(raw, dot);
    assert.equal(result.ok, false, raw);
    assert.match(reasonOf(result), /isn't a number/, raw);
  }
  // The sign outside it reads fine, which is why this is a refusal and not a bug.
  assert.deepEqual(parseMoneyCell("-£45.00", dot), { ok: true, cents: -4500 });
  assert.deepEqual(parseMoneyCell("−$45.00", dot), { ok: true, cents: -4500 });
});

test("a word that merely starts like a month is not a month", () => {
  // A free-text column mis-mapped as the date column used to yield a plausible
  // WRONG date: "Decision" read as December, "Junk" as June.
  for (const raw of ["Decision 3 2026", "Junk 3, 2026", "3 Decision 2026", "3 Mayonnaise 2026"]) {
    const result = parseDateCell(raw, "dmy");
    assert.equal(result.ok, false, raw);
    assert.match(reasonOf(result), /isn't readable/, raw);
  }
  // Full names and the abbreviations exports actually write still read.
  assert.deepEqual(parseDateCell("3 September 2026", "dmy"), { ok: true, iso: "2026-09-03" });
  assert.deepEqual(parseDateCell("3 Sept 2026", "dmy"), { ok: true, iso: "2026-09-03" });
  assert.deepEqual(parseDateCell("3 June 26", "dmy"), { ok: true, iso: "2026-06-03" });
  assert.deepEqual(parseDateCell("3 MARCH 2026", "dmy"), { ok: true, iso: "2026-03-03" });
});

test("a malformed year is refused rather than shipped as an ISO-shaped string", () => {
  // These came back ok, as "999-04-03" and "26-04-03".
  for (const raw of ["03/04/999", "0026-04-03"]) {
    const result = parseDateCell(raw, "dmy");
    assert.equal(result.ok, false, raw);
    assert.match(reasonOf(result), /can't exist/, raw);
  }
  // The two-digit year rule is untouched: a file writing 26 means 2026.
  assert.deepEqual(parseDateCell("03/04/26", "dmy"), { ok: true, iso: "2026-04-03" });
});

test("hyphenated named-month dates read the same as spaced ones", () => {
  // A very common bank and Excel export shape, refused outright before.
  assert.deepEqual(parseDateCell("3-Apr-2026", "dmy"), { ok: true, iso: "2026-04-03" });
  assert.deepEqual(parseDateCell("03-Apr-2026", "mdy"), { ok: true, iso: "2026-04-03" });
  assert.deepEqual(parseDateCell("Apr-3-2026", "dmy"), { ok: true, iso: "2026-04-03" });
  // All-numeric hyphens still follow the order they were told.
  assert.deepEqual(parseDateCell("3-4-2026", "mdy"), { ok: true, iso: "2026-03-04" });
});

test("a cell that is corrupt in both readings casts no vote on the order", () => {
  // 13/13 is impossible either way and parseDateCell refuses it, so it must not
  // drag a column that does have evidence down to a guess.
  assert.deepEqual(inferDateOrder(["13/13/2026", "13/04/2026"]), { order: "dmy", certain: true });
  assert.deepEqual(inferDateOrder(["13/13/2026", "04/13/2026"]), { order: "mdy", certain: true });
  // A column of nothing but corrupt cells has no evidence AND no cell whose
  // reading the order setting could change, so there is nothing to ask about.
  assert.deepEqual(inferDateOrder(["13/13/2026"]), { order: "dmy", certain: true });
  assert.deepEqual(inferDateOrder([]), { order: "dmy", certain: true });
});

test("a column that contradicts itself admits it is guessing", () => {
  // Both readings are genuinely evidenced here, which is real ambiguity rather
  // than one corrupt row, so the screen has to ask the owner.
  assert.deepEqual(inferDateOrder(["13/04/2026", "04/13/2026"]), { order: "dmy", certain: false });
  assert.deepEqual(inferDateOrder(["13/04/2026", "04/13/2026", "01/02/2026"]), { order: "dmy", certain: false });
});

test("direction words are matched whole, after tidying the spacing", () => {
  assert.equal(parseDirectionWord("  Payment   Received "), "in");
  assert.equal(parseDirectionWord("REFUND RECEIVED"), "in");
  // Not a prefix or substring match: these are not the words themselves.
  assert.equal(parseDirectionWord("credited"), null);
  assert.equal(parseDirectionWord("sale of goods"), null);
});

// ---------------------------------------------------------------------------
// Round 2 review fixes.
// ---------------------------------------------------------------------------

test("lakh and crore grouping reads, because this product's own market writes it", () => {
  // Profit Loop's base currency defaults to PKR and its money is counted in
  // paisa. South Asia groups by lakh and crore, so every group but the last is
  // a two. The round 1 guard demanded three of every group, which refused every
  // row of an ordinary Indian or Pakistani export.
  assert.deepEqual(parseMoneyCell("12,34,567.89", dot), { ok: true, cents: 123456789 });
  assert.deepEqual(parseMoneyCell("1,00,000", dot), { ok: true, cents: 10000000 });
  // Western grouping reads identically — the rule accepts both, it does not
  // swap one for the other.
  assert.deepEqual(parseMoneyCell("1,234,567.89", dot), { ok: true, cents: 123456789 });
  // And symmetrically in the comma style.
  assert.deepEqual(parseMoneyCell("12.34.567,89", "comma"), { ok: true, cents: 123456789 });
  assert.deepEqual(parseMoneyCell("1.234,56", "comma"), { ok: true, cents: 123456 });
});

test("the last group must still be three, which is what catches the wrong column", () => {
  // The 100x hole round 1 closed stays closed: only the LAST group was relaxed,
  // and "45,50" fails on exactly that one.
  for (const [raw, style] of [["45,50", dot], ["45,5", dot], ["45.50", "comma"], ["45.5", "comma"]] as const) {
    const result = parseMoneyCell(raw, style);
    assert.equal(result.ok, false, raw);
    assert.match(reasonOf(result), /thousands/, raw);
  }
  // An earlier group of one digit is no grouping convention at all.
  const stray = parseMoneyCell("1,2,345.67", dot);
  assert.equal(stray.ok, false);
  assert.match(reasonOf(stray), /thousands/);
});

test("an explicit plus contradicts a DR exactly as a minus contradicts a CR", () => {
  // Refusing one and silently resolving its mirror was picking a sign on the
  // days the contradiction happened to point the other way.
  for (const raw of ["+45.00 DR", "-45.00 CR", "(45.00) CR"]) {
    const result = parseMoneyCell(raw, dot);
    assert.equal(result.ok, false, raw);
    assert.match(reasonOf(result), /both money in and money out/, raw);
  }
  // A cell with no sign of its own is not a contradiction: the suffix is the
  // only thing claiming a direction, which is the whole round 1 fix.
  assert.deepEqual(parseMoneyCell("45.00 DR", dot), { ok: true, cents: -4500 });
  assert.deepEqual(parseMoneyCell("45.00 CR", dot), { ok: true, cents: 4500 });
  // Agreeing markers still read.
  assert.deepEqual(parseMoneyCell("+45.00 CR", dot), { ok: true, cents: 4500 });
  assert.deepEqual(parseMoneyCell("(45.00) DR", dot), { ok: true, cents: -4500 });
  assert.deepEqual(parseMoneyCell("-45.00 DR", dot), { ok: true, cents: -4500 });
});
