import test from "node:test";
import assert from "node:assert/strict";
import {
  DENSITY_CAP,
  MAX_HEADLINE_WORDS,
  dedupeBySubject,
  defineRule,
  evaluateRules,
  headlineIsWithinCap,
  leaksOnly,
  rankInsights,
  totalLeakCents,
  type Insight,
  type InsightFacts,
} from "./rules";

/** Minimal card — only the fields ranking actually reads. */
function card(overrides: Partial<Insight> & { id: string; impactCents: number }): Insight {
  return {
    headline: "Something happened",
    cause: "Because of a number.",
    explain: { threshold: "t", comparisonPeriod: "p", inputs: [] },
    severity: "normal",
    subject: overrides.id,
    page: "money",
    ...overrides,
  };
}

const facts = { businessType: "ecommerce" } as InsightFacts;

test("a rule that cannot price itself produces no card", () => {
  const broken = defineRule({
    id: "broken",
    page: "money",
    evaluate: () => card({ id: "broken", impactCents: Number.NaN }),
  });
  assert.equal(broken.evaluate(facts), null, "NaN is not a money figure");

  const infinite = defineRule({
    id: "infinite",
    page: "money",
    evaluate: () => card({ id: "infinite", impactCents: Number.POSITIVE_INFINITY }),
  });
  assert.equal(infinite.evaluate(facts), null);

  // Zero IS a figure — the genuinely informational card.
  const zero = defineRule({
    id: "zero",
    page: "money",
    evaluate: () => card({ id: "zero", impactCents: 0 }),
  });
  assert.ok(zero.evaluate(facts));
});

test("rules that do not apply to this business type never run", () => {
  const serviceOnly = defineRule({
    id: "service-only",
    page: "people",
    businessTypes: ["service"],
    evaluate: () => card({ id: "service-only", impactCents: -100 }),
  });
  const everyone = defineRule({
    id: "everyone",
    page: "money",
    evaluate: () => card({ id: "everyone", impactCents: -50 }),
  });

  const forShop = evaluateRules([serviceOnly, everyone], { businessType: "ecommerce" } as InsightFacts);
  assert.deepEqual(forShop.map((i) => i.id), ["everyone"]);

  const forAgency = evaluateRules([serviceOnly, everyone], { businessType: "service" } as InsightFacts);
  assert.deepEqual(forAgency.map((i) => i.id), ["service-only", "everyone"]);
});

test("ranking is by absolute money, so a big loss and a big win both rise", () => {
  const ranked = rankInsights([
    card({ id: "small-loss", impactCents: -10_00 }),
    card({ id: "big-win", impactCents: 900_00 }),
    card({ id: "big-loss", impactCents: -2_000_00 }),
  ]);
  assert.deepEqual(ranked.map((i) => i.id), ["big-loss", "big-win", "small-loss"]);
});

test("percentages never rank — a 90% jump in a tiny fee stays at the bottom", () => {
  // The Rs 12 fee doubled; the Rs 2,000 leak did not move at all. Money wins.
  const ranked = rankInsights([
    card({ id: "tiny-fee-doubled", impactCents: -12_00 }),
    card({ id: "quiet-big-leak", impactCents: -2_000_00 }),
  ]);
  assert.equal(ranked[0].id, "quiet-big-leak");
});

test("urgency beats size", () => {
  const ranked = rankInsights([
    card({ id: "huge", impactCents: -50_000_00 }),
    card({ id: "runway", impactCents: -400_00, urgent: true }),
  ]);
  assert.equal(ranked[0].id, "runway", "running out of cash outranks a bigger number");
});

test("one card per subject: the biggest speaks for the rest", () => {
  const ranked = rankInsights([
    card({ id: "meta-a", impactCents: -100_00, subject: "ads" }),
    card({ id: "meta-b", impactCents: -600_00, subject: "ads" }),
    card({ id: "meta-c", impactCents: -50_00, subject: "ads" }),
    card({ id: "refunds", impactCents: -80_00, subject: "refunds" }),
  ]);

  assert.equal(ranked.length, 2, "three ads cards collapsed into one");
  assert.equal(ranked[0].id, "meta-b", "the biggest one survives");
  assert.deepEqual(ranked[0].related, { count: 2, subject: "ads" });
  assert.equal(ranked[1].related, undefined, "a lone card has nothing rolled into it");
});

test("the feed caps at five", () => {
  const many = Array.from({ length: 9 }, (_, i) =>
    card({ id: `r${i}`, impactCents: -(i + 1) * 100_00, subject: `s${i}` }),
  );
  assert.equal(rankInsights(many).length, DENSITY_CAP);
  assert.equal(DENSITY_CAP, 5);
});

test("slot 5 is reserved for a win when the feed is otherwise all bad news", () => {
  const insights = [
    ...Array.from({ length: 6 }, (_, i) =>
      card({ id: `loss${i}`, impactCents: -(600_00 - i * 10_00), subject: `s${i}` }),
    ),
    card({ id: "the-win", impactCents: 25_00, subject: "win" }),
  ];

  const ranked = rankInsights(insights);
  assert.equal(ranked.length, 5);
  assert.equal(ranked[4].id, "the-win", "the smallest visible loss gives up its slot");
  assert.ok(ranked.slice(0, 4).every((i) => i.impactCents < 0));
});

test("a win already on screen does not get a second slot", () => {
  const insights = [
    card({ id: "big-win", impactCents: 900_00, subject: "w1" }),
    ...Array.from({ length: 6 }, (_, i) =>
      card({ id: `loss${i}`, impactCents: -(500_00 - i * 10_00), subject: `s${i}` }),
    ),
    card({ id: "small-win", impactCents: 5_00, subject: "w2" }),
  ];

  const ranked = rankInsights(insights);
  assert.ok(ranked.some((i) => i.id === "big-win"));
  assert.ok(!ranked.some((i) => i.id === "small-win"), "the reserve only fires when there is no win visible");
});

test("nothing is promoted into slot 5 when there is no win to promote", () => {
  const allBad = Array.from({ length: 8 }, (_, i) =>
    card({ id: `loss${i}`, impactCents: -(800_00 - i * 10_00), subject: `s${i}` }),
  );
  const ranked = rankInsights(allBad);
  assert.equal(ranked.length, 5);
  assert.ok(ranked.every((i) => i.impactCents < 0), "a genuinely bad month is reported as one");
});

test("the leaks view is losses only, worst first, and uncapped", () => {
  const insights = [
    card({ id: "win", impactCents: 500_00, subject: "w" }),
    ...Array.from({ length: 7 }, (_, i) =>
      card({ id: `loss${i}`, impactCents: -(i + 1) * 100_00, subject: `s${i}` }),
    ),
  ];

  const leaks = leaksOnly(insights);
  assert.equal(leaks.length, 7, "the toggle shows the full bill, not the top five");
  assert.ok(leaks.every((i) => i.impactCents < 0));
  assert.equal(leaks[0].id, "loss6", "worst first");
});

test("the leak total is a positive sum of the losses", () => {
  const insights = [
    card({ id: "a", impactCents: -620_00, subject: "a" }),
    card({ id: "b", impactCents: -400_00, subject: "b" }),
    card({ id: "c", impactCents: -220_00, subject: "c" }),
    card({ id: "win", impactCents: 999_00, subject: "w" }),
  ];
  assert.equal(totalLeakCents(insights), 1_240_00, "wins never net off the leak total");
});

test("the leak total counts each subject once", () => {
  const insights = [
    card({ id: "meta-a", impactCents: -600_00, subject: "ads" }),
    card({ id: "meta-b", impactCents: -100_00, subject: "ads" }),
  ];
  assert.equal(totalLeakCents(insights), 600_00, "the rolled-up siblings are not double-counted");
});

test("an urgent card is never swallowed by a bigger card on the same subject", () => {
  // Both are about profit. The milder one carries the larger figure, so a
  // size-only dedupe handed it the subject and "you are losing money" was
  // demoted to a "+1 more" line nobody reads.
  const ranked = rankInsights([
    card({ id: "sold-more-kept-less", impactCents: -340_00, subject: "profit" }),
    card({ id: "running-at-a-loss", impactCents: -220_00, subject: "profit", urgent: true }),
  ]);

  assert.equal(ranked.length, 1);
  assert.equal(ranked[0].id, "running-at-a-loss", "the urgent one speaks for the subject");
  assert.deepEqual(ranked[0].related, { count: 1, subject: "profit" });
});

test("a win never hides a warning about the same thing, however big the win", () => {
  // Found live: "Ceramic bowl earns you the most" (+Rs 2,400) swallowed
  // "Ceramic bowl costs more than it did" (−Rs 1,200), because the win was
  // bigger. Nobody can act on the compliment; they can act on the warning.
  const ranked = rankInsights([
    card({ id: "best-offer", impactCents: 240_00, subject: "offer:Ceramic bowl" }),
    card({ id: "price-staleness", impactCents: -120_00, subject: "offer:Ceramic bowl" }),
  ]);

  assert.equal(ranked.length, 1);
  assert.equal(ranked[0].id, "price-staleness");
  assert.deepEqual(ranked[0].related, { count: 1, subject: "offer:Ceramic bowl" });
});

test("between two warnings about one subject, the bigger one still speaks", () => {
  const ranked = rankInsights([
    card({ id: "small-loss", impactCents: -10_00, subject: "offer:Mug" }),
    card({ id: "big-loss", impactCents: -90_00, subject: "offer:Mug" }),
  ]);
  assert.equal(ranked[0].id, "big-loss");
});

test("dedupe keeps the larger card regardless of the order they arrived in", () => {
  const forwards = dedupeBySubject([
    card({ id: "small", impactCents: -10_00, subject: "x" }),
    card({ id: "large", impactCents: -90_00, subject: "x" }),
  ]);
  const backwards = dedupeBySubject([
    card({ id: "large", impactCents: -90_00, subject: "x" }),
    card({ id: "small", impactCents: -10_00, subject: "x" }),
  ]);
  assert.equal(forwards[0].id, "large");
  assert.equal(backwards[0].id, "large");
});

test("the eight-word headline cap is a checkable rule, not a convention", () => {
  assert.equal(MAX_HEADLINE_WORDS, 8);
  assert.ok(headlineIsWithinCap("You are losing money this period"));
  assert.ok(headlineIsWithinCap("One two three four five six seven eight"));
  assert.ok(!headlineIsWithinCap("One two three four five six seven eight nine"));
});
