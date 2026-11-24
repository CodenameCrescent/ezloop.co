import Link from "next/link";
import { TopBar } from "@/components/TopBar";
import { SUPPORT_EMAIL } from "@/lib/legal";
import {
  LayoutDashboard,
  ShoppingCart,
  Package,
  Megaphone,
  Lightbulb,
  Compass,
  Calculator,
  FileBarChart,
  Settings,
  HelpCircle,
} from "lucide-react";

const sections = [
  {
    icon: LayoutDashboard,
    title: "Dashboard",
    body: "Your daily snapshot: true profit, revenue, marketing spend, and recent business activity.",
  },
  {
    icon: ShoppingCart,
    title: "Workbench",
    body: "Add and manage raw business data such as offers, transactions, clients, customers, and marketing data.",
  },
  {
    icon: Package,
    title: "Offers",
    body: "Manage what your business sells — its price, what each sale costs you, and any variants it comes in.",
  },
  {
    icon: Megaphone,
    title: "Marketing Data",
    body: "Record campaign spend in Workbench, then review ad explanations inside Insights.",
  },
  {
    icon: Lightbulb,
    title: "Insights",
    body: "Plain-language explanations of what's working, what is leaking profit, and what needs attention.",
  },
  {
    icon: Compass,
    title: "Growth",
    body: "Recommended next actions, goals, forecasts, scenarios, and experiments based on the business data.",
  },
  {
    icon: Calculator,
    title: "Tools",
    body: "Quick calculators for true profit, margins, break-even points, ad spend, pricing, and cash decisions.",
  },
  {
    icon: FileBarChart,
    title: "Reports",
    body: "Clean summaries for revenue, costs, profit, cash flow, offers, clients, customers, ads, and budgets.",
  },
  {
    icon: Settings,
    title: "Settings",
    body: "Currency, decision thresholds, and data tools (export, import, restore sample, erase all).",
  },
];

const faqs = [
  {
    q: "How is the decision score calculated?",
    a: "We weigh four signals: total profit (40%), profit margin (30%), ad efficiency (20%), and order volume (10%). The score is then mapped to Scale (≥75 with healthy margin), Stop (≤45 or losing money), or Optimize.",
  },
  {
    q: "Where is my data stored?",
    a: "Everything lives in your browser using localStorage. Nothing leaves your device. Use Export in Settings to back up your data.",
  },
  {
    q: "Can I change the currency?",
    a: "Yes — open Settings → Preferences → Display Currency. Pick from PKR, USD, EUR, GBP, AED, SAR, INR, or BDT. Your data stays stored in PKR; only the display is converted.",
  },
  {
    q: "What does 'Safe Ad Spend' actually mean?",
    a: "It's the maximum ad budget you can spend before your profit per order would no longer cover it. Spending above this limit risks turning profit into loss.",
  },
];

export default function Help() {
  return (
    <>
      <TopBar title="Help" subtitle="How everything works" />
      <div className="space-y-8 px-8 py-6">
        <section>
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            What each tab does
          </h2>
          <div className="grid grid-cols-3 gap-3">
            {sections.map((s) => {
              const Icon = s.icon;
              return (
                <div
                  key={s.title}
                  className="flex gap-3 rounded-xl border border-card-border bg-card p-4"
                >
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[color:var(--pl-orange-tint)] text-primary">
                    <Icon className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold">{s.title}</p>
                    <p className="mt-1 text-xs leading-snug text-muted-foreground">
                      {s.body}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <section>
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Frequently asked
          </h2>
          <div className="space-y-2">
            {faqs.map((f) => (
              <div
                key={f.q}
                className="rounded-xl border border-card-border bg-card p-4"
              >
                <div className="flex items-start gap-3">
                  <HelpCircle className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  <div>
                    <p className="text-sm font-semibold">{f.q}</p>
                    <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                      {f.a}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* The contact line waits for a real address (lib/legal.ts); the
            policies are always here. */}
        <section>
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Contact and policies
          </h2>
          <div className="space-y-2 rounded-xl border border-card-border bg-card p-4 text-sm">
            {SUPPORT_EMAIL && (
              <p>
                Questions, problems or an integration you need? Email{" "}
                <a href={`mailto:${SUPPORT_EMAIL}`} className="font-medium text-primary hover:underline">
                  {SUPPORT_EMAIL}
                </a>
                .
              </p>
            )}
            <p className="text-muted-foreground">
              <Link href="/privacy" className="font-medium text-primary hover:underline">
                Privacy Policy
              </Link>{" "}
              ·{" "}
              <Link href="/terms" className="font-medium text-primary hover:underline">
                Terms of Service
              </Link>
            </p>
          </div>
        </section>
      </div>
    </>
  );
}
