import { useState } from "react";
import Link from "next/link";
import { ArrowRight, Check, MoreHorizontal } from "lucide-react";
import { Line, LineChart, ResponsiveContainer } from "recharts";
import { Surface } from "@/components/Surface";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { formatCents } from "@/lib/money";
import { TONE_STYLE, toneForImpact, type InsightTone } from "@/lib/insightTone";
import { cn } from "@/lib/utils";

/**
 * THE insight card — one component, used on every Insights tab (INSIGHTS.md
 * § The insight card).
 *
 * Anatomy, top to bottom: impact (colored, largest) · headline (max 8 words) ·
 * cause (one line, real numbers) · action + controls.
 *
 * Two rules are enforced here rather than left to callers:
 *   1. Never render a card without a dollar figure. A rule that fires but can't
 *      be quantified is a log entry, not a card — so `impactCents` is required
 *      and a null impact renders nothing.
 *   2. Money arrives as server-computed integer cents and is only formatted
 *      (CLAUDE.md: the UI never computes money).
 */

export interface InsightExplainInput {
  /** What went into the calculation, e.g. "Ad spend" → "$2,200". */
  label: string;
  value: string;
}

export interface InsightExplain {
  /** The rule's threshold in plain words, e.g. "Fires when true ROAS < 1.0×". */
  threshold: string;
  /** What this was measured against, e.g. "This month vs last month". */
  comparisonPeriod: string;
  /** The real inputs — this is the actual math, never an LLM answer. */
  inputs: InsightExplainInput[];
}

export interface InsightCardProps {
  /** Rule id — used for dismissal/telemetry, never shown. */
  id: string;
  /**
   * Server-computed impact in integer cents. Negative = money lost (red),
   * positive = money gained (green), 0 = neutral. Required by design.
   */
  impactCents: number;
  /** Qualifier shown after the figure, e.g. "/mo". Not part of the money math. */
  impactSuffix?: string;
  /** Max 8 words. */
  headline: string;
  /** One line, with real numbers in it. */
  cause: string;
  /** One action, phrased as a verb the user can do today. */
  action?: { label: string; href: string };
  /** The real calculation behind the card, revealed by "Explain". */
  explain?: InsightExplain;
  /**
   * Trend series for the optional sparkline. Only pass this when the card is
   * ABOUT a trend — never decorative.
   */
  trend?: number[];
  /**
   * Urgency beats size: runway under 60 days outranks everything and gets a red
   * left edge. Reserved for that class of card.
   */
  urgent?: boolean;
  /** One card per subject: the rolled-up siblings, e.g. 2 + "Meta ads". */
  related?: { count: number; subject: string };
  /** Currency symbol from user settings. */
  symbol?: string;
  onDismiss?: (id: string) => void;
  onSnooze?: (id: string) => void;
  /** The only feedback loop on rule quality — log every tap. */
  onNotRelevant?: (id: string) => void;
  onShowData?: (id: string) => void;
  className?: string;
}

/** Impact reads as a magnitude with an explicit sign; the color carries the rest. */
function formatImpact(impactCents: number, symbol: string): string {
  const abs = formatCents(Math.abs(impactCents), symbol);
  if (impactCents > 0) return `+${abs}`;
  if (impactCents < 0) return `−${abs}`;
  return abs;
}

export function InsightCard({
  id,
  impactCents,
  impactSuffix,
  headline,
  cause,
  action,
  explain,
  trend,
  urgent,
  related,
  symbol = "Rs",
  onDismiss,
  onSnooze,
  onNotRelevant,
  onShowData,
  className,
}: InsightCardProps) {
  const [explainOpen, setExplainOpen] = useState(false);

  // Rule 1: no dollar figure, no card.
  if (!Number.isFinite(impactCents)) {
    if ((process.env.NODE_ENV !== "production")) {
      console.warn(`InsightCard "${id}" has no impact figure — that's a log entry, not a card.`);
    }
    return null;
  }

  const tone: InsightTone = toneForImpact(impactCents);
  const style = TONE_STYLE[tone];
  const hasTrend = Array.isArray(trend) && trend.length > 1;

  return (
    <Surface
      padding="none"
      className={cn("relative overflow-hidden", className)}
      data-insight-id={id}
      data-tone={tone}
    >
      {/* Urgency marker — the one case a card shouts before it is read. */}
      {urgent && <span aria-hidden className={cn("absolute inset-y-0 left-0 w-1", style.edge)} />}

      <div className={cn("p-5", urgent && "pl-6")}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            {/* Impact — the largest text on the card, and the only coloured one. */}
            <div className={cn("t-num text-2xl font-semibold tracking-tight sm:text-[28px]", style.text)}>
              {formatImpact(impactCents, symbol)}
              {impactSuffix && <span className="ml-0.5 text-base font-medium">{impactSuffix}</span>}
            </div>
            <h3 className="t-section mt-1.5 text-[color:var(--pl-ink)]">{headline}</h3>
            <p className="t-body mt-1 leading-6 text-[color:var(--pl-ink-2)]">{cause}</p>
          </div>

          <div className="flex shrink-0 items-start gap-2">
            {hasTrend && (
              <div className="h-9 w-20" aria-hidden>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={trend!.map((v, i) => ({ i, v }))} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
                    <Line type="monotone" dataKey="v" stroke={style.stroke} strokeWidth={2} dot={false} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
            {(onSnooze || onNotRelevant || onShowData) && (
              <DropdownMenu>
                <DropdownMenuTrigger
                  aria-label="More options"
                  className="rounded-md p-1 text-[color:var(--pl-ink-3)] transition hover:bg-[color:var(--pl-recessed)] hover:text-[color:var(--pl-ink)]"
                >
                  <MoreHorizontal className="h-4 w-4" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {onSnooze && <DropdownMenuItem onClick={() => onSnooze(id)}>Snooze 30 days</DropdownMenuItem>}
                  {onNotRelevant && <DropdownMenuItem onClick={() => onNotRelevant(id)}>Not relevant</DropdownMenuItem>}
                  {onShowData && <DropdownMenuItem onClick={() => onShowData(id)}>Show me the data</DropdownMenuItem>}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </div>

        {/* One card per subject: the siblings that were rolled into this one. */}
        {related && related.count > 0 && (
          <p className="t-micro mt-2">
            +{related.count} more about {related.subject}
          </p>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-2">
          {action && (
            <Link
              href={action.href}
              className="inline-flex items-center gap-1.5 rounded-full bg-[color:var(--pl-orange-fill)] px-3 py-1.5 text-xs font-semibold text-[color:var(--pl-on-orange)] transition-colors hover:bg-[color:var(--pl-orange-hover)]"
            >
              {action.label} <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          )}
          {explain && (
            <button
              type="button"
              onClick={() => setExplainOpen((o) => !o)}
              aria-expanded={explainOpen}
              className="rounded-full px-3 py-1.5 text-xs font-semibold text-[color:var(--pl-ink-2)] transition hover:text-[color:var(--pl-ink)]"
            >
              {explainOpen ? "Hide" : "Explain"}
            </button>
          )}
          {onDismiss && (
            <button
              type="button"
              onClick={() => onDismiss(id)}
              aria-label="Got it"
              title="Got it"
              className="ml-auto inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold text-[color:var(--pl-ink-2)] transition hover:text-[color:var(--pl-ink)]"
            >
              <Check className="h-3.5 w-3.5" /> Got it
            </button>
          )}
        </div>

        {/* The real calculation — inputs, the threshold that fired, the period. */}
        {explain && explainOpen && (
          <div className="mt-3 rounded-lg bg-[color:var(--pl-recessed)] p-3">
            <dl className="space-y-1">
              {explain.inputs.map((input) => (
                <div key={input.label} className="flex items-baseline justify-between gap-3 text-xs">
                  <dt className="text-[color:var(--pl-ink-2)]">{input.label}</dt>
                  <dd className="t-num font-semibold text-[color:var(--pl-ink)]">{input.value}</dd>
                </div>
              ))}
            </dl>
            <p className="t-micro mt-2 border-t border-[color:var(--pl-hairline)] pt-2">
              {explain.threshold} · {explain.comparisonPeriod}
            </p>
          </div>
        )}
      </div>
    </Surface>
  );
}
