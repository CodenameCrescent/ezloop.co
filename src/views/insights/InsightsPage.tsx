import { useMemo } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Redirect } from "@/components/Redirect";
import {
  BarChart3,
  CircleAlert,
  LayoutDashboard,
  Lightbulb,
  Megaphone,
  Package,
  Sparkles,
  TrendingUp,
  Users2,
  Wallet,
} from "lucide-react";
import { TopBar } from "@/components/TopBar";
import { InsightsPeriodProvider, type InsightsPeriodValue } from "@/lib/insightsContext";
import { useGlobalPeriod } from "@/lib/globalPeriod";
import { GlobalPeriodFilter } from "@/components/GlobalPeriodFilter";
import { useStore } from "@/lib/store";
import { navHrefAllowed } from "@/components/navVisibility";
import { cn } from "@/lib/utils";
import Summary from "./Summary";
import Money from "./Money";
import Offers from "./Offers";
import People from "./People";
import Marketing from "./Marketing";
import Profitability from "@/views/workbench/Profitability";
import CommandCenter from "./CommandCenter";
import InsightsClients from "./InsightsClients";
import ProfitInsights from "./ProfitInsights";
import LeaksInsights from "./LeaksInsights";

/**
 * Insights shell.
 *
 * EVERY page is in this nav, including the ones the five-page rebuild will
 * eventually fold in or retire. Owner's call (2026-08-14): nothing is hidden
 * while the rebuild is in flight, so what exists can be seen and judged rather
 * than rediscovered. The five-page brief's target set is Summary · Money ·
 * Offers · People · Marketing; the rest are marked below with what happens to
 * them, and none of them are removed until that is decided deliberately.
 */
const NAV = [
  // The five-page target set, in the brief's order.
  { slug: "", label: "Summary", icon: Sparkles },
  { slug: "money", label: "Money", icon: Wallet },
  { slug: "offers", label: "Offers", icon: Package },
  { slug: "people", label: "People", icon: Users2 },
  { slug: "marketing", label: "Marketing", icon: Megaphone },

  // Still here, still reachable. Leaks is a LENS in the brief (the toggle on
  // Summary) rather than a page; Overview and Profit predate Summary and Money
  // and answer the same questions with charts.
  { slug: "customers", label: "Customers", icon: Users2 },
  { slug: "leaks", label: "Leaks", icon: CircleAlert },
  { slug: "overview", label: "Overview", icon: LayoutDashboard },
  { slug: "profit", label: "Profit", icon: BarChart3 },
  { slug: "worth-having", label: "Worth having", icon: TrendingUp },
] as const;

const DEEP_PAGES = new Set([
  "money",
  "offers",
  "people",
  "marketing",
  "leaks",
  "customers",
  "overview",
  "profit",
  "worth-having",
]);

// Old rule-tab slugs → the nearest new page (bookmarks keep working).
const LEGACY_REDIRECT: Record<string, string> = {
  "profit-leaks": "/insights/leaks",
  financial: "/insights/leaks",
  clients: "/insights/customers",
  "clients-customers": "/insights/customers",
  customers: "/insights/customers",
};

export default function InsightsPage() {
  // Mounted at /insights/[[...tab]], so the segment arrives as an array.
  const params = useParams<{ tab?: string[] }>();
  const tab = params.tab?.[0];
  const { range } = useGlobalPeriod();
  // Above the redirect below, because it is a hook and that is an early return.
  const { settings: storeSettings } = useStore();
  const ctxValue: InsightsPeriodValue = useMemo(() => ({ range }), [range]);

  // A slug that isn't Overview or a live deep page is a retired legacy tab.
  if (tab && !DEEP_PAGES.has(tab)) {
    return <Redirect to={LEGACY_REDIRECT[tab] ?? "/insights"} />;
  }
  const activeSlug = tab ?? "";

  /*
   * This strip is the THIRD place the nav is drawn, and it was the third to
   * ignore the feature flags — "Worth having" sat here for every business,
   * including the ones whose `/client-profitability/*` endpoints answer 403.
   * The page then reports that as "You're offline", so the tab was not merely
   * decorative.
   *
   * Same rule as the sidebar, from the same module, rather than a fourth
   * opinion. `showProjects` is irrelevant here — no Insights tab is gated on
   * it — but the shape is the shared one, so nothing has to be remembered if a
   * tab later is.
   */
  const features = {
    showTeam: storeSettings.features?.client_profitability ?? false,
    showProjects: storeSettings.features?.projects ?? false,
  };
  const visibleNav = NAV.filter((item) =>
    navHrefAllowed(item.slug ? `/insights/${item.slug}` : "/insights", features),
  );

  return (
    <>
      <TopBar title="Insights" subtitle="Answers first: what your money is doing, what changed, and what to do next." />

      <div className="border-b border-[color:var(--pl-light-grey)] bg-[color:color-mix(in_srgb,var(--pl-bg)_72%,transparent)] px-4 py-4 sm:px-6 lg:px-8">
        <div className="mx-auto flex max-w-[1500px] flex-col gap-3">
          <nav className="flex gap-2 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {visibleNav.map((item) => {
              const Icon = item.icon;
              const active = item.slug === activeSlug;
              return (
                <Link
                  key={item.slug || "summary"}
                  href={item.slug ? `/insights/${item.slug}` : "/insights"}
                  className={cn(
                    "inline-flex shrink-0 items-center gap-2 rounded-full border px-3.5 py-2 text-sm font-medium transition",
                    active
                      ? "bg-[color:var(--pl-orange-tint)] text-[color:var(--pl-orange-text)]"
                      : "border-[color:var(--glass-border)] bg-[color:var(--glass-bg-flat)] text-[color:var(--pl-ink-2)] hover:text-[color:var(--pl-ink)]",
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {item.label}
                </Link>
              );
            })}
          </nav>

          <div className="flex flex-wrap items-center gap-3">
            <span className="inline-flex items-center gap-2 text-xs font-semibold text-[color:var(--pl-ink-2)]">
              <Lightbulb className="h-3.5 w-3.5 text-[color:var(--pl-orange-text)]" />
              Shared period
            </span>
            <GlobalPeriodFilter />
            <span className="text-xs text-[color:var(--pl-mid-grey)]">
              {range.label} · compared with the prior {range.days} days
            </span>
          </div>
        </div>
      </div>

      <InsightsPeriodProvider value={ctxValue}>
        {tab === "money" ? (
          <Money />
        ) : tab === "offers" ? (
          <Offers />
        ) : tab === "people" ? (
          <People />
        ) : tab === "marketing" ? (
          <Marketing />
        ) : tab === "profit" ? (
          /* Predates Money, which answers the same question with a waterfall
             instead of a time series. Kept until the rebuild decides its fate. */
          <ProfitInsights />
        ) : tab === "leaks" ? (
          <LeaksInsights />
        ) : tab === "customers" ? (
          <InsightsClients />
        ) : tab === "worth-having" ? (
          <Profitability />
        ) : tab === "overview" ? (
          /* Predates Summary. Same question, charts instead of a score. */
          <CommandCenter />
        ) : (
          <Summary />
        )}
      </InsightsPeriodProvider>
    </>
  );
}
