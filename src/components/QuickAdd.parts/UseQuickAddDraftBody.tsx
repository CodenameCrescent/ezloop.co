import { useMemo } from "react";
import { readMoney, MoneyInputError } from "@/lib/money";
import { dateInputToInstant } from "@/lib/period";
import { type Direction, type CreateBody, type SplitTarget, RATE_SHAPE } from "./DraftFromTransaction";
import { useQuickAddDraftState } from "./UseQuickAddDraftState";

/** useQuickAddLogic's state and handlers, kept out of its render so each file stays short. */
export function useQuickAddDraftBody({ lines, hasRevenue, orderDiscountRupees, taxPaidRupees, fxRate, typedIn, date, paid, paidDate, dueDate, sourceId, customer, notes, reference, taxReclaimable }: { lines: ReturnType<typeof useQuickAddDraftState>["lines"]; hasRevenue: ReturnType<typeof useQuickAddDraftState>["hasRevenue"]; orderDiscountRupees: ReturnType<typeof useQuickAddDraftState>["orderDiscountRupees"]; taxPaidRupees: ReturnType<typeof useQuickAddDraftState>["taxPaidRupees"]; fxRate: ReturnType<typeof useQuickAddDraftState>["fxRate"]; typedIn: ReturnType<typeof useQuickAddDraftState>["typedIn"]; date: ReturnType<typeof useQuickAddDraftState>["date"]; paid: ReturnType<typeof useQuickAddDraftState>["paid"]; paidDate: ReturnType<typeof useQuickAddDraftState>["paidDate"]; dueDate: ReturnType<typeof useQuickAddDraftState>["dueDate"]; sourceId: ReturnType<typeof useQuickAddDraftState>["sourceId"]; customer: ReturnType<typeof useQuickAddDraftState>["customer"]; notes: ReturnType<typeof useQuickAddDraftState>["notes"]; reference: ReturnType<typeof useQuickAddDraftState>["reference"]; taxReclaimable: ReturnType<typeof useQuickAddDraftState>["taxReclaimable"] }) {

  /**
   * The draft, plus the first money box that isn't an amount — named the way it
   * is printed on screen.
   *
   * The problem rides WITH the body rather than being thrown, because this same
   * build feeds the live preview: a half-typed "1." should quietly stop
   * previewing, not interrupt. The message is shown when Record is pressed.
   */
  const draft = useMemo<{ body: CreateBody | null; moneyProblem: string | null }>(() => {
    let problem: string | null = null;
    const read = (label: string, raw: string): number | null => {
      try {
        return readMoney(label, raw);
      } catch (err) {
        if (err instanceof MoneyInputError) { problem ??= err.message; return null; }
        throw err;
      }
    };

    const built = lines
      .map((l) => {
        const qty = l.qty.trim() || "1";
        const line: CreateBody["lines"][number] = { direction: l.direction, qty };
        if (l.categoryId) line.categoryId = l.categoryId;
        if (l.lineDiscountRupees.trim() && l.direction === "in") {
          const discount = read("Discount", l.lineDiscountRupees);
          if (discount === null) return null;
          line.lineDiscountCents = discount;
        }
        // Spreading only ever applies to a cost, and only when the entry is a
        // pure cost — the server refuses both, and the control is hidden in
        // both cases, but a duplicated or templated draft can still carry one.
        if (l.direction === "out" && !hasRevenue) {
          const months = Number(l.spreadMonths.trim());
          if (Number.isInteger(months) && months >= 2) line.spreadMonths = months;
          if (l.isAdvance) line.isAdvance = true;
          if (l.wastedQty.trim()) line.wastedQty = l.wastedQty.trim();

          // Who it was for — one target, or several shares. Never both; the
          // server refuses that, and the control only offers one at a time.
          const parts = (l.splitParts ?? [])
            .filter((p) => p.targetKey && Number(p.percent) > 0)
            .map((p) => {
              const [targetType, targetId] = p.targetKey.split(":");
              return { targetType: targetType as SplitTarget, targetId, weight: p.percent.trim() };
            });
          if (parts.length >= 2) {
            line.split = parts;
          } else if (!l.splitParts && l.targetKey) {
            const [targetType, targetId] = l.targetKey.split(":");
            line.targetType = targetType as SplitTarget;
            line.targetId = targetId;
          }
        }
        if (l.itemId) {
          if (l.direction === "in") line.revenueItemId = l.itemId;
          else line.expenseItemId = l.itemId;
          if (l.priceRupees.trim()) {
            const price = read(l.direction === "in" ? "Price (each)" : "Amount", l.priceRupees);
            if (price === null) return null;
            line.unitPriceCents = price;
          }
          return line;
        }
        // Free-label line — needs a label and a price.
        if (!l.label.trim() || !l.priceRupees.trim()) return null;
        const price = read(l.direction === "in" ? "Price (each)" : "Amount", l.priceRupees);
        if (price === null) return null;
        line.label = l.label.trim();
        line.unitPriceCents = price;
        return line;
      })
      .filter((l): l is CreateBody["lines"][number] => l !== null);

    const orderDiscountCents = orderDiscountRupees.trim() && hasRevenue ? read("Order discount", orderDiscountRupees) : null;
    const taxPaidCents = taxPaidRupees.trim() ? read("Tax included in this amount", taxPaidRupees) : null;

    const rate = fxRate.trim();
    if (typedIn && !(RATE_SHAPE.test(rate) && Number(rate) > 0)) {
      problem ??= rate ? "The exchange rate needs to be a number, like 278.50" : "Add the exchange rate";
    }

    if (built.length === 0 || problem) return { body: null, moneyProblem: problem };
    // Header direction is a summary: "in" if the transaction earns anything.
    const direction: Direction = built.some((l) => l.direction === "in") ? "in" : "out";
    const body: CreateBody = {
      direction,
      // Read as a LOCAL calendar day, the same way every filter reads it —
      // `new Date("2026-08-05")` is UTC midnight, which lands on the day before
      // for anyone west of UTC and hides the entry from its own day.
      occurredAt: dateInputToInstant(date).toISOString(),
      // Unpaid is a missing paid date, never a status: the entry is still real
      // and still counts toward profit, it just hasn't reached the bank.
      paidAt: paid ? dateInputToInstant(paidDate || date).toISOString() : null,
      // A calendar day, sent as typed. Only meaningful while unpaid.
      ...(!paid && dueDate ? { dueDate } : {}),
      lines: built,
      ...(sourceId ? { sourceId } : {}),
      ...(direction === "in" && customer.trim() ? { personName: customer.trim() } : {}),
      ...(notes.trim() ? { notes: notes.trim() } : {}),
      ...(reference.trim() ? { referenceNumber: reference.trim() } : {}),
      ...(orderDiscountCents !== null ? { orderDiscountCents } : {}),
      ...(taxPaidCents !== null ? { taxPaidCents, taxReclaimable } : {}),
      ...(typedIn ? { enteredIn: { currency: typedIn, fxRate: rate } } : {}),
    };
    return { body, moneyProblem: null };
  }, [lines, date, paidDate, dueDate, customer, notes, reference, sourceId, paid, orderDiscountRupees, hasRevenue, taxPaidRupees, taxReclaimable, typedIn, fxRate]);

  const body = draft.body;
  const moneyProblem = draft.moneyProblem;

  return { body, moneyProblem };
}
