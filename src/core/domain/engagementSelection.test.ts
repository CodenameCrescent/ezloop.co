import test from "node:test";
import assert from "node:assert/strict";
import { selectEngagementForPeriod, type EngagementCandidate } from "./engagementSelection";

const engagement = (over: Partial<EngagementCandidate> = {}): EngagementCandidate => ({
  id: "eng_1",
  engagementStatus: "active",
  startDate: null,
  endDate: null,
  createdAt: "2060-01-01T00:00:00.000Z",
  ...over,
});

const JULY = ["2060-07-01", "2060-07-31"] as const;

test("a FINISHED client's agreement is still found — the bug this exists to fix", () => {
  // Marking a client Finished used to erase their scope-creep record. The
  // overrun really happened; the hours still count everywhere else.
  const finished = engagement({ id: "eng_done", engagementStatus: "completed" });
  assert.equal(selectEngagementForPeriod([finished], ...JULY)?.id, "eng_done");

  // Left, too — the other way an arrangement ends.
  const left = engagement({ id: "eng_left", engagementStatus: "churned" });
  assert.equal(selectEngagementForPeriod([left], ...JULY)?.id, "eng_left");
});

test("an engagement with no dates is open at both ends, so it always overlaps", () => {
  // The common case: the dialog never sets dates.
  const undated = engagement();
  assert.ok(selectEngagementForPeriod([undated], ...JULY));
  assert.ok(selectEngagementForPeriod([undated], null, null), "and an unbounded window too");
  assert.ok(selectEngagementForPeriod([undated], "2020-01-01", "2020-01-02"));
});

test("an agreement that ended before the window is not used", () => {
  // Measuring July's hours against an agreement that finished in March is a
  // comparison the owner never made.
  const old = engagement({ startDate: "2060-01-01", endDate: "2060-03-31" });
  assert.equal(selectEngagementForPeriod([old], ...JULY), null);

  // And one that starts after it.
  const future = engagement({ startDate: "2060-09-01", endDate: null });
  assert.equal(selectEngagementForPeriod([future], ...JULY), null);

  // Touching by a single day still counts as overlapping.
  const grazes = engagement({ startDate: "2060-07-31", endDate: "2060-12-31" });
  assert.ok(selectEngagementForPeriod([grazes], ...JULY));
});

test("the agreement covering more of the window wins, live or not", () => {
  const wholeMonth = engagement({ id: "whole", engagementStatus: "completed", startDate: "2060-06-01", endDate: "2060-08-31" });
  const fortnight = engagement({ id: "part", engagementStatus: "active", startDate: "2060-07-20", endDate: "2060-07-31" });

  assert.equal(
    selectEngagementForPeriod([fortnight, wholeMonth], ...JULY)?.id,
    "whole",
    "more overlap beats being the live one",
  );
});

test("on equal overlap the live arrangement wins", () => {
  const finished = engagement({ id: "old", engagementStatus: "completed" });
  const live = engagement({ id: "live", engagementStatus: "active" });
  assert.equal(selectEngagementForPeriod([finished, live], ...JULY)?.id, "live");
  assert.equal(selectEngagementForPeriod([live, finished], ...JULY)?.id, "live", "whatever order they arrive in");
});

test("two finished arrangements resolve the same way every time", () => {
  // Without a total order the answer would depend on the order Postgres
  // happened to return rows in, and the same report would differ day to day.
  const a = engagement({ id: "eng_a", engagementStatus: "completed", createdAt: "2060-02-01T00:00:00.000Z" });
  const b = engagement({ id: "eng_b", engagementStatus: "completed", createdAt: "2060-05-01T00:00:00.000Z" });

  const forwards = selectEngagementForPeriod([a, b], ...JULY)?.id;
  const backwards = selectEngagementForPeriod([b, a], ...JULY)?.id;
  assert.equal(forwards, backwards);
  assert.equal(forwards, "eng_b", "the more recent one");

  // Identical creation times fall through to the id, still deterministic.
  const c = engagement({ id: "eng_c", engagementStatus: "completed" });
  const d = engagement({ id: "eng_d", engagementStatus: "completed" });
  assert.equal(selectEngagementForPeriod([c, d], ...JULY)?.id, selectEngagementForPeriod([d, c], ...JULY)?.id);
});

test("a later start beats an earlier one when the overlap matches", () => {
  const older = engagement({ id: "older", engagementStatus: "completed", startDate: "2060-01-01" });
  const newer = engagement({ id: "newer", engagementStatus: "completed", startDate: "2060-06-01" });
  assert.equal(selectEngagementForPeriod([older, newer], ...JULY)?.id, "newer");
});

test("the real agency path: a project, then a retainer", () => {
  // The project ran to June, the retainer started in July. Looking at July
  // should find the retainer; looking at May should find the project.
  const project = engagement({ id: "project", engagementStatus: "completed", startDate: "2060-01-01", endDate: "2060-06-30" });
  const retainer = engagement({ id: "retainer", engagementStatus: "active", startDate: "2060-07-01", endDate: null });
  const both = [project, retainer];

  assert.equal(selectEngagementForPeriod(both, ...JULY)?.id, "retainer");
  assert.equal(selectEngagementForPeriod(both, "2060-05-01", "2060-05-31")?.id, "project");
});

test("nothing to pick from is null, not a throw", () => {
  assert.equal(selectEngagementForPeriod([], ...JULY), null);
  assert.equal(selectEngagementForPeriod([], null, null), null);
});

test("a nonsense date on an engagement is treated as open rather than dropping it", () => {
  // Better to measure against an agreement with one bad date than to lose the
  // client's overrun because a date failed to parse.
  const odd = engagement({ startDate: "not-a-date", endDate: null });
  assert.ok(selectEngagementForPeriod([odd], ...JULY));
});
