import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * The ONLY place a non-money colour is allowed.
 *
 * Green and red mean money gained and money lost everywhere else in the app.
 * Blue, violet, amber, pink and teal exist for labels — a category the user
 * typed, a source, a kind of thing. They never colour a number.
 *
 * Every tone is a tint background with text that clears 4.5:1 against it, so a
 * tag is readable rather than decorative.
 */
export type TagTone =
  | "neutral"
  | "green"
  | "red"
  | "orange"
  | "blue"
  | "violet"
  | "amber"
  | "pink"
  | "teal";

const toneClass: Record<TagTone, string> = {
  neutral: "bg-[color:var(--pl-recessed)] text-[color:var(--pl-ink-2)]",
  green: "bg-[color:var(--pl-green-tint)] text-[color:var(--pl-green)]",
  red: "bg-[color:var(--pl-red-tint)] text-[color:var(--pl-red)]",
  orange: "bg-[color:var(--pl-orange-tint)] text-[color:var(--pl-orange-text)]",
  blue: "bg-[color:var(--pl-blue-tint)] text-[color:var(--pl-blue)]",
  violet: "bg-[color:var(--pl-violet-tint)] text-[color:var(--pl-violet)]",
  amber: "bg-[color:var(--pl-amber-tint)] text-[color:var(--pl-amber)]",
  pink: "bg-[color:var(--pl-pink-tint)] text-[color:var(--pl-pink)]",
  teal: "bg-[color:var(--pl-teal-tint)] text-[color:var(--pl-teal)]",
};

/** Stable colour for a free-text label, so "Payroll" is the same hue everywhere. */
const LABEL_TONES: TagTone[] = ["blue", "violet", "amber", "pink", "teal"];

export function toneForLabel(label: string): TagTone {
  let hash = 0;
  for (let i = 0; i < label.length; i += 1) hash = (hash * 31 + label.charCodeAt(i)) | 0;
  return LABEL_TONES[Math.abs(hash) % LABEL_TONES.length];
}

export function Tag({
  children,
  tone = "neutral",
  icon,
  className,
}: {
  children: ReactNode;
  tone?: TagTone;
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        toneClass[tone],
        className,
      )}
    >
      {icon}
      {children}
    </span>
  );
}
