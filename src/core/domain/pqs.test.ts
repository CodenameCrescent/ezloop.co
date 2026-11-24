import test from "node:test";
import assert from "node:assert/strict";
import { computeBaseline } from "./baseline";
import {
  MIN_DAYS_FOR_SCORE,
  PILLAR_WEIGHTS,
  biggestLever,
  computePqs,
  scoreConcentration,
  scoreMargin,
  scoreTrend,
  verdictSentence,
  type PqsInput,
} from "./pqs";

const money = (c: number) => `Rs ${(Math.abs(c) / 100).toFixed(2)}`;

/** Six steady months, so the trend pillar has a normal to work from. */
const STEADY = computeBaseline([200_00, 210_00, 190_00, 205_00, 195_00, 200_00], { floor: 10_00 });

function input(over: Partial<PqsInput> = {}): PqsInput {
  return {
    trueProfitCents: 200_00,
    netRevenueCents: 1_000_00,
    topCustomerSharePct: 10,
    topCustomerLabel: "Acme",
    topOfferSharePct: 15,
    topOfferLabel: "Ceramic mug",
    trueProfitBaseline: STEADY,
    daysOfActivity: 90,
    money,
    ...over,
  };
}

const pillar = (pqs: ReturnType<typeof computePqs>, id: string) =>
  pqs.pillars.find((p) => p.id === id)!;

// ── The individual scales ────────────────────────────────────────────────────

test("margin scores on the stated scale and nowhere else", () => {
  assert.equal(scoreMargin(0, 1_000_00), 0, "keeping nothing scores nothing");
  assert.equal(scoreMargin(-500_00, 1_000_00), 0, "a loss cannot score below zero");
  assert.equal(scoreMargin(150_00, 1_000_00), 50, "15% is halfway to the 30% top");
  assert.equal(scoreMargin(300_00, 1_000_00), 100);
  assert.equal(scoreMargin(600_00, 1_000_00), 100, "60% does not score 200");
});

test("margin is ABSENT with no sales, not zero", () => {
  assert.equal(
    scoreMargin(0, 0),
    null,
    "no sales means no margin health — scoring it 0 would blame the business for a gap in the data",
  );
});

test("concentration scores the spread, and a single client scores zero", () => {
  assert.equal(scoreConcentration(5), 100, "a wide spread is a full score");
  assert.equal(scoreConcentration(20), 100, "20% is still healthy");
  assert.equal(scoreConcentration(40), 50);
  assert.equal(scoreConcentration(60), 0);
  assert.equal(scoreConcentration(100), 0, "everything from one name is the worst case");
  assert.equal(scoreConcentration(null), null);
});

test("trend measures a business against ITSELF, not against a fixed idea of good", () => {
  // Normal 200, deviation 10.
  assert.equal(scoreTrend(200_00, STEADY), 50, "at your own normal is the midpoint");
  assert.equal(scoreTrend(210_00, STEADY), 75, "one typical swing better");
  assert.equal(scoreTrend(220_00, STEADY), 100, "two swings better tops out");
  assert.equal(scoreTrend(190_00, STEADY), 25);
  assert.equal(scoreTrend(180_00, STEADY), 0);
  assert.equal(scoreTrend(50_00, STEADY), 0, "and cannot go below zero however bad");
});

test("trend is absent without a normal — two data points is a coin flip", () => {
  assert.equal(scoreTrend(500_00, undefined), null);
  assert.equal(scoreTrend(500_00, computeBaseline([100_00, 200_00])), null, "too few periods");
});

// ── The whole score ──────────────────────────────────────────────────────────

test("the score is the weighted blend of the pillars that have data", () => {
  const pqs = computePqs(input());
  // margin 20% → 67; concentration worst share 15% → 100; trend at normal → 50.
  assert.equal(pillar(pqs, "margin").score, 67);
  assert.equal(pillar(pqs, "concentration").score, 100);
  assert.equal(pillar(pqs, "trend").score, 50);

  // (67×40 + 100×25 + 50×35) ÷ 100 = (2680 + 2500 + 1750) ÷ 100 = 69.3 → 69
  assert.equal(pqs.score, 69);
  assert.equal(pqs.state, "ok");
});

test("ad efficiency is absent and costs the score nothing", () => {
  const pqs = computePqs(input());
  const ads = pillar(pqs, "ads");

  assert.equal(ads.score, null);
  assert.equal(ads.weightPct, 0, "an absent measure carries no weight");
  assert.equal(ads.reason, "not_available_yet");
  assert.equal(PILLAR_WEIGHTS.ads, 0);

  assert.equal(pqs.measuresUsed, 3);
  assert.equal(pqs.measuresTotal, 4, "so the page can say 'based on 3 of 4 measures'");
});

test("an absent pillar renormalises the rest instead of scoring zero", () => {
  // No history: trend drops out and its 35 points redistribute.
  const noTrend = computePqs(input({ trueProfitBaseline: undefined }));
  assert.equal(pillar(noTrend, "trend").score, null);
  assert.equal(pillar(noTrend, "trend").weightPct, 0);
  assert.equal(noTrend.measuresUsed, 2);

  // (67×40 + 100×25) ÷ 65 = 5180 ÷ 65 = 79.7 → 80
  assert.equal(noTrend.score, 80);
  assert.ok(
    noTrend.score! > computePqs(input()).score!,
    "dropping an average pillar raises the score — it does not drag it down as a zero would",
  );

  // And the surviving weights add up to the whole score.
  const weights = noTrend.pillars.filter((p) => p.score !== null).map((p) => p.weightPct);
  assert.equal(weights.reduce((a, b) => a + b, 0), 100);
});

test("concentration takes the WORSE of customer and offer, and routes to whichever drove it", () => {
  // A shop with hundreds of customers but everything riding on one product.
  const shop = computePqs(input({ topCustomerSharePct: 3, topOfferSharePct: 70, topOfferLabel: "Mug" }));
  assert.equal(pillar(shop, "concentration").score, 0, "the product risk is real even with a wide customer base");
  assert.equal(pillar(shop, "concentration").href, "/setup/revenue", "so the row routes to what you sell");
  assert.equal(pillar(shop, "concentration").inputs[0].value, "Mug");

  // A freelancer with one client and a spread of services.
  const freelancer = computePqs(input({ topCustomerSharePct: 100, topCustomerLabel: "Acme", topOfferSharePct: 20 }));
  assert.equal(pillar(freelancer, "concentration").score, 0);
  assert.equal(pillar(freelancer, "concentration").href, "/insights/customers");
  assert.equal(pillar(freelancer, "concentration").inputs[0].value, "Acme");
});

test("every pillar states its scale and shows its raw inputs", () => {
  const pqs = computePqs(input());
  for (const p of pqs.pillars) {
    assert.ok(p.range.length > 0, `${p.id} does not say what it is judged against`);
    assert.ok(p.href.length > 0, `${p.id} has nowhere to go — the bar would be decoration`);
    if (p.score !== null) {
      assert.ok(p.inputs.length > 0, `${p.id} shows no working`);
      assert.ok(p.score >= 0 && p.score <= 100, `${p.id} is off the 0–100 scale`);
    }
  }
});

// ── States ───────────────────────────────────────────────────────────────────

test("a business too new to judge gets no score, not a low one", () => {
  const pqs = computePqs(input({ daysOfActivity: 6 }));
  assert.equal(pqs.score, null, "never a 0 and never a spinner — the hero is replaced instead");
  assert.equal(pqs.state, "too_new");
  assert.equal(pqs.daysOfActivity, 6, "so the page can show 6 of 14 days");
  assert.equal(MIN_DAYS_FOR_SCORE, 14);
});

test("a business with nothing recorded says so plainly", () => {
  const pqs = computePqs(input({ netRevenueCents: 0, trueProfitCents: 0, daysOfActivity: 0 }));
  assert.equal(pqs.state, "no_activity");
  assert.equal(pqs.score, null);
});

test("crisis is negative profit and nothing weaker", () => {
  assert.equal(computePqs(input()).crisis, false);
  assert.equal(computePqs(input({ trueProfitCents: -1 })).crisis, true);
  assert.equal(
    computePqs(input({ trueProfitCents: 1 })).crisis,
    false,
    "a thin profit is not a crisis — extending the band to lesser conditions kills its meaning",
  );
});

// ── The lever ────────────────────────────────────────────────────────────────

test("the drawer names the one change that would move the score most", () => {
  const pqs = computePqs(input());
  const lever = biggestLever(pqs);

  assert.ok(lever);
  assert.equal(lever.pillarId, "trend", "trend at 50 with 35 points of weight beats margin at 67 with 40");
  assert.equal(lever.from, 50);
  assert.equal(lever.to, 75);
  assert.ok(lever.wouldScore > pqs.score!, "and it converts the diagnostic into a goal");
});

test("nothing is offered when everything is already strong", () => {
  const excellent = computePqs(
    input({ trueProfitCents: 400_00, topCustomerSharePct: 2, topOfferSharePct: 2 }),
  );
  assert.equal(pillar(excellent, "margin").score, 100);
  assert.equal(
    biggestLever(excellent),
    null,
    "with every measure already past the target there is no honest suggestion to make, so none is invented",
  );

  // But a single weak pillar among strong ones is still offered.
  const oneWeak = computePqs(input({ trueProfitCents: 400_00, topCustomerSharePct: 55, topOfferSharePct: 55 }));
  assert.equal(biggestLever(oneWeak)?.pillarId, "concentration");

  const noScore = computePqs(input({ daysOfActivity: 2 }));
  assert.equal(biggestLever(noScore), null, "and with no score there is nothing to move");
});

// ── The verdict ──────────────────────────────────────────────────────────────

test("the verdict names what held and what slipped, and never asks a question", () => {
  const weak = computePqs(input({ topCustomerSharePct: 90, topOfferSharePct: 90 }));
  const sentence = verdictSentence(weak, -4);

  assert.match(sentence, /concentration/i, "it names the measure that is dragging");
  assert.ok(!sentence.includes("?"), "a verdict is never a question");
  assert.ok(sentence.split(" ").length < 25, "and it stays one readable line");
});

test("the verdict tells a new business when to come back instead of judging it", () => {
  const sentence = verdictSentence(computePqs(input({ daysOfActivity: 6 })), null);
  assert.match(sentence, /8 more days/, "turns waiting into anticipation with a real number");
});

test("a losing period is named as one, without pretending the score is fine", () => {
  const sentence = verdictSentence(computePqs(input({ trueProfitCents: -50_00 })), -10);
  assert.match(sentence, /spent more than you made/i);
});

test("a genuinely excellent period is allowed to say so", () => {
  const excellent = computePqs(
    input({ trueProfitCents: 400_00, topCustomerSharePct: 2, topOfferSharePct: 2, trueProfitBaseline: computeBaseline([100_00, 100_00, 100_00, 100_00], { floor: 10_00 }) }),
  );
  assert.match(verdictSentence(excellent, 12), /every measure is strong/i);
});
