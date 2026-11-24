import { z } from "zod";
import { defineEndpoint } from "./shared";

export const importKind = z.enum(["transactions", "revenue_items", "expense_items", "people"]);
export const dateOrder = z.enum(["dmy", "mdy"]);
export const totalsMode = z.enum(["whole_order", "per_item"]);

/**
 * Size caps on the collections an import request carries. Zod checks a
 * collection element by element and records one issue per bad element, so an
 * uncapped list in a 4 MB body is millions of issue objects (GHSA-mrhx-c7xc-m3w5).
 * From zod 4.6.6 an array's `.max()` is checked FIRST and an oversized array
 * fails with one issue; a record has no `.max()`, so `importMapping` counts its
 * keys before the record looks at a single value.
 */
const MAX_MAPPING_FIELDS = 200; // an import has ~30 fields (importColumns.ts)
/** One key per skipped row or group, so never more than the 5,000 rows an import may have (MAX_ROWS, imports/functions.ts). */
const MAX_INCLUDE_KEYS = 5_000;

/** field -> the header in THEIR file. Absent field = not mapped. */
export const importMapping = z
  .custom<Record<string, string>>(
    // Only an over-long object is refused here; anything else falls through to the record's own errors.
    (value) => value === null || typeof value !== "object" || Object.keys(value).length <= MAX_MAPPING_FIELDS,
    { message: `A column mapping has at most ${MAX_MAPPING_FIELDS} fields` },
  )
  .pipe(z.record(z.string(), z.string()));

/**
 * One row of the check screen — for every kind of import, not just money.
 *
 * On `occurredOn`, `amountCents`, `direction` and `lineCount`, `null` means
 * "this kind has no such thing" — never "we could not read it". A `people` row
 * is a name, an email and a kind: no date, no amount, no direction. A catalog
 * row has a price but still no date and no direction. Forcing those to send
 * `""`, `0` and `"in"` would paint money treatment — a £0.00 figure with a
 * green-in / red-out marker — across a list of customers, which DESIGN.md's
 * colour-means-money rule forbids. The frontend branches on `kind` regardless,
 * since each kind shows its own columns.
 *
 * For `kind: "transactions"` those four are ALWAYS non-null. An order that
 * cannot say when it happened, what it came to or which way the money went is
 * a failed row, not a ready one with gaps.
 *
 * Every field here is required-and-nullable, not optional: the key is always
 * present, carrying `null`. Omitting one fails the dev-mode response check.
 */
export const importReadRow = z.object({
  key: z.string(),                    // stable within one preview; echoed back on commit
  rowNumbers: z.array(z.number().int()),
  /** ISO date the money moved. Null for the catalog and people kinds, which have no date. */
  occurredOn: z.string().nullable(),
  /** The line the owner reads to recognise the row: the order's description, or the item's or person's name. */
  description: z.string(),
  /**
   * The second identifying column, so two rows sharing a description can still
   * be told apart: the email for a person, the category for a catalog item,
   * null for a transaction where `description` already says it. Without it an
   * owner reviewing 200 contacts cannot tell two people named "J Smith" apart.
   */
  detail: z.string().nullable(),
  /**
   * What the group's lines come to: Σ(quantity × unit price) across them, NOT
   * the sum of the Amount cells as they were typed. The two differ the moment a
   * file carries a quantity column — two at 20.00 plus one at 10.00 is 5000
   * here while the cells add to 3000 — and the ledger multiplies
   * (`services/ledger.ts` uses `mulCentsQty(unitPriceCents, qty)`), so the
   * multiplied figure is the one that lands. This is the number the owner
   * confirms before it becomes money; showing the other one is the exact
   * mistake this whole feature exists to prevent.
   *
   * Three things are NOT in it: tax collected (never revenue, per CLAUDE.md),
   * shipping charged, and discount. All three ride the transaction header on
   * their own fields, so folding any of them in here would count them twice.
   *
   * Always positive — `direction` carries the sign. Null for `people`, which has
   * no money at all; for a catalog kind it is the item's price or typical amount
   * when the file gave one, and null when it did not.
   */
  amountCents: z.number().int().nullable(),
  /**
   * Money in or money out. Null for the catalog and people kinds: an item's
   * price is a fact about the business, not a money event, and must not be
   * coloured like one.
   */
  direction: z.enum(["in", "out"]).nullable(),
  /** How many items this order covers. Null for the kinds that are one record per row. */
  lineCount: z.number().int().nullable(),
  /** Always present; `null` on ready rows. On a skipped row, why we set it aside, in plain English. */
  skipReason: z.string().nullable(),
});

export const importFailedRow = z.object({
  rowNumbers: z.array(z.number().int()),
  /**
   * The row as the file had it, because the "Download these" button rebuilds a
   * CSV from these cells for the owner to fix and re-upload.
   *
   * Row failures already carry them (`importRows.ts` `FailedRow.cells`), but a
   * GROUP failure does not — `importGroup.ts` gives only `rowNumbers` and
   * `reason` — so the service must re-read those rows by `rowNumber` and fill
   * them wherever it can. The default is a floor, not a licence: an empty array
   * writes blank lines into the very file the owner is meant to correct. And it
   * is the dev-mode response check that applies it; production sends the
   * handler's own object, so only the service filling this reaches the browser.
   */
  cells: z.array(z.string()).default([]),
  reason: z.string(),
});

export const importPreview = z.object({
  kind: importKind,
  grouped: z.boolean(),
  unit: z.enum(["rows", "orders"]),
  sourceRowCount: z.number().int(),
  mapping: importMapping,
  ignoredHeaders: z.array(z.string()),
  headers: z.array(z.string()),
  dateOrder,
  /**
   * True when the FILE settled which way its dates run — a day over 12 somewhere
   * in the column — and false when only an assumption or the owner's answer is
   * holding it up.
   *
   * It is not decoration. When this is true the server IGNORES any `dateOrder`
   * the request sent, because the file has proved the answer and a stale answer
   * can only misread it; `dateOrder` above is then the file's own reading and
   * there is nothing left to ask. When it is false the request's answer is what
   * was used, and the screen must keep offering the control that changes it.
   */
  dateOrderCertain: z.boolean(),
  needsTotalsAnswer: z.boolean(),
  counts: z.object({ ready: z.number().int(), skipped: z.number().int(), failed: z.number().int() }),
  /**
   * How many of `counts.failed` failed for want of a channel — the whole count,
   * never cut.
   *
   * The matching screen decides whether to make the owner pick one channel for
   * the file from this, and it CANNOT be worked out from `failed` below: that
   * list stops at 200 rows, and the no-channel failures are appended last, so
   * they are the first entries a long file loses. Read off the truncated list,
   * a file with 200 earlier failures looks like a file with no channel problem
   * at all.
   *
   * The screen needs it exact in both directions. Equal to `counts.failed` with
   * nothing ready and nothing skipped means the file supplied no channel to
   * anybody, which is the one case where picking one here can overrule nothing —
   * so the picker is required. Anything less means some rows failed for another
   * reason and the file has not yet proved what its channels are, so picking one
   * would silently re-file them. Zero for the three kinds that have no channel.
   */
  noChannelFailures: z.number().int(),
  ready: z.array(importReadRow),
  skipped: z.array(importReadRow),
  failed: z.array(importFailedRow),
});

// ── Template download (a plain Express route, not a contract endpoint) ──────
//
// GET /imports/template?kind=... returns text/csv, not JSON, so it is a
// dedicated Express route rather than a Zod endpoint — exactly as the
// attachment upload/download already are. Everything else about importing is
// typed in this file.

/**
 * The `error.code` a preview or commit carries when the mapping cannot read the
 * file AT ALL — no column holds the date, or nothing holds the amount.
 *
 * A code rather than a sentence, and in the contract rather than in either half,
 * because the UPLOAD SCREEN has to tell this refusal apart from every other way
 * a file can be refused: this is the only one a dropdown can fix, so it sends
 * the owner on to the matching step with their columns in hand, while "that file
 * is too big" or "that file has 40,000 rows" keep them where they can pick
 * another file. Telling them apart by comparing the message text held only while
 * both sides quoted the same sentence verbatim — anything that wrapped or
 * prefixed it would have failed the comparison silently and brought the dead end
 * back. The sentence is still what the owner reads; this is what the code reads.
 */
export const IMPORT_MAPPING_UNUSABLE = "mapping_unusable";

export const previewImport = defineEndpoint({
  method: "POST",
  path: "/imports/preview",
  body: z.object({
    kind: importKind,
    filename: z.string().min(1).max(255),
    csv: z.string().min(1),
    mapping: importMapping.optional(),      // absent = guess
    dateOrder: dateOrder.optional(),
    totalsAre: totalsMode.optional(),
    sourceId: z.string().optional(),        // the one channel, when no Channel column
    /**
     * Same field commit takes, and preview needs it for the same reason in
     * reverse: the duplicate warning compares the file's days against rows
     * already in the ledger, and commit wrote those at the first instant of
     * their day in this zone. Read them back in another and the days do not
     * line up, so a second upload of one statement would report nothing to skip.
     */
    timeZone: z.string().min(1).max(64).optional(),
  }),
  response: importPreview,
});

export const importBatch = z.object({
  id: z.string(),
  kind: importKind,
  filename: z.string(),
  sourceId: z.string().nullable(),
  status: z.enum(["applied", "undone"]),
  sourceRowCount: z.number().int(),
  createdCount: z.number().int(),
  skippedCount: z.number().int(),
  failedCount: z.number().int(),
  createdAt: z.string(),
  undoneAt: z.string().nullable(),
});

export const commitImport = defineEndpoint({
  method: "POST",
  path: "/imports/commit",
  body: z.object({
    kind: importKind,
    filename: z.string().min(1).max(255),
    csv: z.string().min(1),
    mapping: importMapping,
    dateOrder,
    totalsAre: totalsMode.optional(),
    sourceId: z.string().optional(),
    /** Keys from the preview's `skipped` list the owner ticked back in. */
    includeKeys: z.array(z.string()).max(MAX_INCLUDE_KEYS).default([]),
    /**
     * The reader's own time zone, IANA-named — "America/Chicago", "Asia/Karachi".
     *
     * A date in a spreadsheet is a CALENDAR DAY, not an instant, and the only
     * calendar that matters is the one the owner keeps. Every window in the app
     * is built from their local day (`lib/period.ts`), so a row stored at UTC
     * midnight sits BEFORE "today" starts for anyone west of Greenwich — they
     * import a file, the receipt says rows landed, and the ledger, dashboard and
     * P&L all read empty until they widen the period. At America/Chicago that is
     * a five-hour gap, and it misses at every hour of the day, not just near
     * midnight.
     *
     * The server cannot know the zone, so the browser says — the same reason
     * `dateOrder` above is sent rather than re-inferred: commit stores the
     * reading the owner was actually shown. Optional, because a caller that
     * omits it (a script, an older client) must still work; it then falls back
     * to UTC, which is what every row already did.
     */
    timeZone: z.string().min(1).max(64).optional(),
  }),
  response: z.object({
    batch: importBatch,
    counts: z.object({ created: z.number().int(), skipped: z.number().int(), failed: z.number().int() }),
    /**
     * WHY each failed row failed, not just how many did — the same shape the
     * preview's `failed` list uses, so one screen renders both.
     *
     * It is not the preview's list re-sent. Commit re-reads the file, so its
     * failures are its own, and a group that the ledger refused at WRITE time
     * never appeared on the check screen at all: "18 rows didn't import" with
     * nothing about which or why is a dead end for an owner who cannot read a
     * log.
     *
     * Cut to the same DISPLAY-ONLY cap the preview's lists use. `counts.failed`
     * beside it stays exact, so a file with 500 bad rows says 500 and shows the
     * first 200.
     *
     * Always present. On an import where nothing failed it is `[]`, never
     * omitted — response validation and zod's key-stripping are both gated on
     * `NODE_ENV !== "production"`, so a field the handler leaves out is filled
     * by this schema in dev and simply missing on a customer's screen.
     */
    failures: z.array(importFailedRow),
  }),
});

export const listImportBatches = defineEndpoint({
  method: "GET",
  path: "/imports",
  response: z.array(importBatch),
});

export const undoImportBatch = defineEndpoint({
  method: "POST",
  path: "/imports/:id/undo",
  params: z.object({ id: z.string() }),
  response: z.object({
    batch: importBatch,
    removed: z.number().int(),
    kept: z.number().int(),
    /**
     * The names of the rows this undo left alone, so the screen can say WHICH
     * rather than only how many. Both halves fill it: a catalog row that
     * something already uses, and a transaction that could not be voided
     * because a refund or chargeback still stands against it.
     */
    keptNames: z.array(z.string()),
  }),
});

export type ImportPreviewShape = z.infer<typeof importPreview>;
export type ImportBatchShape = z.infer<typeof importBatch>;
/** Which of the four things a file is bringing in. Named so screens can hold one. */
export type ImportKindShape = z.infer<typeof importKind>;
/**
 * One row that did not import, with the reason. Named because BOTH the preview
 * and the commit response carry a list of these, and a second interface for the
 * second list is how the two would drift apart.
 *
 * `z.infer`, not `z.input`: `cells` has a `.default([])`, so it is optional
 * going in and always present coming out — and "always present" is what a
 * producer must satisfy, since production never runs the default.
 */
export type ImportFailedRowShape = z.infer<typeof importFailedRow>;
export type ImportMappingShape = z.infer<typeof importMapping>;
/** The two request bodies, named so the frontend hooks in Task 16 can type themselves. */
export type ImportPreviewInput = z.infer<typeof previewImport.body>;
/**
 * `z.input`, not `z.infer`: `includeKeys` carries a `.default([])`, and a
 * default is optional going IN but required coming OUT, so `z.infer` would make
 * every caller pass `includeKeys: []` even when nothing was ticked back in.
 *
 * The schema itself is deliberately untouched. The server still parses the body
 * through `EndpointBody` (`z.infer`), so what a handler receives is unchanged —
 * `includeKeys` is still filled in and still non-optional there. Loosening that
 * to match the caller would be the wrong fix.
 */
export type ImportCommitInput = z.input<typeof commitImport.body>;
