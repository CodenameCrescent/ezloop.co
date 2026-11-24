import test from "node:test";
import assert from "node:assert/strict";
import {
  AGING_BUCKETS,
  OWED_STATE_LABELS,
  agingBucketOf,
  daysOutstanding,
  daysOverdue,
  owedRow,
  owedStateOf,
  summariseAging,
  type OwedInput,
} from "./owed";

const NOW = new Date("2026-09-03T11:30:00Z");
const day = (iso: string) => new Date(`${iso}T00:00:00Z`);

function bill(over: Partial<OwedInput> = {}): OwedInput {
  return {
    occurredAt: day("2026-08-01"),
    paidAt: null,
    dueDate: null,
    status: "completed",
    ...over,
  };
}

// ── What "late" means, and when it means nothing ────────────────────────────

test("an invoice past its due date is overdue, by whole days", () => {
  const state = owedStateOf(bill({ dueDate: day("2026-08-25") }), NOW);
  assert.equal(state, "overdue");
  assert.equal(daysOverdue(bill({ dueDate: day("2026-08-25") }), NOW), 9);
});

test("on the due date itself it is not yet late — the day is not over", () => {
  const onTheDay = bill({ dueDate: day("2026-09-03") });
  assert.notEqual(owedStateOf(onTheDay, NOW), "overdue");
  assert.equal(daysOverdue(onTheDay, NOW), 0);
});

test("one day past the due date is one day late, not two", () => {
  // The boundary that goes wrong when a comparison uses the clock rather than
  // the calendar: NOW is 11:30, so a subtraction of timestamps gives 0.52 days
  // and floors to zero.
  assert.equal(daysOverdue(bill({ dueDate: day("2026-09-02") }), NOW), 1);
  assert.equal(owedStateOf(bill({ dueDate: day("2026-09-02") }), NOW), "overdue");
});

test("a due date inside the next week is due soon; beyond it is simply not due", () => {
  assert.equal(owedStateOf(bill({ dueDate: day("2026-09-08") }), NOW), "due_soon");
  assert.equal(owedStateOf(bill({ dueDate: day("2026-09-30") }), NOW), "not_due");
});

test("WITHOUT an agreed date nothing can be late — it is owed, not overdue", () => {
  // The honest core of this module. Ageing an invoice from the day it was
  // raised and calling the result "overdue" invents an agreement nobody made,
  // and would paint every unpaid sale red the moment it was entered.
  const noDate = bill({ dueDate: null });
  assert.equal(owedStateOf(noDate, NOW), "no_due_date");
  assert.equal(daysOverdue(noDate, NOW), 0);
  // It is still owed, and still ageing, which is what the list sorts on.
  assert.equal(daysOutstanding(noDate, NOW), 33);
});

// ── Who is on the list at all ───────────────────────────────────────────────

test("a paid transaction is not owed, whatever its due date says", () => {
  const paid = bill({ dueDate: day("2026-08-01"), paidAt: day("2026-08-02") });
  assert.equal(owedRow(paid, NOW), null);
});

test("an unconfirmed recurring post is not owed either", () => {
  // `pending` means "the owner has not confirmed this happened", never "unpaid"
  // — see basis.ts. A row nobody has confirmed must not appear on a
  // chase-the-money list.
  assert.equal(owedRow(bill({ status: "pending" }), NOW), null);
});

test("a voided transaction is not owed", () => {
  assert.equal(owedRow(bill({ status: "void" }), NOW), null);
});

test("a disputed charge is still owed — a dispute is not a payment", () => {
  assert.notEqual(owedRow(bill({ status: "disputed" }), NOW), null);
});

// ── Ageing ──────────────────────────────────────────────────────────────────

test("days outstanding count from when it happened, not from when it was due", () => {
  // Two different questions: "how long have I been waiting" and "how late is
  // it". A bill raised in August with a due date in December is 33 days
  // outstanding and not late at all.
  const longTerms = bill({ occurredAt: day("2026-08-01"), dueDate: day("2026-12-01") });
  assert.equal(daysOutstanding(longTerms, NOW), 33);
  assert.equal(daysOverdue(longTerms, NOW), 0);
});

test("a bill dated in the future is zero days outstanding, never negative", () => {
  assert.equal(daysOutstanding(bill({ occurredAt: day("2026-09-30") }), NOW), 0);
});

test("the aging buckets tile without gaps or overlaps", () => {
  assert.equal(agingBucketOf(0), "0–7 days");
  assert.equal(agingBucketOf(7), "0–7 days");
  assert.equal(agingBucketOf(8), "8–30 days");
  assert.equal(agingBucketOf(30), "8–30 days");
  assert.equal(agingBucketOf(31), "31+ days");
  assert.equal(agingBucketOf(4000), "31+ days");
  // Every bucket the labels declare is reachable, so none is decoration.
  const reached = new Set([0, 7, 8, 30, 31].map(agingBucketOf));
  assert.equal(reached.size, AGING_BUCKETS.length);
});

test("summarising aging keeps every row and every rupee", () => {
  const rows = [
    { days: 2, amountCents: 10_000 },
    { days: 9, amountCents: 25_000 },
    { days: 40, amountCents: 5_000 },
    { days: 65, amountCents: 1_000 },
  ];
  const summary = summariseAging(rows);

  // The guard that matters: buckets are a PARTITION of the list. A row that
  // fell through a gap would quietly shrink the total the owner is chasing.
  assert.equal(summary.totalCents, 41_000);
  assert.equal(summary.count, 4);
  assert.equal(
    summary.buckets.reduce((sum, bucket) => sum + bucket.cents, 0),
    summary.totalCents,
  );
  assert.equal(
    summary.buckets.reduce((sum, bucket) => sum + bucket.count, 0),
    summary.count,
  );
  assert.deepEqual(
    summary.buckets.map((bucket) => bucket.count),
    [1, 1, 2],
  );
});

test("summarising an empty list is zero, not an error", () => {
  const summary = summariseAging([]);
  assert.equal(summary.totalCents, 0);
  assert.equal(summary.count, 0);
  assert.equal(summary.buckets.length, AGING_BUCKETS.length);
});

// ── What the owner reads ────────────────────────────────────────────────────

test("every state has words, and none of them says 'overdue' about a bill with no date", () => {
  for (const state of ["not_due", "due_soon", "overdue", "no_due_date"] as const) {
    assert.equal(typeof OWED_STATE_LABELS[state], "string");
    assert.ok(OWED_STATE_LABELS[state].length > 0);
  }
  assert.ok(!OWED_STATE_LABELS.no_due_date.toLowerCase().includes("overdue"));
  assert.ok(!OWED_STATE_LABELS.no_due_date.toLowerCase().includes("late"));
});

test("an owed row carries everything the list sorts and labels by", () => {
  const row = owedRow(bill({ dueDate: day("2026-08-25") }), NOW);
  assert.ok(row);
  assert.equal(row.state, "overdue");
  assert.equal(row.daysOverdue, 9);
  assert.equal(row.daysOutstanding, 33);
});
