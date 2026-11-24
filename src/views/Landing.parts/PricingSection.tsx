import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Star, Sparkles, Zap, Clock, Check, X } from "lucide-react";
import { type LandingFeature } from "./RealNumbersSection";

export const TIERS: {
  name: string;
  price: string;
  sub?: string;
  description: string;
  cta: string;
  ctaLink: string;
  ctaExternal: boolean;
  popular: boolean;
  color: string;
  foundingNote?: string;
  features: LandingFeature[];
}[] = [
  {
    name: "Starter",
    price: "Free",
    sub: "Forever free",
    description: "Perfect for solo sellers just getting started.",
    cta: "Start free",
    ctaLink: "/sign-up",
    ctaExternal: false,
    popular: false,
    color: "border-white/10",
    features: [
      { text: "Unlimited transactions while in beta", included: true },
      { text: "Unlimited offers while in beta", included: true },
      { text: "Basic profit dashboard", included: true },
      { text: "Offer and transaction management", included: true },
      { text: "Money overview and costs", included: false },
      { text: "Export reports (Excel / PDF)", included: false },
      { text: "Growth Actions & Client/Customer Insights", included: false },
      { text: "Shopify sync", included: false },
      { text: "Priority support", included: false },
    ],
  },
  {
    name: "Plus",
    price: "$20",
    sub: "per month",
    description: "For growing businesses that need money clarity and reporting.",
    cta: "Start building",
    ctaLink: "/sign-up",
    ctaExternal: false,
    popular: true,
    color: "",
    features: [
      { text: "Unlimited transactions while in beta", included: true },
      { text: "Unlimited offers while in beta", included: true },
      { text: "Basic profit dashboard", included: true },
      { text: "Offer and transaction management", included: true },
      { text: "Money overview and costs", included: true },
      { text: "Export reports (Excel / PDF)", included: true },
      { text: "Growth Actions & Client/Customer Insights", included: false },
      { text: "Shopify sync", included: false },
      { text: "Priority support", included: false },
    ],
  },
  {
    name: "Pro",
    price: "$50",
    sub: "per month",
    description: "For serious sellers who want every edge and no limits.",
    cta: "Start building",
    ctaLink: "/sign-up",
    ctaExternal: false,
    popular: false,
    color: "",
    foundingNote: "Lock in founding pricing — more features shipping soon",
    features: [
      { text: "Unlimited transactions and offers", included: true },
      { text: "Basic profit dashboard", included: true },
      { text: "Offer and transaction management", included: true },
      { text: "Money overview and costs", included: true },
      { text: "Export reports (Excel / PDF)", included: true },
      { text: "Growth Actions & Client/Customer Insights", included: true },
      { text: "Shopify sync", included: true },
      { text: "Currency conversion", included: true },
      { text: "Priority support", included: true },
    ],
  },
];

export function PricingSection() {
  return (
    <section id="pricing" className="mx-auto max-w-6xl px-6 py-20">
      <div className="text-center mb-12">
        <div className="inline-block rounded-full bg-[color:var(--pl-orange-tint)] border px-3 py-1 text-xs text-[color:var(--pl-orange-text)] mb-4">
          Pricing
        </div>
        <h2 className="text-2xl font-bold md:text-3xl">
          Simple, honest pricing
        </h2>
        <p className="mt-3 text-[color:var(--pl-ink-2)] max-w-md mx-auto">
          Start free while we shape the product. Subscription limits are currently disabled.
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        {TIERS.map((tier) => (
          <div
            key={tier.name}
            className={`relative rounded-2xl border ${tier.color} bg-[color:var(--pl-surface)] p-6 flex flex-col ${
              tier.popular ? "ring-1 ring-[color:var(--pl-orange)]" : ""
            }`}
          >
            {tier.popular && (
              <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                <span className="inline-flex items-center gap-1 rounded-full bg-[color:var(--pl-orange-fill)] px-3 py-1 text-[11px] font-semibold text-white">
                  <Star className="h-3 w-3 fill-[color:var(--pl-ink)]" />
                  Most popular
                </span>
              </div>
            )}
            <div className="mb-5">
              <div className="flex items-center gap-1.5 mb-1">
                {tier.name === "Pro" && <Sparkles className="h-3.5 w-3.5 text-[color:var(--pl-amber)]" />}
                {tier.name === "Plus" && <Zap className="h-3.5 w-3.5 text-[color:var(--pl-orange-text)]" />}
                <div className="text-sm font-semibold text-[color:var(--pl-ink)]">{tier.name}</div>
              </div>
              <div className="flex items-baseline gap-1">
                <span className="text-3xl font-bold text-white">{tier.price}</span>
                {tier.sub && (
                  <span className="text-sm text-[color:var(--pl-ink-2)]">{tier.sub}</span>
                )}
              </div>
              <p className="mt-2 text-xs text-[color:var(--pl-ink-2)]">{tier.description}</p>
              {tier.foundingNote && (
                <p className="mt-1.5 text-[10px] text-[color:var(--pl-amber)] flex items-center gap-1">
                  <Clock className="h-2.5 w-2.5 shrink-0" />
                  {tier.foundingNote}
                </p>
              )}
            </div>

            <ul className="space-y-2.5 flex-1 mb-6">
              {tier.features.map((f) => (
                <li key={f.text} className="flex items-start gap-2.5 text-sm">
                  {f.included ? (
                    <Check className="h-4 w-4 shrink-0 text-[color:var(--pl-orange-text)] mt-0.5" />
                  ) : (
                    <X className="h-4 w-4 shrink-0 text-[color:var(--pl-ink-2)] mt-0.5" />
                  )}
                  <span className={f.included ? "text-[color:var(--pl-ink)]" : "text-[color:var(--pl-ink-2)]"}>
                    {f.text}
                  </span>
                </li>
              ))}
            </ul>

            {tier.ctaExternal ? (
              <a href={tier.ctaLink} target="_blank" rel="noopener noreferrer">
                <Button
                  className={`w-full ${
                    tier.popular
                      ? "bg-[color:var(--pl-orange-fill)] text-white hover:bg-[color:var(--pl-orange-hover)]"
                      : tier.name === "Pro"
                      ? "bg-[color:var(--pl-amber-solid)] text-white hover:bg-[color:var(--pl-amber-solid)]"
                      : "bg-[color:var(--pl-recessed)] text-white hover:bg-[color:var(--pl-recessed)]"
                  }`}
                >
                  {tier.name === "Pro" && <Sparkles className="h-4 w-4 mr-1" />}
                  {tier.cta}
                </Button>
              </a>
            ) : (
              <Link href={tier.ctaLink}>
                <Button className="w-full bg-[color:var(--pl-recessed)] text-white hover:bg-[color:var(--pl-recessed)]">
                  {tier.cta}
                </Button>
              </Link>
            )}
          </div>
        ))}
      </div>

      <p className="text-center text-xs text-[color:var(--pl-ink-2)] mt-6">
        No credit card required. No order or product caps while in beta.
      </p>
    </section>
  );
}
