import { Calendar, Plus } from "lucide-react";
import { useState } from "react";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { PageHeader } from "./PageHeader";
import { QuickAdd } from "./QuickAdd";
import { todayInputValue } from "@/lib/period";

interface Props {
  title: string;
  subtitle?: string;
  date?: Date;
  onDateChange?: (d: Date) => void;
  primaryAction?: React.ReactNode;
}

/**
 * TopBar is now a thin wrapper over PageHeader.
 *
 * Twenty-two pages mount this, and pointing it at the one header was the whole
 * job: they all pick up the same title style and — the part that matters — the
 * period filter in the same fixed spot, without twenty-two separate edits. New
 * pages should use PageHeader directly.
 *
 * The `.app-page-shell` wrapper is needed because PageHeader cancels that
 * shell's padding with negative margins so it can span the full width. TopBar
 * renders as a sibling ABOVE each page's own shell, so it has to supply the
 * padding context itself.
 */
export function TopBar({ title, subtitle, date, onDateChange, primaryAction }: Props) {
  const [open, setOpen] = useState(false);
  const today = date ?? new Date();

  // Only shown when the page actually drives a date. It used to render always,
  // as a read-only pill that looked interactive and did nothing.
  const datePill = onDateChange ? (
    <label className="relative flex cursor-pointer items-center gap-2 rounded-full bg-[color:var(--pl-recessed)] px-3 py-1.5 text-xs transition-colors hover:bg-[color:var(--pl-hairline)]">
      <Calendar className="h-4 w-4 text-[color:var(--pl-ink-2)]" />
      <span className="tabular-nums">{format(today, "EEE, dd MMM yyyy")}</span>
      <input
        type="date"
        max={todayInputValue()}
        value={format(today, "yyyy-MM-dd")}
        onChange={(e) => {
          const v = e.target.value;
          if (v) {
            const [y, m, d] = v.split("-").map(Number);
            onDateChange(new Date(y, m - 1, d));
          }
        }}
        className="absolute inset-0 cursor-pointer opacity-0"
      />
    </label>
  ) : null;

  return (
    <div className="app-page-shell !pb-0">
      <PageHeader
        title={title}
        subtitle={subtitle}
        actions={
          <>
            {datePill}
            {primaryAction ?? (
              <Button onClick={() => setOpen(true)}>
                <Plus className="h-4 w-4" />
                Quick Add
              </Button>
            )}
          </>
        }
      />
      <QuickAdd open={open} onOpenChange={setOpen} />
    </div>
  );
}
