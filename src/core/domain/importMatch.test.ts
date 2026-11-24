import test from "node:test";
import assert from "node:assert/strict";
import { normalizeHeader, guessMapping, normalizeDescription, duplicateKey, isPayoutLike } from "./importMatch";

test("headers normalize to lowercase words", () => {
  assert.equal(normalizeHeader("  Transaction   Date "), "transaction date");
  assert.equal(normalizeHeader("Money_In"), "money in");
  assert.equal(normalizeHeader("Order #"), "order");
  assert.equal(normalizeHeader("E-mail"), "e mail");
  assert.equal(normalizeHeader("﻿Date"), "date");
});

test("a bank statement's headers are guessed", () => {
  const { mapping } = guessMapping(["Transaction Date", "Details", "Paid In", "Paid Out", "Balance"], "transactions");
  assert.equal(mapping.date, "Transaction Date");
  assert.equal(mapping.description, "Details");
  assert.equal(mapping.moneyIn, "Paid In");
  assert.equal(mapping.moneyOut, "Paid Out");
});

test("unrecognised headers are reported as ignored, not dropped in silence", () => {
  const { ignored } = guessMapping(["Date", "Details", "Amount", "Balance", "Sort Code"], "transactions");
  assert.deepEqual(ignored.sort(), ["Balance", "Sort Code"]);
});

test("our own template matches itself completely", () => {
  const headers = ["Date", "Description", "Amount", "Item", "Quantity", "Category", "Channel", "Person"];
  const { mapping, ignored } = guessMapping(headers, "transactions");
  assert.deepEqual(ignored, []);
  assert.equal(mapping.date, "Date");
  assert.equal(mapping.qty, "Quantity");
});

test("the first matching header wins and the duplicate is ignored", () => {
  // Two columns both called Amount: pick one, name the other, guess nothing.
  const { mapping, ignored } = guessMapping(["Date", "Details", "Amount", "Amount"], "transactions");
  assert.equal(mapping.amount, "Amount");
  assert.deepEqual(ignored, ["Amount"]);
});

test("descriptions normalize for comparison without losing their words", () => {
  assert.equal(normalizeDescription("CARD PAYMENT TO  Acme, Ltd."), "card payment to acme ltd");
  assert.equal(normalizeDescription("Acme  Ltd"), "acme ltd");
});

test("the duplicate key is equal for the same money and different otherwise", () => {
  const a = duplicateKey({ occurredOn: "2026-04-03", amountCents: 4500, direction: "out", description: "FACEBOOK ADS" });
  const b = duplicateKey({ occurredOn: "2026-04-03", amountCents: 4500, direction: "out", description: "Facebook  Ads." });
  const c = duplicateKey({ occurredOn: "2026-04-04", amountCents: 4500, direction: "out", description: "Facebook Ads" });
  const d = duplicateKey({ occurredOn: "2026-04-03", amountCents: 4501, direction: "out", description: "Facebook Ads" });
  assert.equal(a, b, "case and punctuation must not make a new row");
  assert.notEqual(a, c);
  assert.notEqual(a, d);
});

test("a near-miss description is NOT a duplicate", () => {
  // Normalized-equal, never fuzzy: two legitimate same-day charges are common,
  // and a similarity threshold gets that wrong in both directions.
  const a = duplicateKey({ occurredOn: "2026-04-03", amountCents: 4500, direction: "out", description: "Facebook Ads" });
  const b = duplicateKey({ occurredOn: "2026-04-03", amountCents: 4500, direction: "out", description: "Facebook Ads 2" });
  assert.notEqual(a, b);
});

test("payout wording is recognised in the shapes banks actually print", () => {
  for (const text of [
    "STRIPE PAYOUT", "Payout from Shopify", "PAYPAL TRANSFER FROM",
    "SumUp remittance", "Transfer from Etsy",
    // What a bank really prints for a settlement: the processor's legal name.
    "STRIPE PAYMENTS UK LTD", "SHOPIFY PAYMENTS", "SumUp Payments Ltd", "Etsy Deposit",
    // Plurals, punctuation and two-word names survive the fold.
    "STRIPE PAYOUTS", "Etsy deposits", "CHECKOUT.COM SETTLEMENT", "Lemon Squeezy payout",
  ]) {
    assert.equal(isPayoutLike(text), true, text);
  }
});

test("ordinary sales and costs are not mistaken for payouts", () => {
  for (const text of ["Card payment Acme Ltd", "Facebook Ads", "Rent April", "Payment to supplier", "Salary"]) {
    assert.equal(isPayoutLike(text), false, text);
  }
});

test("a payout word alone is not a payout — a real one names who settled it", () => {
  // The damaging direction. "TRANSFER FROM <name>" is how a bank prints a
  // customer paying an invoice, which is how most freelancers are paid; setting
  // that aside means an owner who accepts the default never imports their own
  // income. "Settlement fee" is a property-closing cost, and "Remittance
  // advice" titles a document you send when PAYING a supplier.
  for (const text of [
    "TRANSFER FROM ACME LTD", "Bank transfer from J Smith",
    "Settlement fee", "Settlement agent fee", "Remittance advice",
    "Settlement 2026-04", "payouts", "SETTLEMENT",
    "Transfer from savings account", "Security deposit",
  ]) {
    assert.equal(isPayoutLike(text), false, text);
  }
});

test("a processor named without a payout word is ordinary spending", () => {
  for (const text of [
    "PayPal purchase", "Stripe fee", "SHOPIFY BILLING", "PAYPAL PAYMENT",
    "Amazon order 203-11", "eBay seller fees", "Square hardware",
    // Singular "payment" is the shopping; plural "payments" is the company name.
    "PAYPAL *STEAM PAYMENT", "STRIPE CAPITAL REPAYMENT", "Loan repayments",
  ]) {
    assert.equal(isPayoutLike(text), false, text);
  }
});

test("a processor's name must be a word, not letters hiding inside one", () => {
  // Every one of these carries a payout word AND the letters of a processor
  // ("wise", "square"), and every one of them is a customer or a supplier.
  for (const text of [
    "TRANSFER FROM BITWISE LTD", "TRANSFER FROM OTHERWISE DESIGN",
    "Transfer from Wiseman & Co", "Transfer from Squarespace Ireland",
    "Settlement from Likewise Holdings",
  ]) {
    assert.equal(isPayoutLike(text), false, text);
  }
});

test("bare 'transfer' is not a payout word, even beside a processor", () => {
  // The judgement call, pinned so nobody loosens it by accident. "Transfer" on
  // its own is the ordinary word for a customer paying — and Wise is a rail
  // customers pay over, not only one that settles recorded sales. Any other
  // payout word beside the name still works.
  assert.equal(isPayoutLike("Wise transfer"), false);
  assert.equal(isPayoutLike("Wise settlement"), true);
  assert.equal(isPayoutLike("Wise payout"), true);
});

test("a channel we have never heard of can be named by the caller", () => {
  // Daraz is not in KNOWN_PROCESSORS; a business that sells there says so.
  assert.equal(isPayoutLike("Payout from Daraz"), false);
  assert.equal(isPayoutLike("Payout from Daraz", ["daraz"]), true);
  // The caller's spelling is folded the same way the description is, so a name
  // typed the way a human writes it still matches.
  assert.equal(isPayoutLike("DARAZ SETTLEMENT", ["Daraz"]), true);
  assert.equal(isPayoutLike("Bolt Food deposit", ["Bolt Food"]), true);
  // Still both halves: a named channel with no payout word is just a purchase.
  assert.equal(isPayoutLike("Daraz order 88", ["daraz"]), false);
  // A blank name must not turn into "matches everything".
  assert.equal(isPayoutLike("Payout", ["", "  "]), false);
});
