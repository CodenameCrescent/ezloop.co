import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Surface } from "@/components/Surface";

/**
 * A visitor can land here, so it speaks to them rather than to whoever wrote
 * the router. The old copy asked "Did you forget to add the page to the
 * router?" and was the only screen in the app styled off the palette.
 */
export default function NotFound() {
  return (
    <div className="app-page-shell flex min-h-[60vh] items-center justify-center">
      <Surface padding="lg" className="w-full max-w-md text-center">
        <p className="t-hero text-[color:var(--pl-ink-3)]">404</p>
        <h1 className="t-title mt-2 text-[color:var(--pl-ink)]">This page doesn&rsquo;t exist</h1>
        <p className="t-secondary mt-2">
          The link may be out of date, or the page may have moved.
        </p>
        <Button asChild className="mt-6">
          <Link href="/dashboard">Back to dashboard</Link>
        </Button>
      </Surface>
    </div>
  );
}
