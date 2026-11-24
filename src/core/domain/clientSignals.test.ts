import test from "node:test";
import assert from "node:assert/strict";
import { computeClientSignals, type ClientSignalInput } from "./clientSignals";
import { computeTargetProfit, summariseTargets, type TargetProfit } from "./clientProfit";
import { computeConcentration, computeScopeCreep, computeUtilization } from "./workInsights";

/** A costed client row. Override anything; the defaults are a healthy client. */
const client = (over: Partial<Parameters<typeof computeTargetProfit>[0]> = {}): TargetProfit =>
  computeTargetProfit({
    targetType: "client",
    targetId: "c1",
    label: "Acme Corp",
    revenueCents: 100_000_00,
    labourCostCents: 40_000_00,
    overheadCostCents: 10_000_00,
    directCostCents: 0,
    hoursLogged: "40",
    hasHours: true,
    hasEstimates: false,
    ...over,
  });

/** The report shape, with everything quiet unless a test turns it on. */
function input(over: Partial<ClientSignalInput> = {}): ClientSignalInput {
  const rows = over.rows ?? [client()];
  return {
    rows,
    summary: over.summary ?? summariseTargets(rows.filter((r) => r.targetType !== "revenue_item"), rows),
    scopeCreep: over.scopeCreep ?? [],
    utilization: over.utilization ?? { overall: computeUtilization("40", "40") },
    concentration: over.concentration ?? computeConcentration([]),
    coverage: over.coverage ?? { pct: null, attributedCents: 0, payrollCents: 0, reason: "no_payroll", direction: null },
    ...over,
  };
}

const find = (signals: ReturnType<typeof computeClientSignals>, id: string) => signals.find((s) => s.id === id);

test("a client whose time costs more than they pay is the loudest thing on the page", () => {
  // The signal that pays for the whole module: invisible in a P&L, which is
  // the entire reason any of this exists.
  const losing = client({ label: "Fussy Co", revenueCents: 50_000_00, labourCostCents: 80_000_00 });
  const signals = computeClientSignals(input({ rows: [losing] }));

  const loss = find(signals, "client-loss");
  assert.ok(loss, "the loss is reported");
  assert.equal(loss!.severity, "critical");
  assert.equal(signals[0].id, "client-loss", "and it sorts to the top");
  assert.match(loss!.title, /Fussy Co costs more than they pay/);
  assert.match(loss!.plainEnglish, /80,000/);
  assert.match(loss!.plainEnglish, /50,000/);
  assert.match(loss!.plainEnglish, /down 30,000/);
});

test("a client with NO hours never produces a loss or a 'best client' claim", () => {
  // The failure the whole design exists to prevent, in nudge form: revenue with
  // no hours computes to 100% margin, which would read as the best client.
  const ghost = client({ label: "Ghost Client", revenueCents: 45_000_00, labourCostCents: 0, hasHours: false });
  assert.equal(ghost.isCosted, false);

  const signals = computeClientSignals(input({ rows: [ghost] }));
  assert.equal(find(signals, "client-loss"), undefined);
  assert.equal(find(signals, "client-best"), undefined);

  // What IS said is the useful thing: nobody has logged their hours.
  const uncosted = find(signals, "client-uncosted");
  assert.ok(uncosted);
  assert.match(uncosted!.title, /One client has no hours logged/);
  assert.match(uncosted!.plainEnglish, /45,000 of revenue has no time behind it/);
  assert.match(uncosted!.plainEnglish, /no profit figure/);
  assert.match(uncosted!.href, /hours/, "and it points at where to fix that");
});

test("a nudge built on estimated hours admits it in its own sentence", () => {
  // There is no banner above a signal to carry the caveat for it.
  const guessed = client({ label: "Rough Co", revenueCents: 10_000_00, labourCostCents: 30_000_00, hasEstimates: true });
  const signals = computeClientSignals(input({ rows: [guessed] }));
  assert.match(find(signals, "client-loss")!.plainEnglish, /estimates, so treat it as roughly right/);

  // And a figure from logged hours makes no such excuse.
  const logged = client({ label: "Real Co", revenueCents: 10_000_00, labourCostCents: 30_000_00 });
  assert.ok(!/estimates/.test(computeClientSignals(input({ rows: [logged] })).find((s) => s.id === "client-loss")!.plainEnglish));
});

test("scope creep names the two rates, which is the part that changes behaviour", () => {
  const creep = {
    targetId: "c1",
    label: "Acme Corp",
    ...computeScopeCreep({
      agreedHours: "60",
      agreedAmountCents: 150_000_00,
      actualHours: "88",
      revenueCents: 150_000_00,
    }),
  };
  const signals = computeClientSignals(input({ scopeCreep: [creep] }));
  const s = find(signals, "client-scope-creep");
  assert.ok(s);
  assert.match(s!.plainEnglish, /28 hours past the 60 agreed/);
  assert.match(s!.plainEnglish, /47% over/);
  assert.match(s!.plainEnglish, /priced it at 2,500 an hour and are earning 1,705/);
});

test("a client barely over their hours is not worth a warning", () => {
  // Every job runs a little long. Warning at 1% would train the owner to skim.
  const slight = {
    targetId: "c1",
    label: "Acme",
    ...computeScopeCreep({ agreedHours: "100", agreedAmountCents: null, actualHours: "105", revenueCents: 0 }),
  };
  assert.equal(find(computeClientSignals(input({ scopeCreep: [slight] })), "client-scope-creep"), undefined);
});

test("concentration warns only at real risk, and states the true consequence", () => {
  const high = computeConcentration([
    { label: "Big Co", revenueCents: 90_000_00 },
    { label: "Small Co", revenueCents: 10_000_00 },
  ]);
  const s = find(computeClientSignals(input({ concentration: high })), "client-concentration");
  assert.ok(s);
  assert.match(s!.title, /Big Co is 90% of your income/);
  assert.match(s!.plainEnglish, /take 90% of your income/);

  // At 100% the stock phrase would be wrong, so it says the real thing.
  const only = computeConcentration([{ label: "Only Co", revenueCents: 50_000_00 }]);
  assert.match(find(computeClientSignals(input({ concentration: only })), "client-concentration")!.plainEnglish, /leave you with nothing/);

  // A healthy spread says nothing at all.
  const spread = computeConcentration([
    { label: "A", revenueCents: 25_000_00 },
    { label: "B", revenueCents: 25_000_00 },
    { label: "C", revenueCents: 25_000_00 },
    { label: "D", revenueCents: 25_000_00 },
  ]);
  assert.equal(find(computeClientSignals(input({ concentration: spread })), "client-concentration"), undefined);
});

test("a badly under-filled timesheet is called out, because it flatters every client", () => {
  const signals = computeClientSignals(
    input({ coverage: { pct: 40, attributedCents: 40_000_00, payrollCents: 100_000_00, reason: "ok", direction: "under" } }),
  );
  const s = find(signals, "client-coverage");
  assert.ok(s);
  assert.match(s!.plainEnglish, /only 40%/);
  assert.match(s!.plainEnglish, /cheaper than they really are/);

  // A sheet that broadly accounts for the wage bill says nothing.
  for (const cov of [
    { pct: 98, direction: "matched" as const },
    { pct: 85, direction: "under" as const },
    { pct: 130, direction: "over" as const },
  ]) {
    const quiet = computeClientSignals(
      input({ coverage: { ...cov, attributedCents: 1, payrollCents: 1, reason: "ok" } }),
    );
    assert.equal(find(quiet, "client-coverage"), undefined, `${cov.pct}% should be quiet`);
  }
});

test("utilization is reported only when there are enough hours to mean anything", () => {
  const low = computeClientSignals(input({ utilization: { overall: computeUtilization("10", "40") } }));
  assert.match(find(low, "client-utilization")!.plainEnglish, /30 of 40 hours/);

  // Four hours in a week says nothing about how the business runs.
  const tiny = computeClientSignals(input({ utilization: { overall: computeUtilization("1", "4") } }));
  assert.equal(find(tiny, "client-utilization"), undefined);

  // Nothing logged is unknown, not zero — and unknown is never a warning.
  const none = computeClientSignals(input({ utilization: { overall: computeUtilization("0", "0") } }));
  assert.equal(find(none, "client-utilization"), undefined);
});

test("the good news is only offered when there is no bad news to bury", () => {
  const great = client({ label: "Star Co", revenueCents: 100_000_00, labourCostCents: 20_000_00 });
  const signals = computeClientSignals(input({ rows: [great] }));
  const best = find(signals, "client-best");
  assert.ok(best);
  assert.equal(best!.severity, "positive");
  assert.match(best!.title, /Star Co is your most profitable client/);
  assert.match(best!.plainEnglish, /80,000 left after their time and costs — a 80% margin/);

  // With a loss-making client in the room, praise would be a distraction.
  const mixed = [great, client({ targetId: "c2", label: "Bad Co", revenueCents: 10_000_00, labourCostCents: 50_000_00 })];
  const noisy = computeClientSignals(input({ rows: mixed }));
  assert.ok(find(noisy, "client-loss"));
  assert.equal(find(noisy, "client-best"), undefined);
});

test("only the WORST case of each kind is reported, not one per client", () => {
  // Six warnings about six clients would push the refund and margin signals off
  // the overview and train the owner to skim past all of them.
  const rows = [
    client({ targetId: "a", label: "A", revenueCents: 10_000_00, labourCostCents: 20_000_00 }),
    client({ targetId: "b", label: "B", revenueCents: 10_000_00, labourCostCents: 90_000_00 }),
    client({ targetId: "c", label: "C", revenueCents: 10_000_00, labourCostCents: 30_000_00 }),
  ];
  const signals = computeClientSignals(input({ rows }));
  assert.equal(signals.filter((s) => s.id === "client-loss").length, 1);
  assert.match(find(signals, "client-loss")!.title, /^B costs more/, "the worst one, not the first one");
});

test("a product row never produces its own nudge — it is the same money", () => {
  // A sale appears under the client AND the product. Warning about both would
  // say the same thing twice in different words.
  const rows = [
    client({ targetType: "revenue_item", targetId: "ri1", label: "Logo design", revenueCents: 10_000_00, labourCostCents: 40_000_00 }),
  ];
  assert.equal(find(computeClientSignals(input({ rows })), "client-loss"), undefined);
});

test("a business with nothing logged and nothing earned says nothing", () => {
  assert.deepEqual(computeClientSignals(input({ rows: [] })), []);
});
