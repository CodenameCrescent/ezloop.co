import test from "node:test";
import assert from "node:assert/strict";
import {
  findPersonMatches,
  isReusable,
  normalizeCompanyName,
  normalizePersonName,
  type MatchCandidate,
} from "./personMatching";

/** A ledger that already knows Acme, because they have been invoiced. */
const existing: MatchCandidate[] = [
  { id: "p1", displayName: "Acme Corp", email: "billing@acme.com" },
  { id: "p2", displayName: "Beta Studio", email: null },
  { id: "p3", displayName: "Gamma", email: "hi@gamma.io" },
];

test("a client already on the ledger is found, not duplicated", () => {
  // The case this module exists for: an agency invoiced Acme, so Acme is
  // already a customer. Adding them as a client must land on that record.
  const [match] = findPersonMatches({ name: "Acme Corp" }, existing);
  assert.equal(match.person.id, "p1");
  assert.equal(match.strength, "exact_name");
  assert.equal(isReusable(match.strength), true);
});

test("case and punctuation do not make a new person", () => {
  for (const written of ["ACME CORP", "acme  corp", "Acme Corp.", " Acme, Corp "]) {
    const [match] = findPersonMatches({ name: written }, existing);
    assert.equal(match?.person.id, "p1", `"${written}" should find Acme`);
    assert.equal(isReusable(match.strength), true);
  }
});

test("email wins over name, and outranks it", () => {
  // Renamed in one place but the same billing address — still the same client.
  const matches = findPersonMatches({ name: "Acme Corporation Group", email: "billing@acme.com" }, existing);
  assert.equal(matches[0].person.id, "p1");
  assert.equal(matches[0].strength, "exact_email");
  // And it appears once, not twice under two reasons.
  assert.equal(matches.filter((m) => m.person.id === "p1").length, 1);
});

test("a company suffix difference is SIMILAR, never an automatic reuse", () => {
  // "Acme" and "Acme Corp" are probably the same, but "probably" is not good
  // enough to merge on: joining two different clients corrupts both their
  // numbers and is far harder to undo than a duplicate row.
  const [match] = findPersonMatches({ name: "Acme Ltd" }, existing);
  assert.equal(match.person.id, "p1");
  assert.equal(match.strength, "similar");
  assert.equal(isReusable("similar"), false);
});

test("a genuinely new client matches nothing", () => {
  assert.deepEqual(findPersonMatches({ name: "Delta Works" }, existing), []);
  assert.deepEqual(findPersonMatches({ name: "Zeta", email: "new@zeta.com" }, existing), []);
});

test("a shorter form of an existing name is flagged for a human", () => {
  // "Beta" is plausibly the same as "Beta Studio", so it is offered.
  const matches = findPersonMatches({ name: "Beta" }, existing);
  assert.equal(matches[0].person.id, "p2");
  assert.equal(matches[0].strength, "similar");
  assert.match(matches[0].reason, /check/i);
});

test("a shared first word alone is NOT a match — they are different companies", () => {
  // "Beta Studio" and "Beta Consulting" share a word and nothing else. Flagging
  // every such pair would bury the real duplicates in noise, so the rule is
  // containment, not word overlap.
  assert.deepEqual(findPersonMatches({ name: "Beta Consulting" }, existing), []);
});

test("empty input matches nothing rather than everything", () => {
  assert.deepEqual(findPersonMatches({ name: "" }, existing), []);
  assert.deepEqual(findPersonMatches({ name: "   ", email: "  " }, existing), []);
});

test("normalization rules", () => {
  assert.equal(normalizePersonName("  Acme,  Corp. "), "acme corp");
  assert.equal(normalizePersonName("O'Brien & Sons"), "o brien sons");
  // Suffix stripping is only for the loose comparison.
  assert.equal(normalizeCompanyName("Acme Corp"), "acme");
  assert.equal(normalizeCompanyName("Acme Ltd"), "acme");
  assert.equal(normalizeCompanyName("Acme"), "acme");
  // A name that is ONLY a suffix keeps it, rather than becoming empty.
  assert.equal(normalizeCompanyName("Ltd"), "ltd");
});

test("every match carries a reason the owner can read", () => {
  const matches = findPersonMatches({ name: "Acme", email: "hi@gamma.io" }, existing);
  assert.ok(matches.length > 0);
  for (const m of matches) {
    assert.ok(m.reason.length > 0);
    assert.ok(!m.reason.includes("_"), `"${m.reason}" leaks an enum key`);
  }
});

/**
 * The archived-person notice on Quick Add claims a sale WILL land on that
 * record, so it fires only on matches the server actually reuses. The server
 * resolves by exact email, then exact name, then creates — which is exactly
 * `isReusable`. A loose match must not qualify, or the notice promises a
 * reattach that never happens.
 */
test("only exact matches count as 'this will reattach'", () => {
  const archived = [
    { id: "p1", displayName: "Acme Corp", email: "hello@acme.test" },
    { id: "p2", displayName: "Bright Studio Ltd", email: null },
  ];

  const exactName = findPersonMatches({ name: "acme corp" }, archived).filter((m) => isReusable(m.strength));
  assert.equal(exactName.length, 1);
  assert.equal(exactName[0].person.id, "p1");

  const exactEmail = findPersonMatches({ name: "Totally Different", email: "HELLO@ACME.TEST" }, archived).filter((m) =>
    isReusable(m.strength),
  );
  assert.equal(exactEmail.length, 1, "email wins regardless of the typed name");
  assert.equal(exactEmail[0].person.id, "p1");

  // Close enough to be worth showing an owner, not close enough to reattach.
  const loose = findPersonMatches({ name: "Bright Studio" }, archived);
  assert.ok(loose.length > 0, "a loose match is still worth surfacing");
  assert.equal(loose.filter((m) => isReusable(m.strength)).length, 0, "but it must not claim a reattach");
});
