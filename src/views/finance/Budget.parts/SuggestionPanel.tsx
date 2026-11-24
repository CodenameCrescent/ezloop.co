import { useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import type { EndpointResponse, getBudget as getBudgetContract } from "@workspace/api-contract";
import { Surface } from "@/components/Surface";
import { useFormatters } from "@/lib/store";
import { useCreateBudget, useUpdateBudget, useBudgetSuggestion } from "@/api/hooks";

export type BudgetDetail = EndpointResponse<typeof getBudgetContract>;

/** This calendar year, which is what most owners mean by "my budget". */
export function defaultSpan() {
  const year = new Date().getUTCFullYear();
  return { start: `${year}-01-01`, end: `${year}-12-31` };
}

export function NewBudgetForm({ onDone }: { onDone: (id: string) => void }) {
  const createBudget = useCreateBudget();
  const span = useMemo(defaultSpan, []);
  const [name, setName] = useState(`Budget ${new Date().getUTCFullYear()}`);
  const [periodStart, setPeriodStart] = useState(span.start);
  const [periodEnd, setPeriodEnd] = useState(span.end);
  const [target, setTarget] = useState("");
  const [error, setError] = useState<string | null>(null);

  const inputClass =
    "w-full rounded-[length:var(--pl-r-sm)] border border-[color:var(--pl-grid-line)] bg-[color:var(--pl-surface)] px-3 py-2.5 text-[color:var(--pl-ink)] outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--pl-orange)]";

  async function submit() {
    if (!name.trim() || createBudget.isPending) return;
    setError(null);
    const rupees = Number(target);
    try {
      const created = await createBudget.mutateAsync({
        name: name.trim(),
        periodStart,
        periodEnd,
        // Whole currency in, minor units stored. A unit conversion, not a
        // calculation — every figure on this page is computed on the server.
        targetProfitCents: target.trim() && Number.isFinite(rupees) ? Math.round(rupees * 100) : null,
      });
      onDone(created.id);
    } catch {
      setError("That didn't save. Check your connection and try again.");
    }
  }

  return (
    <Surface padding="md" className="space-y-4">
      <h2 className="t-section text-[color:var(--pl-ink)]">A new budget</h2>
      <input value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
      <div className="grid gap-2 sm:grid-cols-3">
        <label className="block">
          <span className="t-micro text-[color:var(--pl-ink-2)]">From</span>
          <input type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} className={`${inputClass} mt-1`} />
        </label>
        <label className="block">
          <span className="t-micro text-[color:var(--pl-ink-2)]">To</span>
          <input type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} className={`${inputClass} mt-1`} />
        </label>
        <label className="block">
          <span className="t-micro text-[color:var(--pl-ink-2)]">Profit you want (optional)</span>
          <input value={target} onChange={(e) => setTarget(e.target.value)} inputMode="decimal" placeholder="e.g. 2000000" className={`${inputClass} mt-1`} />
        </label>
      </div>
      <p className="t-micro text-[color:var(--pl-ink-3)]">
        A profit goal is optional. Capping your spending without saying what you want left over
        is a real way to use a budget, and the page will not invent a target you did not set.
      </p>
      {error && <p className="t-secondary text-[color:var(--pl-amber)]" role="alert">{error}</p>}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => void submit()}
          disabled={!name.trim() || createBudget.isPending}
          className="pl-press inline-flex items-center gap-2 rounded-[length:var(--pl-r-full)] bg-[color:var(--pl-orange)] px-4 py-2 font-semibold text-[color:var(--pl-on-orange)] disabled:opacity-50"
        >
          {createBudget.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
          Create
        </button>
      </div>
    </Surface>
  );
}

/**
 * The first draft, built from real history.
 *
 * The adoption feature. A blank budget form never gets filled in — this reads
 * what the business actually spends and proposes a typical month, so the owner
 * edits rather than invents.
 */
export function SuggestionPanel({ budget, onDone }: { budget: BudgetDetail["budget"]; onDone: () => void }) {
  const f = useFormatters();
  const updateBudget = useUpdateBudget();
  const suggestion = useBudgetSuggestion(6, true);
  const [chosen, setChosen] = useState<Set<string> | null>(null);

  const lines = suggestion.data?.lines ?? [];
  const keyOf = (line: (typeof lines)[number]) => `${line.side}:${line.expenseItemId ?? line.revenueItemId}`;
  // Everything is ticked to begin with — the point is to accept a draft, not to
  // build one from an empty list a second time.
  const selected = chosen ?? new Set(lines.map(keyOf));

  async function apply() {
    await updateBudget.mutateAsync({
      id: budget.id,
      body: {
        lines: lines
          .filter((line) => selected.has(keyOf(line)))
          .map((line) => ({
            side: line.side,
            expenseItemId: line.expenseItemId,
            revenueItemId: line.revenueItemId,
            amountCents: line.medianMonthCents,
            basis: "per_month" as const,
          })),
      },
    });
    onDone();
  }

  return (
    <Surface padding="md" className="space-y-4">
      <div>
        <h2 className="t-section text-[color:var(--pl-ink)]">Start from what you actually spend</h2>
        <p className="t-secondary mt-1 text-[color:var(--pl-ink-2)]">
          A typical month over the last six, per thing. Untick anything you would rather leave
          out, then save it as your starting point.
        </p>
      </div>

      {suggestion.isPending && <p className="t-secondary text-[color:var(--pl-ink-2)]">Reading your history…</p>}

      {suggestion.isSuccess && lines.length === 0 && (
        <p className="t-secondary text-[color:var(--pl-ink-2)]">
          There is not enough history yet to suggest anything. Add your budget lines by hand for
          now, and this will get useful once a few months have gone by.
        </p>
      )}

      {lines.length > 0 && (
        <ul className="divide-y divide-[color:var(--pl-grid-line)]">
          {lines.map((line) => {
            const key = keyOf(line);
            const differs = Math.abs(line.meanMonthCents - line.medianMonthCents) > line.medianMonthCents * 0.25;
            return (
              <li key={key} className="flex items-center gap-3 py-2.5">
                <input
                  type="checkbox"
                  checked={selected.has(key)}
                  onChange={(event) => {
                    const next = new Set(selected);
                    if (event.target.checked) next.add(key);
                    else next.delete(key);
                    setChosen(next);
                  }}
                  className="h-4 w-4 shrink-0 accent-[color:var(--pl-orange)]"
                />
                <span className="t-secondary min-w-0 flex-1 truncate text-[color:var(--pl-ink)]">
                  {line.name}
                  <span className="t-micro ml-2 text-[color:var(--pl-ink-3)]">
                    {line.side === "in" ? "income" : "cost"}
                  </span>
                </span>
                <span className="t-num shrink-0 text-[color:var(--pl-ink)]">
                  {f.moneyCents(line.medianMonthCents)}/mo
                </span>
                {/* Shown only when the two disagree enough to matter — one big
                    purchase pulls the average far from a typical month, and that
                    gap is worth seeing rather than hiding. */}
                {differs && (
                  <span className="t-micro hidden shrink-0 text-[color:var(--pl-ink-3)] sm:inline">
                    avg {f.moneyCents(line.meanMonthCents)}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => void apply()}
          disabled={lines.length === 0 || updateBudget.isPending}
          className="pl-press inline-flex items-center gap-2 rounded-[length:var(--pl-r-full)] bg-[color:var(--pl-orange)] px-4 py-2 font-semibold text-[color:var(--pl-on-orange)] disabled:opacity-50"
        >
          {updateBudget.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
          Use these
        </button>
        <button
          type="button"
          onClick={onDone}
          className="pl-press rounded-[length:var(--pl-r-full)] px-4 py-2 text-[color:var(--pl-ink-2)] transition-colors hover:bg-[color:var(--pl-recessed)]"
        >
          Cancel
        </button>
      </div>
    </Surface>
  );
}
