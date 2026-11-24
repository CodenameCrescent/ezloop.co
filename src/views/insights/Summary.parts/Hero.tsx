import Link from "next/link";
import { Surface } from "@/components/Surface";
import { type FigureState, figureStateSentence } from "@/lib/figureState";
import { MIN_DAYS_FOR_SCORE } from "@workspace/domain";
import type { EndpointResponse, getPqs } from "@workspace/api-contract";

export type PqsResponse = EndpointResponse<typeof getPqs>;

/** Direction beats absolute value: "68" alone means nothing, "down 4" is instant. */
export function Delta({ delta }: { delta: number | null }) {
  if (delta === null) {
    return <p className="t-micro mt-2">Nothing to compare against yet</p>;
  }
  if (delta === 0) {
    return <p className="t-micro mt-2">— unchanged</p>;
  }
  const up = delta > 0;
  return (
    <p
      className="t-num mt-2 text-sm font-medium"
      style={{ color: up ? "var(--pl-green)" : "var(--pl-red)" }}
    >
      {up ? "▲ up" : "▼ down"} {Math.abs(delta)} this period
    </p>
  );
}

export function Hero({
  data,
  state,
  onWhy,
}: {
  data: PqsResponse | undefined;
  state: FigureState;
  onWhy: () => void;
}) {
  /*
   * `!data` first, so the two reasons for having no score are told apart.
   *
   * "Working out your score…" was the answer to `isLoading || !data`, and a
   * failed or paused request leaves `isLoading` false — so the page kept
   * promising a score that was never coming. The states below this line are
   * deliberately careful about the same thing: a score of 0 is a verdict on a
   * business, so it is never shown for a business that has not been measured.
   * A request that did not arrive has measured nothing at all.
   */
  if (!data) {
    return (
      <Surface padding="lg" className="text-center">
        {state === "loading" ? (
          <p className="t-secondary">Working out your score…</p>
        ) : (
          <p className="t-body text-[color:var(--pl-amber)]">
            {figureStateSentence(state, "your score")}
          </p>
        )}
      </Surface>
    );
  }

  /**
   * First run and empty replace the hero ENTIRELY — never a 0 and never a
   * spinner. A zero would be a verdict on a business that has not been measured
   * yet, and it is the first thing a new user would ever see.
   */
  if (data.state !== "ok") {
    const daysLeft = Math.max(0, MIN_DAYS_FOR_SCORE - data.daysOfActivity);
    const pct = Math.min(100, (data.daysOfActivity / MIN_DAYS_FOR_SCORE) * 100);
    return (
      <Surface padding="lg" className="text-center">
        <h1 className="t-title text-[color:var(--pl-ink)]">
          {data.state === "no_activity" ? "Your score starts with your first sale" : "Setting up your score"}
        </h1>
        {data.state === "too_new" && (
          <>
            <div className="mx-auto mt-4 h-2 w-full max-w-xs overflow-hidden rounded-full bg-[color:var(--pl-recessed)]">
              <div className="h-full rounded-full bg-[color:var(--pl-ink-3)]" style={{ width: `${pct}%` }} />
            </div>
            <p className="t-micro mt-2">
              {data.daysOfActivity} of {MIN_DAYS_FOR_SCORE} days
            </p>
          </>
        )}
        <p className="t-verdict mx-auto mt-4 max-w-md text-[color:var(--pl-ink)]">{data.verdict}</p>
        <Link
          href="/record/transactions"
          className="mt-5 inline-flex items-center gap-1.5 rounded-full bg-[color:var(--pl-orange-fill)] px-4 py-2 text-xs font-semibold text-[color:var(--pl-on-orange)] transition-colors hover:bg-[color:var(--pl-orange-hover)]"
        >
          {data.state === "no_activity" ? "Record a sale" : "Keep recording"}
        </Link>
        {daysLeft > 0 && data.state === "too_new" && (
          <p className="t-secondary mt-3">Come back in {daysLeft === 1 ? "a day" : `${daysLeft} days`}.</p>
        )}
      </Surface>
    );
  }

  return (
    <Surface padding="lg" className="text-center">
      {/* The score is NEVER coloured, at any value. If 68 renders orange, people
          read the colour and stop reading the number — and a "yellow" score
          creates anxiety without information. The delta carries the feeling. */}
      <div className="t-num text-[72px] font-semibold leading-none tracking-tight text-[color:var(--pl-ink)] sm:text-[96px]">
        {data.score}
      </div>

      <Delta delta={data.delta} />

      <p className="t-verdict mx-auto mt-3 max-w-md text-[color:var(--pl-ink)]">{data.verdict}</p>

      {data.measuresUsed < data.measuresTotal && (
        <p className="t-micro mt-2">
          Based on {data.measuresUsed} of {data.measuresTotal} measures
        </p>
      )}

      {/* A text link, not a button. Most people never tap it; the ones who do
          will not trust the app until they have. */}
      <button
        type="button"
        onClick={onWhy}
        className="mt-4 text-xs font-semibold text-[color:var(--pl-orange-text)] hover:underline"
      >
        Why this score →
      </button>
    </Surface>
  );
}
