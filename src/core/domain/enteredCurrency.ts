import { isIdentityRate, isValidFxRate, toBaseCents } from "./currency";
import { lineSubtotal, netLineRevenue, orderDiscountShares } from "./profit";
import type { ProfitLine } from "./types";

/**
 * An entry TYPED in another currency, converted into the business's own
 * currency on save.
 *
 * The owner types "$100 at 280.50"; the ledger stores Rs 28,050 and remembers
 * the dollars beside it. Converting at the door, rather than storing dollars and
 * converting on every read, is what keeps every screen that adds amounts
 * together correct without knowing currencies exist — and it means a catalogue
 * item's costs, which are in the business's own currency, are never read as
 * dollars (DECISIONS.md, 2026-09-26).
 *
 * Each amount converts on its own, half-up to whole minor units, exactly as
 * `toBaseCents` does everywhere else.
 */

export class EnteredCurrencyError extends Error {}

interface EntryLineMoney {
  unitPriceCents?: number;
  lineDiscountCents?: number;
}

interface EntryMoney {
  orderDiscountCents?: number;
  shippingChargedCents?: number;
  taxCollectedCents?: number;
  taxPaidCents?: number;
  lines: EntryLineMoney[];
}

const HEADER_FIELDS = ["orderDiscountCents", "shippingChargedCents", "taxCollectedCents", "taxPaidCents"] as const;

export function convertEntryToBase<T extends EntryMoney>(entry: T, fxRate: string): T {
  if (!isValidFxRate(fxRate)) {
    throw new EnteredCurrencyError(`"${fxRate}" is not an exchange rate — it has to be a number above zero`);
  }
  if (isIdentityRate(fxRate)) {
    throw new EnteredCurrencyError("An exchange rate of 1 means nothing is being converted");
  }

  const converted: T = { ...entry };
  for (const field of HEADER_FIELDS) {
    const cents = entry[field];
    if (cents !== undefined) converted[field] = toBaseCents(cents, fxRate);
  }
  converted.lines = entry.lines.map((line) => {
    // A catalogue item's own price is in the business's currency. Falling back
    // to it would read rupees as dollars and multiply them by the rate.
    if (line.unitPriceCents === undefined) {
      throw new EnteredCurrencyError("Type every price in the currency you picked — saved prices are in your own currency");
    }
    const out = { ...line, unitPriceCents: toBaseCents(line.unitPriceCents, fxRate) };
    if (line.lineDiscountCents !== undefined) out.lineDiscountCents = toBaseCents(line.lineDiscountCents, fxRate);
    return out;
  });
  return converted;
}

/**
 * What a transaction amounts to, as the ledger lists it: a sale's net revenue
 * plus shipping (its cost lines are costs, not part of what it was sold for),
 * or an expense's lines less any discount on the order.
 */
export function entryAmountCents(entry: {
  direction: "in" | "out";
  orderDiscountCents: number;
  shippingChargedCents: number;
  lines: ProfitLine[];
}): number {
  if (entry.direction === "in") {
    const revLines = entry.lines.filter((l) => (l.direction ?? "in") === "in");
    const shares = orderDiscountShares(entry.orderDiscountCents, revLines);
    const net = revLines.reduce((sum, l, i) => sum + netLineRevenue(l, shares[i]), 0);
    return net + entry.shippingChargedCents;
  }
  return entry.lines.reduce((sum, l) => sum + lineSubtotal(l), 0) - entry.orderDiscountCents;
}
