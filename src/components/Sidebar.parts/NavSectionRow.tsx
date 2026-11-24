import { useState, useEffect } from "react";
import Link from "next/link";
import { Building2, ChevronRight, LayoutDashboard, ArrowLeftRight, Clock, Repeat2, Megaphone, BarChart3, ReceiptText, Users2, Briefcase, Wallet, Lightbulb } from "lucide-react";
import { ActiveRail, type NavLeaf, type NavGroup, type NavSection, flattenNavItems, pathMatches, sectionHasActivePath } from "./CORE_NAV";

export function Collapsible({ open, children }: { open: boolean; children: React.ReactNode }) {
  return (
    <div
      className="grid transition-[grid-template-rows] duration-200 ease-in-out"
      style={{ gridTemplateRows: open ? "1fr" : "0fr" }}
    >
      <div className="overflow-hidden">{children}</div>
    </div>
  );
}

/**
 * Which set of books you are looking at, and the way to another.
 *
 * It sits directly under the logo because it qualifies EVERYTHING below it: the
 * nav, the figures, the insights. An owner with two businesses who cannot see
 * which one is open has to infer it from the numbers, which is exactly the
 * moment a number gets read against the wrong business.
 *
 * Switching is a full navigation to the businesses page rather than a dropdown
 * here. That page can show each business's profit before you commit to opening
 * it; a menu of names could not, and picking blind is how you land in the wrong
 * one and only notice a screen later.
 */
export function BusinessChip({ name, collapsed }: { name: string; collapsed: boolean }) {
  if (collapsed) {
    return (
      <div className="mt-4 flex justify-center">
        <Link
          href="/businesses"
          title={`${name} — switch business`}
          aria-label={`${name} — switch business`}
          className="pl-press inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-[color:var(--pl-recessed)] text-sm font-bold text-[color:var(--pl-ink)] transition-colors hover:bg-[color:var(--pl-surface)]"
        >
          {name.slice(0, 1).toUpperCase() || "B"}
        </Link>
      </div>
    );
  }

  return (
    <Link
      href="/businesses"
      className="pl-press mt-4 flex w-full items-center gap-2 rounded-xl bg-[color:var(--pl-recessed)] px-3 py-2 text-left transition-colors hover:bg-[color:var(--pl-surface)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:color-mix(in_srgb,var(--pl-orange)_25%,transparent)]"
    >
      <Building2 className="h-4 w-4 shrink-0 text-[color:var(--pl-ink-2)]" />
      <span className="min-w-0 flex-1 truncate text-xs font-bold text-[color:var(--pl-ink)]">{name}</span>
      <span className="t-micro shrink-0 text-[color:var(--pl-ink-3)]">Switch</span>
    </Link>
  );
}

export function NavLeafLink({
  item,
  active,
  railId,
  nested,
}: {
  item: NavLeaf;
  active: boolean;
  railId: string;
  nested?: boolean;
}) {
  const ItemIcon = item.icon;
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={`pl-press relative flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm font-medium transition-colors duration-150 ${
        active
          ? "bg-[color:var(--pl-orange-tint)] font-semibold text-[color:var(--pl-orange-text)]"
          : "text-[color:var(--pl-ink-2)] hover:bg-[color:var(--pl-surface)] hover:text-[color:var(--pl-ink)]"
      }`}
    >
      {/* The rail replaces the old always-on dot. A dot in front of every link
          meant fifteen dots down the Insights group and no signal at all. */}
      {active && (
        <ActiveRail
          id={railId}
          className="absolute -left-[9px] top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-full bg-[color:var(--pl-orange)]"
        />
      )}
      {nested && (
        <ItemIcon
          className={`h-3.5 w-3.5 shrink-0 ${active ? "text-[color:var(--pl-orange-text)]" : "text-[color:var(--pl-ink-3)]"}`}
        />
      )}
      <span className="truncate flex-1">{item.label}</span>
      {item.comingSoon && (
        <span className="shrink-0 rounded-full bg-[color:var(--pl-recessed)] px-1.5 py-0.5 text-xs font-semibold uppercase tracking-wide text-[color:var(--pl-ink-2)]">
          Soon
        </span>
      )}
    </Link>
  );
}

export function NavLeafGroup({
  group,
  location,
  activeHref,
  railId,
}: {
  group: NavGroup;
  location: string;
  activeHref: string | null;
  railId: string;
}) {
  const GroupIcon = group.icon;
  const hasActive = group.items.some((item) => pathMatches(item.href, location));
  const [open, setOpen] = useState(hasActive);

  useEffect(() => {
    if (hasActive) setOpen(true);
  }, [hasActive]);

  return (
    <div className="py-0.5">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-sm font-semibold transition-colors duration-150 hover:bg-[color:var(--pl-surface)] ${
          hasActive ? "text-[color:var(--pl-ink)]" : "text-[color:var(--pl-ink-2)] hover:text-[color:var(--pl-ink)]"
        }`}
      >
        <GroupIcon className="h-3.5 w-3.5 shrink-0 text-[color:var(--pl-ink-3)]" />
        <span className="flex-1 truncate">{group.label}</span>
        <ChevronRight
          className="h-3 w-3 shrink-0 text-[color:var(--pl-ink-3)] transition-transform duration-200 ease-in-out"
          style={{ transform: open ? "rotate(90deg)" : "rotate(0deg)" }}
        />
      </button>
      <Collapsible open={open}>
        <div className="ml-3.5 mt-0.5 space-y-0.5 border-l border-[color:var(--pl-hairline)] pl-2">
          {group.items.map((item) => (
            <NavLeafLink key={item.href} item={item} active={activeHref === item.href} railId={railId} nested />
          ))}
        </div>
      </Collapsible>
    </div>
  );
}

export function NavSectionRow({
  section,
  location,
  activeHref,
  railId,
  openSections,
  toggleSection,
  collapsed,
  compact,
}: {
  section: NavSection;
  location: string;
  /** The one current href in this list, resolved by the Sidebar. */
  activeHref: string | null;
  railId: string;
  openSections: Set<string>;
  toggleSection: (id: string) => void;
  collapsed: boolean;
  compact?: boolean;
}) {
  const SectionIcon = section.icon;
  const isOpen = openSections.has(section.id);
  const hasActive = sectionHasActivePath(section, location);
  const py = compact ? "py-2" : "py-2.5";

  // Collapsed: icon-only pill for all items
  if (collapsed) {
    // For collapsible sections, navigate to first child
    const href = section.href ?? flattenNavItems(section.items)[0]?.href ?? "/";
    const owns = [
      ...(section.href ? [section.href] : []),
      ...flattenNavItems(section.items).map((item) => item.href),
    ];
    const active = activeHref !== null && owns.includes(activeHref);
    return (
      <Link
        href={href}
        title={section.label}
        aria-label={section.label}
        aria-current={active ? "page" : undefined}
        className={`pl-press relative mx-auto flex h-10 w-10 items-center justify-center rounded-xl transition-colors duration-150 ${
          active
            ? "bg-[color:var(--pl-orange-tint)] text-[color:var(--pl-orange-text)]"
            : "text-[color:var(--pl-ink-2)] hover:bg-[color:var(--pl-surface)] hover:text-[color:var(--pl-ink)]"
        }`}
      >
        {active && <ActiveRail id={railId} className="absolute -left-1.5 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-full bg-[color:var(--pl-orange)]" />}
        <SectionIcon className="h-4 w-4 shrink-0" />
      </Link>
    );
  }

  // Expanded: leaf link
  if (section.href) {
    const active = activeHref === section.href;
    return (
      <Link
        href={section.href}
        aria-current={active ? "page" : undefined}
        className={`pl-press relative flex w-full items-center gap-3 rounded-xl ${py} pl-4 pr-3 text-sm font-semibold transition-colors duration-150 ${
          active
            ? "bg-[color:var(--pl-orange-tint)] text-[color:var(--pl-orange-text)]"
            : "text-[color:var(--pl-ink-2)] hover:bg-[color:var(--pl-surface)] hover:text-[color:var(--pl-ink)]"
        }`}
      >
        {active && <ActiveRail id={railId} />}
        <SectionIcon className="h-4 w-4 shrink-0" />
        <span className="flex-1">{section.label}</span>
      </Link>
    );
  }

  // Expanded: collapsible section
  return (
    <div>
      <button
        type="button"
        onClick={() => toggleSection(section.id)}
        aria-expanded={isOpen}
        className={`flex w-full items-center gap-3 rounded-xl ${py} pl-4 pr-3 text-left text-sm font-semibold transition-colors duration-150 ${
          isOpen || hasActive
            ? "text-[color:var(--pl-ink)]"
            : "text-[color:var(--pl-ink-2)] hover:text-[color:var(--pl-ink)]"
        } hover:bg-[color:var(--pl-surface)]`}
      >
        <SectionIcon className="h-4 w-4 shrink-0 text-[color:var(--pl-ink-3)]" />
        <span className="flex-1">{section.label}</span>
        {/* A dot when the section is closed but holds where you are, so a
            collapsed group never hides the fact that you are inside it. */}
        {!isOpen && hasActive && (
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[color:var(--pl-orange)]" />
        )}
        <ChevronRight
          className="h-3.5 w-3.5 shrink-0 text-[color:var(--pl-ink-3)] transition-transform duration-200 ease-in-out"
          style={{ transform: isOpen ? "rotate(90deg)" : "rotate(0deg)" }}
        />
      </button>

      <Collapsible open={isOpen}>
        {/* One quiet vertical line marks the children as belonging to the
            section above them, which is what stops the long Insights group
            reading as fifteen unrelated links. */}
        <div className="ml-[30px] border-l border-[color:var(--pl-hairline)] pb-1 pl-2 pt-1">
          {section.items.map((item) =>
            item.kind === "group" ? (
              <NavLeafGroup key={item.label} group={item} location={location} activeHref={activeHref} railId={railId} />
            ) : (
              <NavLeafLink
                key={item.href}
                item={item}
                active={activeHref === item.href}
                railId={railId}
              />
            ),
          )}
        </div>
      </Collapsible>
    </div>
  );
}

/**
 * The icon rail — a curated shortlist, not the whole tree.
 *
 * It keeps its own labels ("What you sell" rather than "Revenue") and collapses
 * whole areas to one icon ("Money", "Plan"), because nine words do not fit in a
 * 40px column. That curation is deliberate and stays.
 *
 * What was NOT deliberate: it never saw a feature flag, so it showed Hours and
 * Worth having to businesses with those switched off, and — because nobody
 * added it when Projects shipped — it had no Projects icon for the businesses
 * that do have them. `/setup/projects` is here now so the gate below has
 * something to reveal.
 *
 * The hairline between the two halves used to be drawn at `index === 10`. Once
 * the list is filtered, position 10 is whatever happened to survive — so the
 * divider would have slid onto a different icon the first time an owner
 * switched hours off. Two named groups cannot slide, and the rule for drawing
 * it becomes "between them, when both have something in them".
 */
export const RAIL_RECORD_LINKS: NavLeaf[] = [
  { kind: "leaf", label: "Summary", href: "/dashboard", icon: LayoutDashboard },
  { kind: "leaf", label: "Transactions", href: "/record/transactions", icon: ArrowLeftRight },
  { kind: "leaf", label: "Hours", href: "/record/hours", icon: Clock },
  { kind: "leaf", label: "Recurring", href: "/record/recurring", icon: Repeat2 },
  { kind: "leaf", label: "Ad spend", href: "/record/ad-spend", icon: Megaphone },
  { kind: "leaf", label: "What you sell", href: "/setup/revenue", icon: BarChart3 },
  { kind: "leaf", label: "What you spend on", href: "/setup/expenses", icon: ReceiptText },
  { kind: "leaf", label: "People", href: "/setup/people", icon: Users2 },
  { kind: "leaf", label: "Projects", href: "/setup/projects", icon: Briefcase },
  { kind: "leaf", label: "Money", href: "/money", icon: Wallet },
  { kind: "leaf", label: "Insights", href: "/insights", icon: Lightbulb },
];
