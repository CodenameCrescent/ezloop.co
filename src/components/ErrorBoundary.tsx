import { Component, type ErrorInfo, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * The net under every screen.
 *
 * React tears down the ENTIRE tree when a render throws, so before this existed
 * a single bad value took the whole app to a blank white page — no navigation,
 * no explanation, nothing to click. That is how one currency symbol typed into
 * an hours box read as "the app crashed" rather than "that box is wrong".
 *
 * It sits INSIDE the layout on purpose: the sidebar and the top bar keep
 * working, so a broken page is one broken page and the owner can walk away from
 * it. The message is written for someone who did nothing wrong, because from
 * where they sit that is exactly what happened.
 */

interface Props {
  children: ReactNode;
  /** Changing this remounts the boundary — used to clear the error on navigation. */
  resetKey?: string;
}

interface State {
  error: Error | null;
}

class ErrorBoundaryInner extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Kept for whoever debugs it later. The owner is shown words, not this.
    console.error("Screen failed to render:", error, info.componentStack);
  }

  componentDidUpdate(prev: Props) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null });
    }
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="app-page-shell">
        <div className="mx-auto max-w-lg rounded-2xl border border-card-border bg-card p-8 text-center shadow-sm">
          <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-[color:var(--pl-amber-tint)]">
            <AlertTriangle className="h-5 w-5 text-[color:var(--pl-amber)]" />
          </div>
          <h2 className="text-base font-semibold">This page couldn't be shown</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Something on it went wrong. Nothing you've entered has been lost — your figures are safe.
            Try again, or move to another page and come back.
          </p>
          <div className="mt-5 flex justify-center gap-2">
            <Button size="sm" className="gap-2" onClick={() => this.setState({ error: null })}>
              <RotateCcw className="h-4 w-4" /> Try again
            </Button>
            <Button size="sm" variant="outline" onClick={() => window.location.reload()}>
              Reload the app
            </Button>
          </div>
          {/* Hidden by default: useful when reporting it, noise the rest of the time. */}
          <details className="mt-5 text-left">
            <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
              Technical details
            </summary>
            <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-muted/50 p-2 text-[11px] text-muted-foreground">
              {error.message || String(error)}
            </pre>
          </details>
        </div>
      </div>
    );
  }
}

/**
 * Wraps the routed page. Keyed on the location so navigating away from a broken
 * screen clears the error — otherwise the fallback would follow the owner to
 * every page they tried next.
 */
export function RouteErrorBoundary({ children }: { children: ReactNode }) {
  const location = usePathname();
  return <ErrorBoundaryInner resetKey={location}>{children}</ErrorBoundaryInner>;
}

export { ErrorBoundaryInner as ErrorBoundary };
