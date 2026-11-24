"use client";

import { useBusinesses } from "@/api/hooks";
import { AppLayout } from "@/components/AppLayout";
import { AppShellLoading } from "@/components/AppShellLoading";
import { ClientOnly } from "@/components/ClientOnly";
import { RouteErrorBoundary } from "@/components/ErrorBoundary";
import { Redirect } from "@/components/Redirect";
import { getCurrentBusinessId, setCurrentBusinessId } from "@/lib/currentBusiness";
import { GlobalPeriodProvider } from "@/lib/globalPeriod";
import { AppStoreProvider, useStore } from "@/lib/store";

function AppDataGate({ children }: { children: React.ReactNode }) {
  const { isLoading } = useStore();
  if (isLoading) return <AppShellLoading />;
  return <>{children}</>;
}

/**
 * WHICH BUSINESS this session is in, resolved before the app is allowed to draw.
 *
 * Nothing below here is meaningful without an answer: every figure, every list
 * and every chart belongs to one set of books, and rendering the shell first
 * would show a business's navigation while we work out whether there is one.
 *
 * Three outcomes, and the third is the interesting one:
 *   · owns nothing            → the welcome screen; there is no workspace to open
 *   · the stored id is good   → straight in
 *   · the stored id is stale, missing, or theirs no longer:
 *       – exactly one business → use it. Not a guess: it is the only candidate,
 *         and the server resolves an absent header the same way, so this only
 *         makes the choice visible rather than making a different one.
 *       – several              → the businesses page. Choosing for them would
 *         write money into the wrong books in silence.
 */
function BusinessGate({ children }: { children: React.ReactNode }) {
  const businesses = useBusinesses();
  const stored = getCurrentBusinessId();

  const items = businesses.data?.items ?? [];
  const active = items.find((business) => business.id === stored) ?? (items.length === 1 ? items[0] : null);

  // Written during render rather than in an effect on purpose: the very next
  // request must carry it, and an effect would run after the app below has
  // already started fetching without a header.
  if (active && active.id !== stored) setCurrentBusinessId(active.id);

  if (businesses.isPending) return <AppShellLoading />;

  if (businesses.isError) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-[color:var(--pl-page)] px-6">
        <div className="max-w-sm text-center">
          {/* Amber, not red: a request that did not land is not money lost. */}
          <p className="t-section text-[color:var(--pl-amber)]">We couldn&apos;t reach your businesses</p>
          <p className="t-secondary mt-2 text-[color:var(--pl-ink-2)]">
            The server didn&apos;t answer. Nothing is lost — try again in a moment.
          </p>
          <button
            type="button"
            onClick={() => void businesses.refetch()}
            className="pl-press mt-4 rounded-[length:var(--pl-r-full)] bg-[color:var(--pl-orange)] px-5 py-2.5 font-semibold text-[color:var(--pl-on-orange)]"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  if (items.length === 0) return <Redirect to="/welcome" />;
  if (!active) return <Redirect to="/businesses" />;

  return <>{children}</>;
}

/** Every screen that belongs to one business: sidebar, period filter, store. */
export function BusinessShell({ children }: { children: React.ReactNode }) {
  return (
    <ClientOnly fallback={<AppShellLoading />}>
      <BusinessGate>
        <AppStoreProvider>
          <GlobalPeriodProvider>
            <AppDataGate>
              <AppLayout>
                {/* Inside the layout, so a page that fails leaves the nav usable. */}
                <RouteErrorBoundary>{children}</RouteErrorBoundary>
              </AppLayout>
            </AppDataGate>
          </GlobalPeriodProvider>
        </AppStoreProvider>
      </BusinessGate>
    </ClientOnly>
  );
}
