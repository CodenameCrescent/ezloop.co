import { useState } from "react";
import Link from "next/link";
import { type NavFeatureFlags, filterGatedLeaves } from "../navVisibility";
import { BarChart3, Rocket, Wrench, Plug, Settings as SettingsIcon, Check, ChevronsUpDown, LogOut } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useSession, signOut } from "next-auth/react";
import { ActiveRail, DEV_ACCOUNT_STORAGE_KEY, LOCAL_TEST_ACCOUNTS, readLocalTestAccountId, type NavLeaf, resolveActiveLeaf } from "./CORE_NAV";
import { RAIL_RECORD_LINKS } from "./NavSectionRow";

export const RAIL_TOOL_LINKS: NavLeaf[] = [
  { kind: "leaf", label: "Worth having", href: "/insights/worth-having", icon: BarChart3 },
  { kind: "leaf", label: "Plan", href: "/plan/action-plan", icon: Rocket },
  { kind: "leaf", label: "What-if", href: "/plan/what-if", icon: Wrench },
  { kind: "leaf", label: "Integrations", href: "/integrations", icon: Plug },
  { kind: "leaf", label: "Settings", href: "/settings", icon: SettingsIcon },
];

export function CollapsedNavLink({ item, active }: { item: NavLeaf; active: boolean }) {
  const ItemIcon = item.icon;
  return (
    <Link
      href={item.href}
      title={item.label}
      aria-label={item.label}
      aria-current={active ? "page" : undefined}
      className={`pl-press relative mx-auto flex h-10 w-10 items-center justify-center rounded-xl transition-colors duration-150 ${
        active
          ? "bg-[color:var(--pl-orange-tint)] text-[color:var(--pl-orange-text)]"
          : "text-[color:var(--pl-ink-2)] hover:bg-[color:var(--pl-surface)] hover:text-[color:var(--pl-ink)]"
      }`}
    >
      {active && (
        <ActiveRail
          id="sidebar-rail-main"
          className="absolute -left-1.5 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-full bg-[color:var(--pl-orange)]"
        />
      )}
      <ItemIcon className="h-4 w-4 shrink-0" />
    </Link>
  );
}

/**
 * `features` is REQUIRED, and that is the point of it.
 *
 * This component took only `location`, which is exactly why it never gated
 * anything: there was nothing to forget, because there was nothing to pass. A
 * required prop means the next rendering of the nav cannot be written without
 * answering the question, the same way `ChartFrame.state` is required so an
 * empty message can never stand in for a failed request.
 */
export function CollapsedTopNav({ location, features }: { location: string; features: NavFeatureFlags }) {
  const record = filterGatedLeaves(RAIL_RECORD_LINKS, features);
  const tools = filterGatedLeaves(RAIL_TOOL_LINKS, features);
  const activeHref = resolveActiveLeaf([...record, ...tools], location);
  const link = (item: NavLeaf) => (
    <div key={item.label} className="w-full">
      <CollapsedNavLink item={item} active={activeHref === item.href} />
    </div>
  );
  return (
    <div className="flex flex-col items-center gap-1.5">
      {record.map(link)}
      {/* Only when there is something on each side of it to separate. */}
      {record.length > 0 && tools.length > 0 && (
        <div className="mx-auto mb-3 mt-2 h-px w-10 bg-[color:var(--pl-hairline)]" />
      )}
      {tools.map(link)}
    </div>
  );
}

export function CompactHealthGauge({ score }: { score: number }) {
  const radius = 18;
  const circumference = 2 * Math.PI * radius;
  const dash = (Math.max(0, Math.min(100, score)) / 100) * circumference;
  return (
    <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-xl bg-[color:var(--pl-surface)]">
      <div className="relative">
        <svg width="46" height="46" viewBox="0 0 46 46">
          <circle cx="23" cy="23" r={radius} stroke="var(--pl-hairline)" strokeWidth="6" fill="none" />
          <circle
            cx="23"
            cy="23"
            r={radius}
            stroke="var(--pl-orange)"
            strokeWidth="6"
            fill="none"
            strokeLinecap="round"
            strokeDasharray={`${dash} ${circumference}`}
            transform="rotate(-90 23 23)"
          />
        </svg>
        <span className="absolute inset-0 flex items-center justify-center text-xs font-extrabold text-[color:var(--pl-ink)]">
          {score}%
        </span>
      </div>
    </div>
  );
}

export function Avatar({ src, initial, size = 7 }: { src?: string | null; initial: string; size?: number }) {
  const dimension = `${size * 0.25}rem`;
  const style = { width: dimension, height: dimension };
  if (src) {
    return <img src={src} alt="Avatar" style={style} className="shrink-0 rounded-xl object-cover" />;
  }
  return (
    <div
      style={style}
      /* The tint token, not an ad-hoc 15% mix of the brand orange: that mix
         landed the initial at 4.46:1, just under readable, and only in light
         mode. The token is the value that was checked. */
      className="flex shrink-0 items-center justify-center rounded-xl bg-[color:var(--pl-orange-tint)] text-xs font-bold text-[color:var(--pl-orange-text)]"
    >
      {initial.toUpperCase()}
    </div>
  );
}

export function LocalAccountMenu({
  accountId,
  onSwitch,
  collapsed,
}: {
  accountId: string;
  onSwitch: (id: string) => void;
  collapsed?: boolean;
}) {
  return (
    <div
      className={`absolute bottom-full z-50 mb-2 overflow-hidden rounded-xl bg-[color:var(--pl-surface)] p-2 shadow-md ${
        collapsed ? "left-full ml-2 w-60" : "left-3 right-3"
      }`}
    >
      <div className="px-2 pb-2">
        <div className="text-xs font-semibold uppercase tracking-wide text-sidebar-foreground/40">
          Local test accounts
        </div>
        <div className="mt-0.5 text-xs text-sidebar-foreground/35">
          Dev-only data switcher
        </div>
      </div>
      <div className="space-y-1">
        {LOCAL_TEST_ACCOUNTS.map((account) => {
          const active = account.id === accountId;
          return (
            <button
              key={account.id}
              type="button"
              onClick={() => onSwitch(account.id)}
              className={`flex w-full items-start gap-2 rounded-xl px-2.5 py-2 text-left transition-all ${
                active
                  ? "bg-sidebar-primary/10 text-sidebar-foreground"
                  : "text-sidebar-foreground/65 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
              }`}
            >
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-sidebar-primary/15 text-xs font-bold text-sidebar-primary">
                {account.label.slice(0, 1)}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs font-medium">{account.label}</div>
                <div className="truncate text-xs text-sidebar-foreground/40">{account.hint}</div>
              </div>
              {active && <Check className="mt-1 h-3.5 w-3.5 shrink-0 text-sidebar-primary" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function LocalUserFooter({ businessName, plan, collapsed }: { businessName: string; plan: string; collapsed: boolean }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [accountId, setAccountId] = useState(readLocalTestAccountId);
  const account =
    LOCAL_TEST_ACCOUNTS.find((item) => item.id === accountId) ?? LOCAL_TEST_ACCOUNTS[0];
  const initial = account.label.slice(0, 1) || businessName.slice(0, 1) || "L";
  const displayName = account.label || businessName || "Local workspace";

  function switchAccount(nextId: string) {
    if (nextId === accountId) {
      setOpen(false);
      return;
    }
    try {
      localStorage.setItem(DEV_ACCOUNT_STORAGE_KEY, nextId);
    } catch {}
    setAccountId(nextId);
    queryClient.clear();
    window.location.reload();
  }

  if (collapsed) {
    return (
      <div className="relative flex justify-center pt-3">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          title={`${displayName} - local test account`}
          className="rounded-2xl bg-[color:var(--pl-surface)] p-2 outline-none transition-all focus-visible:ring-2 focus-visible:ring-[color:color-mix(in_srgb,var(--pl-orange)_25%,transparent)]"
        >
          <Avatar initial={initial} size={7} />
        </button>
        {open && (
          <LocalAccountMenu
            accountId={account.id}
            onSwitch={switchAccount}
            collapsed
          />
        )}
      </div>
    );
  }

  return (
    <div className="relative pt-4">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-3 rounded-xl bg-[color:var(--pl-surface)] px-3 py-3 text-left transition-all hover:bg-[color:var(--pl-recessed)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:color-mix(in_srgb,var(--pl-orange)_25%,transparent)]"
      >
        <Avatar initial={initial} size={7} />
        <div className="flex min-w-0 flex-1 flex-col leading-tight">
          <span className="truncate text-xs font-bold text-[color:var(--pl-ink)]">
            {displayName}
          </span>
          <span className="t-micro">
            Signed in locally · {plan}
          </span>
        </div>
        <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-[color:var(--pl-ink-2)]" />
      </button>
      {open && (
        <LocalAccountMenu
          accountId={account.id}
          onSwitch={switchAccount}
        />
      )}
    </div>
  );
}

export function SessionUserFooter({ businessName, plan, collapsed }: { businessName: string; plan: string; collapsed: boolean }) {
  const { data } = useSession();
  const user = data?.user;
  const initial = user?.name?.slice(0, 1) || user?.email?.slice(0, 1) || businessName.slice(0, 1) || "U";
  const displayName = user?.name || user?.email || businessName;
  const avatarSrc = user?.image;

  if (collapsed) {
    return (
      <div className="flex justify-center px-2 py-3">
        <div title={displayName}>
          <Avatar src={avatarSrc} initial={initial} size={7} />
        </div>
      </div>
    );
  }

  return (
    <div className="px-4 py-4">
      <div className="flex items-center gap-3 rounded-xl bg-[color:var(--pl-surface)] px-3 py-3">
        <Avatar src={avatarSrc} initial={initial} size={7} />
        <div className="flex min-w-0 flex-1 flex-col leading-tight">
          <span className="truncate text-xs font-medium text-sidebar-foreground">
            {displayName}
          </span>
          <span className="text-xs text-sidebar-foreground/40 capitalize">{plan}</span>
        </div>
        <button
          type="button"
          onClick={() => signOut({ callbackUrl: "/" })}
          title="Sign out"
          className="rounded-xl p-1.5 text-sidebar-foreground/45 transition-all duration-150 ease-out hover:bg-sidebar-accent hover:text-sidebar-foreground"
        >
          <LogOut className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
