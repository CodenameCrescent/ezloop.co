import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Loader2, Sparkles } from "lucide-react";
import type { BusinessType } from "@workspace/domain";
import { Surface } from "@/components/Surface";
import { Reveal, Stagger } from "@/components/Reveal";
import { Logo } from "@/components/Logo";
import { ThemeToggleCompact } from "@/components/ThemeToggle";
import { useCreateBusiness } from "@/api/hooks";
import * as api from "@/lib/api-helpers/client";

import { BUSINESS_TYPE_OPTIONS, CURRENCY_OPTIONS, currencySymbolFor } from "@/lib/businessTypes";
import { setCurrentBusinessId, switchBusiness } from "@/lib/currentBusiness";
import { cn } from "@/lib/utils";

/**
 * What a brand-new account sees, and the only screen in the app that exists
 * before there is a business to be in.
 *
 * Two doors, deliberately. The form is the real one. The sample-data door
 * matters because a profit tool is impossible to judge empty — every screen is
 * an empty state, the charts have nothing to draw, and the honest reaction is
 * "there is nothing here". Nineteen months of a real-shaped business answers the
 * question the form cannot: what does this actually tell me?
 */

/** Three sentences. What the app does, said as the job it does for the owner. */
const PROMISES = [
  {
    title: "Where the money actually went",
    body: "Every sale and every cost in one ledger, with the profit worked out for you — gross, after costs, and what is really left.",
  },
  {
    title: "What is quietly losing money",
    body: "The thing you sell that costs more than it earns, the fee that crept up, the customer who stopped coming back.",
  },
  {
    title: "What to do about it",
    body: "Plain sentences, not a spreadsheet. What changed, how much it cost you, and what would fix it.",
  },
];

export default function Welcome() {
  const queryClient = useQueryClient();
  const createBusiness = useCreateBusiness();

  const [name, setName] = useState("");
  const [businessType, setBusinessType] = useState<BusinessType>("ecommerce");
  const [currency, setCurrency] = useState("PKR");
  const [seeding, setSeeding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const busy = createBusiness.isPending || seeding;
  const trimmedName = name.trim();

  async function create(withSampleData: boolean) {
    if (!trimmedName || busy) return;
    setError(null);
    try {
      const business = await createBusiness.mutateAsync({
        name: trimmedName,
        businessType,
        currency,
        currencySymbol: currencySymbolFor(currency),
      });
      if (withSampleData) {
        setSeeding(true);
        // Written BEFORE the seed call, because the seed has to land in the
        // business we just made — and the request reads its target from here.
        setCurrentBusinessId(business.id);
        await api.seedDemoData();
      }
      switchBusiness(business.id, queryClient);
    } catch {
      setSeeding(false);
      setError("That didn't save. Check your connection and try again.");
    }
  }

  return (
    <div className="min-h-dvh bg-[color:var(--pl-page)] px-5 py-10 sm:px-8 sm:py-16">
      <div className="mx-auto w-full max-w-5xl">
        <header className="mb-10 flex items-center justify-between gap-4">
          <Logo />
          <ThemeToggleCompact />
        </header>

        <Stagger className="grid gap-8 lg:grid-cols-[1fr_1.1fr] lg:gap-12">
          <Reveal className="space-y-8">
            <div>
              <h1 className="t-hero text-[color:var(--pl-ink)]">Welcome to Profit Loop</h1>
              <p className="t-body mt-4 max-w-md text-[color:var(--pl-ink-2)]">
                It works out what your business actually earns, and tells you in plain English
                what is helping and what is not. Start by naming the first one.
              </p>
            </div>

            <ul className="space-y-5">
              {PROMISES.map((promise) => (
                <li key={promise.title}>
                  <p className="t-secondary font-semibold text-[color:var(--pl-ink)]">{promise.title}</p>
                  <p className="t-secondary mt-1 text-[color:var(--pl-ink-2)]">{promise.body}</p>
                </li>
              ))}
            </ul>
          </Reveal>

          <Reveal>
            <Surface variant="hero" padding="lg" className="space-y-6">
              <div>
                <h2 className="t-section text-[color:var(--pl-ink)]">Your first business</h2>
                <p className="t-secondary mt-1 text-[color:var(--pl-ink-2)]">
                  You can add more later, and keep their books completely separate.
                </p>
              </div>

              <label className="block">
                <span className="t-secondary font-medium text-[color:var(--pl-ink)]">What is it called?</span>
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void create(false);
                  }}
                  placeholder="Ahmad Builders"
                  autoFocus
                  className="mt-2 w-full rounded-[length:var(--pl-r-sm)] border border-[color:var(--pl-grid-line)] bg-[color:var(--pl-surface)] px-3 py-2.5 text-[color:var(--pl-ink)] outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--pl-orange)]"
                />
              </label>

              <fieldset>
                <legend className="t-secondary font-medium text-[color:var(--pl-ink)]">
                  What kind of business is it?
                </legend>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {BUSINESS_TYPE_OPTIONS.map((option) => {
                    const checked = businessType === option.value;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => setBusinessType(option.value)}
                        aria-pressed={checked}
                        className={cn(
                          "pl-press rounded-[length:var(--pl-r-md)] border p-3 text-left transition-colors",
                          checked
                            ? "border-[color:var(--pl-orange)] bg-[color:var(--pl-orange-tint)]"
                            : "border-[color:var(--pl-grid-line)] hover:bg-[color:var(--pl-recessed)]",
                        )}
                      >
                        <span className="t-secondary block font-semibold text-[color:var(--pl-ink)]">
                          {option.label}
                        </span>
                        <span className="t-micro mt-1 block text-[color:var(--pl-ink-2)]">
                          {option.description}
                        </span>
                      </button>
                    );
                  })}
                </div>
                <p className="t-micro mt-2 text-[color:var(--pl-ink-3)]">
                  This only decides what you see. You can change it whenever you like.
                </p>
              </fieldset>

              <label className="block">
                <span className="t-secondary font-medium text-[color:var(--pl-ink)]">
                  What money does it deal in?
                </span>
                <select
                  value={currency}
                  onChange={(event) => setCurrency(event.target.value)}
                  className="mt-2 w-full rounded-[length:var(--pl-r-sm)] border border-[color:var(--pl-grid-line)] bg-[color:var(--pl-surface)] px-3 py-2.5 text-[color:var(--pl-ink)] outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--pl-orange)]"
                >
                  {CURRENCY_OPTIONS.map((option) => (
                    <option key={option.code} value={option.code}>
                      {option.label} ({option.symbol})
                    </option>
                  ))}
                </select>
              </label>

              {error && (
                <p className="t-secondary text-[color:var(--pl-amber)]" role="alert">
                  {error}
                </p>
              )}

              <div className="space-y-2.5">
                <button
                  type="button"
                  onClick={() => void create(false)}
                  disabled={!trimmedName || busy}
                  className="pl-press inline-flex w-full items-center justify-center gap-2 rounded-[length:var(--pl-r-full)] bg-[color:var(--pl-orange)] px-5 py-3 font-semibold text-[color:var(--pl-on-orange)] transition-opacity disabled:opacity-50"
                >
                  {createBusiness.isPending && !seeding ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <ArrowRight className="h-4 w-4" />
                  )}
                  Create it and start
                </button>

                <button
                  type="button"
                  onClick={() => void create(true)}
                  disabled={!trimmedName || busy}
                  className="pl-press inline-flex w-full items-center justify-center gap-2 rounded-[length:var(--pl-r-full)] border border-[color:var(--pl-grid-line)] px-5 py-3 font-medium text-[color:var(--pl-ink)] transition-colors hover:bg-[color:var(--pl-recessed)] disabled:opacity-50"
                >
                  {seeding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                  {seeding ? "Filling it with sample data…" : "Fill it with sample data first"}
                </button>
                <p className="t-micro text-[color:var(--pl-ink-3)]">
                  Sample data is a made-up business with about two years of history, so every screen
                  has something real to show. You can clear it from Settings at any time.
                </p>
              </div>
            </Surface>
          </Reveal>
        </Stagger>
      </div>
    </div>
  );
}
