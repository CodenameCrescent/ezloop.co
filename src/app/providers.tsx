"use client";

import { useEffect, useRef, useState } from "react";
import { ThemeProvider } from "next-themes";
import { SessionProvider, useSession } from "next-auth/react";
import {
  QueryCache,
  QueryClient,
  QueryClientProvider,
  useQueryClient,
} from "@tanstack/react-query";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { isBusinessScopeError, setCurrentBusinessId } from "@/lib/currentBusiness";

export const localAuthBypass = process.env.NEXT_PUBLIC_LOCAL_AUTH_BYPASS === "true";

/**
 * A request that the server refuses to scope sends the whole app back to the
 * businesses page.
 *
 * It happens when the business we are holding has been archived, deleted, or
 * belongs to another account — usually because a second tab changed something.
 * Without this the app sits on a dashboard of empty states, which reads as a
 * business with no money in it rather than as a business it could not open.
 * That is the exact class of lie DESIGN.md §9 exists to stop, one level up.
 */
function makeQueryClient() {
  return new QueryClient({
    queryCache: new QueryCache({
      onError: (error) => {
        if (!isBusinessScopeError(error)) return;
        if (window.location.pathname.endsWith("/businesses")) return;
        setCurrentBusinessId(null);
        window.location.assign("/businesses");
      },
    }),
    defaultOptions: {
      queries: {
        retry: 1,
        refetchOnWindowFocus: false,
        /**
         * Moving between screens re-reads nothing for a minute.
         *
         * Safe because writes do not wait for this to expire: `invalidateMoney`
         * marks every ledger-derived key stale the moment money changes, and an
         * invalidated query refetches regardless of its age.
         */
        staleTime: 60_000,
      },
    },
  });
}

/** Signing in as someone else must never show the previous person's cached answers. */
function SessionCacheInvalidator() {
  const { data, status } = useSession();
  const qc = useQueryClient();
  const prev = useRef<string | null | undefined>(undefined);
  const userId = status === "loading" ? undefined : (data?.user?.id ?? null);
  useEffect(() => {
    if (userId === undefined) return;
    if (prev.current !== undefined && prev.current !== userId) qc.clear();
    prev.current = userId;
  }, [userId, qc]);
  return null;
}

export function Providers({ children }: { children: React.ReactNode }) {
  // One client per browser tab, created on first render rather than at module
  // scope so a server render never shares a cache between visitors.
  const [queryClient] = useState(makeQueryClient);

  return (
    /* Dual theme, system-detected. The inline script in the root layout sets
       the class before first paint, so there is no flash of the wrong theme. */
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
      storageKey="profit-loop-theme"
    >
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          {localAuthBypass ? (
            children
          ) : (
            /* The session rides NextAuth's httpOnly cookie, which same-origin
               fetches send by themselves: no token to attach. */
            <SessionProvider refetchOnWindowFocus={false}>
              <SessionCacheInvalidator />
              {children}
            </SessionProvider>
          )}
          <Toaster richColors position="top-right" />
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
