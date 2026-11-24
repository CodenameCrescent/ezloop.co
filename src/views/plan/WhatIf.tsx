import { TopBar } from "@/components/TopBar";
import Tools from "@/views/Tools";
import Scenarios from "@/views/growth/Scenarios";

/**
 * One home for the what-if questions.
 *
 * "Tools" (per-sale calculators) and "Growth › Scenarios" (change a price, see
 * what happens) were the same kind of thing in two unrelated areas of the app:
 * neither reports what happened, both answer "what would happen if". They now
 * sit together, and both keep their existing behaviour — this page only supplies
 * the heading and the order.
 */
export default function WhatIf() {
  return (
    <>
      <TopBar
        title="What-if"
        subtitle="Try a decision before you make it — on one sale, or across a product."
      />
      <div className="app-page-shell space-y-8">
        <section>
          <h2 className="mb-1 text-sm font-semibold">Change a price, cost, or ad spend</h2>
          <p className="mb-3 text-xs text-muted-foreground">
            Takes one of your products and shows what the change would do to its profit.
          </p>
          <Scenarios embedded />
        </section>

        <section>
          <h2 className="mb-1 text-sm font-semibold">Work out a single figure</h2>
          <p className="mb-3 text-xs text-muted-foreground">
            Calculators for one sale at a time — no data of yours needed.
          </p>
          <Tools embedded />
        </section>
      </div>
    </>
  );
}
