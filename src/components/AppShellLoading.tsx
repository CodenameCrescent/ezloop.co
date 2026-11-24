/** The app's outline, drawn while the session and business resolve. */
export function AppShellLoading() {
  return (
    <div className="flex h-screen w-full bg-background">
      {/* Sidebar skeleton */}
      <div className="hidden sm:flex w-60 shrink-0 flex-col border-r border-border bg-sidebar">
        <div className="flex h-14 items-center gap-3 border-b border-border px-4">
          <div className="h-7 w-7 animate-pulse rounded-lg bg-muted" />
          <div className="h-4 w-24 animate-pulse rounded bg-muted" />
        </div>
        <div className="flex-1 space-y-1 p-3">
          {Array.from({ length: 9 }).map((_, i) => (
            <div
              key={i}
              className="h-8 animate-pulse rounded-md bg-muted"
              style={{ opacity: Math.max(0.15, 1 - i * 0.09) }}
            />
          ))}
        </div>
        <div className="border-t border-border p-3">
          <div className="flex items-center gap-2">
            <div className="h-7 w-7 animate-pulse rounded-lg bg-muted" />
            <div className="flex-1 space-y-1">
              <div className="h-3 w-28 animate-pulse rounded bg-muted" />
              <div className="h-2.5 w-16 animate-pulse rounded bg-muted" />
            </div>
          </div>
        </div>
      </div>
      {/* Content skeleton */}
      <div className="flex flex-1 flex-col overflow-hidden">
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-border px-6">
          <div className="h-5 w-36 animate-pulse rounded bg-muted" />
          <div className="h-8 w-28 animate-pulse rounded-lg bg-muted" />
        </div>
        <div className="flex-1 space-y-5 overflow-hidden p-6">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-28 animate-pulse rounded-xl border border-border bg-card" />
            ))}
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="col-span-2 h-64 animate-pulse rounded-xl border border-border bg-card" />
            <div className="h-64 animate-pulse rounded-xl border border-border bg-card" />
          </div>
        </div>
      </div>
    </div>
  );
}
