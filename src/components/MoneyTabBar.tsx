import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";

const TABS = [
  { label: "Profit & Loss", href: "/money/profit-loss" },
  { label: "Cash Flow", href: "/money/cash-flow" },
  { label: "Money owed", href: "/money/owed" },
  { label: "Budget", href: "/money/budget" },
  { label: "Break-even", href: "/money/break-even" },
  { label: "What you own", href: "/money/assets" },
];

export function MoneyTabBar() {
  const location = usePathname();
  return (
    <div className="mx-auto w-full max-w-[1360px] px-4 pt-3 sm:px-6">
      {/* Same segmented-control shape as the period filter: a recessed track
          with the chosen tab raised to the card colour. It used to be a
          bordered bar with an orange fill, which made every Money page open
          on a block of brand colour. */}
      <nav
        aria-label="Money sections"
        className="inline-flex overflow-x-auto rounded-full bg-[color:var(--pl-recessed)] p-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        <div className="flex min-w-max items-center gap-0.5">
          {TABS.map((tab) => {
            const active = location === tab.href;
            return (
              <Link
                key={tab.href}
                href={tab.href}
                className={`relative isolate shrink-0 rounded-full px-4 py-1.5 text-[13px] font-medium transition-colors ${
                  active
                    ? "text-[color:var(--pl-ink)]"
                    : "text-[color:var(--pl-ink-2)] hover:text-[color:var(--pl-ink)]"
                }`}
              >
                {active && (
                  <motion.span
                    layoutId="finance-tab-active"
                    className="absolute inset-0 -z-10 rounded-full bg-[color:var(--pl-surface)]"
                    transition={{ type: "spring", stiffness: 500, damping: 42 }}
                  />
                )}
                {tab.label}
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
