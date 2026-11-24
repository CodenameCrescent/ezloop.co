import { AlertTriangle } from "lucide-react";
import { TopBar } from "@/components/TopBar";
import { MoneyTabBar } from "@/components/MoneyTabBar";
import { Surface } from "@/components/Surface";
import { StatStrip, StatTile } from "@/components/StatTile";
import { Tag } from "@/components/Tag";
import { ChartFrame } from "@/components/charts/ChartFrame";
import { Ladder } from "@/components/charts/Ladder";
import { ShareBar } from "@/components/charts/ShareBar";
import { Reveal, Stagger } from "@/components/Reveal";
import { figureStateSentence } from "@/lib/figureState";
import { FigureSlot } from "@/components/FigureSlot";
import { type MovementRow, useCashFlowLogic } from "./CashFlow.parts/UseCashFlowLogic";

export default function CashFlow() {
  const {
    dataState,
    empty,
    positive,
    f,
    net,
    caption,
    movementColumns,
    positionRows,
    steps,
    owedState,
    owed,
    ownerWithdrawals,
    availableCashEstimate,
    totalCashIn,
    cashInRows,
    toSegments,
    totalCashOut,
    cashOutRows,
    warnings,
    cashPressure,
  } = useCashFlowLogic();

  return (
    <>
      <TopBar title="Cash Flow" subtitle="Money that actually moved — not profit." />
      <MoneyTabBar />
      <div className="app-page-shell">
        <Stagger className="space-y-5" step={0.05}>
          {/* ── The flow. One picture, one figure, one sentence. ──────────── */}
          <Reveal>
            <ChartFrame<MovementRow>
              title="What moved"
              hint="Paid money only — an unpaid invoice has not moved"
              figure={
                /* `!empty` alone looked like it covered this — a dead store
                   makes both totals zero, so the hero happened not to render.
                   It only held while ALL FOUR store queries failed together.
                   One failing (transactions land, expense items do not) leaves
                   `empty` false, and the hero would print a confident signed
                   total and a "came in … went out … leaving" sentence built
                   from half the money, directly above a frame saying the
                   server didn't answer. `dataState` is the honest gate: it
                   reads `settled` whenever every query holds data — including
                   through a refetch — so this costs nothing on a period
                   change. */
                dataState === "settled" && !empty ? (
                  <div>
                    <p
                      className="t-hero"
                      style={{ color: positive ? "var(--pl-green)" : "var(--pl-red)" }}
                    >
                      {f.moneySigned(net)}
                    </p>
                    <p className="t-verdict mt-1 text-[color:var(--pl-ink-2)]">{caption}</p>
                  </div>
                ) : undefined
              }
              height={180}
              state={dataState}
              empty={empty}
              emptyMessage="Mark a sale or a bill as paid and the movement shows up here."
              tableView={{
                columns: movementColumns,
                rows: positionRows,
                getRowKey: (row) => row.label,
              }}
            >
              <Ladder steps={steps} format={f.money} />
            </ChartFrame>
          </Reveal>

          {/* Four figures, not eight cards each with a caption.
              Two kinds of hint sit here and only one of them is gated. The
              first two MEASURE something ("Every sale is paid for") and are
              only true if the sales arrived, so they are suppressed until the
              store settles — a zero that means "we never asked" must not carry
              the sentence that belongs to a zero meaning "nothing is owed".
              The last two DEFINE their label ("Owner draw — not a business
              cost") and stay true whatever loaded, so they hold; the amber
              slot above them already says the figure is missing. */}
          <Reveal as="section">
            <StatStrip columns={4}>
              {/* These two are cents from the contract, so `moneyCents`; the
                  rest of the strip is major units from the legacy store. */}
              <StatTile
                label="Still owed to you"
                value={
                  <FigureSlot state={owedState}>{f.moneyCents(owed?.incoming.totalCents ?? 0)}</FigureSlot>
                }
                goodDirection="down-is-good"
                hint={
                  owedState !== "settled"
                    ? undefined
                    : (owed?.incoming.totalCents ?? 0) > 0
                      ? "Sold, not yet collected"
                      : "Every sale is paid for"
                }
              />
              <StatTile
                label="Bills not paid"
                value={
                  <FigureSlot state={owedState}>{f.moneyCents(owed?.outgoing.totalCents ?? 0)}</FigureSlot>
                }
                goodDirection="neutral"
                hint={
                  owedState !== "settled"
                    ? undefined
                    : (owed?.outgoing.totalCents ?? 0) > 0
                      ? "Recorded, not yet paid"
                      : "Nothing outstanding"
                }
              />
              <StatTile
                label="You took out"
                value={<FigureSlot state={dataState}>{f.money(ownerWithdrawals)}</FigureSlot>}
                goodDirection="neutral"
                hint="Owner draw — not a business cost"
              />
              <StatTile
                label="Cash on hand"
                value={<FigureSlot state={dataState}>{f.money(availableCashEstimate)}</FigureSlot>}
                goodDirection="up-is-good"
                hint="Your opening buffer plus what moved"
              />
            </StatStrip>
          </Reveal>

          {/* ── In and out, by source. ─────────────────────────────────────── */}
          <Reveal as="section" className="grid gap-5 xl:grid-cols-2">
            <ChartFrame<MovementRow>
              title="Where cash came from"
              height={140}
              state={dataState}
              empty={totalCashIn === 0}
              emptyMessage="No money has been collected in this period."
              tableView={{ columns: movementColumns, rows: cashInRows, getRowKey: (r) => r.label }}
            >
              <ShareBar
                segments={toSegments(cashInRows, "gain")}
                layout="rows"
                format={f.money}
                size="sm"
              />
            </ChartFrame>

            <ChartFrame<MovementRow>
              title="Where cash went"
              height={140}
              state={dataState}
              empty={totalCashOut === 0}
              emptyMessage="No money has been paid out in this period."
              tableView={{ columns: movementColumns, rows: cashOutRows, getRowKey: (r) => r.label }}
            >
              <ShareBar
                segments={toSegments(cashOutRows, "neutral")}
                layout="rows"
                format={f.money}
                size="sm"
              />
            </ChartFrame>
          </Reveal>

          {/* ── What needs attention. Real warnings, kept. ────────────────────
              The sharpest false claim on the page, and it fired on EVERY load
              rather than only on a failure. `calculateCashFlowAnalysis` does
              not return an empty warning list when it is handed nothing: the
              third rule is an all-clear that reads "cash estimate is not
              negative AND nothing is unpaid", which three zeros satisfy. So a
              store that had loaded nothing — or could not — produced a green
              "Low" pressure tag over a green-tinted "Your tracked cash
              position looks stable for this period." That is the same shape as
              Dashboard's `NeedsAttention`, and it takes the same fix: the
              whole block is gated on the state, not just its empty case. */}
          {dataState !== "settled" ? (
            <Reveal>
              <Surface padding="md">
                {/* No pressure tag: High/Medium/Low is precisely the verdict
                    that cannot be reached from books nobody read. */}
                <h2 className="t-section text-[color:var(--pl-ink)]">Cash pressure</h2>
                {/* Amber, never red. Colour means money (DESIGN.md §2, §9) and
                    a request that did not land is not money lost. */}
                <p className="t-secondary mt-2 text-[color:var(--pl-amber)]">
                  {dataState === "loading"
                    ? "Checking…"
                    : figureStateSentence(dataState, "your cash position")}
                </p>
              </Surface>
            </Reveal>
          ) : (
            warnings.length > 0 && (
              <Reveal>
                <Surface padding="md">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <h2 className="t-section text-[color:var(--pl-ink)]">Cash pressure</h2>
                    <Tag
                      tone={cashPressure === "High" ? "red" : cashPressure === "Medium" ? "amber" : "green"}
                    >
                      {cashPressure}
                    </Tag>
                  </div>
                  <ul className="space-y-2">
                    {warnings.map((warning) => (
                      <li
                        key={warning.text}
                        className="flex gap-2.5 rounded-lg p-3"
                        style={{
                          background:
                            warning.tone === "bad"
                              ? "var(--pl-red-tint)"
                              : warning.tone === "warn"
                                ? "var(--pl-amber-tint)"
                                : "var(--pl-green-tint)",
                        }}
                      >
                        <AlertTriangle
                          className="mt-0.5 h-4 w-4 shrink-0"
                          style={{
                            color:
                              warning.tone === "bad"
                                ? "var(--pl-red)"
                                : warning.tone === "warn"
                                  ? "var(--pl-amber)"
                                  : "var(--pl-green)",
                          }}
                        />
                        <span className="t-body text-[color:var(--pl-ink)]">{warning.text}</span>
                      </li>
                    ))}
                  </ul>
                </Surface>
              </Reveal>
            )
          )}
        </Stagger>
      </div>
    </>
  );
}
