import { useState } from "react";
import { formatCents } from "@/lib/money";
import { QUADRANT_LABEL, QUADRANT_MEANING, type Quadrant } from "@workspace/domain";
import type { EndpointResponse, getOffers } from "@workspace/api-contract";

type Dot = EndpointResponse<typeof getOffers>["quadrant"]["dots"][number];
type QuadrantData = EndpointResponse<typeof getOffers>["quadrant"];

/**
 * The quadrant map: how much something sells against how much of it you keep.
 *
 * This single chart replaces about six tables and is the thing people remember
 * the app for. One look tells you what to push, fix or kill.
 *
 * The crosshair sits on the business's OWN median offer, not an industry
 * benchmark — a 60% margin is ordinary for a consultancy and extraordinary for
 * a grocer, so a fixed line would mislabel half of all businesses.
 *
 * Colour follows the money rule: green in Winners, red in Traps and Dead
 * weight, grey everywhere else. Only the top few dots are labelled directly —
 * label them all and the chart becomes unreadable.
 */

const PAD = 34;
const HEIGHT = 380;
const LABELLED = 4;

const DOT_FILL: Record<Quadrant, string> = {
  winners: "var(--pl-green-solid)",
  "hidden-gems": "var(--pl-ink-3)",
  traps: "var(--pl-red-solid)",
  "dead-weight": "var(--pl-red-solid)",
};

export function QuadrantMap({
  data,
  symbol = "Rs",
  onSelect,
}: {
  data: QuadrantData;
  symbol?: string;
  onSelect?: (id: string) => void;
}) {
  const [hovered, setHovered] = useState<Dot | null>(null);

  const maxRevenueX = Math.max(...data.dots.map((d) => d.revenueCents), data.revenueMidpoint * 2, 1);
  const maxMargin = Math.max(...data.dots.map((d) => d.marginPct), data.marginMidpoint * 2, 1);
  const minMargin = Math.min(...data.dots.map((d) => d.marginPct), 0);
  const maxUnits = Math.max(...data.dots.map((d) => d.unitsSold), 1);

  // Percent positions inside the plot area.
  const xOf = (v: number) => (v / maxRevenueX) * 100;
  const yOf = (m: number) => ((m - minMargin) / (maxMargin - minMargin || 1)) * 100;
  const rOf = (units: number) => 6 + (units / maxUnits) * 16;

  // The biggest earners get their names printed; the rest reveal on hover.
  const labelled = new Set(
    [...data.dots]
      .sort((a, b) => b.contributionProfitCents - a.contributionProfitCents)
      .slice(0, LABELLED)
      .map((d) => d.id),
  );

  return (
    <div>
      <div className="relative" style={{ height: HEIGHT }}>
        {/* Axis words, not numbers — the reader needs the direction, not the scale. */}
        <span className="t-micro absolute left-0 top-0">Keeps you more</span>
        <span className="t-micro absolute bottom-6 left-0">Keeps you less</span>
        <span className="t-micro absolute bottom-0 left-1/2 -translate-x-1/2">Brings in more →</span>

        <div className="absolute inset-0" style={{ left: PAD + 60, right: 8, top: 18, bottom: 26 }}>
          {/* The crosshair: this business's own median. */}
          <div
            className="absolute inset-y-0 border-l border-dashed border-[color:var(--pl-hairline)]"
            style={{ left: `${xOf(data.revenueMidpoint)}%` }}
          />
          <div
            className="absolute inset-x-0 border-t border-dashed border-[color:var(--pl-hairline)]"
            style={{ bottom: `${yOf(data.marginMidpoint)}%` }}
          />

          {/* Four plain labels, sitting in their corners. */}
          <QuadrantTag className="left-1 top-1" quadrant="hidden-gems" />
          <QuadrantTag className="right-1 top-1" quadrant="winners" />
          <QuadrantTag className="bottom-1 left-1" quadrant="dead-weight" />
          <QuadrantTag className="bottom-1 right-1" quadrant="traps" />

          {data.dots.map((dot) => {
            const r = rOf(dot.unitsSold);
            return (
              <button
                key={dot.id}
                type="button"
                onClick={() => onSelect?.(dot.id)}
                onMouseEnter={() => setHovered(dot)}
                onMouseLeave={() => setHovered(null)}
                onFocus={() => setHovered(dot)}
                onBlur={() => setHovered(null)}
                aria-label={`${dot.name}: brought in ${formatCents(dot.revenueCents, symbol)}, keeps ${dot.marginPct.toFixed(0)}%`}
                className="absolute -translate-x-1/2 translate-y-1/2 rounded-full transition-transform hover:scale-110 focus:outline-none focus:ring-2 focus:ring-[color:var(--pl-orange)]"
                style={{
                  left: `${xOf(dot.revenueCents)}%`,
                  bottom: `${yOf(dot.marginPct)}%`,
                  width: r * 2,
                  height: r * 2,
                  background: DOT_FILL[dot.quadrant],
                  opacity: 0.85,
                }}
              />
            );
          })}

          {/* Direct labels for the few that matter; the rest on hover. */}
          {data.dots
            .filter((d) => labelled.has(d.id))
            .map((dot) => (
              <span
                key={`label-${dot.id}`}
                className="t-micro pointer-events-none absolute -translate-x-1/2 whitespace-nowrap text-[color:var(--pl-ink)]"
                style={{
                  left: `${xOf(dot.revenueCents)}%`,
                  bottom: `calc(${yOf(dot.marginPct)}% + ${rOf(dot.unitsSold) + 4}px)`,
                }}
              >
                {dot.name}
              </span>
            ))}
        </div>
      </div>

      <div className="mt-2 min-h-[3.5rem] rounded-lg bg-[color:var(--pl-recessed)] p-3">
        {hovered ? (
          <>
            <p className="t-body font-semibold text-[color:var(--pl-ink)]">{hovered.name}</p>
            <p className="t-secondary">
              {QUADRANT_LABEL[hovered.quadrant]} · sold {hovered.unitsSold} · brought in{" "}
              {formatCents(hovered.netRevenueCents, symbol)} · kept{" "}
              {formatCents(hovered.contributionProfitCents, symbol)} ({hovered.marginPct.toFixed(0)}%)
            </p>
          </>
        ) : (
          <p className="t-secondary">
            Each dot is something you sell, placed by how much it brings in and how much of that
            you keep, sized by how many you sold. Point at one to see it.
          </p>
        )}
      </div>
    </div>
  );
}

function QuadrantTag({ quadrant, className }: { quadrant: Quadrant; className: string }) {
  return (
    <span className={`t-micro pointer-events-none absolute ${className}`} title={QUADRANT_MEANING[quadrant]}>
      {QUADRANT_LABEL[quadrant]}
    </span>
  );
}
