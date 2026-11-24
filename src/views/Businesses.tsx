import { useState } from "react";
import Link from "next/link";
import { ArrowRight, Loader2, Plus } from "lucide-react";
import type { BusinessType } from "@workspace/domain";
import { Surface } from "@/components/Surface";
import { Reveal, Stagger } from "@/components/Reveal";
import { Logo } from "@/components/Logo";
import { ThemeToggleCompact } from "@/components/ThemeToggle";
import { useBusinesses, useCreateBusiness } from "@/api/hooks";
import { BUSINESS_TYPE_OPTIONS, CURRENCY_OPTIONS, currencySymbolFor } from "@/lib/businessTypes";
import { getCurrentBusinessId } from "@/lib/currentBusiness";
import { BusinessCard } from "./Businesses.parts/BusinessCard";

function NewBusinessForm({ onDone }: { onDone: () => void }) {
  const createBusiness = useCreateBusiness();
  const [name, setName] = useState("");
  const [businessType, setBusinessType] = useState<BusinessType>("ecommerce");
  const [currency, setCurrency] = useState("PKR");
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const trimmed = name.trim();
    if (!trimmed || createBusiness.isPending) return;
    setError(null);
    try {
      await createBusiness.mutateAsync({
        name: trimmed,
        businessType,
        currency,
        currencySymbol: currencySymbolFor(currency),
      });
      onDone();
    } catch {
      setError("That didn't save. Check your connection and try again.");
    }
  }

  return (
    <Surface padding="md" className="space-y-4">
      <h2 className="t-section text-[color:var(--pl-ink)]">A new business</h2>
      <input
        value={name}
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") void submit();
        }}
        placeholder="What is it called?"
        autoFocus
        className="w-full rounded-[length:var(--pl-r-sm)] border border-[color:var(--pl-grid-line)] bg-[color:var(--pl-surface)] px-3 py-2.5 text-[color:var(--pl-ink)] outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--pl-orange)]"
      />
      <div className="grid gap-2 sm:grid-cols-2">
        <select
          value={businessType}
          onChange={(event) => setBusinessType(event.target.value as BusinessType)}
          className="rounded-[length:var(--pl-r-sm)] border border-[color:var(--pl-grid-line)] bg-[color:var(--pl-surface)] px-3 py-2.5 text-[color:var(--pl-ink)] outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--pl-orange)]"
        >
          {BUSINESS_TYPE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <select
          value={currency}
          onChange={(event) => setCurrency(event.target.value)}
          className="rounded-[length:var(--pl-r-sm)] border border-[color:var(--pl-grid-line)] bg-[color:var(--pl-surface)] px-3 py-2.5 text-[color:var(--pl-ink)] outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--pl-orange)]"
        >
          {CURRENCY_OPTIONS.map((option) => (
            <option key={option.code} value={option.code}>
              {option.label} ({option.symbol})
            </option>
          ))}
        </select>
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
          disabled={!name.trim() || createBusiness.isPending}
          className="pl-press inline-flex items-center justify-center gap-2 rounded-[length:var(--pl-r-full)] bg-[color:var(--pl-orange)] px-4 py-2 font-semibold text-[color:var(--pl-on-orange)] disabled:opacity-50"
        >
          {createBusiness.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
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

export default function Businesses() {
  const [showArchived, setShowArchived] = useState(false);
  const [adding, setAdding] = useState(false);
  const businesses = useBusinesses(showArchived);
  const currentId = getCurrentBusinessId();

  const items = businesses.data?.items ?? [];
  const hasArchived = items.some((business) => business.archivedAt !== null);

  return (
    <div className="min-h-dvh bg-[color:var(--pl-page)] px-5 py-10 sm:px-8 sm:py-14">
      <div className="mx-auto w-full max-w-5xl">
        <header className="mb-8 flex items-center justify-between gap-4">
          <Logo />
          <ThemeToggleCompact />
        </header>

        <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="t-hero text-[color:var(--pl-ink)]">Your businesses</h1>
            <p className="t-body mt-2 text-[color:var(--pl-ink-2)]">
              Each one keeps its own sales, costs and figures. Nothing crosses between them.
            </p>
          </div>
          {!adding && (
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="pl-press inline-flex items-center gap-2 rounded-[length:var(--pl-r-full)] border border-[color:var(--pl-grid-line)] px-4 py-2 font-medium text-[color:var(--pl-ink)] transition-colors hover:bg-[color:var(--pl-recessed)]"
            >
              <Plus className="h-4 w-4" />
              New business
            </button>
          )}
        </div>

        {adding && (
          <div className="mb-6">
            <NewBusinessForm onDone={() => setAdding(false)} />
          </div>
        )}

        {businesses.isPending && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[0, 1].map((i) => (
              <div key={i} className="h-48 animate-pulse rounded-[length:var(--pl-r-md)] bg-[color:var(--pl-recessed)]" />
            ))}
          </div>
        )}

        {businesses.isError && (
          // Amber, not red: colour means money, and a request that did not land
          // is not money lost (DESIGN.md §9).
          <Surface padding="md">
            <p className="t-secondary text-[color:var(--pl-amber)]">
              We couldn't load your businesses. The server didn't answer.
            </p>
            <button
              type="button"
              onClick={() => void businesses.refetch()}
              className="pl-press mt-3 rounded-[length:var(--pl-r-full)] border border-[color:var(--pl-grid-line)] px-4 py-2 text-[color:var(--pl-ink)] transition-colors hover:bg-[color:var(--pl-recessed)]"
            >
              Try again
            </button>
          </Surface>
        )}

        {businesses.isSuccess && items.length === 0 && (
          <Surface padding="lg" className="text-center">
            <p className="t-section text-[color:var(--pl-ink)]">Nothing here yet</p>
            <p className="t-secondary mx-auto mt-2 max-w-sm text-[color:var(--pl-ink-2)]">
              {showArchived
                ? "You have no businesses at all, archived or otherwise."
                : "Make your first one and Profit Loop will start keeping its books."}
            </p>
            <Link
              href="/welcome"
              className="pl-press mt-4 inline-flex items-center gap-2 rounded-[length:var(--pl-r-full)] bg-[color:var(--pl-orange)] px-5 py-2.5 font-semibold text-[color:var(--pl-on-orange)]"
            >
              Get started
              <ArrowRight className="h-4 w-4" />
            </Link>
          </Surface>
        )}

        {items.length > 0 && (
          <Stagger className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((business) => (
              <Reveal key={business.id} className="flex">
                <div className="flex w-full">
                  <BusinessCard business={business} isCurrent={business.id === currentId} />
                </div>
              </Reveal>
            ))}
          </Stagger>
        )}

        {(hasArchived || showArchived) && (
          <button
            type="button"
            onClick={() => setShowArchived((value) => !value)}
            className="t-secondary mt-6 text-[color:var(--pl-ink-2)] underline underline-offset-4 hover:text-[color:var(--pl-ink)]"
          >
            {showArchived ? "Hide archived" : "Show archived"}
          </button>
        )}
        {!hasArchived && !showArchived && items.length > 0 && (
          <button
            type="button"
            onClick={() => setShowArchived(true)}
            className="t-secondary mt-6 text-[color:var(--pl-ink-2)] underline underline-offset-4 hover:text-[color:var(--pl-ink)]"
          >
            Show archived
          </button>
        )}
      </div>
    </div>
  );
}
