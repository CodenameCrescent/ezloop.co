import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
import {
  LayoutDashboard,
  Briefcase,
  Wallet,
  Settings,
  Plus,
} from "lucide-react";
import { QuickAdd } from "./QuickAdd";
import { DUR, EASE, useMotionPrefs } from "@/lib/motion";

const MOBILE_NAV_LEFT = [
  { icon: LayoutDashboard, label: "Summary", href: "/dashboard" },
  { icon: Briefcase, label: "Record", href: "/record/transactions" },
];

const MOBILE_NAV_RIGHT = [
  { icon: Wallet, label: "Money", href: "/money" },
  { icon: Settings, label: "Settings", href: "/settings" },
];

function isActive(href: string, location: string) {
  return href === "/" ? location === "/" : location.startsWith(href);
}

function NavTab({
  href,
  label,
  icon: Icon,
  active,
  reduced,
}: {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  active: boolean;
  reduced: boolean;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className="pl-press relative flex min-w-0 flex-1 flex-col items-center gap-1 py-1.5 text-[10px] font-semibold"
    >
      {/* The pill is ONE element shared by all four tabs, so tapping slides it
          across rather than blinking it out and in somewhere else. That slide
          is the only thing telling a thumb where it just came from. */}
      {active && (
        <motion.span
          layoutId="mobile-nav-pill"
          transition={reduced ? { duration: 0 } : { duration: DUR.base, ease: EASE }}
          className="absolute inset-x-2 inset-y-0 rounded-xl bg-[color:var(--pl-orange-tint)]"
        />
      )}
      <span
        className="relative flex flex-col items-center gap-1 transition-colors"
        style={{ color: active ? "var(--pl-orange-text)" : "var(--pl-ink-2)" }}
      >
        <Icon className="h-[18px] w-[18px]" />
        {label}
      </span>
    </Link>
  );
}

export function MobileBottomNav() {
  const location = usePathname();
  const [addOrderOpen, setAddOrderOpen] = useState(false);
  const { reduced } = useMotionPrefs();

  return (
    <>
      <QuickAdd open={addOrderOpen} onOpenChange={setAddOrderOpen} />
      {/*
        Translucent and blurred, with the one hairline the shell allows itself.
        On a phone the content runs right up under this bar, and on dark the
        bar and the page are within a few percent of each other — without a
        line, the nav visually dissolves into the last row of the list above
        it. The line is tokenised, so it is invisibly faint in light and does
        the work in dark.

        The bottom padding is the safe area PLUS a real gutter, so on a phone
        with a home indicator the labels are not sitting on the gesture bar.
      */}
      <nav
        className="fixed inset-x-0 bottom-0 z-50 flex items-stretch border-t border-[color:var(--pl-hairline)] bg-[color:color-mix(in_srgb,var(--pl-surface)_88%,transparent)] px-1 pt-1.5 backdrop-blur-xl sm:hidden"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 0.5rem)" }}
      >
        {MOBILE_NAV_LEFT.map((item) => (
          <NavTab
            key={item.href}
            {...item}
            active={isActive(item.href, location)}
            reduced={reduced}
          />
        ))}

        {/* The one thing this bar exists for: recording money, in one thumb
            reach, from anywhere in the app. */}
        <button
          type="button"
          onClick={() => setAddOrderOpen(true)}
          className="pl-press flex min-w-0 flex-1 flex-col items-center gap-1 py-1.5 text-[10px] font-semibold text-[color:var(--pl-ink-2)]"
          aria-label="Add transaction"
        >
          <span
            className="-mt-4 flex h-11 w-11 items-center justify-center rounded-full bg-[color:var(--pl-orange-fill)] text-[color:var(--pl-on-orange)]"
            style={{ boxShadow: "0 6px 16px -4px color-mix(in srgb, var(--pl-orange) 55%, transparent)" }}
          >
            <Plus className="h-5 w-5" />
          </span>
          <span>Add</span>
        </button>

        {MOBILE_NAV_RIGHT.map((item) => (
          <NavTab
            key={item.href}
            {...item}
            active={isActive(item.href, location)}
            reduced={reduced}
          />
        ))}
      </nav>
    </>
  );
}
