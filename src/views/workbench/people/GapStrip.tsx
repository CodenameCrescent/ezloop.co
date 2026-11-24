import { cn } from "@/lib/utils";
import { StatStrip } from "@/components/StatTile";
import { Surface } from "@/components/Surface";
import { PERSON_GAP_COPY, type PersonGap, type PersonGapResult } from "@workspace/domain";

/** "a", "a and b", "a, b and c" — never a bare comma list. */
function joinEnglish(items: string[]): string {
  if (items.length <= 1) return items.join("");
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/**
 * What is wrong with this list, as buttons that narrow it.
 *
 * Only gaps with something in them are rendered: a tile reading zero is noise
 * wearing the costume of information, and four of them is a page shouting that
 * nothing is wrong. When every checked gap is empty the strip becomes one calm
 * line instead — but that line only ever names the checks that actually ran.
 * `results` already carries exactly that set (the caller passes an empty array
 * while it is still loading, and `findPersonGaps` itself omits a gap it could
 * not evaluate), so nothing here may claim more than `results` proves.
 *
 * Amber, never green or red. This is a data-quality signal, not money, and
 * colour in this app means money (DESIGN.md).
 */
export function GapStrip({
  results,
  active,
  onToggle,
}: {
  results: PersonGapResult[];
  active: PersonGap | null;
  onToggle: (gap: PersonGap) => void;
}) {
  // Absent means "not looked at"; empty means "looked, found nothing". Only the
  // second earns the all-clear line, and neither earns a tile.
  const found = results.filter((r) => r.personIds.length > 0);

  if (found.length === 0) {
    // Nothing evaluated at all — still loading, or the caller withheld
    // `results` on purpose. Silence, not a claim, is correct here.
    if (results.length === 0) return null;
    // Something WAS evaluated and came back clean, but "complete" would be a
    // claim about checks that never ran (a pay-rate check the module has
    // turned off, say). Name exactly the checks behind this sentence instead —
    // with `checkName`, the positive form of each gap, so an all-clear line
    // doesn't read as a list of things wrong.
    const checked = results.map((r) => PERSON_GAP_COPY[r.gap].checkName);
    return (
      <Surface variant="bordered" padding="md">
        <p className="t-secondary">Nothing to fix. I checked for {joinEnglish(checked)}.</p>
      </Surface>
    );
  }

  const columns = found.length >= 3 ? 3 : 2;

  return (
    // A single found gap must not render half-width: StatStrip's 2-column
    // class leaves the other half empty, so a lone tile gets its own row.
    // `overflow-hidden` keeps a pressed tile's fill inside StatStrip's
    // rounded corners — the strip's border has a radius but no clipping of
    // its own, since every other StatStrip in the app only ever holds
    // transparent StatTile cells.
    <StatStrip columns={columns} className={cn("overflow-hidden", found.length === 1 && "sm:grid-cols-1")}>
      {found.map(({ gap, personIds }) => {
        const copy = PERSON_GAP_COPY[gap];
        const on = active === gap;
        return (
          <button
            key={gap}
            type="button"
            aria-pressed={on}
            onClick={() => onToggle(gap)}
            className={`flex flex-col gap-1.5 p-3 text-left transition-colors ${
              on
                ? "bg-[color:var(--pl-amber-tint)]"
                : "hover:bg-[color:var(--pl-recessed)]"
            }`}
          >
            <span className="t-micro">{copy.label}</span>
            <span className="text-lg font-semibold text-[color:var(--pl-amber)]">
              {personIds.length}
            </span>
            <span className="t-secondary text-xs">{copy.consequence}</span>
          </button>
        );
      })}
    </StatStrip>
  );
}
