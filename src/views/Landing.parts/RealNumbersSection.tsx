import { useState, useEffect } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Sparkles, ArrowRight, CheckCircle2 } from "lucide-react";

export function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: string;
}) {
  return (
    <div className="rounded-lg bg-[color:var(--pl-surface)]/[0.02] p-3">
      <div className="text-[10px] uppercase tracking-wider text-[color:var(--pl-ink-2)]">
        {label}
      </div>
      <div className={`mt-1 text-base font-bold ${tone}`}>{value}</div>
    </div>
  );
}

export function AnimatedKpiCard() {
  const frames = [
    { revenue: "Rs 184K", adSpend: "Rs 42K", profit: "Rs 64K", pct: "+18.4%" },
    { revenue: "Rs 211K", adSpend: "Rs 51K", profit: "Rs 73K", pct: "+22.1%" },
    { revenue: "Rs 97K", adSpend: "Rs 28K", profit: "Rs 31K", pct: "+9.7%" },
  ];
  const [idx, setIdx] = useState(0);
  const [fade, setFade] = useState(true);

  useEffect(() => {
    const timer = setInterval(() => {
      setFade(false);
      setTimeout(() => {
        setIdx((i) => (i + 1) % frames.length);
        setFade(true);
      }, 300);
    }, 2800);
    return () => clearInterval(timer);
  }, []);

  const f = frames[idx];
  return (
    <div className="relative">
      
      <div className="relative rounded-2xl bg-[color:var(--pl-surface)] p-5">
        <div className="mb-4 flex items-center justify-between">
          <div className="text-xs text-[color:var(--pl-ink-2)]">Today's snapshot</div>
          <div
            className="rounded-full bg-[color:var(--pl-orange-tint)] px-2 py-0.5 text-[10px] font-semibold text-[color:var(--pl-orange-text)] transition-opacity duration-300"
            style={{ opacity: fade ? 1 : 0 }}
          >
            {f.pct}
          </div>
        </div>
        <div
          className="grid grid-cols-3 gap-3 transition-opacity duration-300"
          style={{ opacity: fade ? 1 : 0 }}
        >
          <Stat label="Revenue" value={f.revenue} tone="text-white" />
          <Stat label="Ad spend" value={f.adSpend} tone="text-[color:var(--pl-amber)]" />
          <Stat label="Net profit" value={f.profit} tone="text-[color:var(--pl-orange-text)]" />
        </div>
        <div className="mt-4 rounded-lg bg-[color:var(--pl-surface)]/[0.02] p-3">
          <div className="text-[10px] uppercase tracking-wider text-[color:var(--pl-ink-2)] mb-1.5">
            Cost breakdown
          </div>
          <div className="space-y-1">
            {[
              { label: "Product COGS", val: "Rs 68K", w: "w-[55%]" },
              { label: "Delivery", val: "Rs 10K", w: "w-[12%]" },
              { label: "Ad spend", val: "Rs 42K", w: "w-[33%]" },
            ].map((r) => (
              <div key={r.label} className="flex items-center gap-2">
                <div className="w-20 shrink-0 text-[10px] text-[color:var(--pl-ink-2)]">{r.label}</div>
                <div className="flex-1 rounded-full bg-[color:var(--pl-recessed)] h-1.5">
                  <div className={`h-1.5 rounded-full bg-[color:var(--pl-orange-tint)] ${r.w}`} />
                </div>
                <div className="w-12 text-right text-[10px] text-[color:var(--pl-ink-2)]">{r.val}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export function HeroSection() {
  return (
    <section className="mx-auto max-w-6xl px-6 pb-16 pt-12 md:pt-20">
      <div className="grid gap-10 md:grid-cols-2 md:items-center">
        <div>
          <div className="mb-5 inline-flex items-center gap-2 rounded-full border bg-[color:var(--pl-orange-tint)] px-3 py-1 text-xs text-[color:var(--pl-orange-text)]">
            <Sparkles className="h-3.5 w-3.5" />
            The profit OS for online sellers
          </div>
          <h1 className="text-4xl font-bold leading-tight tracking-tight md:text-5xl">
            See your{" "}
            <span className="text-[color:var(--pl-orange-text)]">
              real profit
            </span>
            , not just revenue.
          </h1>
          <p className="mt-5 max-w-xl text-lg text-[color:var(--pl-ink-2)]">
            Profit Loop pulls every cost — ads, COGS, delivery, fees — into
            one view, then tells you exactly which offers to{" "}
            <span className="text-[color:var(--pl-orange-text)]">scale</span>,{" "}
            <span className="text-[color:var(--pl-amber)]">optimize</span>, or{" "}
            <span className="text-[color:var(--pl-red)]">stop</span>.
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <Link href="/sign-up">
              <Button
                size="lg"
                className="bg-[color:var(--pl-orange-fill)] text-white hover:bg-[color:var(--pl-orange-hover)]"
              >
                Start free
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </Link>
            <a href="#real-numbers">
              <Button
                size="lg"
                variant="outline"
                className="border-white/10 bg-[color:var(--pl-recessed)] text-white hover:bg-[color:var(--pl-recessed)]"
              >
                See demo
              </Button>
            </a>
          </div>
          <div className="mt-6 flex items-center gap-5 text-xs text-[color:var(--pl-ink-2)]">
            <span className="inline-flex items-center gap-1.5">
              <CheckCircle2 className="h-3.5 w-3.5 text-[color:var(--pl-orange-text)]" />
              No credit card
            </span>
            <span className="inline-flex items-center gap-1.5">
              <CheckCircle2 className="h-3.5 w-3.5 text-[color:var(--pl-orange-text)]" />
              Cancel anytime
            </span>
            <span className="inline-flex items-center gap-1.5">
              <CheckCircle2 className="h-3.5 w-3.5 text-[color:var(--pl-orange-text)]" />
              Setup in 2 min
            </span>
          </div>
        </div>
        <AnimatedKpiCard />
      </div>
    </section>
  );
}

export function RealNumbersSection() {
  return (
    <section id="real-numbers" className="mx-auto max-w-6xl px-6 py-20">
      <div className="text-center mb-12">
        <div className="inline-block rounded-full bg-[color:var(--pl-amber-tint)] px-3 py-1 text-xs text-[color:var(--pl-amber)] mb-4">
          Real example
        </div>
        <h2 className="text-2xl font-bold md:text-3xl">
          What you think vs. what you actually made
        </h2>
        <p className="mt-3 text-[color:var(--pl-ink-2)] max-w-lg mx-auto">
          Most sellers are surprised — often shocked — when they see their true profit for the first time.
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-2 max-w-4xl mx-auto">
        <div className="rounded-xl bg-[color:var(--pl-red-tint)] p-6">
          <div className="flex items-center gap-2 mb-4">
            <div className="h-2 w-2 rounded-full bg-[color:var(--pl-red-solid)]" />
            <span className="text-sm font-medium text-[color:var(--pl-red)]">Before Profit Loop</span>
          </div>
          <div className="text-3xl font-bold text-white mb-1">Rs 45,000</div>
          <div className="text-xs text-[color:var(--pl-ink-2)] mb-5">Sales total (what you see coming in)</div>
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-[color:var(--pl-ink-2)]">Product revenue</span>
              <span className="text-white">Rs 45,000</span>
            </div>
            <div className=" pt-2 text-sm text-[color:var(--pl-ink-2)] italic">
              "I made Rs 45K this month!"
            </div>
          </div>
        </div>

        <div className="rounded-xl bg-[color:var(--pl-orange-tint)] p-6">
          <div className="flex items-center gap-2 mb-4">
            <div className="h-2 w-2 rounded-full bg-[color:var(--pl-orange)]" />
            <span className="text-sm font-medium text-[color:var(--pl-orange-text)]">With Profit Loop</span>
          </div>
          <div className="text-3xl font-bold text-[color:var(--pl-orange-text)] mb-1">Rs 12,300</div>
          <div className="text-xs text-[color:var(--pl-ink-2)] mb-5">True net profit after all costs</div>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-[color:var(--pl-ink-2)]">Product revenue</span>
              <span className="text-white">Rs 45,000</span>
            </div>
            <div className="flex justify-between text-[color:var(--pl-red)]">
              <span>− Product COGS</span>
              <span>Rs 18,500</span>
            </div>
            <div className="flex justify-between text-[color:var(--pl-red)]">
              <span>− Meta & Google ads</span>
              <span>Rs 9,200</span>
            </div>
            <div className="flex justify-between text-[color:var(--pl-red)]">
              <span>− Delivery costs</span>
              <span>Rs 3,100</span>
            </div>
            <div className="flex justify-between text-[color:var(--pl-red)]">
              <span>- Operating costs</span>
              <span>Rs 1,900</span>
            </div>
            <div className=" mt-2 pt-2 flex justify-between font-semibold">
              <span className="text-[color:var(--pl-orange-text)]">= Net profit</span>
              <span className="text-[color:var(--pl-orange-text)]">Rs 12,300</span>
            </div>
          </div>
        </div>
      </div>

      <p className="text-center text-sm text-[color:var(--pl-ink-2)] mt-6">
        Rs 32,700 in costs you weren't tracking. Profit Loop surfaces every one of them.
      </p>
    </section>
  );
}

export interface LandingFeature {
  text: string;
  included: boolean;
}
