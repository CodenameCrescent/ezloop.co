import { assertCents, type Cents } from "./money";

/**
 * Advances — money that moves before the work does.
 *
 * A mobilisation advance to a subcontractor. A deposit to a supplier. A deposit
 * taken FROM a customer before a job starts. All the same shape: real cash has
 * moved, and nothing has been earned or consumed yet.
 *
 * ── Why this needed a new idea ──────────────────────────────────────────────
 *
 * Everything else in this ledger is a money event that is also an economic
 * event: a sale earns, a bill costs. An advance is the one case where the two
 * come apart in TIME rather than by a few days. Recorded as an ordinary
 * payment, it lands as a cost in a month where no work happened — the month
 * reports a loss it did not have, and the month the work actually happens
 * reports a profit it did not make.
 *
 * ── The rule ────────────────────────────────────────────────────────────────
 *
 * An advance line spends NOTHING under accrual and EVERYTHING under cash. That
 * is the same shape as a capitalised purchase (`defersToSlices` in profit.ts)
 * and deliberately so: both are "the cash moved now, the cost belongs
 * elsewhere". They differ in where elsewhere is — a spread cost is already
 * incurred and belongs to the months it covers, an advance is not yet incurred
 * at all and belongs to whenever the bill finally arrives.
 *
 * ── How it ends ─────────────────────────────────────────────────────────────
 *
 * The bill arrives as an ordinary transaction, and an APPLICATION says how much
 * of the advance settles it. Applications are append-only rows; the balance is
 * derived, never stored. When applications reach a bill's full amount the
 * server sets its `paid_at`, so `paid_at` remains the single answer to "is this
 * settled" and applications only ever explain HOW.
 */

/** One draw against an advance, or one payment against a bill. */
export interface AdvanceApplication {
  amountCents: Cents;
}

function sum(applications: AdvanceApplication[]): Cents {
  return applications.reduce((total, application) => total + application.amountCents, 0);
}

/**
 * What is left of an advance.
 *
 * Never negative. Over-drawing is refused at the write path, and if a row ever
 * slipped past it a negative balance would read as the supplier owing money
 * back — a different claim entirely, and a wrong one.
 */
export function advanceBalance(advanceCents: Cents, applications: AdvanceApplication[]): Cents {
  assertCents(advanceCents, "advanceBalance");
  return Math.max(0, advanceCents - sum(applications));
}

export interface ApplicableInput {
  /** What the bill is for. */
  billCents: Cents;
  /** What has already been applied to that bill, from any source. */
  alreadyAppliedCents: Cents;
  /** What is left on the advance being drawn from. */
  advanceBalanceCents: Cents;
}

/**
 * The most that may be applied: the smaller of what the bill still owes and
 * what the advance still holds.
 *
 * Both bounds matter. Ignoring the bill lets an advance overpay it, which would
 * mark it more than settled; ignoring the advance lets a draw exceed what was
 * ever paid, which invents money.
 */
export function applicableAmount(input: ApplicableInput): Cents {
  assertCents(input.billCents, "applicableAmount.billCents");
  const owing = Math.max(0, input.billCents - input.alreadyAppliedCents);
  return Math.max(0, Math.min(owing, input.advanceBalanceCents));
}

/** Has this bill been covered in full? What sets `paid_at`. */
export function isFullySettled(billCents: Cents, applications: AdvanceApplication[]): boolean {
  return sum(applications) >= billCents;
}

/**
 * The property a test can assert directly: nothing drawn from an advance
 * exceeds the advance itself. A breach means money was invented in a place that
 * looks like ordinary bookkeeping from every screen.
 */
export function applicationsReconcile(advanceCents: Cents, applications: AdvanceApplication[]): boolean {
  return sum(applications) <= advanceCents;
}
