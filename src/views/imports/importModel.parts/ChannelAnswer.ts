import { type ImportKind, isMapped, type DateOrder, type TotalsMode } from "@workspace/domain";

/**
 * Whether to offer the channel picker, and whether the file can be imported at
 * all without an answer to it.
 *
 * **"No Channel column mapped" is the wrong question, and our own blank template
 * is why.** That template HAS a Channel column, so an owner who fills it in and
 * leaves that column empty — which looks optional, and is the natural thing to
 * do — brings back a file whose headers match perfectly and whose every row then
 * fails, because a transaction has to land somewhere. Asking only whether the
 * column is mapped would have said "no picker needed" about the one file that
 * needs it most, and the owner would reach a screen with nothing on it that
 * helps.
 *
 * So the question is not about the COLUMN, it is about the ROWS: did a single
 * one of them get a channel out of this file?
 *
 *   · **No Channel column at all** — nothing the file says will ever fill one
 *     in. This also covers the file we could not read a row of, where the
 *     mapping is still empty.
 *   · **A Channel column that gave nothing to anybody** — nothing ready, nothing
 *     skipped, and EVERY failure was for want of a channel. That is the template
 *     case: the count comes from the server's `noChannelFailures`, which is
 *     taken off the whole failure list rather than the 200 rows the response
 *     shows, so a long file cannot lose the evidence to the display cap.
 *
 * ── Why EVERY failure, and not merely one ────────────────────────────────
 *
 * Because "nothing landed" on its own says nothing about the channels. Six
 * template rows: four carry Channel "Etsy" and dates this file writes
 * month-first, so they fail "That date can't exist"; two leave Channel blank and
 * fail for want of one. Nothing is ready, nothing is skipped — and asking only
 * whether SOME row wanted a channel made the picker required. The owner picks
 * "Shop" to get past it, then answers the date question on this same screen, the
 * four Etsy rows parse, and all six land in "Shop", because a chosen channel
 * outranks the row's own. Four transactions filed under a channel nobody chose
 * for them, with nothing on screen saying so, and wrong per-channel profit
 * forever after.
 *
 * A file with failures of other kinds has not yet proved anything about its
 * channels. Fix those first and ask again — which is exactly what happens, since
 * the screen re-previews on every change.
 *
 * ── Why a PARTLY blank column is deliberately not offered the picker ──────
 *
 * Same override read the other way round. Picking here does not fill the gaps —
 * it overrules everything. The server's `channelFor` takes the chosen channel
 * ahead of whatever the row said, so an owner with 197 good rows and 3 blank
 * ones who reached for this control would silently re-file all 200 into one
 * channel. The three rows fail, keep their reason, and are named on the check
 * screen, which is the honest answer: the fix is three cells in their file, not
 * a control that quietly rewrites the other hundred and ninety-seven.
 *
 * `show` stays true once a channel has been chosen even though the failures that
 * summoned the control are gone — otherwise the picker vanishes the moment it
 * works and the owner cannot change their mind about a choice still in force.
 * While it is on screen it says out loud that it overrides the file's own
 * Channel column, because by then it may be doing exactly that.
 *
 * Only ever true for a money file. A catalog item is SOLD ON channels and a
 * contact has none at all, so neither has a channel to be missing.
 */
export function channelAnswer(input: {
  kind: ImportKind;
  mapping: Record<string, string>;
  counts: { ready: number; skipped: number; failed: number } | null;
  /** The server's exact count, uncut. Zero when there is no preview to ask. */
  noChannelFailures: number;
  chosenSourceId: string | undefined;
}): { show: boolean; required: boolean } {
  const chosen = (input.chosenSourceId ?? "") !== "";
  if (input.kind !== "transactions") return { show: false, required: false };

  const noColumn = !isMapped(input.mapping, "channel");
  // Nothing landed anywhere, and every single failure said the same why.
  const nothingLanded =
    input.counts !== null &&
    input.counts.ready === 0 &&
    input.counts.skipped === 0 &&
    input.counts.failed > 0 &&
    input.noChannelFailures === input.counts.failed;

  const required = !chosen && (noColumn || nothingLanded);
  return { show: required || chosen, required };
}

/**
 * Everything the owner has told us about ONE file.
 *
 * Held together rather than as four loose pieces of state because they share a
 * lifetime: they are all answers about the file in hand, and the moment a
 * different file arrives every one of them is about a file that is no longer on
 * screen.
 */
export interface OwnerAnswers {
  mapping: Record<string, string>;
  dateOrder: DateOrder | undefined;
  totalsAre: TotalsMode | undefined;
  sourceId: string | undefined;
  includeKeys: string[];
}

/**
 * The answers a freshly uploaded file starts from: the server's guessed mapping,
 * and NOTHING else.
 *
 * ── Why the other four have to go ─────────────────────────────────────────
 *
 * The upload step asks the server to read a file with no answers attached at all
 * — it posts `{kind, filename, csv}` and lets the server guess. So the picture
 * that comes back was produced from the guessed mapping and from no date order,
 * no totals answer and no chosen channel. If the previous file's answers are
 * still standing when it lands, the screen is holding answers the picture in
 * front of the owner was not built from, which is the one thing this flow
 * promises never to do.
 *
 * It is reachable in two clicks: answer the totals question (or pick a channel)
 * on file A, press Back — which returns to the UPLOAD step, not out of the
 * dialog, so nothing is reset — and choose file B. The matching screen then
 * mounts believing the preview it was handed is a picture of the answers it
 * holds, Continue is live immediately, and commit posts a channel that overrides
 * file B's own Channel column or a totals answer its preview never used. Worse,
 * a clean file B skips the matching screen altogether (`StepUpload`'s
 * `readyToSkip`), so there is no screen left to catch it.
 *
 * Clearing them HERE — at the one moment a new file is read — is what makes "the
 * answers we hold are the answers this picture was built from" true by
 * construction rather than something a later screen has to defend. `includeKeys`
 * goes for the same reason and one more: a tick is a decision about one row of
 * one file, and the keys are built out of the file's own order ids, so a stale
 * one is meaningless at best and a collision at worst.
 *
 * ── What it costs ─────────────────────────────────────────────────────────
 *
 * Going Back and choosing the SAME file again also starts over. That is
 * deliberate, and it is what already happened to the mapping — a re-upload has
 * always taken the server's fresh guess over whatever the owner had corrected —
 * so the other four now behave like the one they sit beside rather than
 * outliving it. Re-uploading is starting the file again; it is two clicks from
 * the matching screen, and the alternative is a screen that quietly holds
 * answers about a file nobody can see.
 */
export function answersForNewFile(guessedMapping: Record<string, string>): OwnerAnswers {
  return {
    mapping: { ...guessedMapping },
    dateOrder: undefined,
    totalsAre: undefined,
    sourceId: undefined,
    includeKeys: [],
  };
}

/**
 * Whether Continue may be pressed on the matching screen.
 *
 * ── The one it exists for: the answers and the picture must agree ─────────
 *
 * The check screen's entire promise is that the figures the owner approves are
 * the figures that land. It cannot keep that promise by itself: the preview it
 * is handed carries the mapping and the date order, but nothing about which
 * TOTALS answer or which CHANNEL produced it, so it has no way to notice that
 * the picture in front of it was computed from different answers than the ones
 * it is about to post.
 *
 * And they really could differ. Re-previewing is debounced by 300 ms, so for
 * that window an answer has changed and no request has even been fired — the
 * mutation is not pending, because nothing is in flight yet. Continue used to be
 * open in that window. Clicking it unmounts this screen, whose cleanup cancels
 * the timer, and the check screen then renders the OLD preview while holding the
 * NEW answers and posting them.
 *
 * The reachable one is the totals question: "For the whole sale" and "For each
 * item" sit a few hundred pixels above Continue and decide whether a file's tax,
 * shipping and discount figures cover the order or each line of it. Click one,
 * click Continue inside 300 ms, and the owner approves whole-order money while
 * per-item money lands.
 *
 * So `shownFor` — the answers the preview ON SCREEN was produced from — is
 * compared against the answers as they now stand, and any difference closes
 * Continue. Not "a request is pending", which is a narrower fact that misses
 * the debounce window entirely; the question is whether what they are looking at
 * is what these answers say.
 *
 * ── It always releases ───────────────────────────────────────────────────
 *
 * A guard that never opened would be worse than the bug. Every way `answers` can
 * move from `shownFor` ends in one of three places: the re-preview lands and
 * `shownFor` catches up; the mapping cannot read the file and `problem` says so
 * on screen; or the server refused and `serverSaid` does. There is no fourth,
 * because the screen sends on every change it does not already have a sentence
 * about.
 */
export function continueBlocked(input: {
  /** Why these answers cannot read the file at all. Null when they can. */
  problem: string | null;
  /** What the server said when it refused them. Null on the ordinary path. */
  serverSaid: string | null;
  hasPreview: boolean;
  /** A re-preview is in flight. Still needed: an answer can be changed and changed back. */
  requestInFlight: boolean;
  /** The answers as they now stand. */
  answers: string;
  /** The answers the preview on screen was produced from; null when none has landed. */
  shownFor: string | null;
  /** Nothing in the file says where this money landed, and no channel was picked. */
  channelRequired: boolean;
}): boolean {
  return (
    input.problem !== null ||
    input.serverSaid !== null ||
    !input.hasPreview ||
    input.requestInFlight ||
    input.answers !== input.shownFor ||
    input.channelRequired
  );
}

// ── The check step ─────────────────────────────────────────────────────────

/**
 * A count in the unit the SERVER said it was counting in.
 *
 * `unit` comes off the preview and is "orders" the moment rows are being
 * grouped by an Order ID. Printing "282 rows ready" about 282 orders read out
 * of 1,140 rows is how somebody concludes they have lost 858 sales, so the noun
 * is never assumed here — it is carried.
 */
export function countInUnit(count: number, unit: "rows" | "orders"): string {
  const noun = unit === "orders" ? "order" : "row";
  return `${count.toLocaleString("en-US")} ${count === 1 ? noun : `${noun}s`}`;
}

/**
 * What pressing Import will actually create, and whether it may be pressed.
 *
 * Two facts that have to be worked out together, because the button's label and
 * the button's enabled-ness are the same question asked twice.
 *
 * **`readyCount` is the exact server count; `skippedShown` is the DISPLAY list**,
 * cut to 200 rows. That asymmetry is fine and deliberate: a ticked-back-in row
 * can only be one the owner saw and clicked, so the ticks can never outnumber
 * what was shown. It is also why the ticks are filtered THROUGH the current
 * list rather than counted straight off `includeKeys` — going Back, changing a
 * column and coming forward again re-previews the file and mints fresh keys, and
 * the stale ones left in state would otherwise inflate this figure while the
 * server (which matches keys against its own fresh plan) quietly ignored them.
 *
 * **Nothing landing is a real outcome and it must not be committable.** A
 * filled-in template with a blank Channel column and one permanently unreadable
 * row gets past the matching screen's block — its channel rule needs EVERY
 * failure to be a channel failure, and that file has one that is not — and
 * arrives here with nothing ready. An Import button that posts that would write
 * an empty batch into the history and tell the owner it worked.
 */
export function whatLands(input: {
  readyCount: number;
  skippedShown: readonly { key: string }[];
  includeKeys: readonly string[];
}): { included: string[]; willLand: number; canImport: boolean } {
  const ticked = new Set(input.includeKeys);
  const included = input.skippedShown.filter((row) => ticked.has(row.key)).map((row) => row.key);
  const willLand = input.readyCount + included.length;
  return { included, willLand, canImport: willLand > 0 };
}

/**
 * A full stop, when the server's sentence did not bring one.
 *
 * Our sentences get bolted onto the server's, and not every one of the server's
 * ends in punctuation: the lock refusal is "Another import is still running —
 * give it a moment and try again", so the panel read "…try again We've unticked
 * the 2 rows…" — two sentences with nothing between them, on a screen for
 * somebody who is already worried about what happened to their money. Added
 * here rather than in the server's constants, because this is the only place
 * that joins two sentences and a message shown on its own elsewhere should not
 * grow a full stop it never had.
 */
export function endStop(message: string): string {
  const said = message.trim();
  return said === "" || /[.!?…]$/.test(said) ? said : `${said}.`;
}
