import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { SectionHeading } from "@/components/SectionHeading";
import { StatStrip, StatTile } from "@/components/StatTile";
import { Surface } from "@/components/Surface";
import { DataTable, type Column } from "@/components/DataTable";
import { Tag } from "@/components/Tag";
import { Button } from "@/components/ui/button";
import { useGlobalPeriod } from "@/lib/globalPeriod";
import { useFormatters } from "@/lib/store";
import {
  apiErrorMessage,
  toApiRange,
  useAdPlatforms,
  useAdSpend,
  useLogAdSpend,
  useVoidAdSpend,
} from "@/api/hooks";
import { figureState, figureStateSentence } from "@/lib/figureState";
import { FigureSlot } from "@/components/FigureSlot";
import { LogSpendDialog } from "./AdSpend.parts/LogSpendDialog";

type Entry = {
  id: string;
  spentOn: string;
  platform: string;
  sourceId: string;
  campaign: string | null;
  amountCents: number;
  currency: string;
  paidAt: string | null;
  origin: string;
  status: string;
  notes: string | null;
};

export default function AdSpend() {
  const { range } = useGlobalPeriod();
  const f = useFormatters();
  const apiRange = useMemo(() => toApiRange(range), [range]);

  const adSpend = useAdSpend(apiRange);
  const { data } = adSpend;
  /*
   * The table's empty state is an instruction — "Log what you spent on ads",
   * "Until it's here, your profit looks better than it is" — and an
   * instruction is a claim that the thing is not there. It was reached from
   * `!isLoading`, which a failed or paused request leaves false, so an owner
   * who logs their ads every week was told their profit was overstated because
   * one request did not land. The tiles above already degrade to an em dash,
   * which understates rather than lies; the table did not.
   */
  const adSpendState = figureState(adSpend, data != null);
  const { data: platforms } = useAdPlatforms();
  const logSpend = useLogAdSpend();
  const voidSpend = useVoidAdSpend();

  const [open, setOpen] = useState(false);

  const money = f.moneyCents;
  const entries = data?.entries ?? [];

  /**
   * Share of revenue is NULL when the period earned nothing. A share of nothing
   * is unanswerable, not 0% — so the tile says so in words instead of printing
   * a confident number nobody can act on.
   */
  const sharePct = data?.shareOfRevenueBps == null ? null : data.shareOfRevenueBps / 100;

  const columns: Column<Entry>[] = [
    {
      key: "spentOn",
      header: "Date",
      render: (row) => <span className="t-num">{new Date(row.spentOn).toLocaleDateString()}</span>,
    },
    {
      key: "platform",
      header: "Platform",
      render: (row) => <span className="font-medium text-[color:var(--pl-ink)]">{row.platform}</span>,
    },
    {
      key: "campaign",
      header: "Campaign",
      hideOnMobile: true,
      render: (row) =>
        row.campaign ? (
          <span className="t-secondary">{row.campaign}</span>
        ) : (
          <span className="t-secondary">—</span>
        ),
    },
    {
      key: "paid",
      header: "Paid",
      hideOnMobile: true,
      render: (row) =>
        row.paidAt ? (
          <span className="t-secondary">{new Date(row.paidAt).toLocaleDateString()}</span>
        ) : (
          // An unpaid ad bill still counts against profit today; it just has
          // not left the bank. Saying "Not yet" rather than blank is what stops
          // the cash and profit screens looking like they disagree.
          <Tag tone="amber">Not yet</Tag>
        ),
    },
    {
      key: "amount",
      header: "Spent",
      align: "right",
      bar: (row) => row.amountCents,
      // Money out, so it reads red — the same rule as everywhere else.
      render: (row) => (
        <span className="t-num font-medium text-[color:var(--pl-red)]">−{money(row.amountCents)}</span>
      ),
    },
    {
      key: "actions",
      header: "",
      align: "right",
      render: (row) => (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            voidSpend.mutate(row.id, {
              onSuccess: () => toast.success("Removed from your profit"),
              onError: (err) => toast.error(apiErrorMessage(err, "Couldn't remove that")),
            });
          }}
        >
          Remove
        </Button>
      ),
    },
  ];

  return (
    <div className="app-page-shell">
      <PageHeader
        title="Ad spend"
        subtitle="What you paid to bring customers in. It comes straight off your profit."
        actions={
          <Button onClick={() => setOpen(true)}>
            <Plus className="mr-1.5 h-4 w-4" />
            Log spend
          </Button>
        }
      />

      <StatStrip columns={3} className="mb-8">
        {/* The tiles used to answer every non-settled state with the same em
            dash a genuinely empty period gets. That understates rather than
            lies, but it is still the page declining to say which of three
            different things happened. */}
        <StatTile
          label="Spent this period"
          value={
            <FigureSlot state={adSpendState}>{money(data?.totalCents ?? 0)}</FigureSlot>
          }
          goodDirection="down-is-good"
        />
        <StatTile
          label="Share of revenue"
          value={
            <FigureSlot state={adSpendState}>
              {sharePct == null ? "—" : `${sharePct.toFixed(1)}%`}
            </FigureSlot>
          }
          goodDirection="down-is-good"
          /* The hint was the sharper bug of the two: `sharePct` is null both
             when the period genuinely earned nothing AND when `data` never
             arrived, so a failed request printed "No sales recorded in this
             period yet" — a statement about the business, from nothing. */
          hint={
            adSpendState !== "settled"
              ? undefined
              : sharePct == null
                ? "No sales recorded in this period yet"
                : `of ${money(data!.grossRevenueCents)} in sales`
          }
        />
        <StatTile
          label="Platforms"
          value={<FigureSlot state={adSpendState}>{data?.byPlatform.length ?? 0}</FigureSlot>}
          goodDirection="neutral"
        />
      </StatStrip>

      {data && data.byPlatform.length > 1 && (
        <section className="mb-8">
          <SectionHeading hint="Where the money went">By platform</SectionHeading>
          <Surface padding="md" className="flex flex-col gap-3">
            {data.byPlatform.map((p) => {
              const width = data.totalCents > 0 ? (p.amountCents / data.totalCents) * 100 : 0;
              return (
                <div key={p.sourceId} className="flex flex-col gap-1.5">
                  <div className="flex items-baseline justify-between gap-4">
                    <span className="t-body text-[color:var(--pl-ink)]">{p.platform}</span>
                    <span className="t-num text-[color:var(--pl-ink-2)]">{money(p.amountCents)}</span>
                  </div>
                  {/* A zero bar is empty — never floored to look like something. */}
                  <div className="h-2 w-full overflow-hidden rounded-full bg-[color:var(--pl-recessed)]">
                    <div
                      className="h-full rounded-full bg-[color:var(--pl-red-solid)]"
                      style={{ width: `${width}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </Surface>
        </section>
      )}

      <section>
        <SectionHeading hint="Newest first">Every entry</SectionHeading>
        <DataTable
          columns={columns}
          rows={entries}
          getRowKey={(row) => row.id}
          caption="Ad spend for the selected period"
          empty={
            adSpendState === "loading" ? (
              <span className="t-secondary">Loading…</span>
            ) : adSpendState !== "settled" ? (
              <div className="flex flex-col items-center gap-3 py-6 text-center">
                <p className="t-body text-[color:var(--pl-amber)]">
                  {figureStateSentence(adSpendState, "your ad spend")}
                </p>
                {adSpendState === "failed" && (
                  <Button variant="outline" onClick={() => adSpend.refetch()}>
                    Try again
                  </Button>
                )}
              </div>
            ) : (
              <div className="flex flex-col items-center gap-3 py-6 text-center">
                <p className="t-body text-[color:var(--pl-ink)]">
                  Log what you spent on ads to see whether it paid off.
                </p>
                <p className="t-secondary max-w-sm">
                  Until it's here, your profit looks better than it is.
                </p>
                <Button onClick={() => setOpen(true)}>Log spend</Button>
              </div>
            )
          }
        />
      </section>

      <LogSpendDialog
        open={open}
        onOpenChange={setOpen}
        knownPlatforms={(platforms ?? []).map((p) => p.name)}
        pending={logSpend.isPending}
        onSubmit={(body) =>
          logSpend.mutate(body, {
            onSuccess: () => {
              toast.success("Logged — your profit is updated");
              setOpen(false);
            },
            onError: (err) => toast.error(apiErrorMessage(err, "Couldn't save that")),
          })
        }
      />
    </div>
  );
}
