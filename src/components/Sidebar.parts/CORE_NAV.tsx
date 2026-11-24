import { type NavFeatureFlags, navHrefAllowed } from "../navVisibility";
import { LayoutDashboard, SlidersHorizontal, BarChart3, ReceiptText, Users2, Briefcase, Plug, ArrowLeftRight, Repeat2, Clock, Megaphone, Wallet, Target, Package, Lightbulb, Sparkles, CircleAlert, TrendingUp, Rocket, Wrench, Settings as SettingsIcon, FileBarChart, MessageCircle } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { motion } from "framer-motion";
import { DEV_ACCOUNTS } from "@/lib/devAccounts";
import { useMotionPrefs, DUR, EASE } from "@/lib/motion";

/**
 * The rail that marks where you are.
 *
 * It is ONE element per list, moved by framer-motion's shared-layout, so
 * changing page slides the marker from the old row to the new one instead of
 * blinking it out and in. That slide is the whole point: it shows the
 * relationship between where you were and where you now are, which a plain
 * highlight cannot.
 *
 * Two ids, not one, because the main nav and the bottom nav are separate lists
 * that can each hold the active route at the same moment when the sidebar is
 * collapsed (Settings appears in both). Sharing one id there would ask a single
 * element to be in two places.
 */
export function ActiveRail({ id, className }: { id: string; className?: string }) {
  const { reduced } = useMotionPrefs();
  return (
    <motion.span
      layoutId={id}
      transition={reduced ? { duration: 0 } : { duration: DUR.base, ease: EASE }}
      className={
        className ??
        "absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-full bg-[color:var(--pl-orange)]"
      }
      aria-hidden="true"
    />
  );
}

export const DEV_ACCOUNT_STORAGE_KEY = "profit_loop_dev_account_id";

/**
 * Dev-only ACCOUNTS — a different axis from the business switcher above, and
 * relabelled to say so. They used to be named like businesses ("My Store"), so
 * with a business chip in the header the sidebar showed two different names for
 * two different things and read as one of them being stale. These are people;
 * each owns their own businesses.
 */
export const LOCAL_TEST_ACCOUNTS = DEV_ACCOUNTS;

export function readLocalTestAccountId(): string {
  try {
    return localStorage.getItem(DEV_ACCOUNT_STORAGE_KEY) || "local-user";
  } catch {
    return "local-user";
  }
}

export type NavLeaf = {
  kind: "leaf";
  label: string;
  href: string;
  icon: LucideIcon;
  comingSoon?: boolean;
};

export type NavGroup = {
  kind: "group";
  label: string;
  icon: LucideIcon;
  items: NavLeaf[];
};

export type NavItem = NavLeaf | NavGroup;

export type NavSection = {
  id: string;
  label: string;
  icon: LucideIcon;
  href?: string;
  items: NavItem[];
};

/**
 * Drops leaves whose feature is off, recursing into groups.
 *
 * The RULE moved to `navVisibility.ts` because this file draws the nav twice —
 * expanded, and as the collapsed icon rail — and only this half was asking it.
 * See that file for what the rail was showing as a result.
 */
export function filterNavItems(items: NavItem[], features: NavFeatureFlags): NavItem[] {
  return items
    .map((item) =>
      item.kind === "group"
        ? { ...item, items: item.items.filter((leaf) => navHrefAllowed(leaf.href, features)) }
        : item,
    )
    .filter((item) =>
      item.kind === "group" ? item.items.length > 0 : navHrefAllowed(item.href, features),
    );
}

export const DASHBOARD_NAV: NavSection[] = [
  {
    id: "dashboard",
    label: "Summary",
    icon: LayoutDashboard,
    href: "/dashboard",
    items: [],
  },
];

/**
 * Areas named for what the owner is DOING, not for the module that built the
 * screen. "Workbench" named a container and nothing else, and it held inputs,
 * setup and one insight side by side.
 */
export const CORE_NAV: NavSection[] = [
  {
    id: "setup",
    label: "Set-Up",
    icon: SlidersHorizontal,
    items: [
      { kind: "leaf", label: "Revenue", href: "/setup/revenue", icon: BarChart3 },
      { kind: "leaf", label: "Expense", href: "/setup/expenses", icon: ReceiptText },
      { kind: "leaf", label: "People", href: "/setup/people", icon: Users2 },
      { kind: "leaf", label: "Projects", href: "/setup/projects", icon: Briefcase },
      { kind: "leaf", label: "Integrations", href: "/integrations", icon: Plug },
    ],
  },
  {
    id: "record",
    label: "Records",
    icon: ArrowLeftRight,
    items: [
      { kind: "leaf", label: "Transactions", href: "/record/transactions", icon: ArrowLeftRight },
      { kind: "leaf", label: "Recurring", href: "/record/recurring", icon: Repeat2 },
      { kind: "leaf", label: "Hours", href: "/record/hours", icon: Clock },
      { kind: "leaf", label: "Ad spend", href: "/record/ad-spend", icon: Megaphone },
    ],
  },
  /**
   * Money, Insights and Reports each used to be a single link that dropped you
   * on a page with its own tab bar — so five of their pages existed but were
   * invisible from the nav. Every real page now has a link.
   */
  {
    id: "money",
    label: "Money",
    icon: Wallet,
    items: [
      { kind: "leaf", label: "Profit & Loss", href: "/money/profit-loss", icon: Wallet },
      { kind: "leaf", label: "Cash flow", href: "/money/cash-flow", icon: ArrowLeftRight },
      { kind: "leaf", label: "Money owed", href: "/money/owed", icon: Clock },
      { kind: "leaf", label: "Budget", href: "/money/budget", icon: SlidersHorizontal },
      { kind: "leaf", label: "Break-even", href: "/money/break-even", icon: Target },
      { kind: "leaf", label: "What you own", href: "/money/assets", icon: Package },
    ],
  },
  {
    id: "insights",
    label: "Insights",
    icon: Lightbulb,
    items: [
      { kind: "leaf", label: "Summary", href: "/insights", icon: Sparkles },
      { kind: "leaf", label: "Money", href: "/insights/money", icon: Wallet },
      { kind: "leaf", label: "Offers", href: "/insights/offers", icon: Package },
      { kind: "leaf", label: "People", href: "/insights/people", icon: Users2 },
      { kind: "leaf", label: "Marketing", href: "/insights/marketing", icon: Megaphone },
      { kind: "leaf", label: "Leaks", href: "/insights/leaks", icon: CircleAlert },
      { kind: "leaf", label: "Overview", href: "/insights/overview", icon: LayoutDashboard },
      { kind: "leaf", label: "Profit", href: "/insights/profit", icon: BarChart3 },
      { kind: "leaf", label: "Customers", href: "/insights/customers", icon: Users2 },
      { kind: "leaf", label: "Worth having", href: "/insights/worth-having", icon: TrendingUp },
    ],
  },
  {
    id: "plan",
    label: "Plan",
    icon: Rocket,
    items: [
      { kind: "leaf", label: "Action plan", href: "/plan/action-plan", icon: Rocket },
      { kind: "leaf", label: "Forecasts", href: "/plan/forecasts", icon: Lightbulb },
      { kind: "leaf", label: "What-if", href: "/plan/what-if", icon: Wrench },
    ],
  },
];

// Tools became Plan > What-if; Integrations and Settings moved into Set up.
export const UTILITY_NAV: NavSection[] = [];

export const NAV = [...DASHBOARD_NAV, ...CORE_NAV, ...UTILITY_NAV];

export const BOTTOM_NAV: NavSection[] = [
  {
    id: "settings",
    label: "Settings",
    icon: SettingsIcon,
    items: [
      { kind: "leaf", label: "Business & data", href: "/settings", icon: SettingsIcon },
      { kind: "leaf", label: "Preferences", href: "/settings/preferences", icon: SlidersHorizontal },
    ],
  },
  {
    id: "reports",
    label: "Reports",
    icon: FileBarChart,
    items: [
      { kind: "leaf", label: "Overview", href: "/reports/overview", icon: FileBarChart },
      /* "Financial statements" was a SECOND profit and loss page, computing its
         own float figures over the store's one 200-row page and defaulting to
         All Time. Every figure on it disagreed with /money/profit-loss, and it
         printed a line claiming the opposite. Deleted — the real P&L and the
         Reports download both read the server ladder. */
    ],
  },
  {
    id: "help",
    label: "Help & Support",
    icon: MessageCircle,
    href: "/help",
    items: [],
  },
  /* Dev builds only — the gallery of every InsightCard state. It is the closest
     thing this app has to a component storybook, and it was unreachable. */
  ...((process.env.NODE_ENV !== "production")
    ? [
        {
          id: "dev",
          label: "Component gallery",
          icon: Sparkles,
          href: "/dev/insight-card",
          items: [],
        } satisfies NavSection,
      ]
    : []),
];

export const ALL_NAV = [...NAV, ...BOTTOM_NAV];

export function flattenNavItems(items: NavItem[]): NavLeaf[] {
  return items.flatMap((item) => (item.kind === "group" ? item.items : [item]));
}

export function pathMatches(href: string, path: string): boolean {
  if (href === "/") return path === "/";
  return href === path || path.startsWith(href + "/");
}

export function getSectionForPath(path: string): string | null {
  // Prefer the most specific match: exact leaf item match first
  for (const section of ALL_NAV) {
    for (const item of flattenNavItems(section.items)) {
      if (pathMatches(item.href, path)) return section.id;
    }
  }
  // Fall back to section-level href match (prefix ok for non-root sections)
  for (const section of ALL_NAV) {
    if (section.href && pathMatches(section.href, path)) return section.id;
  }
  return null;
}

export function sectionHasActivePath(section: NavSection, path: string): boolean {
  if (section.href && pathMatches(section.href, path)) return true;
  // Leaf items use exact matching — no false positives from prefix
  return flattenNavItems(section.items).some((item) => pathMatches(item.href, path));
}

/**
 * The ONE href that is current, out of every href in the nav.
 *
 * `pathMatches` is a prefix test, so on /settings/preferences it says yes to
 * both "/settings" and "/settings/preferences" — which used to light up two
 * rows at once. The longest match wins, which is always the most specific one,
 * so exactly one item in the tree can be current. The moving rail needs that
 * to be true (one marker cannot be in two rows), and it was the right answer
 * for the plain highlight too.
 */
export function resolveActiveHref(sections: NavSection[], path: string): string | null {
  let best: string | null = null;
  for (const section of sections) {
    const hrefs = [
      ...(section.href ? [section.href] : []),
      ...flattenNavItems(section.items).map((item) => item.href),
    ];
    for (const href of hrefs) {
      if (pathMatches(href, path) && (!best || href.length > best.length)) best = href;
    }
  }
  return best;
}

/** Same rule, over a flat list of leaves (the collapsed rail). */
export function resolveActiveLeaf(leaves: NavLeaf[], path: string): string | null {
  let best: string | null = null;
  for (const leaf of leaves) {
    // "Overview" is the Insights root, so a prefix match would light it up on
    // every Insights page including Worth having. Exact match only for that one.
    const hit = leaf.href === "/insights" ? path === "/insights" : pathMatches(leaf.href, path);
    if (hit && (!best || leaf.href.length > best.length)) best = leaf.href;
  }
  return best;
}
