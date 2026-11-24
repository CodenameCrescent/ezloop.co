import test from "node:test";
import assert from "node:assert/strict";
import { ladderRowFigure, ladderRowPresentation } from "./ladderRow";

const money = (value: number) => `Rs ${value.toFixed(2)}`;

/**
 * A result is not an operation.
 *
 * The defect these pin: a losing month printed `− True profit  Rs 600,050.83`,
 * because a negative end borrowed the deduction's colour AND its minus. The
 * colour is right to borrow; the minus belongs on the figure.
 */

test("a losing period signs the figure and leaves the label alone", () => {
  const p = ladderRowPresentation("end", -600_050_83);
  assert.equal(p.fillKind, "deduction", "a loss must not draw in the profit green");
  assert.equal(p.prefix, "", "the bottom rung is a result — it never wears an operator");
  assert.equal(p.signed, true);
  assert.equal(ladderRowFigure(-600_050_83, p.signed, money), "-Rs 60005083.00");
});

test("a profitable period is the green end, unsigned, and still has no operator", () => {
  const p = ladderRowPresentation("end", 1_035_453_06);
  assert.equal(p.fillKind, "end");
  assert.equal(p.prefix, "");
  assert.equal(p.signed, false);
  assert.equal(ladderRowFigure(1_035_453_06, p.signed, money), "Rs 103545306.00");
});

test("an end of exactly zero is not a loss", () => {
  // Break-even is not money lost, so it keeps the neutral end treatment. A
  // `< 0` test rather than `<= 0` is the whole of this, and it is easy to get
  // wrong in the other direction.
  const p = ladderRowPresentation("end", 0);
  assert.equal(p.fillKind, "end");
  assert.equal(p.signed, false);
});

test("deductions and credits keep their operator, and their figures stay unsigned", () => {
  const deduction = ladderRowPresentation("deduction", 667_485_65);
  assert.equal(deduction.prefix, "− ");
  assert.equal(deduction.signed, false);
  assert.equal(ladderRowFigure(667_485_65, deduction.signed, money), "Rs 66748565.00");

  const credit = ladderRowPresentation("credit", 12_000);
  assert.equal(credit.prefix, "+ ");
  assert.equal(credit.signed, false);
});

test("the opening rung carries no operator at all", () => {
  const p = ladderRowPresentation("start", 67_434_82);
  assert.equal(p.prefix, "");
  assert.equal(p.fillKind, "start");
  assert.equal(p.signed, false);
});

test("the formatter only ever sees a positive number", () => {
  // Both pages using this hand in their own formatter — one speaks rupees, one
  // cents — and neither should have to grow a signed variant to be used here.
  let seen: number | null = null;
  ladderRowFigure(-1_917_213, true, (v) => {
    seen = v;
    return String(v);
  });
  assert.equal(seen, 1_917_213);
});
