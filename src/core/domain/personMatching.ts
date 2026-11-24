/**
 * Spotting that someone is already in the books before creating them again.
 *
 * A service business almost always has its clients already: they have been
 * invoiced, so they exist as customers on the ledger. Adding "Acme Corp" as a
 * client must therefore find that Acme, not mint a second one — a duplicate
 * splits their revenue across two records and quietly halves what the client
 * appears to be worth.
 *
 * Two strengths of match, deliberately kept apart:
 *
 *   EXACT   — same email, or the same name once case and punctuation are
 *             ignored. Safe to reuse the record automatically.
 *   SIMILAR — close enough that a human should look. Never reused
 *             automatically; the UI offers it and the owner decides.
 *
 * Auto-merging on a fuzzy match would be worse than a duplicate: joining two
 * genuinely different clients corrupts both their numbers and is far harder to
 * unpick than adding a second row.
 */

/** Common company suffixes, which people write inconsistently and rarely mean. */
const COMPANY_SUFFIXES = [
  "ltd", "limited", "llc", "inc", "incorporated", "corp", "corporation",
  "co", "company", "plc", "gmbh", "pvt", "private", "llp", "lp",
];

/**
 * Reduces a name to what it is really saying: lowercase, no punctuation, single
 * spaces. "Acme Corp." and "acme  corp" both become "acme corp".
 */
export function normalizePersonName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Normalization plus company suffixes removed, so "Acme Ltd" and "Acme" line up.
 * Used ONLY for the similar list — the suffix genuinely distinguishes some
 * businesses, so this is never grounds for reusing a record on its own.
 */
export function normalizeCompanyName(name: string): string {
  const words = normalizePersonName(name).split(" ").filter(Boolean);
  while (words.length > 1 && COMPANY_SUFFIXES.includes(words[words.length - 1])) {
    words.pop();
  }
  return words.join(" ");
}

export interface MatchCandidate {
  id: string;
  displayName: string;
  email: string | null;
}

export type MatchStrength = "exact_email" | "exact_name" | "similar";

export interface PersonMatch<T extends MatchCandidate = MatchCandidate> {
  person: T;
  strength: MatchStrength;
  /** Plain English for the owner — why this row is being shown. */
  reason: string;
}

/** An exact match may be reused without asking; a similar one may not. */
export function isReusable(strength: MatchStrength): boolean {
  return strength === "exact_email" || strength === "exact_name";
}

/**
 * Everyone in `candidates` who might already be this person, strongest first.
 *
 * The caller decides what to do: reuse an exact match, offer a similar one.
 */
export function findPersonMatches<T extends MatchCandidate>(
  input: { name: string; email?: string | null },
  candidates: T[],
): PersonMatch<T>[] {
  const email = input.email?.trim().toLowerCase() || null;
  const exactName = normalizePersonName(input.name);
  const looseName = normalizeCompanyName(input.name);
  if (!exactName && !email) return [];

  const matches: PersonMatch<T>[] = [];
  const taken = new Set<string>();

  for (const person of candidates) {
    if (!email || !person.email) continue;
    if (person.email.trim().toLowerCase() !== email) continue;
    matches.push({ person, strength: "exact_email", reason: "Same email address" });
    taken.add(person.id);
  }

  for (const person of candidates) {
    if (taken.has(person.id)) continue;
    if (!exactName || normalizePersonName(person.displayName) !== exactName) continue;
    matches.push({ person, strength: "exact_name", reason: "Same name" });
    taken.add(person.id);
  }

  for (const person of candidates) {
    if (taken.has(person.id)) continue;
    const candidateLoose = normalizeCompanyName(person.displayName);
    if (!looseName || !candidateLoose) continue;
    // Either is contained in the other: "Acme" vs "Acme Ltd" vs "Acme Design".
    const related = candidateLoose === looseName || candidateLoose.startsWith(`${looseName} `) || looseName.startsWith(`${candidateLoose} `);
    if (!related) continue;
    matches.push({ person, strength: "similar", reason: "Similar name — check this isn't the same one" });
    taken.add(person.id);
  }

  return matches;
}
