"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Client-side redirect for decisions only the browser can make — which business
 * is selected, which insights tab survived. Fixed old-URL → new-URL moves live in
 * `next.config.ts` instead, where they cost no render at all.
 */
export function Redirect({ to }: { to: string }) {
  const router = useRouter();
  useEffect(() => {
    router.replace(to);
  }, [router, to]);
  return null;
}
