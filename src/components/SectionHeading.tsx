import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * The one section-title style. It replaced six: `text-xl/lg/base/sm/xs`,
 * `font-bold` against `font-semibold`, and `tracking-wider` against
 * `tracking-widest` — all of them meaning "this is a section".
 *
 * Always renders an <h2>, because a page has exactly one <h1> and PageHeader
 * owns it.
 */
export function SectionHeading({
  children,
  hint,
  action,
  className,
}: {
  children: ReactNode;
  /** One quiet line under the heading. */
  hint?: string;
  /** A link or control on the right of the heading row. */
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mb-4 flex items-start justify-between gap-4", className)}>
      <div className="min-w-0">
        <h2 className="t-section text-[color:var(--pl-ink)]">{children}</h2>
        {hint && <p className="t-secondary mt-0.5">{hint}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
