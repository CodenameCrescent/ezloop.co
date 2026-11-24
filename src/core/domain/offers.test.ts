import test from "node:test";
import assert from "node:assert/strict";
import {
  MIN_OFFERS_FOR_MAP,
  buildPodium,
  buildQuadrantMap,
  offersSentence,
  revenueVsProfitFlip,
  type OfferStat,
} from "./offers";

const money = (c: number) =>
  `Rs ${new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Math.abs(c) / 100)}`;

function offer(over: Partial<OfferStat> & { id: string; name: string }): OfferStat {
  const netRevenueCents = over.netRevenueCents ?? 1_000_00;
  const contributionProfitCents = over.contributionProfitCents ?? 500_00;
  return {
    unitsSold: 10,
    netRevenueCents,
    contributionProfitCents,
    marginPct: netRevenueCents > 0 ? (contributionProfitCents / netRevenueCents) * 100 : null,
    ...over,
  };
}

// ── Podium ───────────────────────────────────────────────────────────────────

test("the podium ranks by PROFIT, not by revenue", () => {
  const items = [
    // Sells the most money, keeps almost none of it.
    offer({ id: "a", name: "Cheap tote", netRevenueCents: 5_000_00, contributionProfitCents: 200_00 }),
    offer({ id: "b", name: "Deep tissue", netRevenueCents: 2_000_00, contributionProfitCents: 1_400_00 }),
    offer({ id: "c", name: "Hot stone", netRevenueCents: 1_000_00, contributionProfitCents: 600_00 }),
  ];

  const podium = buildPodium(items);
  assert.deepEqual(
    podium.entries.map((e) => e.name),
    ["Deep tissue", "Hot stone", "Cheap tote"],
    "the biggest seller comes LAST because it earns least",
  );
});

test("shares are of everything kept, and add up", () => {
  const items = [
    offer({ id: "a", name: "A", contributionProfitCents: 600_00 }),
    offer({ id: "b", name: "B", contributionProfitCents: 300_00 }),
    offer({ id: "c", name: "C", contributionProfitCents: 100_00 }),
  ];
  const podium = buildPodium(items);

  assert.equal(podium.totalContributionCents, 1_000_00);
  assert.deepEqual(podium.entries.map((e) => Math.round(e.sharePct)), [60, 30, 10]);
});

test("a podium of two looks broken, so there is no podium", () => {
  const two = buildPodium([
    offer({ id: "a", name: "A", contributionProfitCents: 100_00 }),
    offer({ id: "b", name: "B", contributionProfitCents: 50_00 }),
  ]);
  assert.equal(two.show, false);
  assert.equal(two.entries.length, 2, "the data is still there for a plain list");

  const three = buildPodium([
    offer({ id: "a", name: "A", contributionProfitCents: 100_00 }),
    offer({ id: "b", name: "B", contributionProfitCents: 50_00 }),
    offer({ id: "c", name: "C", contributionProfitCents: 25_00 }),
  ]);
  assert.equal(three.show, true);
});

test("offers that lose money never reach the podium", () => {
  const podium = buildPodium([
    offer({ id: "a", name: "Good", contributionProfitCents: 100_00 }),
    offer({ id: "b", name: "Losing", contributionProfitCents: -80_00 }),
  ]);
  assert.deepEqual(podium.entries.map((e) => e.name), ["Good"]);
  assert.equal(podium.totalContributionCents, 100_00, "a loss never nets off the total the shares are of");
});

// ── Quadrant map ─────────────────────────────────────────────────────────────

test("the axes split on this business's OWN median, not an invented benchmark", () => {
  // Revenues 100, 200, 400, 1000 → median 300. Margins 10, 20, 60, 80 → median 40.
  const items = [
    offer({ id: "a", name: "A", unitsSold: 5, netRevenueCents: 100_00, contributionProfitCents: 10_00 }),
    offer({ id: "b", name: "B", unitsSold: 5, netRevenueCents: 200_00, contributionProfitCents: 40_00 }),
    offer({ id: "c", name: "C", unitsSold: 5, netRevenueCents: 400_00, contributionProfitCents: 240_00 }),
    offer({ id: "d", name: "D", unitsSold: 5, netRevenueCents: 1_000_00, contributionProfitCents: 800_00 }),
  ];

  const map = buildQuadrantMap(items);
  assert.equal(map.revenueMidpoint, 300_00);
  assert.equal(map.marginMidpoint, 40);

  const q = (id: string) => map.dots.find((d) => d.id === id)!.quadrant;
  assert.equal(q("a"), "dead-weight", "brings in little, keeps little");
  assert.equal(q("b"), "dead-weight");
  assert.equal(q("c"), "winners", "brings in a lot, keeps plenty");
  assert.equal(q("d"), "winners");
});

test("the X axis is MONEY, not units — a few big jobs are not dead weight", () => {
  // Caught on the seed: a web build sold twice at Rs 32,550 each was the single
  // biggest earner in the company and landed in Dead weight, directly under a
  // podium calling it the best thing they sell. Two mugs and two web builds are
  // not the same amount of business.
  const items = [
    offer({ id: "build", name: "Custom web build", unitsSold: 2, netRevenueCents: 65_100_00, contributionProfitCents: 45_000_00 }),
    offer({ id: "mug", name: "Ceramic mug", unitsSold: 78, netRevenueCents: 1_950_00, contributionProfitCents: 300_00 }),
    offer({ id: "sticker", name: "Sticker", unitsSold: 200, netRevenueCents: 400_00, contributionProfitCents: 40_00 }),
  ];
  const map = buildQuadrantMap(items);

  assert.equal(
    map.dots.find((d) => d.id === "build")!.quadrant,
    "winners",
    "the biggest earner in the company cannot be dead weight",
  );
  assert.equal(map.dots.find((d) => d.id === "build")!.revenueCents, 65_100_00);
  assert.equal(map.dots.find((d) => d.id === "build")!.unitsSold, 2, "units still size the dot");
});

test("the trap is found: brings in a lot, keeps little", () => {
  const items = [
    offer({ id: "trap", name: "Busy work", unitsSold: 500, netRevenueCents: 5_000_00, contributionProfitCents: 100_00 }),
    offer({ id: "gem", name: "Quiet earner", unitsSold: 3, netRevenueCents: 300_00, contributionProfitCents: 240_00 }),
    offer({ id: "mid", name: "Middle", unitsSold: 50, netRevenueCents: 500_00, contributionProfitCents: 150_00 }),
  ];
  const map = buildQuadrantMap(items);

  assert.equal(map.dots.find((d) => d.id === "trap")!.quadrant, "traps");
  assert.equal(
    map.dots.find((d) => d.id === "gem")!.quadrant,
    "hidden-gems",
    "brings in little but keeps plenty — worth pushing, and invisible on any revenue ranking",
  );
});

test("offers with NO costs are kept off the map and counted, not plotted at 100%", () => {
  // The partial case is the common one and the more damaging: an uncosted offer
  // reads as a flawless 100% margin, which parks it in Winners on no evidence
  // AND drags the median up so genuinely healthy offers fall below the line.
  const items = [
    offer({ id: "a", name: "Costed A", unitsSold: 10, netRevenueCents: 1_000_00, contributionProfitCents: 700_00 }),
    offer({ id: "b", name: "Costed B", unitsSold: 10, netRevenueCents: 800_00, contributionProfitCents: 500_00 }),
    offer({ id: "c", name: "Costed C", unitsSold: 10, netRevenueCents: 600_00, contributionProfitCents: 300_00 }),
    offer({ id: "free1", name: "Pro plan", unitsSold: 13, netRevenueCents: 500_00, contributionProfitCents: 500_00 }),
    offer({ id: "free2", name: "Team plan", unitsSold: 3, netRevenueCents: 300_00, contributionProfitCents: 300_00 }),
  ];
  const map = buildQuadrantMap(items);

  assert.equal(map.dots.length, 3, "only the costed ones are plotted");
  assert.equal(map.uncostedCount, 2);
  assert.deepEqual(map.uncostedNames.sort(), ["Pro plan", "Team plan"]);
  assert.equal(map.missingCosts, false, "some costs exist, so the map is still worth drawing");

  // The median is taken from the costed three (70%, 62.5%, 50%) → 62.5%,
  // rather than being dragged toward 100% by the two free-looking rows.
  assert.equal(map.marginMidpoint, 62.5);
  assert.equal(map.show, true);
});

test("an offer nobody bought is left OFF the map rather than dumped at the origin", () => {
  const items = [
    offer({ id: "a", name: "A", unitsSold: 10 }),
    offer({ id: "b", name: "B", unitsSold: 20 }),
    offer({ id: "c", name: "C", unitsSold: 30 }),
    offer({ id: "ghost", name: "Never sold", unitsSold: 0, netRevenueCents: 0, contributionProfitCents: 0, marginPct: null }),
  ];
  const map = buildQuadrantMap(items);

  assert.equal(map.dots.length, 3);
  assert.ok(
    !map.dots.some((d) => d.id === "ghost"),
    "plotting it at 0,0 would invent a position and file it under Dead weight on no evidence",
  );
});

test("a business with nothing costed gets told, not shown a map of all winners", () => {
  // Every margin is 100%, so the vertical axis carries no information at all.
  const items = [
    offer({ id: "a", name: "A", unitsSold: 5, netRevenueCents: 100_00, contributionProfitCents: 100_00 }),
    offer({ id: "b", name: "B", unitsSold: 10, netRevenueCents: 200_00, contributionProfitCents: 200_00 }),
    offer({ id: "c", name: "C", unitsSold: 20, netRevenueCents: 300_00, contributionProfitCents: 300_00 }),
  ];
  const map = buildQuadrantMap(items);

  assert.equal(map.missingCosts, true);
  assert.equal(map.show, false, "the highest-value onboarding prompt in the app goes here instead");
});

test("two offers cannot make four quadrants mean anything", () => {
  const map = buildQuadrantMap([
    offer({ id: "a", name: "A", unitsSold: 5, contributionProfitCents: 100_00 }),
    offer({ id: "b", name: "B", unitsSold: 10, contributionProfitCents: 200_00 }),
  ]);
  assert.equal(map.show, false);
  assert.equal(MIN_OFFERS_FOR_MAP, 3);
});

test("a dot carries what it needs to be drawn and tapped", () => {
  const map = buildQuadrantMap([
    offer({ id: "a", name: "A", unitsSold: 5, netRevenueCents: 100_00, contributionProfitCents: 30_00 }),
    offer({ id: "b", name: "B", unitsSold: 10, netRevenueCents: 400_00, contributionProfitCents: 200_00 }),
    offer({ id: "c", name: "C", unitsSold: 20, netRevenueCents: 900_00, contributionProfitCents: 100_00 }),
  ]);
  for (const dot of map.dots) {
    assert.ok(dot.id && dot.name);
    assert.ok(Number.isFinite(dot.revenueCents), "money is the X axis");
    assert.ok(Number.isFinite(dot.marginPct), "margin is the Y axis");
    assert.ok(dot.unitsSold > 0, "units size the dot");
    assert.ok(dot.quadrant);
  }
});

// ── The flip ─────────────────────────────────────────────────────────────────

test("the flip is found when the best seller is not the best earner", () => {
  const flip = revenueVsProfitFlip([
    offer({ id: "a", name: "Cheap tote", netRevenueCents: 5_000_00, contributionProfitCents: 200_00 }),
    offer({ id: "b", name: "Deep tissue", netRevenueCents: 2_000_00, contributionProfitCents: 1_400_00 }),
  ]);

  assert.ok(flip);
  assert.equal(flip.revenueLeader.name, "Cheap tote");
  assert.equal(flip.profitLeader.name, "Deep tissue");
});

test("no flip is reported when the same offer leads both", () => {
  const flip = revenueVsProfitFlip([
    offer({ id: "a", name: "Star", netRevenueCents: 5_000_00, contributionProfitCents: 3_000_00 }),
    offer({ id: "b", name: "Other", netRevenueCents: 1_000_00, contributionProfitCents: 200_00 }),
  ]);
  assert.equal(flip, null, "a surprise that is not a surprise is noise");
});

// ── The sentence ─────────────────────────────────────────────────────────────

test("the sentence leads with the flip, because it is the most useful thing here", () => {
  const items = [
    offer({ id: "a", name: "Cheap tote", netRevenueCents: 5_000_00, contributionProfitCents: 200_00 }),
    offer({ id: "b", name: "Deep tissue", netRevenueCents: 2_000_00, contributionProfitCents: 1_400_00 }),
  ];
  const s = offersSentence(items, buildPodium(items), money);

  assert.match(s, /Cheap tote brings in the most money/);
  assert.match(s, /Deep tissue earns you the most/);
  assert.ok(!s.includes("?"));
});

test("with no flip it names the top earner and its share", () => {
  const items = [
    offer({ id: "a", name: "Star", netRevenueCents: 5_000_00, contributionProfitCents: 3_000_00 }),
    offer({ id: "b", name: "Other", netRevenueCents: 1_000_00, contributionProfitCents: 200_00 }),
  ];
  const s = offersSentence(items, buildPodium(items), money);
  assert.match(s, /Star earns you the most/);
  assert.match(s, /Rs 3,000\.00/);
  assert.match(s, /94%/, "3,000 of 3,200 kept");
});

test("nothing sold says so, rather than reporting an empty ranking", () => {
  const items = [offer({ id: "a", name: "A", unitsSold: 0, netRevenueCents: 0, contributionProfitCents: 0, marginPct: null })];
  assert.match(offersSentence(items, buildPodium(items), money), /Nothing sold in this period/);
});

test("a period where everything lost money is named as one", () => {
  const items = [
    offer({ id: "a", name: "A", unitsSold: 5, netRevenueCents: 100_00, contributionProfitCents: -50_00 }),
    offer({ id: "b", name: "B", unitsSold: 5, netRevenueCents: 100_00, contributionProfitCents: -20_00 }),
  ];
  const s = offersSentence(items, buildPodium(items), money);
  assert.match(s, /Nothing you sold made a profit/);
});
