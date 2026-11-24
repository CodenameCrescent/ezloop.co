import { useEffect, useMemo } from "react";
import { Loader2, type LucideIcon } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { TopBar } from "@/components/TopBar";
import { Button } from "@/components/ui/button";
import { useIntegrations as useListIntegrations } from "@/api/hooks";
import { figureState, figureStateSentence } from "@/lib/figureState";
import type { IntegrationKindShape as IntegrationKind, IntegrationShape as Integration } from "@workspace/api-contract";
import { type CatalogEntry, IntegrationCard } from "./IntegrationsGrid.parts/IntegrationCard";
export { IntegrationCard } from "./IntegrationsGrid.parts/IntegrationCard";
export type { CatalogEntry } from "./IntegrationsGrid.parts/IntegrationCard";

export const CATALOG: Record<IntegrationKind, CatalogEntry> = {
  shopify: {
    kind: "shopify",
    name: "Shopify",
    blurb: "Imports orders from your Shopify store and infers source from UTM/referrer data.",
    accent: "bg-[color:var(--pl-green-tint)] text-[color:var(--pl-green)]",
  },
  daraz: {
    kind: "daraz",
    name: "Daraz",
    blurb: "Imports Daraz orders and source from the storefront referrer mix.",
    accent: "bg-[color:var(--pl-orange-tint)] text-[color:var(--pl-orange-text)]",
  },
  meta_ads: {
    kind: "meta_ads",
    name: "Meta Ads",
    blurb: "Pulls daily Meta ad spend and stamps untagged recent orders with source Meta Ads.",
    accent: "bg-[color:var(--pl-teal-tint)] text-[color:var(--pl-teal)]",
  },
  google_ads: {
    kind: "google_ads",
    name: "Google Ads",
    blurb: "Pulls Google Ads spend and tags untagged recent orders with source Google Ads.",
    accent: "bg-[color:var(--pl-blue-tint)] text-[color:var(--pl-blue)]",
  },
  tiktok_ads: {
    kind: "tiktok_ads",
    name: "TikTok Ads",
    blurb: "Pulls TikTok Ads spend and tags untagged recent orders with source TikTok Ads.",
    accent: "bg-[color:var(--pl-pink-tint)] text-[color:var(--pl-pink)]",
  },
};

const OAUTH_ERROR_MESSAGES: Record<string, string> = {
  not_configured: "Shopify OAuth is not configured on the server.",
  invalid_state: "OAuth flow expired or was tampered with. Please try again.",
  invalid_hmac: "Shopify HMAC verification failed. Please try again.",
  token_exchange_failed: "Could not exchange authorization code. Please try again.",
  db_error: "Failed to save connection. Please try again.",
};

export function IntegrationsGrid({
  title,
  description,
  icon: Icon,
  kinds,
}: {
  title: string;
  description: string;
  icon: LucideIcon;
  kinds: IntegrationKind[];
}) {
  const queryClient = useQueryClient();
  const integrationsQuery = useListIntegrations();
  const { data: integrations = [] } = integrationsQuery;
  /* Same defect as the hub page: `[]` makes every card claim "not connected",
     with a Connect button on an account that may already be live. */
  const integrationsState = figureState(integrationsQuery, integrationsQuery.data != null);

  const byKind = useMemo(() => {
    const map = new Map<IntegrationKind, Integration>();
    for (const i of integrations) map.set(i.kind, i);
    return map;
  }, [integrations]);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["integrations"] });
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const connected = params.get("connected");
    const error = params.get("error");
    if (connected === "shopify") {
      toast.success('Shopify connected! Click "Sync now" to import your orders.');
      refresh();
    } else if (error) {
      toast.error(OAUTH_ERROR_MESSAGES[error] ?? "Shopify connection failed. Please try again.");
    }
    if (connected || error) {
      const url = new URL(window.location.href);
      url.searchParams.delete("connected");
      url.searchParams.delete("error");
      window.history.replaceState({}, "", url.toString());
    }
  }, []); // intentionally empty — runs once on mount to handle OAuth redirect params

  return (
    <>
      <TopBar title={title} />
      <div className="px-4 py-4 sm:px-8 sm:py-6 space-y-6 max-w-5xl">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted shrink-0">
            <Icon className="h-5 w-5 text-muted-foreground" />
          </div>
          <p className="text-sm text-muted-foreground pt-1">{description}</p>
        </div>

        {integrationsState === "loading" ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading integrations...
          </div>
        ) : integrationsState !== "settled" ? (
          <div className="text-sm">
            <p className="text-[color:var(--pl-amber)]">
              {figureStateSentence(integrationsState, "your connections")}
            </p>
            {integrationsState === "failed" && (
              <Button
                variant="outline"
                size="sm"
                className="mt-3"
                onClick={() => integrationsQuery.refetch()}
              >
                Try again
              </Button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {kinds.map((kind) => (
              <IntegrationCard
                key={kind}
                entry={CATALOG[kind]}
                connected={byKind.get(kind) ?? null}
                onChanged={refresh}
              />
            ))}
          </div>
        )}
      </div>
    </>
  );
}
