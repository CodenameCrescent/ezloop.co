import test from "node:test";
import assert from "node:assert/strict";
import { BLENDED_CAVEAT, computeMarketing, marketingSentence, type MarketingInput } from "./marketing";

const money = (c: number) =>
  `Rs ${new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Math.abs(c) / 100)}`;

function input(over: Partial<MarketingInput> = {}): MarketingInput {
  return {
    adSpendCents: 2_200_00,
    byPlatform: [
      { platform: "Meta Ads", amountCents: 1_150_00 },
      { platform: "Google Ads", amountCents: 1_050_00 },
    ],
    netRevenueCents: 10_000_00,
    contributionProfitCents: 4_000_00,
    trueProfitCents: 800_00,
    newCustomerCount: 25,
    priorAdSpendCents: 2_000_00,
    priorTrueProfitCents: 700_00,
    ...over,
  };
}

// ── The differentiator ───────────────────────────────────────────────────────

test("break-even ROAS comes from YOUR margin, not a generic 3×", () => {
  // 40% margin: every Rs 1 of ads must bring in Rs 2.50 of sales to pay for
  // itself. This is the number almost no competitor computes, because they do
  // not have reliable margin data.
  const forty = computeMarketing(input({ netRevenueCents: 10_000_00, contributionProfitCents: 4_000_00 }));
  assert.equal(forty.contributionMarginPct, 40);
  assert.equal(forty.breakEvenRoas, 2.5);

  // A thin 20%-margin shop needs 5×, and would be losing money at the "3× is
  // healthy" rule of thumb every ad tool repeats.
  const twenty = computeMarketing(input({ netRevenueCents: 10_000_00, contributionProfitCents: 2_000_00 }));
  assert.equal(twenty.breakEvenRoas, 5);

  // An 80%-margin consultancy only needs 1.25×.
  const eighty = computeMarketing(input({ netRevenueCents: 10_000_00, contributionProfitCents: 8_000_00 }));
  assert.equal(eighty.breakEvenRoas, 1.25);
});

test("there is no break-even multiple when the sales lose money to begin with", () => {
  const m = computeMarketing(input({ contributionProfitCents: -500_00 }));
  assert.equal(m.breakEvenRoas, null, "you cannot advertise your way out of selling at a loss");
  assert.equal(m.state, "no_margin");
  assert.match(marketingSentence(m, money, -500_00), /advertising cannot fix that/);
});

test("the one-sided test: ads that lose money can be PROVEN to have lost money", () => {
  // Everything sold left Rs 1,500 of margin. The ads cost Rs 2,200. Even
  // crediting the adverts with every last penny of margin the business made,
  // they did not cover themselves — and no attribution is needed to know it.
  const m = computeMarketing(input({ contributionProfitCents: 1_500_00, adSpendCents: 2_200_00 }));

  assert.equal(m.definitelyLostMoney, true);
  assert.ok(m.blendedMarginReturn! < 1);
  const s = marketingSentence(m, money, 1_500_00);
  assert.match(s, /the ads did not pay for themselves/);
  assert.match(s, /Rs 2,200\.00/);
});

test("the reverse is NOT claimed — plenty of margin proves nothing about the ads", () => {
  const m = computeMarketing(input({ contributionProfitCents: 40_000_00, adSpendCents: 100_00 }));

  assert.equal(m.definitelyLostMoney, false);
  assert.ok(m.blendedMarginReturn! > 1);
  // The sentence falls back to the break-even fact rather than declaring
  // victory, because most of that margin had nothing to do with the ads.
  const s = marketingSentence(m, money, 40_000_00);
  assert.ok(!/paid for themselves/.test(s), "correlation is all we have and the copy must not overclaim");
  assert.match(s, /just to pay for itself/);
});

test("the break-even sentence gives two concrete amounts, not a multiplier to apply", () => {
  // 40% margin → 2.5×. The reader should not have to do the arithmetic the
  // sentence exists to save them.
  const m = computeMarketing(input({ netRevenueCents: 10_000_00, contributionProfitCents: 4_000_00 }));
  const s = marketingSentence(m, money, 4_000_00);

  assert.match(s, /every Rs 100\.00 of ads has to bring in Rs 250\.00 of sales/);
  assert.ok(!/times that/.test(s));
});

test("every blended figure travels with the caveat that explains it", () => {
  assert.match(BLENDED_CAVEAT, /which sales came from which advert/);
  assert.match(BLENDED_CAVEAT, /ALL your sales/);
});

// ── The plain arithmetic ─────────────────────────────────────────────────────

test("profit before and after ads, without recomputing either", () => {
  // True profit ALREADY has the ad spend taken out, so adding it back is the
  // before figure — no second calculation to drift from the ladder.
  const m = computeMarketing(input({ trueProfitCents: 800_00, adSpendCents: 2_200_00 }));
  assert.equal(m.profitAfterAdsCents, 800_00);
  assert.equal(m.profitBeforeAdsCents, 3_000_00);
});

test("blended figures are ratios of the whole period, and named as such", () => {
  const m = computeMarketing(input({ netRevenueCents: 10_000_00, adSpendCents: 2_000_00 }));
  assert.equal(m.blendedRoas, 5, "Rs 10,000 of sales alongside Rs 2,000 of ads");
  assert.equal(m.shareOfRevenueBps, 2_000, "ads were 20% of revenue");
});

test("cost per new customer is spend over arrivals, and absent when nobody arrived", () => {
  const m = computeMarketing(input({ adSpendCents: 2_500_00, newCustomerCount: 25 }));
  assert.equal(m.costPerNewCustomerCents, 100_00);

  const none = computeMarketing(input({ newCustomerCount: 0 }));
  assert.equal(none.costPerNewCustomerCents, null, "dividing by nobody is not zero, it is unanswerable");
});

test("the platform split is sorted by spend and shares add to 100", () => {
  const m = computeMarketing(
    input({
      adSpendCents: 1_000_00,
      byPlatform: [
        { platform: "TikTok Ads", amountCents: 100_00 },
        { platform: "Meta Ads", amountCents: 600_00 },
        { platform: "Google Ads", amountCents: 300_00 },
      ],
    }),
  );

  assert.deepEqual(m.byPlatform.map((p) => p.platform), ["Meta Ads", "Google Ads", "TikTok Ads"]);
  assert.equal(m.byPlatform.reduce((sum, p) => sum + p.sharePct, 0), 100);
});

test("spend up and profit down is flagged", () => {
  const worse = computeMarketing(input({ adSpendCents: 3_000_00, priorAdSpendCents: 1_000_00, trueProfitCents: 100_00, priorTrueProfitCents: 900_00 }));
  assert.equal(worse.spendUpProfitDown, true);

  const better = computeMarketing(input({ adSpendCents: 3_000_00, priorAdSpendCents: 1_000_00, trueProfitCents: 2_000_00, priorTrueProfitCents: 900_00 }));
  assert.equal(better.spendUpProfitDown, false, "spending more and earning more is it working");
});

// ── States ───────────────────────────────────────────────────────────────────

test("no ad spend means there is nothing to judge, and nothing is claimed", () => {
  const m = computeMarketing(input({ adSpendCents: 0, byPlatform: [] }));

  assert.equal(m.state, "no_spend");
  assert.equal(m.blendedRoas, null);
  assert.equal(m.blendedMarginReturn, null);
  assert.equal(m.definitelyLostMoney, false, "no spend cannot have lost money");
  assert.equal(
    m.costPerNewCustomerCents,
    null,
    "not Rs 0.00 — that reads as a triumph when the truth is you did not advertise",
  );
  assert.match(marketingSentence(m, money, 4_000_00), /have not logged any ad spend/);

  // The break-even multiple still stands — it is a fact about the margin, not
  // about the ads, and it is worth knowing BEFORE spending anything.
  assert.equal(m.breakEvenRoas, 2.5);
});

test("spend with no sales at all is reported as exactly that", () => {
  const m = computeMarketing(input({ netRevenueCents: 0, contributionProfitCents: 0 }));
  assert.equal(m.state, "no_revenue");
  assert.equal(m.shareOfRevenueBps, null, "a share of nothing is unanswerable, not 0%");
  assert.equal(m.contributionMarginPct, null);
  assert.match(marketingSentence(m, money, 0), /no sales were recorded/);
});
