import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { TrendingUp, ArrowRight, ChevronDown, Package, ClipboardList } from "lucide-react";
import { HeroSection, RealNumbersSection } from "./Landing.parts/RealNumbersSection";
import { PricingSection } from "./Landing.parts/PricingSection";

export default function Landing() {
  return (
    <div className="min-h-screen bg-[color:var(--pl-bg)] text-[color:var(--pl-ink)]">
      <Header />
      <HeroSection />
      <ProductShotSection />
      <HowItWorksSection />
      <RealNumbersSection />
      <PricingSection />
      <LogosSection />
      <FaqSection />
      <CtaSection />
      <footer className=" py-6 text-center text-xs text-[color:var(--pl-ink-2)]">
        © {new Date().getFullYear()} Profit Loop · All rights reserved ·{" "}
        <Link href="/privacy" className="hover:text-[color:var(--pl-ink)] hover:underline">
          Privacy
        </Link>{" "}
        ·{" "}
        <Link href="/terms" className="hover:text-[color:var(--pl-ink)] hover:underline">
          Terms
        </Link>
      </footer>
    </div>
  );
}

function Header() {
  return (
    <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
      <div className="flex items-center gap-2">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[color:var(--pl-orange)]">
          <TrendingUp className="h-5 w-5 text-white" strokeWidth={3} />
        </div>
        <div className="leading-tight">
          <div className="text-base font-bold">Profit Loop</div>
          <div className="text-[10px] uppercase tracking-wider text-[color:var(--pl-ink-2)]">
            Profit Intelligence
          </div>
        </div>
      </div>
      <nav className="flex items-center gap-3">
        <a href="#pricing" className="hidden text-sm text-[color:var(--pl-ink-2)] hover:text-white sm:block">
          Pricing
        </a>
        <Link href="/sign-in">
          <Button variant="ghost" className="text-[color:var(--pl-ink)] hover:text-white">
            Sign in
          </Button>
        </Link>
        <Link href="/sign-up">
          <Button className="bg-[color:var(--pl-orange-fill)] text-white hover:bg-[color:var(--pl-orange-hover)]">
            Get started
          </Button>
        </Link>
      </nav>
    </header>
  );
}

const shotBase = "/".replace(/\/$/, "");

/**
 * The real dashboard, not an illustration of one. Captured from the demo
 * dataset (`pnpm --filter @workspace/api-server demo`) at 1680px, once per
 * theme; the app toggles themes with a `.dark` class, so the swap follows it
 * rather than the media query. Lazy, so the hidden twin is never fetched.
 */
function ProductShotSection() {
  const shot = "block w-full h-auto rounded-md";
  return (
    <section className="mx-auto max-w-6xl px-6 pb-4">
      <div className="rounded-lg bg-[color:var(--pl-surface)] p-2 [border:1px_solid_var(--pl-surface-line)] [box-shadow:var(--pl-surface-shadow)]">
        <img
          src={`${shotBase}/landing/dashboard-light.png`}
          alt="The Profit Loop summary screen: last month's true profit, what came in, what it cost, and money in and out by day."
          width={2520}
          height={1575}
          loading="lazy"
          className={`${shot} [.dark_&]:hidden`}
        />
        <img
          src={`${shotBase}/landing/dashboard-dark.png`}
          alt="The Profit Loop summary screen: last month's true profit, what came in, what it cost, and money in and out by day."
          width={2520}
          height={1575}
          loading="lazy"
          className={`${shot} hidden [.dark_&]:block`}
        />
      </div>
    </section>
  );
}

function HowItWorksSection() {
  const steps = [
    {
      icon: Package,
      number: "01",
      title: "Add your offers",
      body: "Enter products, services, subscriptions, or projects with their price and direct cost. Takes under 2 minutes.",
    },
    {
      icon: ClipboardList,
      number: "02",
      title: "Log your transactions",
      body: "Record sales manually or let Profit Loop sync with Shopify. Each order captures COGS, delivery, and ad cost.",
    },
    {
      icon: TrendingUp,
      number: "03",
      title: "See your real profit",
      body: "Your dashboard updates instantly. Know your true margin — not just what landed in your bank account.",
    },
  ];

  return (
    <section className="mx-auto max-w-6xl px-6 py-20">
      <div className="text-center mb-12">
        <div className="inline-block rounded-full bg-[color:var(--pl-orange-tint)] border px-3 py-1 text-xs text-[color:var(--pl-orange-text)] mb-4">
          How it works
        </div>
        <h2 className="text-2xl font-bold md:text-3xl">
          Up and running in three steps
        </h2>
        <p className="mt-3 text-[color:var(--pl-ink-2)] max-w-lg mx-auto">
          No complicated integrations required. Most sellers are tracking real profit within 5 minutes.
        </p>
      </div>
      <div className="grid gap-6 md:grid-cols-3">
        {steps.map((s, i) => (
          <div key={i} className="relative rounded-xl bg-[color:var(--pl-surface)]/[0.02] p-6">
            <div className="flex items-start gap-4">
              <div className="shrink-0">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[color:var(--pl-orange-tint)] text-[color:var(--pl-orange-text)]">
                  <s.icon className="h-5 w-5" />
                </div>
              </div>
              <div>
                <div className="text-[10px] font-bold tracking-widest text-[color:var(--pl-orange-text)] mb-1">
                  STEP {s.number}
                </div>
                <div className="text-base font-semibold text-white mb-2">{s.title}</div>
                <p className="text-sm text-[color:var(--pl-ink-2)]">{s.body}</p>
              </div>
            </div>
            {i < steps.length - 1 && (
              <div className="hidden md:block absolute top-10 -right-3 text-[color:var(--pl-ink-2)] text-lg">→</div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

function LogosSection() {
  /* Only what works today. This row used to name Meta, Google and TikTok Ads,
     WooCommerce and Daraz — none of which could be connected. Everything else
     arrives through the spreadsheet import. */
  const logos = ["Shopify", "Bank statements", "Spreadsheets", "Any CSV export"];
  return (
    <section className=" py-10">
      <div className="mx-auto max-w-6xl px-6">
        <p className="text-center text-xs uppercase tracking-widest text-[color:var(--pl-ink-2)] mb-7">
          Works with your existing channels
        </p>
        <div className="flex flex-wrap items-center justify-center gap-8">
          {logos.map((name) => (
            <div
              key={name}
              className="text-[color:var(--pl-ink-2)] text-sm font-semibold tracking-wide opacity-60 hover:opacity-100 transition-opacity"
            >
              {name}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

const FAQS = [
  {
    q: "Is my data safe?",
    a: "Yes. All data is encrypted at rest and in transit. Your data is scoped strictly to your account — no other user can see it. Sign-in and your data are hosted by Supabase (PostgreSQL).",
  },
  {
    q: "Are there order or product limits right now?",
    a: "No. Subscription limits are disabled while the product is still being shaped, so you can test real workflows freely.",
  },
  {
    q: "Does Profit Loop work with Shopify?",
    a: "Yes. Connect your Shopify store and your orders come in by themselves. Selling somewhere else? Import a spreadsheet of your sales, or add them by hand.",
  },
  {
    q: "Are paid plans active?",
    a: "Billing and subscription tiers are paused so the core business workflow can be built properly first.",
  },
  {
    q: "I sell in PKR — will Profit Loop work for me?",
    a: "Profit Loop is built for Pakistani sellers first. All amounts display in Rs by default. Paid in dollars or another currency? Enter it as it came in — we suggest today's rate, and you can change it to what your bank actually gave you.",
  },
  {
    q: "Do I need to be technical to set this up?",
    a: "Not at all. If you can fill in a spreadsheet, you can use Profit Loop. Most sellers are tracking real profit within 5 minutes of creating their account.",
  },
];

function FaqSection() {
  const [open, setOpen] = useState<number | null>(null);
  return (
    <section className="mx-auto max-w-3xl px-6 py-20">
      <div className="text-center mb-12">
        <h2 className="text-2xl font-bold md:text-3xl">Common questions</h2>
      </div>
      <div className="space-y-2">
        {FAQS.map((faq, i) => (
          <div
            key={i}
            className="rounded-xl bg-[color:var(--pl-surface)]/[0.02] overflow-hidden"
          >
            <button
              className="flex w-full items-center justify-between px-5 py-4 text-left text-sm font-medium text-[color:var(--pl-ink)] hover:text-white"
              onClick={() => setOpen(open === i ? null : i)}
            >
              <span>{faq.q}</span>
              <ChevronDown
                className={`h-4 w-4 shrink-0 text-[color:var(--pl-ink-2)] transition-transform ${
                  open === i ? "rotate-180" : ""
                }`}
              />
            </button>
            {open === i && (
              <div className="px-5 pb-4 text-sm text-[color:var(--pl-ink-2)] leading-relaxed pt-3">
                {faq.a}
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

function CtaSection() {
  return (
    <section className="mx-auto max-w-4xl px-6 pb-24 text-center">
      <div className="rounded-xl bg-[color:var(--pl-surface)] p-10">
        <h3 className="text-2xl font-bold md:text-3xl">
          Ready to see your real profit?
        </h3>
        <p className="mx-auto mt-3 max-w-lg text-[color:var(--pl-ink-2)]">
          Free forever. No credit card. Live in under 2 minutes.
        </p>
        <Link href="/sign-up">
          <Button
            size="lg"
            className="mt-6 bg-[color:var(--pl-orange-fill)] text-white hover:bg-[color:var(--pl-orange-hover)]"
          >
            Create your free account
            <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </Link>
        <p className="mt-4 text-xs text-[color:var(--pl-ink-2)]">
          Free while the product is in beta. No subscription limits right now.
        </p>
      </div>
    </section>
  );
}

