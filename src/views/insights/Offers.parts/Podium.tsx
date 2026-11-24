import { cn } from "@/lib/utils";
import type { EndpointResponse, getOffers } from "@workspace/api-contract";

export type OffersData = EndpointResponse<typeof getOffers>;
export type PodiumEntry = OffersData["podium"]["entries"][number];

/**
 * Three cards sized by what each one earns, biggest in the CENTRE.
 *
 * The top offer being physically the largest thing on screen is the point —
 * you know your winner before reading a word.
 */
export function Podium({
  entries,
  money,
  onSelect,
}: {
  entries: PodiumEntry[];
  money: (c: number) => string;
  onSelect: (id: string) => void;
}) {
  const [first, second, third] = entries;
  // Centre the winner: second, first, third.
  const ordered = [second, first, third].filter(Boolean);

  return (
    <div className="flex items-end justify-center gap-3 sm:gap-4">
      {ordered.map((entry) => {
        const isWinner = entry.id === first?.id;
        return (
          <button
            key={entry.id}
            type="button"
            onClick={() => onSelect(entry.id)}
            className={cn(
              "flex flex-1 flex-col justify-end rounded-xl p-4 text-left transition-colors",
              isWinner
                ? "bg-[color:var(--pl-green-tint)] sm:p-6"
                : "bg-[color:var(--pl-recessed)]",
            )}
            style={{ minHeight: isWinner ? 190 : 140 }}
          >
            <p
              className={cn(
                "font-semibold text-[color:var(--pl-ink)]",
                isWinner ? "t-section" : "t-body",
              )}
            >
              {entry.name}
            </p>
            <p
              className={cn("t-num mt-1 font-semibold", isWinner ? "text-2xl" : "text-lg")}
              style={{ color: isWinner ? "var(--pl-green)" : "var(--pl-ink)" }}
            >
              {money(entry.contributionProfitCents)}
            </p>
            <p className="t-secondary mt-0.5">{entry.sharePct.toFixed(0)}% of what you keep</p>
          </button>
        );
      })}
    </div>
  );
}
