import { useState } from "react";
import { Loader2, Plug, CheckCircle2, RefreshCw, Unplug, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { useConnectIntegration, useSyncIntegration, useDisconnectIntegration } from "@/api/hooks";
import type { IntegrationKindShape as IntegrationKind, IntegrationShape as Integration } from "@workspace/api-contract";

export interface CatalogEntry {
  kind: IntegrationKind;
  name: string;
  blurb: string;
  /** Tint + text pair for the provider CHIP only — never the whole card. */
  accent: string;
}

export function GenericConnectForm({
  entry,
  onChanged,
}: {
  entry: CatalogEntry;
  onChanged: () => void;
}) {
  const [account, setAccount] = useState("");
  const connectM = useConnectIntegration();

  const handleConnect = () => {
    connectM.mutate(
      { kind: entry.kind, body: { externalAccount: account || null } },
      {
        onSuccess: () => {
          toast.success(`${entry.name} connected`);
          setAccount("");
          onChanged();
        },
        onError: () => toast.error(`Failed to connect ${entry.name}`),
      },
    );
  };

  return (
    <div className="space-y-2">
      <input
        type="text"
        placeholder={`${entry.name} store / account (optional)`}
        value={account}
        onChange={(e) => setAccount(e.target.value)}
        className="w-full rounded-md border border-border bg-background/40 px-3 py-1.5 text-xs placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-primary"
      />
      <Button size="sm" disabled={connectM.isPending} onClick={handleConnect} className="w-full">
        {connectM.isPending ? (
          <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
        ) : (
          <Plug className="h-4 w-4 mr-1.5" />
        )}
        Connect {entry.name}
      </Button>
    </div>
  );
}

export function IntegrationCard({
  entry,
  connected,
  onChanged,
}: {
  entry: CatalogEntry;
  connected: Integration | null;
  onChanged: () => void;
}) {
  const [account, setAccount] = useState("");
  const syncM = useSyncIntegration();
  const disconnectM = useDisconnectIntegration();

  const isShopify = entry.kind === "shopify";

  const handleShopifyOAuth = () => {
    const shop = account.trim();
    if (!shop) return;
    window.location.href = `/api/integrations/shopify/oauth/start?shop=${encodeURIComponent(shop)}`;
  };

  const handleSync = () => {
    syncM.mutate(entry.kind, {
      onSuccess: (res) => {
        // The server's own sentence, either way. It says what came in and what
        // is still unlinked — "Shopify synced" would throw away the one part
        // the owner has to act on.
        if (res.ok) toast.success(res.message);
        else toast.info(res.message);
        onChanged();
      },
      onError: (err) => toast.error(`Sync failed: ${(err as Error).message}`),
    });
  };

  const handleDisconnect = () => {
    disconnectM.mutate(entry.kind, {
        onSuccess: () => {
          toast.success(`${entry.name} disconnected`);
          onChanged();
        },
        onError: () => toast.error(`Failed to disconnect ${entry.name}`),
      },
    );
  };

  const busy = syncM.isPending || disconnectM.isPending;

  return (
    /* A white card like every other card. Each provider used to tint its whole
       panel, so a grid of them read as a paint chart rather than a page — the
       provider's colour now lives on its initial only. */
    <div className="pl-surface flex flex-col gap-4 p-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span
            className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg text-sm font-semibold ${entry.accent}`}
            aria-hidden="true"
          >
            {entry.name.charAt(0)}
          </span>
          <div className="min-w-0">
            <h3 className="t-section text-[color:var(--pl-ink)]">{entry.name}</h3>
            <p className="t-secondary mt-0.5">{entry.blurb}</p>
          </div>
        </div>
        {connected && (
          <span className="inline-flex items-center gap-1 rounded-md bg-[color:var(--pl-green-tint)] px-2 py-0.5 text-[10px] font-medium text-[color:var(--pl-green)] shrink-0">
            <CheckCircle2 className="h-3 w-3" /> Connected
          </span>
        )}
      </div>

      {connected ? (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div>
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Store</div>
              <div className="font-medium truncate">{connected.externalAccount ?? "\u2014"}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Last sync
              </div>
              <div className="font-medium">
                {connected.lastSyncedAt
                  ? format(new Date(connected.lastSyncedAt), "MMM d, h:mm a")
                  : "Never"}
              </div>
            </div>
          </div>
          {isShopify && (
            <p className="text-[11px] text-muted-foreground">
              Syncing pulls orders placed since the last sync. Duplicates are skipped automatically.
            </p>
          )}
          <div className="flex gap-2">
            <Button size="sm" variant="default" disabled={busy} onClick={handleSync} className="flex-1">
              {syncM.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
              ) : (
                <RefreshCw className="h-4 w-4 mr-1.5" />
              )}
              Sync now
            </Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={handleDisconnect}>
              <Unplug className="h-4 w-4 mr-1.5" />
              Disconnect
            </Button>
          </div>
        </div>
      ) : isShopify ? (
        <div className="space-y-3">
          <div className="rounded-md border border-border/50 bg-background/30 px-4 py-3 text-xs text-muted-foreground space-y-1 leading-relaxed">
            <p>
              Enter your store URL and click{" "}
              <strong className="text-foreground">Connect with Shopify</strong>. You will be
              redirected to Shopify to authorize access.
            </p>
            <a
              href="https://help.shopify.com/en/manual/apps/app-types/public-apps"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-primary hover:underline"
            >
              Learn about Shopify app authorization <ExternalLink className="h-3 w-3" />
            </a>
          </div>
          <div className="space-y-1">
            <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
              Store URL
            </label>
            <input
              type="text"
              placeholder="your-store.myshopify.com"
              value={account}
              onChange={(e) => setAccount(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleShopifyOAuth()}
              className="w-full rounded-md border border-border bg-background/40 px-3 py-1.5 text-xs placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
          <Button size="sm" disabled={!account.trim()} onClick={handleShopifyOAuth} className="w-full">
            <Plug className="h-4 w-4 mr-1.5" />
            Connect with Shopify
          </Button>
        </div>
      ) : (
        <GenericConnectForm entry={entry} onChanged={onChanged} />
      )}
    </div>
  );
}
