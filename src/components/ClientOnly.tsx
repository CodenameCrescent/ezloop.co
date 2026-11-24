"use client";

import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

/**
 * Renders `fallback` on the server and during hydration, `children` after.
 *
 * The signed-in app reads localStorage while it renders — the chosen business,
 * the saved period, the dev account — and the server has none of it. Rather
 * than let each of those disagree with the server's HTML, the whole app area
 * waits one tick for the browser and shows the shell skeleton until then.
 */
export function ClientOnly({ children, fallback = null }: { children: React.ReactNode; fallback?: React.ReactNode }) {
  const mounted = useSyncExternalStore(subscribe, () => true, () => false);
  return <>{mounted ? children : fallback}</>;
}
