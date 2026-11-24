import { InsightCard } from "@/components/InsightCard";

/**
 * Dev-only gallery for THE insight card (INSIGHTS.md § The insight card).
 * Mounted at /dev/insight-card behind import.meta.env.DEV so it never ships.
 * Every state the card supports is rendered here so a visual regression is
 * obvious in one screenshot, in both light and dark.
 */
export default function InsightCardGallery() {
  return (
    <div className="mx-auto max-w-2xl space-y-4 px-4 py-6">
      <h1 className="text-lg font-semibold text-[color:var(--pl-black)]">Insight card — all states</h1>

      <p className="text-xs text-[color:var(--pl-grey)]">Loss · the spec's worked example, with the real math behind Explain.</p>
      <InsightCard
        id="meta-roas"
        impactCents={-62_000}
        impactSuffix="/mo"
        headline="Meta ads stopped paying off"
        cause="True ROAS fell to 0.9× — you pay Rs 88 to acquire a customer worth Rs 82."
        action={{ label: "Pause retargeting", href: "/insights/marketing" }}
        explain={{
          threshold: "Fires when true ROAS drops below 1.0×",
          comparisonPeriod: "This month vs last month",
          inputs: [
            { label: "Ad spend", value: "Rs 2,200.00" },
            { label: "Revenue attributed", value: "Rs 1,980.00" },
            { label: "Margin on those sales", value: "31%" },
            { label: "True ROAS", value: "0.9×" },
          ],
        }}
        related={{ count: 2, subject: "Meta ads" }}
        onDismiss={() => {}}
        onSnooze={() => {}}
        onNotRelevant={() => {}}
        onShowData={() => {}}
      />

      <p className="text-xs text-[color:var(--pl-grey)]">Gain · slot 5's reserved win, with a trend sparkline.</p>
      <InsightCard
        id="deep-tissue"
        impactCents={310_000}
        headline="Deep tissue is carrying your profit"
        cause="It made Rs 3,100 this month — 41% of all profit, up from 28%."
        action={{ label: "See the offer", href: "/insights/offers" }}
        trend={[12, 18, 16, 24, 29, 34, 41]}
        onDismiss={() => {}}
        onSnooze={() => {}}
      />

      <p className="text-xs text-[color:var(--pl-grey)]">Urgent · red left edge, the only card allowed to shout.</p>
      <InsightCard
        id="runway"
        impactCents={-1_840_00}
        headline="Your cash runs out in 6 weeks"
        cause="Rs 18,400 on hand against Rs 12,600 of monthly outgoings."
        action={{ label: "Review upcoming costs", href: "/money/cash-flow" }}
        urgent
        explain={{
          threshold: "Fires when runway falls under 60 days",
          comparisonPeriod: "Rolling 90-day burn",
          inputs: [
            { label: "Cash on hand", value: "Rs 18,400.00" },
            { label: "Average monthly burn", value: "Rs 12,600.00" },
            { label: "Runway", value: "44 days" },
          ],
        }}
        onDismiss={() => {}}
      />

      <p className="text-xs text-[color:var(--pl-grey)]">Neutral · a fact worth surfacing that neither made nor cost money.</p>
      <InsightCard
        id="flat"
        impactCents={0}
        headline="Refund rate is holding steady"
        cause="1.5% of gross revenue, unchanged from your 12-month normal."
        onDismiss={() => {}}
      />

      <p className="text-xs text-[color:var(--pl-grey)]">Minimal · impact, headline and cause only.</p>
      <InsightCard
        id="bare"
        impactCents={-4_550}
        headline="Processing fees crept up"
        cause="Rs 45.50 more than last month on the same volume."
      />
    </div>
  );
}
