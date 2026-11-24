import Link from "next/link";
import { AlertTriangle, ArrowRight } from "lucide-react";
import { useSignals } from "@/api/hooks";

/**
 * The single most-urgent computed signal, surfaced as an ambient banner (Q4:
 * ambient nudges). Renders nothing unless there's a warning/critical signal —
 * no noise on a healthy business. Uses the app-wide default period.
 */
export function SignalBanner() {
  const signals = useSignals();
  const top = signals.data?.signals.find((s) => s.severity === "critical" || s.severity === "warning");
  if (!top) return null;
  const critical = top.severity === "critical";
  // Named tints rather than an 8% wash of the accent: the wash shifted the
  // background just enough that the secondary text landed at 4.41, and an
  // arbitrary mix can never be checked the way a token can.
  const tint = critical ? "var(--pl-red-tint)" : "var(--pl-amber-tint)";
  const ink = critical ? "var(--pl-red)" : "var(--pl-amber)";

  return (
    <Link
      href={top.href}
      className="flex items-center gap-3 rounded-xl px-4 py-3 text-sm transition"
      style={{ backgroundColor: tint }}
    >
      <AlertTriangle className="h-5 w-5 shrink-0" style={{ color: ink }} />
      <span className="min-w-0 flex-1">
        <span className="font-semibold text-[color:var(--pl-ink)]">{top.title}</span>
        <span className="text-[color:var(--pl-ink-2)]"> — {top.plainEnglish}</span>
      </span>
      <ArrowRight className="h-4 w-4 shrink-0 text-[color:var(--pl-ink-2)]" />
    </Link>
  );
}
