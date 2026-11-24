import { useState } from "react";
import { Loader2, Plus, ReceiptText } from "lucide-react";
import type { ProjectStatusShape } from "@workspace/api-contract";
import { TopBar } from "@/components/TopBar";
import { Surface } from "@/components/Surface";
import { Reveal, Stagger } from "@/components/Reveal";
import { FigureSlot } from "@/components/FigureSlot";
import { Meter } from "@/components/charts/Meter";
import { figureState } from "@/lib/figureState";
import { useFormatters } from "@/lib/store";
import { useCreateProject, useProjects } from "@/api/hooks";
import { cn } from "@/lib/utils";
import { type ProjectRow, BillDialog } from "./Projects.parts/BillDialog";

/**
 * Sites, contracts and production runs — the container costs and revenue point
 * at, so "did I make money on THAT one" becomes an answerable question.
 *
 * The word is the trade's own, and it comes from the SERVER
 * (`projectLabel(businessType)`), not from a guess here: a factory runs
 * production runs and a builder runs projects, and asking either to translate is
 * the small friction that makes software feel written for somebody else.
 */

const STATUS_LABELS: Record<ProjectStatusShape, string> = {
  quoted: "Quoted",
  active: "In progress",
  on_hold: "On hold",
  completed: "Finished",
  cancelled: "Cancelled",
};

/** Order matters: this is how the list reads top to bottom. */
const STATUS_ORDER: ProjectStatusShape[] = ["active", "quoted", "on_hold", "completed", "cancelled"];

function ProjectCard({ project, onBill }: { project: ProjectRow; onBill: () => void }) {
  const f = useFormatters();
  const { money } = project;
  const profitable = money.contributionProfitCents > 0;
  const loss = money.contributionProfitCents < 0;

  return (
    <Surface padding="md" className="flex h-full flex-col gap-4">
      <div>
        <div className="flex items-start justify-between gap-3">
          <h2 className="t-section min-w-0 truncate text-[color:var(--pl-ink)]">{project.name}</h2>
          <span className="t-micro shrink-0 rounded-[length:var(--pl-r-sm)] bg-[color:var(--pl-recessed)] px-2 py-1 text-[color:var(--pl-ink-2)]">
            {STATUS_LABELS[project.status]}
          </span>
        </div>
        <p className="t-micro mt-1 truncate text-[color:var(--pl-ink-3)]">
          {[project.code, project.personName].filter(Boolean).join(" · ") || "No customer recorded"}
        </p>
      </div>

      <div>
        <p className="t-micro text-[color:var(--pl-ink-3)]">Profit so far</p>
        <p className="t-title mt-1">
          <span
            className={cn(
              profitable && "text-[color:var(--pl-green)]",
              loss && "text-[color:var(--pl-red)]",
              !profitable && !loss && "text-[color:var(--pl-ink)]",
            )}
          >
            {/* Sign as well as colour — green and red do not separate under
                colour blindness (DESIGN.md §3a). */}
            {profitable ? "+" : loss ? "-" : ""}
            {f.moneyCents(Math.abs(money.contributionProfitCents))}
          </span>
        </p>
        {/* The sentence that stops this figure being read as cash in hand. */}
        <p className="t-micro mt-1 text-[color:var(--pl-ink-3)]">
          Before your fixed running costs
          {money.marginPct !== null && ` · ${money.marginPct.toFixed(1)}% of what you billed`}
        </p>
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
        <div>
          <dt className="t-micro text-[color:var(--pl-ink-3)]">Billed</dt>
          <dd className="t-secondary t-num text-[color:var(--pl-ink)]">{f.moneyCents(money.billedCents)}</dd>
        </div>
        <div>
          <dt className="t-micro text-[color:var(--pl-ink-3)]">Cost so far</dt>
          <dd className="t-secondary t-num text-[color:var(--pl-ink)]">{f.moneyCents(money.costToDateCents)}</dd>
        </div>
        {money.stillOwedCents > 0 && (
          <div>
            <dt className="t-micro text-[color:var(--pl-ink-3)]">Still owed</dt>
            <dd className="t-secondary t-num text-[color:var(--pl-ink)]">{f.moneyCents(money.stillOwedCents)}</dd>
          </div>
        )}
        {money.costPerUnitCents !== null && (
          <div>
            <dt className="t-micro text-[color:var(--pl-ink-3)]">
              Cost per {project.outputUnitLabel ?? "unit"}
            </dt>
            <dd className="t-secondary t-num text-[color:var(--pl-ink)]">
              {f.moneyCents(money.costPerUnitCents)}
            </dd>
          </div>
        )}
      </dl>

      <div className="mt-auto">
        <button
          type="button"
          onClick={onBill}
          className="pl-press inline-flex w-full items-center justify-center gap-2 rounded-[length:var(--pl-r-full)] border border-[color:var(--pl-grid-line)] px-4 py-2 text-[color:var(--pl-ink)] transition-colors hover:bg-[color:var(--pl-recessed)]"
        >
          <ReceiptText className="h-4 w-4" />
          Raise an invoice
        </button>
      </div>

      {project.contractValueCents !== null && money.billedPct !== null && (
        <div>
          <div className="flex items-center justify-between">
            <span className="t-micro text-[color:var(--pl-ink-3)]">
              Billed {money.billedPct.toFixed(0)}% of {f.moneyCents(project.contractValueCents)}
            </span>
          </div>
          <div className="mt-1.5">
            {/* Over 100% is not good news here — it means billing past the
                contract, which somebody has to have agreed to. */}
            <Meter
              value={Math.min(100, money.billedPct)}
              tone={money.billedPct > 100 ? "loss" : "neutral"}
              inline
            />
          </div>
        </div>
      )}
    </Surface>
  );
}

function NewProjectForm({ label, onDone }: { label: string; onDone: () => void }) {
  const createProject = useCreateProject();
  const [name, setName] = useState("");
  const [customer, setCustomer] = useState("");
  const [contractValue, setContractValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const trimmed = name.trim();
    if (!trimmed || createProject.isPending) return;
    setError(null);
    const rupees = Number(contractValue);
    try {
      await createProject.mutateAsync({
        name: trimmed,
        personName: customer.trim() || null,
        // The one place this screen touches money, and it is a UNIT conversion
        // rather than a calculation: the owner types whole currency, the ledger
        // stores minor units. Every figure shown is computed on the server.
        contractValueCents: contractValue.trim() && Number.isFinite(rupees) ? Math.round(rupees * 100) : null,
      });
      onDone();
    } catch {
      setError("That didn't save. Check your connection and try again.");
    }
  }

  const inputClass =
    "w-full rounded-[length:var(--pl-r-sm)] border border-[color:var(--pl-grid-line)] bg-[color:var(--pl-surface)] px-3 py-2.5 text-[color:var(--pl-ink)] outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--pl-orange)]";

  return (
    <Surface padding="md" className="space-y-4">
      <h2 className="t-section text-[color:var(--pl-ink)]">A new {label.toLowerCase()}</h2>
      <input
        value={name}
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") void submit();
        }}
        placeholder="What is it called?"
        autoFocus
        className={inputClass}
      />
      <div className="grid gap-2 sm:grid-cols-2">
        <input
          value={customer}
          onChange={(event) => setCustomer(event.target.value)}
          placeholder="Customer (optional)"
          className={inputClass}
        />
        <input
          value={contractValue}
          onChange={(event) => setContractValue(event.target.value)}
          inputMode="decimal"
          placeholder="What it's worth (optional)"
          className={inputClass}
        />
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
          disabled={!name.trim() || createProject.isPending}
          className="pl-press inline-flex items-center gap-2 rounded-[length:var(--pl-r-full)] bg-[color:var(--pl-orange)] px-4 py-2 font-semibold text-[color:var(--pl-on-orange)] disabled:opacity-50"
        >
          {createProject.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
          Create
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

export default function Projects() {
  const projects = useProjects();
  const [adding, setAdding] = useState(false);
  const [billing, setBilling] = useState<string | null>(null);
  const state = figureState(projects, projects.data != null);

  const label = projects.data?.label ?? { one: "Project", many: "Projects" };
  const items = projects.data?.items ?? [];
  const ordered = [...items].sort(
    (a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status),
  );

  return (
    <>
      <TopBar
        title={label.many}
        subtitle={`What each one has earned, what it has cost, and what is left to bill`}
      />
      <div className="app-page-shell">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="t-secondary max-w-2xl text-[color:var(--pl-ink-2)]">
            {/* The rule this page must never let anyone misread. */}
            Every figure here is profit <strong>before your fixed running costs</strong> — rent,
            wages and the like are never split across {label.many.toLowerCase()}, because no
            honest split exists.
          </p>
          {!adding && (
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="pl-press inline-flex shrink-0 items-center gap-2 rounded-[length:var(--pl-r-full)] border border-[color:var(--pl-grid-line)] px-4 py-2 font-medium text-[color:var(--pl-ink)] transition-colors hover:bg-[color:var(--pl-recessed)]"
            >
              <Plus className="h-4 w-4" />
              New {label.one.toLowerCase()}
            </button>
          )}
        </div>

        {adding && <NewProjectForm label={label.one} onDone={() => setAdding(false)} />}

        {billing && items.some((project) => project.id === billing) && (
          <BillDialog
            project={items.find((project) => project.id === billing)!}
            onDone={() => setBilling(null)}
          />
        )}

        {state === "loading" && (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="h-56 animate-pulse rounded-[length:var(--pl-r-md)] bg-[color:var(--pl-recessed)]"
              />
            ))}
          </div>
        )}

        {(state === "failed" || state === "offline") && (
          <Surface padding="md">
            <p className="t-secondary text-[color:var(--pl-amber)]">
              <FigureSlot state={state}>{null}</FigureSlot>
            </p>
            <button
              type="button"
              onClick={() => void projects.refetch()}
              className="pl-press mt-3 rounded-[length:var(--pl-r-full)] border border-[color:var(--pl-grid-line)] px-4 py-2 text-[color:var(--pl-ink)] transition-colors hover:bg-[color:var(--pl-recessed)]"
            >
              Try again
            </button>
          </Surface>
        )}

        {state === "settled" && ordered.length === 0 && !adding && (
          <Surface padding="lg" className="text-center">
            <p className="t-section text-[color:var(--pl-ink)]">No {label.many.toLowerCase()} yet</p>
            <p className="t-secondary mx-auto mt-2 max-w-md text-[color:var(--pl-ink-2)]">
              Make one, then point costs and invoices at it. You will be able to see what it
              earned and what it consumed, separately from everything else you do.
            </p>
          </Surface>
        )}

        {ordered.length > 0 && (
          <Stagger className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {ordered.map((project) => (
              <Reveal key={project.id} className="flex">
                <div className="flex w-full">
                  <ProjectCard project={project} onBill={() => setBilling(project.id)} />
                </div>
              </Reveal>
            ))}
          </Stagger>
        )}
      </div>
    </>
  );
}
