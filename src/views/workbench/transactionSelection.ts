/**
 * Which transaction the pinned detail card is showing.
 *
 * The card sits open beside the ledger rather than sliding over it, so unlike a
 * drawer it can never be "closed" — there is always a row in it. Two rules keep
 * that honest:
 *
 * - **It opens on the newest transaction.** The thing most likely to be checked
 *   is the one just recorded, and an empty third of the screen on every load is
 *   a worse default than a useful guess.
 * - **It does not move on its own.** A selection survives the list refreshing
 *   underneath it; only a selection that has genuinely left the list (filtered
 *   out, or the period changed) falls back to the newest row.
 */
export function resolveSelection(selectedId: string | null, rowIds: string[]): string | null {
  if (rowIds.length === 0) return null;
  if (selectedId && rowIds.includes(selectedId)) return selectedId;
  return rowIds[0];
}
