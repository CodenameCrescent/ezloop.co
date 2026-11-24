import * as React from "react";
import { useTheme } from "next-themes";
import { motion } from "framer-motion";
import { Monitor, Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";
import { DUR, EASE, useMotionPrefs } from "@/lib/motion";

/**
 * Light / Auto / Dark.
 *
 * Three states, not two, and "Auto" is the default: a laptop that switches
 * itself at sunset should take the app with it without anyone being asked to
 * think about it. The other two exist because plenty of people want the app to
 * disagree with their machine, and a two-way switch cannot express that — once
 * you flip it there is no way back to "whatever the computer says".
 *
 * The labels are in plain English on purpose. "System" is a developer's word.
 */

type Choice = "light" | "system" | "dark";

const CHOICES: { value: Choice; label: string; icon: typeof Sun }[] = [
  { value: "light", label: "Light", icon: Sun },
  { value: "system", label: "Auto", icon: Monitor },
  { value: "dark", label: "Dark", icon: Moon },
];

/** next-themes has no value until it has read localStorage on the client. */
function useMountedTheme() {
  const { theme, setTheme, resolvedTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);
  return {
    /** "system" until we know better, so the control never flashes a wrong pip. */
    choice: (mounted ? (theme as Choice | undefined) : undefined) ?? "system",
    resolved: mounted ? resolvedTheme : undefined,
    setTheme,
    mounted,
  };
}

/**
 * The full control: three segments with a pip that slides between them.
 * For the expanded sidebar, where there is room to say what each one does.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const { choice, setTheme, mounted } = useMountedTheme();
  const { reduced } = useMotionPrefs();

  return (
    <div
      role="radiogroup"
      aria-label="Appearance"
      className={cn(
        "flex items-center gap-0.5 rounded-full bg-[color:var(--pl-recessed)] p-0.5",
        className,
      )}
    >
      {CHOICES.map(({ value, label, icon: Icon }) => {
        const active = mounted && choice === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={label}
            title={label}
            onClick={() => setTheme(value)}
            className={cn(
              "relative flex h-7 flex-1 items-center justify-center rounded-full text-[11px] font-semibold transition-colors",
              active
                ? "text-[color:var(--pl-ink)]"
                : "text-[color:var(--pl-ink-3)] hover:text-[color:var(--pl-ink)]",
            )}
          >
            {active && (
              /* One pip, shared across the three buttons, so switching reads as
                 the same object moving rather than two things blinking. */
              <motion.span
                layoutId="theme-pip"
                transition={reduced ? { duration: 0 } : { duration: DUR.base, ease: EASE }}
                className="absolute inset-0 rounded-full bg-[color:var(--pl-surface)]"
                style={{ boxShadow: "inset 0 0 0 1px var(--pl-surface-line)" }}
              />
            )}
            <span className="relative flex items-center gap-1">
              <Icon className="h-3.5 w-3.5" />
              {label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * One button that steps Light → Auto → Dark → Light.
 *
 * For the collapsed sidebar and the mobile bar, where three segments do not
 * fit. It shows the state it is IN, and its title says what a press will do,
 * because a cycling control that only shows an icon is otherwise a guess.
 */
export function ThemeToggleCompact({ className }: { className?: string }) {
  const { choice, setTheme, mounted } = useMountedTheme();
  const { reduced } = useMotionPrefs();

  const index = CHOICES.findIndex((c) => c.value === choice);
  const current = CHOICES[index === -1 ? 1 : index];
  const next = CHOICES[(index === -1 ? 1 : index + 1) % CHOICES.length];
  const Icon = current.icon;

  return (
    <button
      type="button"
      onClick={() => setTheme(next.value)}
      title={mounted ? `Appearance: ${current.label} — switch to ${next.label}` : "Appearance"}
      aria-label={`Appearance: ${current.label}. Switch to ${next.label}`}
      className={cn(
        "pl-press inline-flex h-9 w-9 items-center justify-center rounded-xl text-[color:var(--pl-ink-2)] transition-colors hover:bg-[color:var(--pl-surface)] hover:text-[color:var(--pl-ink)]",
        className,
      )}
    >
      <motion.span
        key={current.value}
        initial={reduced ? false : { rotate: -35, opacity: 0, scale: 0.8 }}
        animate={{ rotate: 0, opacity: 1, scale: 1 }}
        transition={reduced ? { duration: 0 } : { duration: DUR.base, ease: EASE }}
        className="flex"
      >
        <Icon className="h-4 w-4" />
      </motion.span>
    </button>
  );
}
