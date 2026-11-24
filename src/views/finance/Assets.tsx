import { useMemo, useState } from "react";
import { Package, Trash2 } from "lucide-react";
import { TopBar } from "@/components/TopBar";
import { MoneyTabBar } from "@/components/MoneyTabBar";
import { Surface } from "@/components/Surface";
import { Reveal, Stagger } from "@/components/Reveal";
import { FigureSlot } from "@/components/FigureSlot";
import { Meter } from "@/components/charts/Meter";
import { figureState } from "@/lib/figureState";
import { useGlobalPeriod } from "@/lib/globalPeriod";
import { useFormatters } from "@/lib/store";
import { toApiRange, useAssetsReport, useWasteReport } from "@/api/hooks";

/**
 * What you own, and what you threw away.
 *
 * Two reports on one screen because they answer the same shape of question —
 * where is money sitting that the profit ladder cannot show you. Neither adds a
 * rupee to anything: an asset is a purchase already spread across the months it
 * covers, and waste is a slice of spending already counted.
 */
export default function Assets() {
  const f = useFormatters();
  const { range } = useGlobalPeriod();
  const [includeFullyUsed, setIncludeFullyUsed] = useState(false);

  const assets = useAssetsReport(includeFullyUsed);
  const waste = useWasteReport(useMemo(() => toApiRange(range), [range]));
  const assetState = figureState(assets, assets.data != null);
  const wasteState = figureState(waste, waste.data != null);

  const assetItems = assets.data?.items ?? [];
  const wasteRows = waste.data?.rows ?? [];

  return (
    <>
      <TopBar
        title="What you own"
        subtitle="Big purchases still being used up, and what went to waste"
      />
      <MoneyTabBar />
      <div className="app-page-shell">
        <Stagger className="space-y-5">
          {/* ── Assets ─────────────────────────────────────────────────── */}
          <Reveal>
            <Surface padding="none" className="overflow-hidden">
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[color:var(--pl-grid-line)] p-5">
                <div className="flex items-start gap-3">
                  <span className="rounded-[length:var(--pl-r-md)] bg-[color:var(--pl-recessed)] p-2 text-[color:var(--pl-ink-2)]">
                    <Package className="h-4 w-4" />
                  </span>
                  <div>
                    <h2 className="t-section text-[color:var(--pl-ink)]">Things you bought to keep</h2>
                    {/* Said plainly, because this list is not a separate record —
                        it IS the purchases you already spread over months. */}
                    <p className="t-micro mt-0.5 max-w-xl text-[color:var(--pl-ink-3)]">
                      Anything you chose to charge across several months. There is nothing extra to
                      set up — this is those purchases, with how much of each is left.
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="t-micro text-[color:var(--pl-ink-3)]">Still to be used up</p>
                  <p className="t-title text-[color:var(--pl-ink)]">
                    <FigureSlot state={assetState}>
                      {f.moneyCents(assets.data?.totalRemainingCents ?? 0)}
                    </FigureSlot>
                  </p>
                </div>
              </div>

              {assetState === "settled" && assetItems.length === 0 && (
                <p className="t-secondary p-5 text-[color:var(--pl-ink-2)]">
                  Nothing here yet. When you buy something big, choose to charge it over several
                  months on the entry form and it will appear here.
                </p>
              )}

              {assetItems.length > 0 && (
                <ul className="divide-y divide-[color:var(--pl-grid-line)]">
                  {assetItems.map((asset) => (
                    <li key={asset.transactionId} className="flex flex-wrap items-center gap-3 p-4 sm:flex-nowrap">
                      <div className="min-w-0 flex-1">
                        <p className="t-secondary truncate font-medium text-[color:var(--pl-ink)]">
                          {asset.name}
                        </p>
                        <p className="t-micro mt-0.5 text-[color:var(--pl-ink-3)]">
                          {f.moneyCents(asset.purchaseCents)} over {asset.spreadMonths} months ·{" "}
                          {asset.monthsLeft === 0
                            ? "fully used up"
                            : `${asset.monthsLeft} ${asset.monthsLeft === 1 ? "month" : "months"} left`}
                        </p>
                      </div>
                      <span className="w-32 shrink-0">
                        <Meter value={asset.usedPct} tone="neutral" inline />
                      </span>
                      <span className="t-num w-32 shrink-0 text-right text-[color:var(--pl-ink)]">
                        {f.moneyCents(asset.remainingCents)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}

              <div className="border-t border-[color:var(--pl-grid-line)] px-5 py-3">
                <button
                  type="button"
                  onClick={() => setIncludeFullyUsed((value) => !value)}
                  className="t-secondary text-[color:var(--pl-ink-2)] underline underline-offset-4 hover:text-[color:var(--pl-ink)]"
                >
                  {includeFullyUsed ? "Hide fully used up" : "Show fully used up"}
                </button>
              </div>
            </Surface>
          </Reveal>

          {/* ── Waste ──────────────────────────────────────────────────── */}
          <Reveal>
            <Surface padding="none" className="overflow-hidden">
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[color:var(--pl-grid-line)] p-5">
                <div className="flex items-start gap-3">
                  <span className="rounded-[length:var(--pl-r-md)] bg-[color:var(--pl-recessed)] p-2 text-[color:var(--pl-ink-2)]">
                    <Trash2 className="h-4 w-4" />
                  </span>
                  <div>
                    <h2 className="t-section text-[color:var(--pl-ink)]">What went to waste</h2>
                    {/* The sentence that stops this being read as a new cost. */}
                    <p className="t-micro mt-0.5 max-w-xl text-[color:var(--pl-ink-3)]">
                      This is not extra money spent — you already paid for it. It is how much of
                      what you bought never made it into the work.
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="t-micro text-[color:var(--pl-ink-3)]">Wasted in this period</p>
                  <p className="t-title text-[color:var(--pl-ink)]">
                    <FigureSlot state={wasteState}>
                      {f.moneyCents(waste.data?.totalWastedCents ?? 0)}
                    </FigureSlot>
                  </p>
                  {wasteState === "settled" && waste.data?.shareOfSpendPct !== null && waste.data && (
                    <p className="t-micro text-[color:var(--pl-ink-3)]">
                      {waste.data.shareOfSpendPct}% of what you spent
                    </p>
                  )}
                </div>
              </div>

              {wasteState === "settled" && wasteRows.length === 0 && (
                <p className="t-secondary p-5 text-[color:var(--pl-ink-2)]">
                  No waste recorded in this period. When you enter a purchase you can say how much
                  of it was ruined or scrapped, and it will be totalled here.
                </p>
              )}

              {wasteRows.length > 0 && (
                <ul className="divide-y divide-[color:var(--pl-grid-line)]">
                  {wasteRows.map((row) => (
                    <li key={row.name} className="flex flex-wrap items-center gap-3 p-4 sm:flex-nowrap">
                      <div className="min-w-0 flex-1">
                        <p className="t-secondary truncate font-medium text-[color:var(--pl-ink)]">
                          {row.name}
                        </p>
                        <p className="t-micro mt-0.5 text-[color:var(--pl-ink-3)]">
                          {/* "of what you tracked" is not a hedge — the rate counts
                              only the purchases where waste was recorded, because a
                              delivery nobody checked is not a recorded zero. */}
                          {row.ratePct === null
                            ? "—"
                            : `${row.ratePct}% of what you tracked, out of ${f.moneyCents(row.boughtCents)}`}
                        </p>
                      </div>
                      <span className="t-num w-32 shrink-0 text-right text-[color:var(--pl-ink)]">
                        {f.moneyCents(row.wastedCents)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Surface>
          </Reveal>
        </Stagger>
      </div>
    </>
  );
}
