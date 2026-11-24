import { z } from "zod";
import { defineEndpoint, moneyCents } from "./shared";
import { accountingBasis } from "./transactions";

const groupRow = z.object({
  key: z.string(),
  label: z.string(),
  amountCents: moneyCents,
  count: z.number().int(),
});

/**
 * The profit ladder for a period, computed by the ONE implementation in
 * lib/domain/profit.ts, plus the expandable breakdowns each rung opens into.
 */
export const getPnl = defineEndpoint({
  method: "GET",
  path: "/reports/pnl",
  query: z.object({
    startDate: z.string().optional(),
    endDate: z.string().optional(),
    /**
     * Which date to measure by. `accrual` (default) files money under when it
     * HAPPENED — that is profit. `cash` files it under when it was PAID and
     * drops anything unpaid — that is what moved through the bank.
     */
    basis: accountingBasis.optional(),
  }),
  response: z.object({
    ladder: z.object({
      grossRevenue: moneyCents,
      discounts: moneyCents,
      refunds: moneyCents,
      netRevenue: moneyCents,
      /** What the sold things cost — the rung between net revenue and contribution profit. */
      directCosts: moneyCents,
      contributionProfit: moneyCents,
      periodExpenses: moneyCents,
      trueProfit: moneyCents,
    }),
    /** Gross revenue expandable by each grouping. */
    revenueGroups: z.object({
      type: z.array(groupRow),
      category: z.array(groupRow),
      source: z.array(groupRow),
    }),
    /** Direct costs expandable by snapshot component name. */
    costComponents: z.array(z.object({ name: z.string(), kind: z.enum(["fee", "cost"]), totalCents: moneyCents })),
    /** Period expenses expandable by expense item type. */
    expenseGroups: z.array(groupRow),
    transactionCount: z.number().int(),
  }),
});

/**
 * How much must sell before the period stops costing money. Computed by the ONE
 * implementation in lib/domain/breakeven.ts from the same ledger the P&L reads,
 * with period expenses split by each expense item's cost nature.
 *
 * `reason` says whether a target exists at all, so the UI states the right
 * sentence instead of inferring one from a null (or printing a confident zero,
 * which is exactly what this endpoint replaces).
 */
export const getBreakEven = defineEndpoint({
  method: "GET",
  path: "/reports/break-even",
  query: z.object({
    startDate: z.string().optional(),
    endDate: z.string().optional(),
    /** Optional profit goal, on top of merely covering costs. */
    targetProfitCents: z.coerce.number().int().optional(),
  }),
  response: z.object({
    fixedExpensesCents: moneyCents,
    variableExpensesCents: moneyCents,
    /** Spend on lines with no catalog item behind them — counted as variable. */
    unclassifiedExpensesCents: moneyCents,
    contributionAfterVariableCents: moneyCents,
    contributionMarginPct: z.number().nullable(),
    breakEvenRevenueCents: moneyCents.nullable(),
    breakEvenTransactions: z.number().int().nullable(),
    breakEvenUnits: z.number().int().nullable(),
  /** What that count is counted in. Null when the period mixed units — show the revenue target instead. */
  breakEvenUnitLabel: z.string().nullable(),
    surplusCents: moneyCents.nullable(),
    coveredPct: z.number().nullable(),
    reason: z.enum(["ok", "no_fixed_costs", "no_sales", "no_margin"]),
    /** Revenue needed to reach targetProfitCents; null when none was asked for. */
    revenueForTargetProfitCents: moneyCents.nullable(),
    /** The ladder figures this was built from, so the page can show its working. */
    netRevenueCents: moneyCents,
    contributionProfitCents: moneyCents,
    periodExpensesCents: moneyCents,
    trueProfitCents: moneyCents,
    /** Fixed spend per item, biggest first — what to cut to lower the target. */
    fixedCostBreakdown: z.array(
      z.object({ id: z.string(), name: z.string(), amountCents: moneyCents, costNature: z.enum(["fixed", "semi_variable"]) }),
    ),
  }),
});

export const pnlSeriesBucket = z.enum(["day", "week", "month", "year"]);

/**
 * The profit ladder over TIME: the period partitioned into buckets, each rung
 * computed per bucket by the same ONE ladder implementation. Bucket rungs are
 * additive — they sum exactly to the whole-period ladder.
 */
export const getPnlSeries = defineEndpoint({
  method: "GET",
  path: "/reports/pnl-series",
  query: z.object({
    startDate: z.string(),
    endDate: z.string(),
    bucket: pnlSeriesBucket,
  }),
  response: z.object({
    bucket: pnlSeriesBucket,
    buckets: z.array(
      z.object({
        /** Bucket start (inclusive), ISO. */
        start: z.string(),
        /** Bucket end (inclusive), ISO. */
        end: z.string(),
        /** Human label, e.g. "Jul 18", "W29", "Jul 2026", "2026". */
        label: z.string(),
        grossRevenue: moneyCents,
        discounts: moneyCents,
        refunds: moneyCents,
        netRevenue: moneyCents,
        contributionProfit: moneyCents,
        periodExpenses: moneyCents,
        trueProfit: moneyCents,
        transactionCount: z.number().int(),
      }),
    ),
  }),
});

/** Acquisition cohort grid: cohort × months-since-first, avg cumulative contribution/customer. */
export const getCohorts = defineEndpoint({
  method: "GET",
  path: "/reports/cohorts",
  response: z.object({
    cohorts: z.array(
      z.object({
        cohortMonth: z.string(),
        size: z.number().int(),
        cumulativeContributionPerCustomer: z.array(moneyCents),
      }),
    ),
    maxOffset: z.number().int(),
  }),
});

const driverRow = z.object({
  key: z.string(),
  label: z.string(),
  currentCents: moneyCents,
  priorCents: moneyCents,
  deltaCents: moneyCents,
});

/**
 * WHY true profit moved: the period decomposed into named buckets that sum
 * EXACTLY to the ladder's true profit, compared bucket-by-bucket to the prior
 * window. `profit` is the reconciling axis; the others re-slice the same money.
 */
export const getDrivers = defineEndpoint({
  method: "GET",
  path: "/reports/drivers",
  query: z.object({
    startDate: z.string(),
    endDate: z.string(),
    priorStartDate: z.string(),
    priorEndDate: z.string(),
  }),
  response: z.object({
    profit: z.array(driverRow),
    items: z.array(driverRow),
    sources: z.array(driverRow),
    categories: z.array(driverRow),
    expenseTypes: z.array(driverRow),
    currentTrueProfitCents: moneyCents,
    priorTrueProfitCents: moneyCents,
  }),
});

/**
 * Computed nudges: plain-English signals over period-vs-prior money. The range
 * is optional — omitted, the server defaults to this month vs last month (the
 * app-wide health chip). Consumed by the sidebar chip, a Dashboard banner, and
 * the command center's Needs-attention list.
 */
export const getSignals = defineEndpoint({
  method: "GET",
  path: "/reports/signals",
  query: z.object({
    startDate: z.string().optional(),
    endDate: z.string().optional(),
    priorStartDate: z.string().optional(),
    priorEndDate: z.string().optional(),
  }),
  response: z.object({
    signals: z.array(
      z.object({
        id: z.string(),
        severity: z.enum(["positive", "info", "warning", "critical"]),
        title: z.string(),
        plainEnglish: z.string(),
        href: z.string(),
      }),
    ),
  }),
});

/** What's gaining and stalling (contribution vs prior), plus frequently-bought-together pairs. */
export const getMomentum = defineEndpoint({
  method: "GET",
  path: "/reports/momentum",
  query: z.object({
    startDate: z.string(),
    endDate: z.string(),
    priorStartDate: z.string(),
    priorEndDate: z.string(),
  }),
  response: z.object({
    itemWinners: z.array(driverRow),
    itemLosers: z.array(driverRow),
    sourceWinners: z.array(driverRow),
    sourceLosers: z.array(driverRow),
    pairs: z.array(z.object({ aName: z.string(), bName: z.string(), count: z.number().int() })),
  }),
});

/** Where profit quietly drains: refunds, discounts, fee creep, unpaid aging, margin erosion. */
export const getLeaks = defineEndpoint({
  method: "GET",
  path: "/reports/leaks",
  query: z.object({
    startDate: z.string(),
    endDate: z.string(),
    priorStartDate: z.string(),
    priorEndDate: z.string(),
  }),
  response: z.object({
    refunds: z.object({
      totalCents: moneyCents,
      ratePct: z.number(),
      byItem: z.array(z.object({ name: z.string(), cents: moneyCents, ratePct: z.number() })),
      bySource: z.array(z.object({ name: z.string(), cents: moneyCents })),
    }),
    discounts: z.object({ totalCents: moneyCents, pctOfGross: z.number() }),
    fees: z.array(z.object({ name: z.string(), currentCents: moneyCents, priorCents: moneyCents, deltaCents: moneyCents })),
    marginErosion: z.array(z.object({ name: z.string(), marginNowPct: z.number(), marginPriorPct: z.number(), deltaPts: z.number() })),
    unpaidAging: z.object({
      totalCents: moneyCents,
      buckets: z.array(z.object({ label: z.string(), count: z.number().int(), cents: moneyCents })),
      rows: z.array(z.object({ id: z.string(), displayName: z.string(), occurredAt: z.string(), amountCents: moneyCents, days: z.number().int() })),
    }),
    /**
     * The mirror of unpaidAging: money OUT that has not been paid — what the
     * business owes, not what it is owed. A total and a count, because the
     * dashboard card states a figure; ageing can join it when a page needs to
     * chase individual bills.
     */
    unpaidPayables: z.object({
      totalCents: moneyCents,
      count: z.number().int(),
    }),
  }),
});

/**
 * Retention + repeat-purchase behaviour (Lifetimely-style). Data layer for the
 * upcoming Insights redesign — percentages are 0–100 with one decimal.
 */
export const getRetention = defineEndpoint({
  method: "GET",
  path: "/reports/retention",
  response: z.object({
    retention: z.object({
      cohorts: z.array(
        z.object({
          cohortMonth: z.string(),
          size: z.number().int(),
          activePctByOffset: z.array(z.number()),
        }),
      ),
      maxOffset: z.number().int(),
    }),
    repeat: z.object({
      customersWithPurchase: z.number().int(),
      repeatCustomers: z.number().int(),
      repeatRatePct: z.number(),
      medianDaysToSecondPurchase: z.number().int().nullable(),
    }),
  }),
});

/**
 * The insight feed: ranked cards from the rule engine.
 *
 * Distinct from `/reports/signals`, which stays as the ambient one-line nudge
 * feed the sidebar chip and dashboard banner read. This endpoint serves the
 * full card — impact, cause, action, and the real arithmetic behind it.
 */
const insightExplain = z.object({
  threshold: z.string(),
  comparisonPeriod: z.string(),
  inputs: z.array(z.object({ label: z.string(), value: z.string() })),
});

export const insightCard = z.object({
  id: z.string(),
  /** Signed minor units. Negative = lost, positive = gained. Never absent. */
  impactCents: moneyCents,
  impactSuffix: z.string().optional(),
  headline: z.string(),
  cause: z.string(),
  action: z.object({ label: z.string(), href: z.string() }).optional(),
  explain: insightExplain,
  trend: z.array(z.number()).optional(),
  severity: z.enum(["critical", "normal"]),
  subject: z.string(),
  page: z.enum(["summary", "money", "offers", "people", "marketing"]),
  urgent: z.boolean().optional(),
  /**
   * The figure is money AT STAKE or TIED UP, not gained or lost. Ranks in the
   * feed like anything else, but is absent from the Leaks view and its total —
   * cash that is merely late must not inflate "you're leaking Rs X".
   */
  exposure: z.boolean().optional(),
  /** Siblings rolled into this card by the one-per-subject rule. */
  related: z.object({ count: z.number().int(), subject: z.string() }).optional(),
});
export type InsightCardShape = z.infer<typeof insightCard>;

export const getInsights = defineEndpoint({
  method: "GET",
  path: "/reports/insights",
  query: z.object({
    startDate: z.string(),
    endDate: z.string(),
    priorStartDate: z.string(),
    priorEndDate: z.string(),
    /** Shown verbatim inside every card's Explain, e.g. "This month vs last month". */
    comparisonLabel: z.string().optional(),
  }),
  response: z.object({
    /** Ranked and capped at five — what the feed shows. */
    insights: z.array(insightCard),
    /** Every losing card, worst first, uncapped — the Leaks view. */
    leaks: z.array(insightCard),
    /** Positive minor units. Rides inside the Leaks toggle's own label. */
    totalLeakCents: moneyCents,
    /** Past periods the normals were built from. 0 means no normals exist yet. */
    baselinePeriods: z.number().int(),
    generatedAt: z.string(),
  }),
});

/**
 * The Profit Quality Score.
 *
 * A pillar with no data reports `score: null` and `weightPct: 0` — absent, not
 * zero — and the remaining weights renormalise, which is what makes "based on
 * 3 of 4 measures" honest rather than a disclaimer on a fudged figure. Every
 * pillar carries the scale it was judged on and the raw inputs behind it, so
 * the drawer can answer "based on what?" completely.
 */
const pqsPillar = z.object({
  id: z.enum(["margin", "concentration", "trend", "ads"]),
  label: z.string(),
  score: z.number().int().nullable(),
  weightPct: z.number().int(),
  range: z.string(),
  inputs: z.array(z.object({ label: z.string(), value: z.string() })),
  reason: z.enum(["ok", "no_revenue", "no_history", "not_available_yet"]),
  href: z.string(),
});

export const getPqs = defineEndpoint({
  method: "GET",
  path: "/reports/pqs",
  query: z.object({
    startDate: z.string(),
    endDate: z.string(),
    priorStartDate: z.string(),
    priorEndDate: z.string(),
  }),
  response: z.object({
    score: z.number().int().nullable(),
    /** Movement on the previous period. Null when either side has no score. */
    delta: z.number().int().nullable(),
    state: z.enum(["ok", "too_new", "no_activity"]),
    pillars: z.array(pqsPillar),
    measuresUsed: z.number().int(),
    measuresTotal: z.number().int(),
    daysOfActivity: z.number().int(),
    /** Negative profit — the one condition allowed a band above the score. */
    crisis: z.boolean(),
    verdict: z.string(),
    /** The single change that would raise the score most. Null when nothing would. */
    lever: z
      .object({
        pillarId: z.enum(["margin", "concentration", "trend", "ads"]),
        label: z.string(),
        from: z.number().int(),
        to: z.number().int(),
        wouldScore: z.number().int(),
      })
      .nullable(),
    calculatedAt: z.string(),
  }),
});

/**
 * The money waterfall — the Money page's hero.
 *
 * `reconciles` is the contract: `startCents` minus every deduction equals
 * `endCents`. A chart whose bars do not add up to the number beside them is
 * worse than no chart, so the property travels with the data.
 */
export const getWaterfall = defineEndpoint({
  method: "GET",
  path: "/reports/waterfall",
  query: z.object({
    startDate: z.string(),
    endDate: z.string(),
    priorStartDate: z.string(),
    priorEndDate: z.string(),
  }),
  response: z.object({
    steps: z.array(
      z.object({
        id: z.string(),
        label: z.string(),
        kind: z.enum(["start", "deduction", "credit", "end"]),
        amountCents: moneyCents,
        href: z.string().nullable(),
        runningTotalCents: moneyCents,
        rungLabel: z.string().optional(),
      }),
    ),
    startCents: moneyCents,
    endCents: moneyCents,
    reconciles: z.boolean(),
    /** Revenue recorded with nothing costed against it — the page must say so. */
    missingCosts: z.boolean(),
    verdict: z.string(),
    /** The four tiles, each with its prior-period counterpart. */
    tiles: z.object({
      revenueCents: moneyCents,
      priorRevenueCents: moneyCents,
      /** Percentage points, one decimal. Null when there is no revenue to divide by. */
      netMarginPct: z.number().nullable(),
      priorNetMarginPct: z.number().nullable(),
      trueProfitCents: moneyCents,
      priorTrueProfitCents: moneyCents,
      /**
       * Cash that actually MOVED this period (the ladder on a cash basis) —
       * not a bank balance, which would need an opening figure the app does
       * not hold. Labelled accordingly.
       */
      cashMovedCents: moneyCents,
      priorCashMovedCents: moneyCents,
    }),
  }),
});

/**
 * The Offers page — what you sell, ranked by PROFIT and mapped.
 *
 * `flip` is the surprise worth surfacing: when your best seller is not your
 * best earner. Every other tool ranks by revenue, so it is the fact their
 * reports structurally cannot show.
 */
const offerStat = z.object({
  id: z.string(),
  name: z.string(),
  unitsSold: z.number(),
  netRevenueCents: moneyCents,
  contributionProfitCents: moneyCents,
  marginPct: z.number().nullable(),
});

export const getOffers = defineEndpoint({
  method: "GET",
  path: "/reports/offers",
  query: z.object({ startDate: z.string(), endDate: z.string() }),
  response: z.object({
    verdict: z.string(),
    podium: z.object({
      entries: z.array(
        z.object({
          id: z.string(),
          name: z.string(),
          contributionProfitCents: moneyCents,
          netRevenueCents: moneyCents,
          sharePct: z.number(),
        }),
      ),
      totalContributionCents: moneyCents,
      /** False below three profitable offers — a podium of two looks broken. */
      show: z.boolean(),
    }),
    quadrant: z.object({
      dots: z.array(
        z.object({
          id: z.string(),
          name: z.string(),
          revenueCents: moneyCents,
          marginPct: z.number(),
          unitsSold: z.number(),
          netRevenueCents: moneyCents,
          contributionProfitCents: moneyCents,
          quadrant: z.enum(["winners", "hidden-gems", "traps", "dead-weight"]),
        }),
      ),
      /** The crosshair: this business's own median COSTED offer, not a benchmark. */
      revenueMidpoint: z.number(),
      marginMidpoint: z.number(),
      /** Nothing costed at all, so every margin is 100% and the map says nothing. */
      missingCosts: z.boolean(),
      /** Offers left off the map because nothing has been costed against them. */
      uncostedCount: z.number().int(),
      uncostedNames: z.array(z.string()),
      show: z.boolean(),
    }),
    flip: z
      .object({ revenueLeader: offerStat, profitLeader: offerStat })
      .nullable(),
    /** Every offer, for the ranked list beneath the two heroes. */
    offers: z.array(offerStat),
  }),
});

/**
 * The People page — "Who pays me, and are they staying?"
 *
 * The concentration bar is the hero. For a service business "Acme is 38% of
 * your revenue, and losing them would take you to a loss" is the single
 * highest-value warning the product can produce.
 */
const customerStat = z.object({
  id: z.string(),
  name: z.string(),
  netRevenueCents: moneyCents,
  contributionProfitCents: moneyCents,
  lifetimeOrderCount: z.number().int(),
  firstPurchaseAt: z.string().nullable(),
  lastPurchaseAt: z.string().nullable(),
  trailingYearContributionCents: moneyCents,
});

export const getPeople = defineEndpoint({
  method: "GET",
  path: "/reports/people",
  query: z.object({ startDate: z.string(), endDate: z.string() }),
  response: z.object({
    verdict: z.string(),
    concentration: z.object({
      segments: z.array(
        z.object({
          id: z.string().nullable(),
          name: z.string(),
          netRevenueCents: moneyCents,
          sharePct: z.number(),
          atRisk: z.boolean(),
        }),
      ),
      topName: z.string().nullable(),
      topSharePct: z.number().nullable(),
      risk: z.enum(["none", "watch", "high", "sole"]),
      /** Losing the top customer would put the business into a loss. */
      losingThemMeansLoss: z.boolean(),
      profitWithoutTopCents: moneyCents.nullable(),
      /** Revenue with no customer attached — real money that cannot concentrate. */
      unattributedCents: moneyCents,
    }),
    tiles: z.object({
      /** Null when there are too few customers for a rate to mean anything. */
      repeatRatePct: z.number().nullable(),
      customerCount: z.number().int(),
      revenuePerCustomerCents: moneyCents.nullable(),
      goneQuietCount: z.number().int(),
      goneQuietValueCents: moneyCents,
    }),
    /** Named, because a percentage is not something anybody can act on. */
    goneQuiet: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        lastPurchaseAt: z.string(),
        daysSince: z.number().int(),
        usualGapDays: z.number().int(),
        worthPerYearCents: moneyCents,
      }),
    ),
    /** Your biggest customer is not your most profitable one. */
    biggestVsBest: z
      .object({ biggest: customerStat, best: customerStat })
      .nullable(),
    customers: z.array(customerStat),
  }),
});

/**
 * The Marketing page — "Is my ad spend making money?"
 *
 * Everything here is BLENDED, and labelled blended. Nothing links a sale to the
 * advert that caused it (`attributed_campaign_id` is inert), so per-channel
 * ROAS is not computable and no field claims it.
 *
 * What the page does have is the thing ad tools lack: real margin. So
 * `breakEvenRoas` — the sales multiple your OWN margin requires — is exact, and
 * `definitelyLostMoney` is a one-sided proof that needs no attribution at all.
 */
export const getMarketing = defineEndpoint({
  method: "GET",
  path: "/reports/marketing",
  query: z.object({
    startDate: z.string(),
    endDate: z.string(),
    priorStartDate: z.string(),
    priorEndDate: z.string(),
  }),
  response: z.object({
    verdict: z.string(),
    /** Travels with every blended figure on the page. */
    blendedCaveat: z.string(),
    state: z.enum(["no_spend", "no_revenue", "no_margin", "ok"]),
    adSpendCents: moneyCents,
    priorAdSpendCents: moneyCents,
    byPlatform: z.array(
      z.object({ platform: z.string(), amountCents: moneyCents, sharePct: z.number() }),
    ),
    contributionMarginPct: z.number().nullable(),
    /** Sales each unit of ad spend must bring in to pay for itself, at your margin. */
    breakEvenRoas: z.number().nullable(),
    /** Sales that came ALONGSIDE each unit of ad spend. Not attributed. */
    blendedRoas: z.number().nullable(),
    /** Margin that came alongside each unit of ad spend. Below 1 is proof of loss. */
    blendedMarginReturn: z.number().nullable(),
    /** The ads did not cover themselves even credited with ALL margin. */
    definitelyLostMoney: z.boolean(),
    profitBeforeAdsCents: moneyCents,
    profitAfterAdsCents: moneyCents,
    contributionProfitCents: moneyCents,
    costPerNewCustomerCents: moneyCents.nullable(),
    newCustomerCount: z.number().int(),
    shareOfRevenueBps: z.number().int().nullable(),
    spendUpProfitDown: z.boolean(),
  }),
});
