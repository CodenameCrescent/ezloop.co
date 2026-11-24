interface Props {
  score: number;
  label: string;
}

/**
 * A slim status row, not a card.
 *
 * The card version stood 359px tall in a 720px rail, which pushed the last nav
 * section ("Plan") into a scroll area — the nav has to fit without scrolling on
 * an ordinary laptop, so this earns one line.
 */
export function HealthGauge({ score, label }: Props) {
  const radius = 13;
  const circumference = 2 * Math.PI * radius;
  const dash = (Math.max(0, Math.min(100, score)) / 100) * circumference;

  // Green, red, grey — nothing else. The arc is a fill, so it takes -solid.
  const color =
    score >= 65
      ? "var(--pl-green-solid)"
      : score >= 45
        ? "var(--pl-ink-3)"
        : "var(--pl-red-solid)";

  return (
    <div className="flex items-center gap-2.5 rounded-full bg-[color:var(--pl-surface)] py-2 pl-2 pr-3.5">
      <div className="relative shrink-0">
        <svg width="32" height="32" viewBox="0 0 32 32">
          <circle cx="16" cy="16" r={radius} stroke="var(--pl-hairline)" strokeWidth="4" fill="none" />
          <circle
            cx="16"
            cy="16"
            r={radius}
            stroke={color}
            strokeWidth="4"
            fill="none"
            strokeLinecap="round"
            strokeDasharray={`${dash} ${circumference}`}
            transform="rotate(-90 16 16)"
            style={{ transition: "stroke-dasharray 600ms ease" }}
          />
        </svg>
      </div>
      <div className="min-w-0 leading-tight">
        <p className="t-num text-sm font-semibold text-[color:var(--pl-ink)]">
          {score}
          <span className="ml-1.5 font-normal text-[color:var(--pl-ink-2)]">{label}</span>
        </p>
        <p className="t-micro">Business health</p>
      </div>
    </div>
  );
}
