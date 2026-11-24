/**
 * Turning rows back into orders.
 *
 * Shopify, Etsy and Stripe export one row PER ITEM, not per order: a three-item
 * sale is three rows sharing an Order ID. Imported row by row that becomes
 * three separate orders — a wrong order count, and then rows two and three
 * collide on `unique(source_id, external_ref)` and are thrown away as
 * duplicates, so the same mistake loses the lines as well. This module puts the
 * three back together into the header-plus-lines shape the ledger already has.
 *
 * Two rules carry all the risk, and both are about order-level values — the
 * tax, the shipping, the customer — which belong to the SALE and not to any one
 * item:
 *
 *   - The group takes the FIRST NON-BLANK value, never a sum. Exports either
 *     repeat those values on every row or write them once and leave the rest
 *     blank, and first-non-blank is right for both; summing turns the repeated
 *     case into treble the tax. Summing happens only when the caller says the
 *     figures really are per item.
 *   - Two rows carrying DIFFERENT non-blank values refuse the whole group. That
 *     disagreement means the file is not what the mapping claims it is, and
 *     quietly picking one writes a wrong order that looks right forever.
 *
 * Nothing here parses: `importParse` reads cells and `importRows` reads rows,
 * and by the time a row arrives every value on it is already typed. This module
 * only decides which rows are one sale and which value the sale takes.
 */
import type { Direction } from "./importParse";
import type { ParsedTxnRow, PaidOn } from "./importRows";

/**
 * Whether a tax / shipping / discount figure describes the whole order or the
 * one item on its row. The file cannot say, so the owner is asked — see the
 * check screen's "these totals are…" question.
 */
export type TotalsMode = "whole_order" | "per_item";

/**
 * The one sentence for a group with no channel to land on.
 *
 * Written down once because THREE readers have to agree on it, and a sentence
 * copied out is a sentence that agrees by luck. The preview marks such a group
 * failed with it; commit refuses the same case with it; and the MATCHING SCREEN
 * reads it back off the preview's failures to decide whether to offer the
 * channel picker.
 *
 * That last reader is why it sits in the domain rather than in the import
 * service. "No Channel column mapped" is NOT the condition — our own blank
 * template has a Channel column, so an owner who fills the template in and
 * leaves that column empty produces a file whose headers match perfectly and
 * whose every row then fails for want of somewhere to land. The only thing that
 * tells those two cases apart is this reason coming back on the failures, and
 * the browser cannot import an Express service to read it.
 */
export const NO_CHANNEL_REASON = "No channel for this row";

export interface OrderLine {
  rowNumber: number;
  label: string;
  itemName: string | null;
  categoryName: string | null;
  qty: string;
  amountCents: number;
  direction: Direction;
}

export interface OrderGroup {
  orderId: string | null;
  rowNumbers: number[];
  occurredOn: string;
  paidOn: PaidOn;
  direction: Direction;          // the header's; lines may differ
  description: string;
  channelName: string | null;
  personName: string | null;
  reference: string | null;
  notes: string | null;
  taxCollectedCents: number;
  shippingChargedCents: number;
  discountCents: number;
  lines: OrderLine[];
}

/**
 * A group that could not be made, like a row that could not be read: it names
 * every row it covers, so the owner is told about the whole order at once
 * rather than about one line of it.
 */
export type GroupOutcome =
  | { ok: true; group: OrderGroup }
  | { ok: false; rowNumbers: number[]; reason: string };

/**
 * First non-blank wins, and a second DIFFERENT non-blank value refuses.
 *
 * Exports either repeat order-level values on every row or put them on the
 * first row only; first-non-blank is right for both, where summing turns the
 * repeated case into triple the tax. A genuine disagreement means the file is
 * not what the mapping claims it is, and quietly picking one writes a wrong
 * order that looks right forever.
 */
function agree<T>(
  values: Array<T | null>,
  label: string,
  isBlank: (v: T) => boolean,
): { ok: true; value: T | null } | { ok: false; reason: string } {
  let chosen: T | null = null;
  for (const value of values) {
    if (value === null || isBlank(value)) continue;
    if (chosen === null) { chosen = value; continue; }
    if (chosen !== value) {
      return { ok: false, reason: `Rows in this order disagree about ${label}: "${String(chosen)}" and "${String(value)}"` };
    }
  }
  return { ok: true, value: chosen };
}

/**
 * An amount written the way the file writes it, for a refusal the owner reads
 * beside their spreadsheet.
 *
 * Cents are how this app stores money, and no way at all to describe it: a
 * sentence saying a row disagrees about "500" and "900" sends the owner looking
 * for numbers they never typed, when their cells say 5.00 and 9.00. Digits are
 * moved as text — no division, no float, nothing that could round the figure it
 * is only quoting.
 */
function centsText(cents: number): string {
  const digits = String(Math.abs(cents)).padStart(3, "0");
  return `${cents < 0 ? "-" : ""}${digits.slice(0, -2)}.${digits.slice(-2)}`;
}

/**
 * "Paid on" flattened to one comparable, readable value, with blank as the
 * empty string.
 *
 * `agree` compares with `!==`, which on two objects asks whether they are the
 * same object, not whether they say the same thing — every row would look like
 * a disagreement. "follows" is the blank here because it is what a row says
 * when its Paid on cell was empty.
 */
function paidOnText(paidOn: PaidOn): string {
  if (paidOn.mode === "follows") return "";
  return paidOn.mode === "unpaid" ? "unpaid" : paidOn.iso;
}

function paidOnFrom(text: string | null): PaidOn {
  if (text === null || text === "") return { mode: "follows" };
  return text === "unpaid" ? { mode: "unpaid" } : { mode: "on", iso: text };
}

/**
 * The id this row's order is filed under. Trimmed, and an id that is blank or
 * absent is no id at all — a mapped Order ID column that nobody filled in must
 * not collapse a month of unrelated bank rows into one enormous order.
 */
function orderKeyOf(row: ParsedTxnRow): string {
  return row.orderId === null ? "" : row.orderId.trim();
}

/** One row, one line. Row order is line order, and no row is ever dropped. */
function lineOf(row: ParsedTxnRow): OrderLine {
  return {
    rowNumber: row.rowNumber,
    label: row.description,
    itemName: row.itemName,
    categoryName: row.categoryName,
    qty: row.qty,
    amountCents: row.amountCents,
    direction: row.direction,
  };
}

/** The rows of ONE order, resolved into a single sale or refused as a whole. */
function groupRows(rows: ParsedTxnRow[], totalsAre: TotalsMode): GroupOutcome {
  const first = rows[0];
  const rowNumbers = rows.map((row) => row.rowNumber);
  const lines = rows.map(lineOf);
  const orderId = orderKeyOf(first) || null;

  // The header of a sale is taken from its first row: its date, its direction,
  // and the label the list will read by. Which value each of the shared fields
  // takes is the work below.
  const header = (over: Partial<OrderGroup>): GroupOutcome => ({
    ok: true,
    group: {
      orderId, rowNumbers, lines,
      occurredOn: first.occurredOn,
      paidOn: first.paidOn,
      direction: first.direction,
      description: first.description,
      channelName: first.channelName,
      personName: first.personName,
      reference: first.reference,
      notes: first.notes,
      taxCollectedCents: first.taxCollectedCents,
      shippingChargedCents: first.shippingChargedCents,
      discountCents: first.discountCents,
      ...over,
    },
  });

  // One row cannot disagree with itself, and its own values are the order's in
  // either totals mode. The ordinary bank statement is a file of these, so the
  // common case never pays for the machinery below. The values pass through as
  // the row layer left them — trimmed, with blanks already null — which is the
  // same answer the agreement below would reach for a single row.
  if (rows.length === 1) return header({});

  const refuse = (reason: string): GroupOutcome => ({ ok: false, rowNumbers, reason });

  const text = (pick: (row: ParsedTxnRow) => string | null, label: string) =>
    agree(rows.map(pick), label, (value) => value.trim() === "");

  /**
   * A shared money figure: agreed in whole-order mode, added up in per-item
   * mode. Per-item is only ever reached because the caller said so.
   */
  const total = (
    pick: (row: ParsedTxnRow) => number,
    label: string,
  ): { ok: true; value: number } | { ok: false; reason: string } => {
    const values = rows.map(pick);
    if (totalsAre === "per_item") {
      return { ok: true, value: values.reduce((sum, value) => sum + value, 0) };
    }
    // Agreed on how the figure READS, so the refusal can quote the owner's own
    // units. The text is one-to-one with the number, so the first non-zero row
    // is the value that text was agreed from.
    const agreed = agree(values.map((value) => (value === 0 ? null : centsText(value))), label, (value) => value === "");
    if (!agreed.ok) return agreed;
    return { ok: true, value: values.find((value) => value !== 0) ?? 0 };
  };

  const occurredOn = text((row) => row.occurredOn, "the date");
  if (!occurredOn.ok) return refuse(occurredOn.reason);
  const paidOn = text((row) => paidOnText(row.paidOn), "when it was paid");
  if (!paidOn.ok) return refuse(paidOn.reason);
  const channelName = text((row) => row.channelName, "the channel");
  if (!channelName.ok) return refuse(channelName.reason);
  const personName = text((row) => row.personName, "the person");
  if (!personName.ok) return refuse(personName.reason);
  const reference = text((row) => row.reference, "the reference");
  if (!reference.ok) return refuse(reference.reason);
  const notes = text((row) => row.notes, "the notes");
  if (!notes.ok) return refuse(notes.reason);

  const tax = total((row) => row.taxCollectedCents, "the tax collected");
  if (!tax.ok) return refuse(tax.reason);
  const shipping = total((row) => row.shippingChargedCents, "the shipping charged");
  if (!shipping.ok) return refuse(shipping.reason);
  const discount = total((row) => row.discountCents, "the discount");
  if (!discount.ok) return refuse(discount.reason);

  return header({
    // Never null in practice: a row with no date was refused a layer down, so
    // there is no group whose every date is blank. Falling back to the first
    // row's rather than asserting keeps that a fact about the data, not a throw.
    occurredOn: occurredOn.value ?? first.occurredOn,
    paidOn: paidOnFrom(paidOn.value),
    channelName: channelName.value,
    personName: personName.value,
    reference: reference.value,
    notes: notes.value,
    taxCollectedCents: tax.value,
    shippingChargedCents: shipping.value,
    discountCents: discount.value,
  });
}

export function groupTransactionRows(
  rows: ParsedTxnRow[],
  options: { totalsAre: TotalsMode },
): GroupOutcome[] {
  // A Map, so orders come back in the order the file first mentions them —
  // rows of one order need not be adjacent, and an export that interleaves two
  // orders must still produce two.
  const buckets = new Map<string, ParsedTxnRow[]>();
  rows.forEach((row, index) => {
    const id = orderKeyOf(row);
    // An unidentified row is its own order. The keys are prefixed because
    // otherwise a file whose order ids happened to look like the synthetic ones
    // would have unrelated rows merged into a single sale.
    const key = id === "" ? `row:${index}` : `id:${id}`;
    const bucket = buckets.get(key);
    if (bucket === undefined) buckets.set(key, [row]);
    else bucket.push(row);
  });

  const outcomes: GroupOutcome[] = [];
  for (const bucket of buckets.values()) outcomes.push(groupRows(bucket, options.totalsAre));
  return outcomes;
}

/**
 * True when any two rows share a non-empty order id — drives the UI's "1,140
 * rows make 412 orders", and the question about whose totals those are, which
 * is only worth asking of a file that groups at all.
 */
export function willGroup(rows: ParsedTxnRow[]): boolean {
  const seen = new Set<string>();
  for (const row of rows) {
    const id = orderKeyOf(row);
    if (id === "") continue;
    if (seen.has(id)) return true;
    seen.add(id);
  }
  return false;
}
