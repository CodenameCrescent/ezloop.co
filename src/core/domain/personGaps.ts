/**
 * What is wrong with a person's record, and what that costs elsewhere.
 *
 * People is a workbench page, and the workbench is where records are kept
 * straight — "which client is worth having" is answered by Worth having, and
 * the concentration bar by Insights. So this module answers the narrower
 * question nobody else asks: what is missing here, and which number does it
 * quietly break?
 *
 * That framing is the point. A missing pay rate raises no error; it produces a
 * Worth having page that leaves an employee's work out of every total. The gap
 * and its consequence therefore travel together, because a count on its own is
 * nagging.
 *
 * Input types are declared structurally rather than imported from the API
 * contract: `lib/domain` stays pure (CLAUDE.md), so callers map their own
 * shapes in — the same arrangement `personMatching.ts` uses.
 */

/** Severity order: what it costs you, worst first. The page renders as given. */
export const PERSON_GAPS = [
  "duplicate",
  "no_pay_rate",
  "no_agreed_terms",
  "missing_contact",
] as const;
export type PersonGap = (typeof PERSON_GAPS)[number];

export type GapPersonKind = "customer" | "vendor" | "employee" | "other";

export interface GapPerson {
  id: string;
  status: "active" | "archived";
  email: string | null;
  phone: string | null;
}

export interface GapEngagement {
  personId: string;
  engagementStatus: "active" | "completed" | "churned";
  agreedAmountCents: number | null;
  agreedHours: string | null;
}

export interface GapTeamMember {
  id: string;
  effectiveHourlyCostCents: number | null;
}

export interface GapInputs {
  people: GapPerson[];
  /** Ids appearing in any duplicate group the server reported. */
  duplicateIds: Iterable<string>;
  /** null means NOT LOOKED — the client-profitability feature is off. */
  engagements: GapEngagement[] | null;
  /** null means NOT LOOKED. */
  teamMembers: GapTeamMember[] | null;
}

export interface PersonGapResult {
  gap: PersonGap;
  personIds: string[];
}

/**
 * The sentence under each count. No numbers in the consequence — the tile
 * already carries the count, and repeating it there is how copy starts
 * disagreeing with the figure beside it.
 *
 * `checkName` is the same check named positively rather than as a fault — the
 * noun phrase that fits after "I checked for". It exists because the all-clear
 * line (GapStrip) has to name exactly the checks that ran without reading like
 * a list of problems, and `label` ("Possible duplicates") is written to sit
 * over a count, not to be lowercased into a sentence.
 */
export const PERSON_GAP_COPY: Record<PersonGap, { label: string; consequence: string; checkName: string }> = {
  duplicate: {
    label: "Possible duplicates",
    consequence: "One person on two rows splits their lifetime value, so both look smaller than they are.",
    checkName: "duplicates",
  },
  no_pay_rate: {
    label: "No pay recorded",
    consequence: "Their hours cannot be costed, so Worth having leaves them out of every total.",
    checkName: "missing pay rates",
  },
  no_agreed_terms: {
    label: "No agreed terms",
    consequence: "Nothing agreed to measure the work against, so overruns and underpricing go unspotted.",
    checkName: "missing agreed terms",
  },
  missing_contact: {
    label: "No way to reach them",
    consequence: "Nothing else breaks — the record is just thinner than it could be.",
    checkName: "missing contact details",
  },
};

/** Which gaps this kind can have, given what was actually loaded. */
function applies(gap: PersonGap, kind: GapPersonKind, inputs: GapInputs): boolean {
  switch (gap) {
    case "duplicate":
    case "missing_contact":
      return true;
    case "no_pay_rate":
      return kind === "employee" && inputs.teamMembers !== null;
    case "no_agreed_terms":
      return kind === "customer" && inputs.engagements !== null;
  }
}

export function findPersonGaps(kind: GapPersonKind, inputs: GapInputs): PersonGapResult[] {
  // Archived first and once: an archived record is not one the owner needs to
  // fix, and counting it makes a tile that finds nothing when clicked.
  const active = inputs.people.filter((p) => p.status === "active");
  const duplicates = new Set(inputs.duplicateIds);

  const costedIds = new Set(
    (inputs.teamMembers ?? [])
      .filter((m) => m.effectiveHourlyCostCents != null)
      .map((m) => m.id),
  );

  // Only ACTIVE engagements, and only those with neither agreed figure.
  const blankTermIds = new Set(
    (inputs.engagements ?? [])
      .filter(
        (e) =>
          e.engagementStatus === "active" &&
          e.agreedAmountCents == null &&
          (e.agreedHours == null || e.agreedHours === ""),
      )
      .map((e) => e.personId),
  );

  const matches: Record<PersonGap, (p: GapPerson) => boolean> = {
    duplicate: (p) => duplicates.has(p.id),
    // Never set up is at least as bad as set up without a rate: either way
    // their hours cannot be costed.
    no_pay_rate: (p) => !costedIds.has(p.id),
    no_agreed_terms: (p) => blankTermIds.has(p.id),
    missing_contact: (p) => p.email == null && p.phone == null,
  };

  return PERSON_GAPS.filter((gap) => applies(gap, kind, inputs)).map((gap) => ({
    gap,
    personIds: active.filter(matches[gap]).map((p) => p.id),
  }));
}
