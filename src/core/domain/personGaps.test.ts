import test from "node:test";
import assert from "node:assert/strict";
import {
  findPersonGaps,
  PERSON_GAPS,
  PERSON_GAP_COPY,
  type GapEngagement,
  type GapInputs,
  type GapPerson,
  type GapTeamMember,
} from "./personGaps";

function person(over: Partial<GapPerson> & { id: string }): GapPerson {
  return { status: "active", email: "a@b.com", phone: "123", ...over };
}

function inputs(over: Partial<GapInputs> = {}): GapInputs {
  return { people: [], duplicateIds: [], engagements: null, teamMembers: null, ...over };
}

/** Pull one gap's ids out of the result, or undefined when the gap is ABSENT. */
function ids(result: ReturnType<typeof findPersonGaps>, gap: string): string[] | undefined {
  return result.find((r) => r.gap === gap)?.personIds;
}

test("someone in a duplicate group is flagged, on every kind", () => {
  for (const kind of ["customer", "vendor", "employee"] as const) {
    const result = findPersonGaps(kind, inputs({
      people: [person({ id: "p1" }), person({ id: "p2" })],
      duplicateIds: ["p1"],
    }));
    assert.deepEqual(ids(result, "duplicate"), ["p1"], `${kind} should report duplicates`);
  }
});

test("contact is missing only when there is NO way to reach them", () => {
  // One channel is enough. Nagging about a missing email when a phone number
  // is sitting right there is the behaviour this rule exists to prevent.
  const result = findPersonGaps("customer", inputs({
    people: [
      person({ id: "both-missing", email: null, phone: null }),
      person({ id: "has-phone", email: null }),
      person({ id: "has-email", phone: null }),
    ],
  }));
  assert.deepEqual(ids(result, "missing_contact"), ["both-missing"]);
});

test("an employee with no costed rate is flagged; one with a rate is not", () => {
  const teamMembers: GapTeamMember[] = [
    { id: "no-rate", effectiveHourlyCostCents: null },
    { id: "costed", effectiveHourlyCostCents: 250000 },
  ];
  const result = findPersonGaps("employee", inputs({
    people: [person({ id: "no-rate" }), person({ id: "costed" })],
    teamMembers,
  }));
  assert.deepEqual(ids(result, "no_pay_rate"), ["no-rate"]);
});

test("an employee with no team record at all is flagged too", () => {
  // Never set up is at least as bad as set up without a rate: either way their
  // hours cannot be costed.
  const result = findPersonGaps("employee", inputs({
    people: [person({ id: "unknown" })],
    teamMembers: [],
  }));
  assert.deepEqual(ids(result, "no_pay_rate"), ["unknown"]);
});

test("only an ACTIVE engagement can be missing its terms", () => {
  // A finished project with no agreed figure is history. Asking the owner to
  // fix the past is noise.
  const engagements: GapEngagement[] = [
    { personId: "live-blank", engagementStatus: "active", agreedAmountCents: null, agreedHours: null },
    { personId: "done-blank", engagementStatus: "completed", agreedAmountCents: null, agreedHours: null },
    { personId: "left-blank", engagementStatus: "churned", agreedAmountCents: null, agreedHours: null },
  ];
  const result = findPersonGaps("customer", inputs({
    people: [person({ id: "live-blank" }), person({ id: "done-blank" }), person({ id: "left-blank" })],
    engagements,
  }));
  assert.deepEqual(ids(result, "no_agreed_terms"), ["live-blank"]);
});

test("either agreed figure is enough to count as terms", () => {
  const engagements: GapEngagement[] = [
    { personId: "has-amount", engagementStatus: "active", agreedAmountCents: 500000, agreedHours: null },
    { personId: "has-hours", engagementStatus: "active", agreedAmountCents: null, agreedHours: "40" },
  ];
  const result = findPersonGaps("customer", inputs({
    people: [person({ id: "has-amount" }), person({ id: "has-hours" })],
    engagements,
  }));
  assert.deepEqual(ids(result, "no_agreed_terms"), []);
});

test("a customer who was never a client is not missing terms", () => {
  // Plenty of customers are only ever customers.
  const result = findPersonGaps("customer", inputs({
    people: [person({ id: "just-a-buyer" })],
    engagements: [],
  }));
  assert.deepEqual(ids(result, "no_agreed_terms"), []);
});

test("archived people are excluded from every gap", () => {
  const result = findPersonGaps("customer", inputs({
    people: [person({ id: "gone", status: "archived", email: null, phone: null })],
    duplicateIds: ["gone"],
    engagements: [
      { personId: "gone", engagementStatus: "active", agreedAmountCents: null, agreedHours: null },
    ],
  }));
  for (const gap of PERSON_GAPS) {
    assert.deepEqual(ids(result, gap) ?? [], [], `${gap} must not count an archived person`);
  }
});

test("a gap that could not be evaluated is ABSENT, not zero", () => {
  // The feature is off, so the app never looked. Reporting 0 would be a claim.
  const result = findPersonGaps("employee", inputs({
    people: [person({ id: "p1" })],
    teamMembers: null,
  }));
  assert.equal(ids(result, "no_pay_rate"), undefined);
  assert.deepEqual(ids(result, "missing_contact"), []);
});

test("a gap that WAS evaluated and found nothing is present and empty", () => {
  const result = findPersonGaps("employee", inputs({
    people: [person({ id: "p1" })],
    teamMembers: [{ id: "p1", effectiveHourlyCostCents: 100 }],
  }));
  assert.deepEqual(ids(result, "no_pay_rate"), []);
});

test("gaps that do not apply to a kind are absent", () => {
  // Vendors have no pay rate and no engagement, even with both lists loaded.
  const result = findPersonGaps("vendor", inputs({
    people: [person({ id: "v1" })],
    engagements: [],
    teamMembers: [],
  }));
  assert.equal(ids(result, "no_pay_rate"), undefined);
  assert.equal(ids(result, "no_agreed_terms"), undefined);
  assert.deepEqual(ids(result, "duplicate"), []);
  assert.deepEqual(ids(result, "missing_contact"), []);
});

test("results come back in severity order, worst first", () => {
  const result = findPersonGaps("customer", inputs({
    people: [person({ id: "p1", email: null, phone: null })],
    duplicateIds: ["p1"],
    engagements: [
      { personId: "p1", engagementStatus: "active", agreedAmountCents: null, agreedHours: null },
    ],
  }));
  assert.deepEqual(result.map((r) => r.gap), ["duplicate", "no_agreed_terms", "missing_contact"]);
});

test("every gap has copy, and the consequence never restates the count", () => {
  for (const gap of PERSON_GAPS) {
    const copy = PERSON_GAP_COPY[gap];
    assert.ok(copy.label.length > 0, `${gap} needs a label`);
    assert.ok(copy.consequence.length > 0, `${gap} needs a consequence`);
    assert.ok(!/\d/.test(copy.consequence), `${gap}'s consequence must not carry a number`);
    // checkName is the same check named positively (for the all-clear line,
    // which cannot lowercase `label` without reading like a list of faults).
    assert.ok(copy.checkName.length > 0, `${gap} needs a checkName`);
    assert.ok(!/\d/.test(copy.checkName), `${gap}'s checkName must not carry a number`);
  }
});
