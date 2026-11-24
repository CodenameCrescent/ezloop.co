import test from "node:test";
import assert from "node:assert/strict";
import { IMPORT_MAPPING_UNUSABLE } from "@workspace/api-contract";
import { parseCsv } from "@workspace/domain";
import {
  PROBLEM_COLUMN,
  ambiguousDateCell,
  answersForNewFile,
  answersSignature,
  channelAnswer,
  channelNameFromFilename,
  commitDateOrder,
  commitFailedSentence,
  continueBlocked,
  countInUnit,
  dateQuestion,
  dateReading,
  failuresCsv,
  failuresFilename,
  groupedNote,
  importedSentence,
  isCurrentRequest,
  isMappingRefusal,
  nothingToImportHint,
  refusedBeforeWriting,
  rowLabel,
  spellDate,
  undoneSentence,
  whatLands,
} from "./importModel";

/**
 * The three questions this flow gets wrong if nobody is watching.
 *
 * Each of these was a real dead end or very nearly one, so each is pinned here
 * rather than left to be re-discovered by clicking through a dialog.
 */

// ── The refusal that must reach the matching screen ─────────────────────────
//
// A file whose columns we cannot guess is refused before a row is read, and the
// refusal carries no column names. Left on the upload step the owner is told
// "Tell us which column holds the date" by a screen offering no way to tell us
// anything. The fall-through that prevents that used to fire on an exact match
// against the refusal's SENTENCE — sound only while both halves quoted one
// function verbatim, and silently dead the day anything wrapped the message.

test("the mapping refusal is recognised by its code, not by its wording", () => {
  assert.equal(isMappingRefusal(IMPORT_MAPPING_UNUSABLE), true);
});

test("a reworded, wrapped or prefixed message still fires the fall-through", () => {
  // The message is prose and prose moves. The code is what is being asked.
  assert.equal(isMappingRefusal("mapping_unusable"), true, "the wire value, spelled out");
});

test("every other refusal stays on the upload step, where a different file can be chosen", () => {
  // Too big, too many rows, not a CSV, no rows at all: nothing a dropdown fixes.
  assert.equal(isMappingRefusal("invalid"), false);
  assert.equal(isMappingRefusal("not_found"), false);
  assert.equal(isMappingRefusal("unavailable"), false);
  assert.equal(isMappingRefusal(null), false, "an error with no envelope at all");
});

// ── The channel picker ─────────────────────────────────────────────────────

const MAPPED = { date: "Date", amount: "Amount", channel: "Channel" };

test("no Channel column at all means the file can never supply one", () => {
  assert.deepEqual(
    channelAnswer({
      kind: "transactions",
      mapping: { date: "Date", amount: "Amount" },
      counts: { ready: 5, skipped: 0, failed: 0 },
      noChannelFailures: 0,
      chosenSourceId: undefined,
    }),
    { show: true, required: true },
  );
});

test("our own template, filled in with the Channel column left empty, still asks", () => {
  // The case that made "no Channel column mapped" the wrong question. Every
  // header matches, so the mapping is perfect; every row fails anyway, and every
  // one of them fails for the same reason.
  assert.deepEqual(
    channelAnswer({
      kind: "transactions",
      mapping: MAPPED,
      counts: { ready: 0, skipped: 0, failed: 2 },
      noChannelFailures: 2,
      chosenSourceId: undefined,
    }),
    { show: true, required: true },
  );
});

test("a file whose Channel column is filled in is not asked", () => {
  assert.deepEqual(
    channelAnswer({
      kind: "transactions",
      mapping: MAPPED,
      counts: { ready: 4, skipped: 0, failed: 1 },
      noChannelFailures: 0,
      chosenSourceId: undefined,
    }),
    { show: false, required: false },
    "a failure about something else is not a failure about the channel",
  );
});

test("nothing landed is not enough — a file that failed for OTHER reasons is not asked", () => {
  // Six template rows. Four carry Channel "Etsy" and dates this file writes
  // month-first, so they fail "That date can't exist"; two leave Channel blank.
  // Nothing ready, nothing skipped — and requiring a channel here is how four
  // transactions end up filed under a channel nobody chose for them: the owner
  // picks "Shop" to unblock Continue, then fixes the date question on this same
  // screen, the four Etsy rows parse, and a chosen channel outranks the row's
  // own. Wrong per-channel profit, with nothing on screen saying so.
  assert.deepEqual(
    channelAnswer({
      kind: "transactions",
      mapping: MAPPED,
      counts: { ready: 0, skipped: 0, failed: 6 },
      noChannelFailures: 2,
      chosenSourceId: undefined,
    }),
    { show: false, required: false },
    "four of the six failures were about dates; this file has proved nothing about its channels",
  );
  // Fix the dates and the two blanks are all that is left — but four rows now
  // carry their own channel, so there is still nothing to overrule and nothing
  // to ask.
  assert.deepEqual(
    channelAnswer({
      kind: "transactions",
      mapping: MAPPED,
      counts: { ready: 4, skipped: 0, failed: 2 },
      noChannelFailures: 2,
      chosenSourceId: undefined,
    }),
    { show: false, required: false },
  );
});

test("a PARTLY blank Channel column is not offered the picker", () => {
  // Picking here would not fill the three gaps, it would overrule all two
  // hundred rows — the server takes the chosen channel ahead of the row's own.
  // Those three keep their reason and are named on the check screen instead.
  assert.deepEqual(
    channelAnswer({
      kind: "transactions",
      mapping: MAPPED,
      counts: { ready: 197, skipped: 0, failed: 3 },
      noChannelFailures: 3,
      chosenSourceId: undefined,
    }),
    { show: false, required: false },
  );
  assert.deepEqual(
    channelAnswer({
      kind: "transactions",
      mapping: MAPPED,
      counts: { ready: 0, skipped: 12, failed: 1 },
      noChannelFailures: 1,
      chosenSourceId: undefined,
    }),
    { show: false, required: false },
    "rows already imported landed somewhere too — the file did supply a channel",
  );
});

test("the evidence is the server's whole count, not the 200 failures it shows", () => {
  // `preview.failed` stops at 200 and the no-channel failures are appended last,
  // so they are the first a long file loses. A 250-row template with every
  // Channel cell blank shows 200 failures and must still be asked; the count is
  // read from `noChannelFailures`, which is never cut.
  assert.deepEqual(
    channelAnswer({
      kind: "transactions",
      mapping: MAPPED,
      counts: { ready: 0, skipped: 0, failed: 250 },
      noChannelFailures: 250,
      chosenSourceId: undefined,
    }),
    { show: true, required: true },
  );
});

test("the picker does not vanish the moment the answer works", () => {
  // Choosing a channel clears the very failures that summoned the control. If
  // that took the control away with them, the owner could not change their mind
  // about a choice still in force — and it is no longer REQUIRED, because it has
  // been given.
  assert.deepEqual(
    channelAnswer({
      kind: "transactions",
      mapping: MAPPED,
      counts: { ready: 300, skipped: 0, failed: 0 },
      noChannelFailures: 0,
      chosenSourceId: "src_1",
    }),
    { show: true, required: false },
  );
  assert.deepEqual(
    channelAnswer({
      kind: "transactions",
      mapping: MAPPED,
      counts: { ready: 300, skipped: 0, failed: 0 },
      noChannelFailures: 0,
      chosenSourceId: "",
    }),
    { show: false, required: false },
    "a blank id is no answer, exactly as the server reads it",
  );
});

test("a file we could not read at all still gets the picker when it has no Channel column", () => {
  // The unguessable path: no preview, nothing mapped, columns on screen.
  assert.deepEqual(
    channelAnswer({
      kind: "transactions",
      mapping: {},
      counts: null,
      noChannelFailures: 0,
      chosenSourceId: undefined,
    }),
    { show: true, required: true },
  );
});

test("a catalog or contacts file is never asked for a channel", () => {
  for (const kind of ["revenue_items", "expense_items", "people"] as const) {
    assert.deepEqual(
      channelAnswer({
        kind,
        mapping: {},
        counts: null,
        noChannelFailures: 0,
        chosenSourceId: undefined,
      }),
      { show: false, required: false },
      `${kind} has no channel for money to land in`,
    );
  }
});

// ── The date question ──────────────────────────────────────────────────────

test("the example quoted back is one the setting really does change", () => {
  assert.equal(ambiguousDateCell(["03/04/2026"]), "03/04/2026");
  assert.equal(ambiguousDateCell(["2026-04-03"]), null, "an ISO cell reads the same either way");
  assert.equal(ambiguousDateCell(["3 Apr 2026"]), null, "so does a named month");
  assert.equal(ambiguousDateCell(["25/12/2026"]), null, "a day over 12 cannot be a month");
  assert.equal(
    ambiguousDateCell(["", "2026-04-03", "not a date", "05/06/2026"]),
    "05/06/2026",
    "blanks and unreadable cells are skipped, not quoted",
  );
});

test("the reading is spelled out, so the sentence cannot be ambiguous itself", () => {
  assert.equal(dateReading("03/04/2026", "dmy"), "3 April 2026");
  assert.equal(dateReading("03/04/2026", "mdy"), "4 March 2026");
  assert.equal(dateReading("nonsense", "dmy"), null);
  assert.equal(spellDate("2026-12-25"), "25 December 2026");
  assert.equal(spellDate("not-a-date"), null);
});

test("[Change] stays while the owner's answer is what is holding the reading up", () => {
  const open = { dateOrder: "dmy", dateOrderCertain: false } as const;
  assert.deepEqual(
    dateQuestion(open, undefined),
    { reading: "dmy", changeable: true },
    "unanswered and unsettled: the file's guess, and the control that changes it",
  );
  assert.deepEqual(
    dateQuestion(open, "mdy"),
    { reading: "mdy", changeable: true },
    "the answer is in force, so it must not take away the control that gave it",
  );
});

test("the sentence follows the click, not the round trip", () => {
  // The reading used to be taken from the last preview, so [Change] moved
  // nothing for 300 ms plus a round trip — and a second click inside that window
  // recomputed from the same unchanged reading, set the same value and sent
  // nothing at all. The control looked stuck. Their answer is what is read now.
  const stale = { dateOrder: "dmy", dateOrderCertain: false } as const;
  assert.equal(dateQuestion(stale, "mdy").reading, "mdy", "one click, and the sentence has moved");
  assert.equal(dateQuestion(stale, "dmy").reading, "dmy", "two clicks, and it is back — not stuck");
});

test("a file that settles the question keeps the answer out of it", () => {
  // A day over 12 in their column makes the other reading impossible, so the
  // server ignores the answer and the screen shows the FILE's reading with no
  // control — there is nothing left to change.
  assert.deepEqual(
    dateQuestion({ dateOrder: "dmy", dateOrderCertain: true }, "mdy"),
    { reading: "dmy", changeable: false },
    "an old answer does not out-vote a column that proved itself",
  );
});

// ── Two answers in flight ──────────────────────────────────────────────────

test("the answers make one comparable value, and a key order is not a change", () => {
  const a = answersSignature({
    mapping: { date: "Date", amount: "Amount" },
    dateOrder: undefined,
    totalsAre: undefined,
    sourceId: undefined,
  });
  const b = answersSignature({
    mapping: { amount: "Amount", date: "Date" },
    dateOrder: undefined,
    totalsAre: undefined,
    sourceId: undefined,
  });
  assert.equal(a, b, "pointing a field elsewhere and back is not a new question");
  assert.notEqual(
    a,
    answersSignature({
      mapping: { date: "Date", amount: "Amount" },
      dateOrder: "mdy",
      totalsAre: undefined,
      sourceId: undefined,
    }),
    "answering the date question is",
  );
});

test("a slow answer that lands after a newer one has gone out is dropped", () => {
  // Two dropdown changes 300 ms apart on a round trip longer than that. The
  // older request answers LAST, and it must not paint the previous mapping's
  // counts, failures and date certainty over the newer picture — which is what
  // Continue is read from.
  //
  // This drives the real bookkeeping the screen does: `lastSent` moves the
  // instant a request fires, each request remembers what it was fired with, and
  // `isCurrentRequest` is asked before anything is shown.
  const lastSent: { current: string | null } = { current: null };
  const shown: string[] = [];

  function fire(mapping: Record<string, string>, answerIs: string): () => void {
    const sent = answersSignature({
      mapping,
      dateOrder: undefined,
      totalsAre: undefined,
      sourceId: undefined,
    });
    lastSent.current = sent;
    return () => {
      if (!isCurrentRequest(sent, lastSent.current)) return;
      shown.push(answerIs);
    };
  }

  const older = fire({ date: "Column A" }, "the picture of Column A");
  const newer = fire({ date: "Column B" }, "the picture of Column B");
  newer();
  older();

  assert.deepEqual(shown, ["the picture of Column B"], "the overtaken answer never reached the screen");
});

test("answers arriving in the order they were asked are both shown", () => {
  // The guard drops what is stale, never what is merely second.
  const lastSent: { current: string | null } = { current: null };
  const shown: string[] = [];

  function fireAndAnswer(mapping: Record<string, string>, answerIs: string): void {
    const sent = answersSignature({
      mapping,
      dateOrder: undefined,
      totalsAre: undefined,
      sourceId: undefined,
    });
    lastSent.current = sent;
    if (isCurrentRequest(sent, lastSent.current)) shown.push(answerIs);
  }

  fireAndAnswer({ date: "Column A" }, "the picture of Column A");
  fireAndAnswer({ date: "Column B" }, "the picture of Column B");

  assert.deepEqual(shown, ["the picture of Column A", "the picture of Column B"]);
});

// ── The window where the owner could approve figures nobody showed them ────
//
// Re-previewing is debounced by 300 ms. For that window an answer has changed
// and NO request has been fired, so "a request is pending" is false and Continue
// used to be open. Clicking it unmounts the matching screen, whose cleanup kills
// the timer, and the check screen renders the OLD picture while holding — and
// posting — the NEW answers. The reachable one is the totals question, which
// decides whether a file's tax, shipping and discount figures cover the order or
// each line of it, and which sits a few hundred pixels above Continue.

const MAPPED_ANSWERS = { date: "Date", amount: "Amount" };
const WHOLE_ORDER = answersSignature({
  mapping: MAPPED_ANSWERS,
  dateOrder: undefined,
  totalsAre: "whole_order",
  sourceId: undefined,
});
const PER_ITEM = answersSignature({
  mapping: MAPPED_ANSWERS,
  dateOrder: undefined,
  totalsAre: "per_item",
  sourceId: undefined,
});

/** A picture on screen, and it is a picture of these answers. */
const SETTLED = {
  problem: null,
  serverSaid: null,
  hasPreview: true,
  requestInFlight: false,
  answers: WHOLE_ORDER,
  shownFor: WHOLE_ORDER,
  channelRequired: false,
} as const;

test("Continue is open when what is on screen is what these answers say", () => {
  assert.equal(continueBlocked(SETTLED), false);
});

test("Continue closes in the 300 ms before a changed answer has even been sent", () => {
  // Nothing is pending — the timer has not fired — and this is exactly the
  // window the owner could click through to approve whole-order money while
  // per-item money landed.
  assert.equal(continueBlocked({ ...SETTLED, answers: PER_ITEM }), true);
  assert.equal(
    continueBlocked({ ...SETTLED, answers: PER_ITEM, requestInFlight: true }),
    true,
    "and stays closed for the round trip after it",
  );
});

test("and Continue opens again the moment the new picture lands", () => {
  // A guard that never released would be worse than the bug it fixes: the owner
  // could never get past this screen. The preview arriving is what releases it.
  assert.equal(continueBlocked({ ...SETTLED, answers: PER_ITEM, shownFor: PER_ITEM }), false);
});

test("an answer changed and changed back still waits for the request in flight", () => {
  // The answers match the picture again, but a request for the OTHER answer is
  // on its way and would replace the picture after Continue was pressed —
  // landing on the check screen, which has no way to know it is not its own.
  assert.equal(continueBlocked({ ...SETTLED, requestInFlight: true }), true);
});

test("the reasons Continue was already closed for still close it", () => {
  assert.equal(
    continueBlocked({ ...SETTLED, problem: "Tell us which column holds the date" }),
    true,
  );
  assert.equal(continueBlocked({ ...SETTLED, serverSaid: "We couldn't read that file." }), true);
  assert.equal(
    continueBlocked({ ...SETTLED, hasPreview: false, shownFor: null }),
    true,
    "the file we could not read a row of",
  );
  assert.equal(
    continueBlocked({ ...SETTLED, channelRequired: true }),
    true,
    "nothing in the file says where this money landed",
  );
});

// ── The same hole, reached by a second upload ──────────────────────────────
//
// `continueBlocked` compares the answers against the picture — but it can only
// be right if the answers it is handed are about the file on screen. Answer the
// totals question on file A, press Back (which goes to the UPLOAD step, not out
// of the dialog), choose file B: the upload asks the server with no answers
// attached, so the picture that comes back was built from the guessed mapping
// and nothing else, while file A's answers are still standing. The matching
// screen then mounts believing its preview is a picture of them, and a clean
// file B skips that screen altogether.

/** What the upload step actually asked the server: a file, and no answers. */
function whatTheUploadAsked(guessedMapping: Record<string, string>): string {
  return answersSignature({
    mapping: guessedMapping,
    dateOrder: undefined,
    totalsAre: undefined,
    sourceId: undefined,
  });
}

test("a new file starts from the answers its own preview was built from", () => {
  const guess = { date: "Date", amount: "Amount", channel: "Channel" };
  const fresh = answersForNewFile(guess);

  assert.equal(
    answersSignature(fresh),
    whatTheUploadAsked(guess),
    "what we hold and what the server was told are the same thing",
  );
  assert.deepEqual(fresh.mapping, guess, "the server's guess is the one answer worth keeping");
});

test("nothing the owner said about the last file survives into this one", () => {
  // Each of these is the money bug in one field: a channel that overrides file
  // B's own Channel column, a totals answer its preview never used, a date
  // reading from somebody else's file.
  const fresh = answersForNewFile({ date: "Posted", amount: "Value" });
  assert.equal(fresh.sourceId, undefined, "the channel picked for the last file");
  assert.equal(fresh.totalsAre, undefined, "whole sale or each item, answered about the last file");
  assert.equal(fresh.dateOrder, undefined, "which way the last file wrote its dates");
  assert.deepEqual(fresh.includeKeys, [], "ticks are decisions about rows of a file now gone");
});

test("the carried answers really would have been a different picture", () => {
  // Belt and braces on the test above: if these two signatures were equal, the
  // guard would have had nothing to catch and the first assertion would pass for
  // the wrong reason.
  const guess = { date: "Date", amount: "Amount" };
  const carried = answersSignature({
    mapping: guess,
    dateOrder: undefined,
    totalsAre: "per_item",
    sourceId: "src_etsy",
  });
  assert.notEqual(answersSignature(answersForNewFile(guess)), carried);
});

// ── Small things the screen says ───────────────────────────────────────────

test("a channel name is suggested from the filename, or not at all", () => {
  assert.equal(channelNameFromFilename("stripe-payouts-jan.csv"), "Stripe Payouts Jan");
  assert.equal(
    channelNameFromFilename("Monzo_2026_01.CSV"),
    "Monzo",
    "the account is the channel; the month is just which download this was",
  );
  assert.equal(channelNameFromFilename("sales.csv"), "Sales");
  assert.equal(channelNameFromFilename("2026-01.csv"), "", "digits alone are not a name");
  assert.equal(channelNameFromFilename(".csv"), "");
});

test("the grouped note states the row count and claims no order count at all", () => {
  // It used to say "1,140 rows make 412 orders.", with the 412 added up in the
  // browser from ready + skipped + failed. Those three do not share a unit:
  // ready and skipped are ORDERS, while `failed` counts a row the parser could
  // not read once per ROW and a group the ledger refused once per GROUP. Ten
  // unreadable rows in a file whose other 1,130 make 400 orders printed "1,140
  // rows make 410 orders", which is a figure about nothing. The server sends no
  // order total and one cannot be recovered from counts in two units, so the
  // sentence stops claiming one.
  assert.equal(
    groupedNote(1140),
    "1,140 rows, grouped into orders — rows sharing an Order ID count as one.",
  );
  assert.match(groupedNote(1), /^1 row,/, "one row, and the plural follows it");
  for (const rows of [1, 3, 1140]) {
    assert.doesNotMatch(groupedNote(rows), /\d+ orders?\b/, "no order count, at any size");
  }
});

// ── The check step ─────────────────────────────────────────────────────────
//
// The screen where the owner says yes. Everything pinned below is something
// that, got wrong, either posts a decision nobody made or tells them a number
// that is not the one about to land.

test("the date the file is read by is the owner's answer, and the preview's reading when they gave none", () => {
  // `undefined` is "nobody has been asked", and commit's `dateOrder` is a
  // required field, so something fills the gap. It has to be the reading the
  // owner was SHOWN. A literal here posts a decision they never saw, on the one
  // field that decides whether 03/04/2026 is April or March.
  assert.equal(commitDateOrder("mdy", { dateOrder: "dmy" }), "mdy", "their answer outranks the guess");
  assert.equal(commitDateOrder(undefined, { dateOrder: "mdy" }), "mdy", "the picture they approved");
  assert.equal(
    commitDateOrder(undefined, { dateOrder: "dmy" }),
    "dmy",
    "and not a hardcoded day-first either — this one only looks right by luck",
  );
});

// ── What will actually land ────────────────────────────────────────────────

const SKIPPED = [{ key: "a" }, { key: "b" }, { key: "c" }];

test("what lands is the ready count plus the rows ticked back in", () => {
  const plan = whatLands({ readyCount: 282, skippedShown: SKIPPED, includeKeys: ["a", "c"] });
  assert.deepEqual(plan.included, ["a", "c"]);
  assert.equal(plan.willLand, 284);
  assert.equal(plan.canImport, true);
});

test("a tick left over from a previous reading of the file counts for nothing", () => {
  // Back, change a column, Continue: the file is re-read and the keys are
  // minted afresh. The stale ones still sitting in state would inflate this
  // figure while the server — matching keys against its own new plan — quietly
  // ignored them, so the screen would promise rows that never arrive.
  const plan = whatLands({
    readyCount: 4,
    skippedShown: SKIPPED,
    includeKeys: ["a", "key-from-the-mapping-before-last"],
  });
  assert.deepEqual(plan.included, ["a"]);
  assert.equal(plan.willLand, 5);
});

test("an owner cannot commit nothing", () => {
  // The residual the matching screen leaves: a filled-in template with a blank
  // Channel column AND one permanently unreadable row. Its channel rule needs
  // EVERY failure to be a channel failure, this file has one that is not, so it
  // gets through — and arrives here with nothing ready. Importing that writes an
  // empty batch into the history and tells the owner it worked.
  const nothing = whatLands({ readyCount: 0, skippedShown: SKIPPED, includeKeys: [] });
  assert.equal(nothing.willLand, 0);
  assert.equal(nothing.canImport, false);

  // One tick is enough to make it a real import again.
  const ticked = whatLands({ readyCount: 0, skippedShown: SKIPPED, includeKeys: ["b"] });
  assert.equal(ticked.willLand, 1);
  assert.equal(ticked.canImport, true);
});

test("every reason for nothing landing names something the owner can go and do", () => {
  // "Nothing to import" on its own is the dead end this whole flow exists to
  // end, so each branch points at a control that is actually within reach.
  assert.match(nothingToImportHint({ skipped: 3, failed: 0 }), /Tick/);
  assert.match(nothingToImportHint({ skipped: 0, failed: 3 }), /Go Back/);
  assert.match(nothingToImportHint({ skipped: 0, failed: 3 }), /download/);
  const both = nothingToImportHint({ skipped: 3, failed: 3 });
  assert.match(both, /Tick/);
  assert.match(both, /Go Back/);
  assert.equal(nothingToImportHint({ skipped: 0, failed: 0 }), "There's nothing in this file to bring in.");
});

// ── When the import stopped part-way ───────────────────────────────────────
//
// The write is not atomic and cannot be made so: `createTransaction` opens its
// own database transaction per order, so every order that got through before a
// failure is real, committed money. A retry is mostly safe, because re-reading
// the file re-detects those as duplicates and sets them aside — except for the
// rows the owner ticked back in, which override that skip. A forced row with no
// Order ID has no `unique(source_id, external_ref)` behind it, so a second
// attempt writes it AGAIN. So the ticks come off, and the sentence says so.

test("a failed import says some of it may already have landed", () => {
  const said = commitFailedSentence("We couldn't finish that import.", 0, "rows", false);
  assert.match(said, /^We couldn't finish that import\./, "the server's own words first");
  assert.match(said, /may already have been saved/);
  assert.match(said, /check your books/, "something they can actually go and do");
  assert.doesNotMatch(said, /unticked/, "nothing was ticked, so nothing is claimed about ticks");
});

test("the rows ticked back in are dropped, and counted in the screen's own unit", () => {
  // Orders on a grouped file, rows otherwise — the same noun the counts above
  // are wearing, or the sentence is about something else.
  const orders = commitFailedSentence("We couldn't finish that import.", 3, "orders", false);
  assert.match(orders, /We've unticked the 3 orders you'd brought in by hand/);
  assert.match(orders, /tick them back in only if they didn't land/);
  const one = commitFailedSentence("We couldn't finish that import.", 1, "rows", false);
  assert.match(one, /the 1 row you'd brought in by hand — tick it back in only if it didn't land/);
});

test("it promises nothing about what did land, because only the ledger knows", () => {
  // "We saved 140 of your 282" would be a figure the browser made up: commit
  // raised an error instead of a count, so the screen has nothing to count.
  const said = commitFailedSentence("The database is busy.", 2, "orders", false);
  assert.doesNotMatch(said, /\bimported\b|\bsaved \d/, "no claim about how far it got");
});

// ── A refusal is not a part-written import ─────────────────────────────────
//
// The hedge is right for a write that stopped part-way and wrong for one the
// server never started. "Another import is still running" is raised by the
// advisory lock BEFORE a row is read, let alone written, so telling the owner
// their books may have moved is false — and sends them to check something there
// is nothing to check.

test("a commit refused before any write drops the may-have-been-saved warning", () => {
  const said = commitFailedSentence(
    "Another import is still running — give it a moment and try again",
    0,
    "rows",
    true,
  );
  assert.equal(said, "Another import is still running — give it a moment and try again.");
  assert.doesNotMatch(said, /may already have been saved/, "nothing was written to warn about");
  assert.doesNotMatch(said, /check your books/, "and nothing for them to go and check");
});

test("a server sentence with no full stop gets one before ours is joined to it", () => {
  // The lock refusal ends without punctuation, so the panel read "…try again
  // We've unticked the 2 rows…" — two sentences with nothing between them.
  const joined = commitFailedSentence("Another import is still running", 2, "rows", true);
  assert.match(joined, /still running\. We've unticked/);
  const already = commitFailedSentence("We couldn't finish that import.", 1, "rows", true);
  assert.doesNotMatch(already, /import\.\./, "and one that brought its own keeps just the one");
});

test("it does not claim the opposite either", () => {
  // "Nothing was saved" would be a claim of its own, and the one refusal that
  // can coincide with money landing is the lock: another commit for this
  // business was writing at that moment, possibly of this very file.
  const said = commitFailedSentence("We couldn't finish that import.", 0, "rows", true);
  assert.doesNotMatch(said, /[Nn]othing .*(saved|landed|written)/);
});

test("the ticks still come off when nothing was written, and are still said so", () => {
  // The guard is against a SECOND attempt writing a forced row twice, which "this
  // request wrote nothing" does not rule out.
  const said = commitFailedSentence("Another import is still running.", 2, "orders", true);
  assert.match(said, /We've unticked the 2 orders you'd brought in by hand/);
  assert.match(said, /tick them back in only if they didn't land/);
});

test("only a 4xx means the server wrote nothing", () => {
  assert.equal(refusedBeforeWriting(400), true, "the lock refusal, and every other refusal");
  assert.equal(refusedBeforeWriting(404), true);
  assert.equal(refusedBeforeWriting(413), true);
  assert.equal(
    refusedBeforeWriting(503),
    false,
    "the import's own mid-write abort: the batch is stamped and the rows are real",
  );
  assert.equal(refusedBeforeWriting(500), false, "a bug after the loop started");
  assert.equal(
    refusedBeforeWriting(null),
    false,
    "no answer at all — the import may have finished and had nowhere to say so",
  );
  assert.equal(refusedBeforeWriting(200), false, "not a failure, and certainly not a refusal");
});

// ── Counting in the unit the server counted in ─────────────────────────────

test("a count carries the unit the server said it was counting in", () => {
  // 282 orders read out of 1,140 rows, called "282 rows", is how somebody
  // concludes they have lost 858 sales.
  assert.equal(countInUnit(282, "rows"), "282 rows");
  assert.equal(countInUnit(282, "orders"), "282 orders");
  assert.equal(countInUnit(1, "rows"), "1 row");
  assert.equal(countInUnit(1, "orders"), "1 order");
  assert.equal(countInUnit(0, "rows"), "0 rows");
  assert.equal(countInUnit(1140, "rows"), "1,140 rows");
});

test("the receipt says what happened, and stays quiet about what did not", () => {
  assert.equal(importedSentence({ created: 282, skipped: 18, failed: 0 }, "rows"), "282 rows imported. 18 skipped.");
  assert.equal(importedSentence({ created: 412, skipped: 0, failed: 0 }, "orders"), "412 orders imported.");
  assert.equal(
    importedSentence({ created: 1, skipped: 0, failed: 4 }, "rows"),
    "1 row imported. 4 couldn't be read.",
  );
});

// ── The way back out ───────────────────────────────────────────────────────
//
// One sentence printed on two screens — the receipt, seconds after the import,
// and Settings, days later — so it is pinned here rather than in either of
// them.

/** Six names is the cap, so the lists below are built rather than typed out. */
function names(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `Item ${i + 1}`);
}

test("the undo sentence says what was actually done to the rows, per kind", () => {
  // Transactions are VOIDED and catalogue rows ARCHIVED. They are different
  // things and the owner is told which — "removed" would be false for both.
  assert.equal(
    undoneSentence({ removed: 2, kept: 0, keptNames: [], kind: "transactions", unit: "rows" }),
    "Undone — 2 rows taken back out.",
  );
  assert.equal(
    undoneSentence({ removed: 1, kept: 0, keptNames: [], kind: "people", unit: "rows" }),
    "Undone — 1 row put away.",
  );
  // And the count keeps the unit it was counted in: undoing a grouped file took
  // out orders, not rows.
  assert.equal(
    undoneSentence({ removed: 412, kept: 0, keptNames: [], kind: "transactions", unit: "orders" }),
    "Undone — 412 orders taken back out.",
  );
});

test("one row left alone is 'it', more than one is 'them'", () => {
  assert.equal(
    undoneSentence({ removed: 3, kept: 1, keptNames: ["Rent"], kind: "expense_items", unit: "rows" }),
    "Undone — 3 rows put away. We left Rent alone, because something else in your books already refers to it.",
  );
  assert.equal(
    undoneSentence({
      removed: 3,
      kept: 2,
      keptNames: ["Rent", "Van"],
      kind: "expense_items",
      unit: "rows",
    }),
    "Undone — 3 rows put away. We left Rent, Van alone, because something else in your books already refers to them.",
  );
});

test("a long list of kept names is cut, and the count stays exact about it", () => {
  const base = { removed: 0, kind: "revenue_items", unit: "rows" } as const;
  // Six is the cap: every one of them is named, with nothing counted after.
  assert.equal(
    undoneSentence({ ...base, kept: 6, keptNames: names(6) }),
    "Undone — 0 rows put away. We left Item 1, Item 2, Item 3, Item 4, Item 5, Item 6 alone, because something else in your books already refers to them.",
  );
  // Seven, and the seventh is counted rather than named.
  assert.equal(
    undoneSentence({ ...base, kept: 7, keptNames: names(7) }),
    "Undone — 0 rows put away. We left Item 1, Item 2, Item 3, Item 4, Item 5, Item 6 and 1 more alone, because something else in your books already refers to them.",
  );
  // The figure is `kept`, never the length of the list shown — a file that kept
  // 1,200 rows says 1,200 and prints six names, not 1,200 names.
  assert.equal(
    undoneSentence({ ...base, kept: 1200, keptNames: names(1200) }),
    "Undone — 0 rows put away. We left Item 1, Item 2, Item 3, Item 4, Item 5, Item 6 and 1,194 more alone, because something else in your books already refers to them.",
  );
});

test("rows kept with nothing to name them by are still counted, never dropped", () => {
  // Written off `kept` rather than off the names, so the sentence cannot go
  // silent about rows the owner has to deal with by hand.
  assert.equal(
    undoneSentence({ removed: 40, kept: 2, keptNames: [], kind: "transactions", unit: "rows" }),
    "Undone — 40 rows taken back out. We left 2 of them alone, because something else in your books already refers to them.",
  );
  assert.equal(
    undoneSentence({ removed: 40, kept: 1, keptNames: [], kind: "transactions", unit: "rows" }),
    "Undone — 40 rows taken back out. We left one of them alone, because something else in your books already refers to it.",
  );
});

test("a group's rows are listed, never printed as a range", () => {
  // The rows that shared an Order ID, and a file is under no obligation to keep
  // them together — "Rows 4–9" would be a claim about six lines when three are
  // involved.
  assert.equal(rowLabel([4]), "Row 4");
  assert.equal(rowLabel([4, 5, 9]), "Rows 4, 5, 9");
  assert.equal(rowLabel([1, 2, 3, 4, 5, 6, 7]), "Rows 1, 2, 3, 4, 5 +2 more");
  assert.equal(rowLabel([]), "");
});

// ── The file we hand back ──────────────────────────────────────────────────

test("the rows we couldn't read come back as their own columns plus a Problem one", () => {
  const csv = failuresCsv(
    ["Date", "Description", "Amount"],
    [
      { rowNumbers: [4], cells: ["2026-13-40", "Widget", "45.00"], reason: "That date can't exist" },
      { rowNumbers: [7], cells: ["2026-04-03", "Thing", "N/A"], reason: "Amount isn't a number: 'N/A'" },
    ],
  );
  // Read back with the SERVER'S OWN parser, which is what will read it when the
  // owner fixes it and brings it back. Asserting the string would pin the
  // quoting; parsing it pins the property that matters.
  assert.deepEqual(parseCsv(csv), [
    ["Date", "Description", "Amount", PROBLEM_COLUMN],
    ["2026-13-40", "Widget", "45.00", "That date can't exist"],
    ["2026-04-03", "Thing", "N/A", "Amount isn't a number: 'N/A'"],
  ]);
});

test("a comma, a quote and a newline in their data all survive the round trip", () => {
  const csv = failuresCsv(
    ["Description"],
    [{ rowNumbers: [2], cells: ['Smith, "Bob"\nLtd'], reason: "Row is blank" }],
  );
  assert.deepEqual(parseCsv(csv)[1], ['Smith, "Bob"\nLtd', "Row is blank"]);
});

test("a row with more cells than the file had headers loses none of them", () => {
  // A ragged row is exactly the sort of row that fails, and this is the file the
  // owner is about to correct — dropping a cell out of it is the one thing this
  // must never do. The extra header is left blank rather than invented.
  const csv = failuresCsv(
    ["Date", "Amount"],
    [{ rowNumbers: [9], cells: ["2026-04-03", "45.00", "stray", "extra"], reason: "Too many columns" }],
  );
  assert.deepEqual(parseCsv(csv), [
    ["Date", "Amount", "", "", PROBLEM_COLUMN],
    ["2026-04-03", "45.00", "stray", "extra", "Too many columns"],
  ]);
});

test("a short row is padded out rather than shifting the Problem column left", () => {
  const csv = failuresCsv(
    ["Date", "Description", "Amount"],
    [{ rowNumbers: [3], cells: ["2026-04-03"], reason: "No amount found" }],
  );
  assert.deepEqual(parseCsv(csv)[1], ["2026-04-03", "", "", "No amount found"]);
});

test("the file they get back is named after the file they gave us", () => {
  assert.equal(failuresFilename("sales-jan.csv"), "sales-jan-couldnt-read.csv");
  assert.equal(failuresFilename("Monzo Export.CSV"), "Monzo Export-couldnt-read.csv");
  assert.equal(failuresFilename(".csv"), "import-couldnt-read.csv", "nothing left to name it after");
});
