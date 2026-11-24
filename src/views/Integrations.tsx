import { useMemo, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  Boxes,
  CheckCircle2,
  Loader2,
  Megaphone,
  Plug,
  ShoppingBag,
  SlidersHorizontal,
} from "lucide-react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";

import { TopBar } from "@/components/TopBar";
import { Button } from "@/components/ui/button";
import { useFormatters } from "@/lib/store";
import { useIntegrations as useListIntegrations } from "@/api/hooks";
import { figureState, figureStateSentence } from "@/lib/figureState";
import { LIVE_INTEGRATION_KINDS, type IntegrationKindShape as IntegrationKind } from "@workspace/api-contract";
import { CATALOG, IntegrationCard } from "./integrations/IntegrationsGrid";

type FilterId = "all" | "sales" | "ads";

type SectionDef = {
  id: Exclude<FilterId, "all">;
  label: string;
  title: string;
  description: string;
  icon: ReactNode;
  kinds: IntegrationKind[];
};

/*
 * Every kind the server knows, but a card is drawn only for one that works
 * (LIVE_INTEGRATION_KINDS) or one this business already connected, which
 * stays so it can be disconnected. Daraz and the ad platforms used to carry a
 * Connect button that answered "Meta Ads connected" and then brought nothing
 * in, ever; QuickBooks, Xero and Odoo were "Coming Soon" tiles. Both promised
 * what the app does not do. A section with no card left is not drawn.
 */
const SECTIONS: SectionDef[] = [
  {
    id: "sales",
    label: "Sales",
    title: "Sales integrations",
    description: "Bring orders in from your store.",
    icon: <ShoppingBag className="h-4 w-4" />,
    kinds: ["shopify", "daraz"],
  },
  {
    id: "ads",
    label: "Ads",
    title: "Ads integrations",
    description: "Connected before these were built. Add ad spend by hand for now.",
    icon: <Megaphone className="h-4 w-4" />,
    kinds: ["meta_ads", "google_ads", "tiktok_ads"],
  },
];

export default function IntegrationsHub() {
  const [filter, setFilter] = useState<FilterId>("all");
  const queryClient = useQueryClient();
  const f = useFormatters();
  const integrationsQuery = useListIntegrations();
  const { data: integrations = [] } = integrationsQuery;
  /*
   * The claim here is not about money, but it is about the owner's setup, and
   * it degrades the same way. `integrations` falls back to `[]`, so a request
   * that failed or paused left `byKind` empty and every card in the grid drew
   * itself as NOT CONNECTED, with a Connect button on it — under a caption
   * reading "0 connected". An owner whose Shopify has been syncing for months
   * would be looking at a page inviting them to connect it again.
   */
  const integrationsState = figureState(integrationsQuery, integrationsQuery.data != null);

  const byKind = useMemo(() => {
    const map = new Map<IntegrationKind, (typeof integrations)[number]>();
    for (const integration of integrations) map.set(integration.kind, integration);
    return map;
  }, [integrations]);

  const connectedCount = integrations.length;
  const sections = useMemo(
    () =>
      SECTIONS.map((section) => ({
        ...section,
        kinds: section.kinds.filter((kind) => LIVE_INTEGRATION_KINDS.includes(kind) || byKind.has(kind)),
      })).filter((section) => section.kinds.length > 0),
    [byKind],
  );
  // A filter over one section filters nothing, so it is only offered for two.
  const showFilters = sections.length > 1;
  const activeFilter = sections.some((section) => section.id === filter) ? filter : "all";
  const visibleSections = sections.filter((section) => activeFilter === "all" || section.id === activeFilter);

  // Zero-COGS diagnostics move to the rebuilt catalog page in R4.
  const zeroCogCount: number = 0;

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["integrations"] });
  };

  return (
    <>
      <TopBar
        title="Integrations"
        subtitle="Connect your store and its orders come in by themselves"
      />
      <div className="mx-auto max-w-7xl space-y-6 px-4 py-4 sm:px-8 sm:py-6">
        <div className="rounded-2xl border border-card-border bg-card/40 p-4 shadow-sm">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[color:var(--pl-orange-tint)] text-primary">
                <Plug className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-sm font-semibold">All integrations</h2>
                {integrationsState === "settled" && (
                  <p className="mt-0.5 text-xs text-muted-foreground">{connectedCount} connected.</p>
                )}
              </div>
            </div>
            {showFilters && (
              <div className="inline-flex items-center gap-1 rounded-lg border border-border bg-background/40 p-1">
                <SlidersHorizontal className="ml-2 h-3.5 w-3.5 text-muted-foreground" />
                {[{ id: "all" as FilterId, label: "All" }, ...sections].map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setFilter(item.id)}
                    className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                      activeFilter === item.id
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:bg-muted/40 hover:text-foreground"
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {zeroCogCount > 0 && (
          <div className="flex items-start gap-3 rounded-xl border border-yellow-500/40 bg-yellow-500/10 px-4 py-3 text-sm text-yellow-300">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-yellow-400" />
            <span>
              <strong>
                {zeroCogCount} product{zeroCogCount === 1 ? "" : "s"}
              </strong>{" "}
              imported from Shopify still{" "}
              {zeroCogCount === 1 ? "has" : "have"} a cost price of{" "}
              {f.symbol} 0. Profit calculations will be incorrect until you set them.{" "}
              <Link href="/setup/revenue" className="underline hover:text-yellow-200">
                Go to Revenue to fix
              </Link>
            </span>
          </div>
        )}

        {integrationsState === "loading" ? (
          <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading integrations...
          </div>
        ) : integrationsState !== "settled" ? (
          /* The whole grid goes, not just a banner above it. Every card in it
             would be stating a connection status this page does not know, and
             a Connect button on an already-connected account is a click with
             real consequences behind it. */
          <div className="py-10 text-center text-sm">
            <p className="text-[color:var(--pl-amber)]">
              {figureStateSentence(integrationsState, "your connections")}
            </p>
            {integrationsState === "failed" && (
              <Button variant="outline" size="sm" className="mt-3" onClick={() => integrationsQuery.refetch()}>
                Try again
              </Button>
            )}
          </div>
        ) : (
          <div className="space-y-8">
            {visibleSections.map((section) => (
              <section key={section.id} className="space-y-3">
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted/50 text-muted-foreground">
                    {section.icon}
                  </div>
                  <div>
                    <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                      {section.title}
                    </h2>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {section.description}
                    </p>
                  </div>
                </div>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {section.kinds.map((kind) => (
                    <IntegrationCard
                      key={kind}
                      entry={CATALOG[kind]}
                      connected={byKind.get(kind) ?? null}
                      onChanged={refresh}
                    />
                  ))}
                </div>
              </section>
            ))}

            <div className="rounded-xl border border-dashed border-border bg-muted/10 p-6 text-center">
              <p className="text-sm text-muted-foreground">
                Selling somewhere else?{" "}
                <Button variant="link" className="h-auto p-0 text-sm" asChild>
                  <Link href="/record/transactions">Import a spreadsheet of your sales</Link>
                </Button>{" "}
                or{" "}
                <Button variant="link" className="h-auto p-0 text-sm" asChild>
                  <Link href="/help">tell us what to connect next</Link>
                </Button>
                .
              </p>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
