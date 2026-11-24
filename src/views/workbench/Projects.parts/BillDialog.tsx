import { useState } from "react";
import { Loader2 } from "lucide-react";
import type { EndpointResponse, listProjects } from "@workspace/api-contract";
import { Surface } from "@/components/Surface";
import { useFormatters } from "@/lib/store";
import { useBillProject } from "@/api/hooks";

export type ProjectsResponse = EndpointResponse<typeof listProjects>;
export type ProjectRow = ProjectsResponse["items"][number];

/**
 * Raise an invoice against a project, optionally holding a percentage back.
 *
 * The retention half is why this dialog exists rather than pointing the owner at
 * Quick Add: a retained bill is TWO receivables with two different dates, and
 * asking someone to enter that by hand — twice, with the arithmetic done in
 * their head — is how it silently stops being done at all.
 */
export function BillDialog({ project, onDone }: { project: ProjectRow; onDone: () => void }) {
  const f = useFormatters();
  const billProject = useBillProject();
  const [amount, setAmount] = useState("");
  const [label, setLabel] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [retain, setRetain] = useState(false);
  const [retentionPct, setRetentionPct] = useState("10");
  const [retentionDueDate, setRetentionDueDate] = useState("");
  const [error, setError] = useState<string | null>(null);

  const rupees = Number(amount);
  const amountCents = Number.isFinite(rupees) && rupees > 0 ? Math.round(rupees * 100) : 0;
  const pct = Number(retentionPct);
  /**
   * A PREVIEW, and only a preview. The server splits the invoice for real with
   * the same domain function; this exists so the owner is not surprised by two
   * rows appearing. If the two ever disagree, the server's answer is the money.
   */
  const heldBackPreview =
    retain && amountCents > 0 && Number.isFinite(pct) && pct > 0
      ? Math.round((amountCents * pct) / 100)
      : 0;

  async function submit() {
    if (!amountCents || !label.trim() || billProject.isPending) return;
    setError(null);
    try {
      await billProject.mutateAsync({
        id: project.id,
        body: {
          amountCents,
          occurredAt: new Date().toISOString(),
          label: label.trim(),
          dueDate: dueDate || null,
          retentionPct: retain ? retentionPct : null,
          retentionDueDate: retain ? retentionDueDate || null : null,
        },
      });
      onDone();
    } catch (err) {
      const message = (err as { data?: { error?: { message?: string } } })?.data?.error?.message;
      setError(message ?? "That didn't save. Check your connection and try again.");
    }
  }

  const inputClass =
    "w-full rounded-[length:var(--pl-r-sm)] border border-[color:var(--pl-grid-line)] bg-[color:var(--pl-surface)] px-3 py-2.5 text-[color:var(--pl-ink)] outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--pl-orange)]";

  return (
    <Surface padding="md" className="space-y-4">
      <div>
        <h2 className="t-section text-[color:var(--pl-ink)]">Raise an invoice</h2>
        <p className="t-micro mt-1 text-[color:var(--pl-ink-3)]">{project.name}</p>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <input
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          placeholder="What it's for"
          autoFocus
          className={inputClass}
        />
        <input
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          inputMode="decimal"
          placeholder="Amount"
          className={inputClass}
        />
      </div>

      <label className="block">
        <span className="t-micro text-[color:var(--pl-ink-2)]">When is it due?</span>
        <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className={`${inputClass} mt-1`} />
      </label>

      <div className="rounded-[length:var(--pl-r-md)] border border-[color:var(--pl-grid-line)] p-3">
        <label className="flex items-center justify-between gap-3">
          <span>
            <span className="t-secondary block font-medium text-[color:var(--pl-ink)]">
              Hold some back until sign-off?
            </span>
            <span className="t-micro block text-[color:var(--pl-ink-3)]">
              You'll get two entries owed to you, each with its own date.
            </span>
          </span>
          <input
            type="checkbox"
            checked={retain}
            onChange={(event) => setRetain(event.target.checked)}
            className="h-5 w-5 shrink-0 accent-[color:var(--pl-orange)]"
          />
        </label>

        {retain && (
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <label className="block">
              <span className="t-micro text-[color:var(--pl-ink-2)]">How much, as a percentage</span>
              <input
                value={retentionPct}
                onChange={(event) => setRetentionPct(event.target.value)}
                inputMode="decimal"
                className={`${inputClass} mt-1`}
              />
            </label>
            <label className="block">
              <span className="t-micro text-[color:var(--pl-ink-2)]">When is that part due?</span>
              <input
                type="date"
                value={retentionDueDate}
                onChange={(event) => setRetentionDueDate(event.target.value)}
                className={`${inputClass} mt-1`}
              />
            </label>
            {heldBackPreview > 0 && (
              <p className="t-micro sm:col-span-2 text-[color:var(--pl-ink-2)]">
                {f.moneyCents(amountCents - heldBackPreview)} due now, {f.moneyCents(heldBackPreview)} held
                back until sign-off.
              </p>
            )}
          </div>
        )}
      </div>

      {error && (
        <p className="t-secondary text-[color:var(--pl-amber)]" role="alert">
          {error}
        </p>
      )}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => void submit()}
          disabled={!amountCents || !label.trim() || billProject.isPending}
          className="pl-press inline-flex items-center gap-2 rounded-[length:var(--pl-r-full)] bg-[color:var(--pl-orange)] px-4 py-2 font-semibold text-[color:var(--pl-on-orange)] disabled:opacity-50"
        >
          {billProject.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
          Raise it
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
