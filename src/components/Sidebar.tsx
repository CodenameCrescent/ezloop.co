import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, Search, Settings as SettingsIcon, PanelLeftClose } from "lucide-react";
import { Logo } from "./Logo";
import { HealthGauge } from "./HealthGauge";
import { ThemeToggle, ThemeToggleCompact } from "./ThemeToggle";
import { useProductMetrics, useStore } from "@/lib/store";
import { useSignals } from "@/api/hooks";
import { businessHealthScore } from "@/lib/decisions";
import { filterNavItems, DASHBOARD_NAV, CORE_NAV, UTILITY_NAV, BOTTOM_NAV, getSectionForPath, resolveActiveHref } from "./Sidebar.parts/CORE_NAV";
import { BusinessChip, NavSectionRow } from "./Sidebar.parts/NavSectionRow";
import { CollapsedTopNav, CompactHealthGauge, LocalUserFooter, SessionUserFooter } from "./Sidebar.parts/LocalUserFooter";
const SIDEBAR_COLLAPSED_STORAGE_KEY = "profit_loop_sidebar_collapsed";

function readSidebarCollapsed(): boolean {
  try {
    const saved = localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY);
    if (saved !== null) return saved === "true";
  } catch {}
  return typeof window !== "undefined" ? window.innerWidth < 768 : false;
}

export function Sidebar() {
  const location = usePathname();
  const { settings } = useStore();
  const metrics = useProductMetrics();
  const health = businessHealthScore(metrics);
  const signals = useSignals();
  const urgentCount = (signals.data?.signals ?? []).filter((s) => s.severity === "warning" || s.severity === "critical").length;
  const [collapsed, setCollapsed] = useState(readSidebarCollapsed);

  /**
   * Team only appears for a business with client profitability switched on.
   * The server refuses those endpoints regardless (403), so this is about not
   * showing a dead link — the gate itself lives on the server, not here.
   */
  const showTeam = settings.features?.client_profitability ?? false;
  const showProjects = settings.features?.projects ?? false;
  const visibleCoreNav = useMemo(
    () =>
      CORE_NAV.map((section) =>
        section.items.length === 0
          ? section
          : { ...section, items: filterNavItems(section.items, { showTeam, showProjects }) },
      ),
    [showTeam, showProjects],
  );

  const initialSection = getSectionForPath(location) ?? "dashboard";
  const [openSections, setOpenSections] = useState<Set<string>>(
    new Set([initialSection, "workbench"]),
  );

  // Resolved once, up here, so every row below is told whether it is the
  // current one rather than each deciding for itself and two of them saying yes.
  const mainActiveHref = useMemo(
    () => resolveActiveHref([...DASHBOARD_NAV, ...visibleCoreNav, ...UTILITY_NAV], location),
    [visibleCoreNav, location],
  );
  const bottomActiveHref = useMemo(() => resolveActiveHref(BOTTOM_NAV, location), [location]);

  useEffect(() => {
    const sec = getSectionForPath(location);
    if (sec) setOpenSections((prev) => new Set([...prev, sec]));
  }, [location]);

  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, String(collapsed));
    } catch {}
  }, [collapsed]);

  const toggleSection = (id: string) =>
    setOpenSections((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  return (
    /* No right border and no shadow: the nav sits on the page background, on
       the same plane as the cards. A line here is the one thing that would
       give the shell away as two panes bolted together (DESIGN.md). */
    <aside
      className="hidden h-[100dvh] max-h-[100dvh] shrink-0 flex-col overflow-hidden bg-[color:var(--pl-bg)] text-[color:var(--pl-ink)] transition-[width] duration-300 ease-in-out sm:flex"
      style={{ width: collapsed ? 76 : 268 }}
    >
      <div className="shrink-0 px-4 pb-3 pt-5">
        <div className={`flex items-center ${collapsed ? "justify-center" : "justify-between"}`}>
          <button
            type="button"
            onClick={() => collapsed && setCollapsed(false)}
            title={collapsed ? "Expand sidebar" : "Profit Loop"}
            aria-label={collapsed ? "Expand sidebar" : "Profit Loop"}
            className="rounded-2xl outline-none transition hover:bg-[color:var(--pl-surface)] focus-visible:ring-2 focus-visible:ring-[color:color-mix(in_srgb,var(--pl-orange)_30%,transparent)]"
          >
            <Logo className={collapsed ? "h-10 w-10" : ""} />
          </button>
          {!collapsed && (
            <div className="flex items-center gap-0.5">
              <SidebarHeaderIcon label="Notifications" onClick={() => {}}>
                <Bell className="h-4 w-4" />
              </SidebarHeaderIcon>
              <Link
                href="/settings"
                title="Settings"
                aria-label="Settings"
                className="pl-press inline-flex h-9 w-9 items-center justify-center rounded-xl text-[color:var(--pl-ink-2)] transition-colors hover:bg-[color:var(--pl-surface)] hover:text-[color:var(--pl-ink)]"
              >
                <SettingsIcon className="h-4 w-4" />
              </Link>
              <SidebarHeaderIcon label="Collapse sidebar" onClick={() => setCollapsed(true)}>
                <PanelLeftClose className="h-4 w-4" />
              </SidebarHeaderIcon>
            </div>
          )}
        </div>

        <BusinessChip name={settings.businessName} collapsed={collapsed} />

        {collapsed ? (
          <div className="mt-5 flex flex-col items-center gap-3">
            <button
              type="button"
              onClick={() => setCollapsed(false)}
              title="Expand sidebar"
              aria-label="Expand sidebar"
              className="inline-flex h-10 w-10 items-center justify-center rounded-2xl text-[color:var(--pl-ink-2)] transition hover:bg-[color:var(--pl-surface)] hover:text-[color:var(--pl-orange-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:color-mix(in_srgb,var(--pl-orange)_25%,transparent)]"
            >
              <Search className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <label className="mt-5 flex h-10 items-center gap-2 rounded-full bg-[color:var(--pl-recessed)] px-4 text-sm text-[color:var(--pl-ink-2)] transition focus-within:bg-[color:var(--pl-surface)] focus-within:ring-2 focus-within:ring-[color:color-mix(in_srgb,var(--pl-orange)_25%,transparent)]">
            <Search className="h-4 w-4 shrink-0" />
            <input
              type="search"
              placeholder="Search"
              className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-[color:var(--pl-ink-3)]"
            />
          </label>
        )}
      </div>

      <nav className="app-scrollbar min-h-0 flex-1 overflow-y-auto px-4 py-1">
        {collapsed ? (
          <CollapsedTopNav location={location} features={{ showTeam, showProjects }} />
        ) : (
          <>
            <div className="space-y-0.5">
              {DASHBOARD_NAV.map((section) => (
                <NavSectionRow
                  key={section.id}
                  section={section}
                  location={location}
                  activeHref={mainActiveHref}
                  railId="sidebar-rail-main"
                  openSections={openSections}
                  toggleSection={toggleSection}
                  collapsed={collapsed}
                />
              ))}
            </div>

            <div className="my-3 h-px bg-[color:var(--pl-hairline)]" />
            <div className="space-y-0.5">
              {visibleCoreNav.map((section) => (
                <NavSectionRow
                  key={section.id}
                  section={section}
                  location={location}
                  activeHref={mainActiveHref}
                  railId="sidebar-rail-main"
                  openSections={openSections}
                  toggleSection={toggleSection}
                  collapsed={collapsed}
                />
              ))}
            </div>

            {UTILITY_NAV.length > 0 && (
              <>
                <div className="my-4 h-px bg-[color:var(--pl-hairline)]" />
                <div className="space-y-0.5">
                  {UTILITY_NAV.map((section) => (
                    <NavSectionRow
                      key={section.id}
                      section={section}
                      location={location}
                      activeHref={mainActiveHref}
                      railId="sidebar-rail-main"
                      openSections={openSections}
                      toggleSection={toggleSection}
                      collapsed={collapsed}
                    />
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </nav>

      <div className="mt-auto shrink-0 px-4 pb-4 pt-3">
        <div className={collapsed ? "space-y-3" : "space-y-4"}>
          <Link
            href="/insights"
            title={urgentCount > 0 ? `Business Health — ${urgentCount} thing${urgentCount === 1 ? "" : "s"} need attention` : "Business Health"}
            aria-label="Business Health"
            className="relative block rounded-2xl outline-none transition focus-visible:ring-2 focus-visible:ring-[color:color-mix(in_srgb,var(--pl-orange)_25%,transparent)]"
          >
            {urgentCount > 0 && (
              <span className="absolute -right-1 -top-1 z-[2] grid h-5 min-w-5 place-items-center rounded-full bg-[color:var(--pl-red)] px-1 text-xs font-bold text-white">
                {urgentCount}
              </span>
            )}
            {collapsed ? (
              <CompactHealthGauge score={health.score} />
            ) : (
              <HealthGauge score={health.score} label={health.label} />
            )}
          </Link>

          <div className={collapsed ? "space-y-2" : "space-y-0.5"}>
            {BOTTOM_NAV.map((section) => (
              <NavSectionRow
                key={section.id}
                section={section}
                location={location}
                activeHref={bottomActiveHref}
                railId="sidebar-rail-bottom"
                openSections={openSections}
                toggleSection={toggleSection}
                collapsed={collapsed}
                compact
              />
            ))}
          </div>

          {/* Appearance lives down here rather than in the header row: it is
              set once and then forgotten, so it belongs with the account, not
              beside the things you press all day. */}
          {collapsed ? (
            <div className="flex justify-center">
              <ThemeToggleCompact />
            </div>
          ) : (
            <ThemeToggle />
          )}
        </div>

        <UserFooter businessName={settings.businessName} plan={settings.plan} collapsed={collapsed} />
      </div>
    </aside>
  );
}

function SidebarHeaderIcon({ label, children, onClick }: { label: string; children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className="pl-press inline-flex h-9 w-9 items-center justify-center rounded-xl text-[color:var(--pl-ink-2)] transition-colors hover:bg-[color:var(--pl-surface)] hover:text-[color:var(--pl-ink)]"
    >
      {children}
    </button>
  );
}

function UserFooter({ businessName, plan, collapsed }: { businessName: string; plan: string; collapsed: boolean }) {
  if (process.env.NEXT_PUBLIC_LOCAL_AUTH_BYPASS === "true") {
    return <LocalUserFooter businessName={businessName} plan={plan} collapsed={collapsed} />;
  }

  return <SessionUserFooter businessName={businessName} plan={plan} collapsed={collapsed} />;
}
