import { useMemo, useState } from "react";
import { BarChart3, Percent, Megaphone, ReceiptText } from "lucide-react";
import { TopBar } from "@/components/TopBar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useFormatters, useStore } from "@/lib/store";
import { calculateProductUnitEconomics, calculateTrueProfitPerTransaction } from "@/lib/finance";

/** `embedded` drops the TopBar so Plan > What-if can host this beside the calculators. */
export default function Scenarios({ embedded = false }: { embedded?: boolean }) {
  const { products } = useStore();
  const f = useFormatters();
  const firstProductId = products[0]?.id ?? "";
  const [productId, setProductId] = useState(firstProductId);
  const [priceChange, setPriceChange] = useState("10");
  const [costChange, setCostChange] = useState("0");
  const [adSpendChange, setAdSpendChange] = useState("0");

  const selected = products.find((product) => product.id === productId) ?? products[0];
  const base = selected ? calculateProductUnitEconomics(selected) : null;
  const scenario = useMemo(() => {
    if (!selected || !base) return null;
    const priceMultiplier = 1 + (Number(priceChange) || 0) / 100;
    const costMultiplier = 1 + (Number(costChange) || 0) / 100;
    const extraAd = Number(adSpendChange) || 0;
    const sellingPrice = selected.defaultSellingPrice * priceMultiplier;
    const productCost = base.productCost * costMultiplier;
    const { profit, marginPct } = calculateTrueProfitPerTransaction({
      sellingPrice,
      costPrice: productCost,
      adCost: extraAd,
    });
    return {
      sellingPrice,
      productCost,
      profit,
      margin: marginPct,
      baseProfit: base.grossProfit,
      baseMargin: base.grossMarginPct,
    };
  }, [selected, base, priceChange, costChange, adSpendChange]);

  return (
    <>
      {!embedded && (
        <TopBar title="Scenarios" subtitle="Test simple what-if decisions before changing prices, costs, or spend." />
      )}
      <div className={embedded ? "" : "app-page-shell"}>
        <section className="grid gap-4 xl:grid-cols-[0.85fr_1.15fr]">
          <div className="rounded-2xl border border-card-border bg-card p-5">
            <div className="mb-4">
              <h2 className="text-base font-bold text-foreground">Offer scenario</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Select an offer and test pricing, cost, or ad-spend changes.
              </p>
            </div>
            <div className="space-y-4">
              <Field label="Offer">
                <select
                  value={selected?.id ?? ""}
                  onChange={(event) => setProductId(event.target.value)}
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  {products.length === 0 ? (
                    <option value="">No offers yet</option>
                  ) : (
                    products.map((product) => (
                      <option key={product.id} value={product.id}>{product.name}</option>
                    ))
                  )}
                </select>
              </Field>
              <Field label="Price change %">
                <Input value={priceChange} onChange={(event) => setPriceChange(event.target.value)} type="number" />
              </Field>
              <Field label="Cost change %">
                <Input value={costChange} onChange={(event) => setCostChange(event.target.value)} type="number" />
              </Field>
              <Field label={`Extra ad spend per sale (${f.symbol})`}>
                <Input value={adSpendChange} onChange={(event) => setAdSpendChange(event.target.value)} type="number" />
              </Field>
              <Button type="button" variant="outline" onClick={() => {
                setPriceChange("10");
                setCostChange("0");
                setAdSpendChange("0");
              }}>
                Reset scenario
              </Button>
            </div>
          </div>

          <div className="rounded-2xl border border-card-border bg-card p-5">
            <div className="mb-4 flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[color:var(--pl-orange-tint)] text-primary">
                <BarChart3 className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-base font-bold text-foreground">Scenario result</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  This uses known offer price and direct costs. It does not change saved data.
                </p>
              </div>
            </div>

            {!scenario ? (
              <div className="rounded-xl border border-dashed border-card-border bg-background/70 p-8 text-center text-sm text-muted-foreground">
                Add an offer first, then run a scenario.
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <ResultCard icon={<Percent className="h-5 w-5" />} label="New margin" value={`${scenario.margin.toFixed(1)}%`} sub={`Base ${scenario.baseMargin.toFixed(1)}%`} tone={scenario.margin >= scenario.baseMargin ? "good" : "bad"} />
                <ResultCard icon={<ReceiptText className="h-5 w-5" />} label="Profit per sale" value={f.moneySigned(scenario.profit)} sub={`Base ${f.moneySigned(scenario.baseProfit)}`} tone={scenario.profit >= scenario.baseProfit ? "good" : "bad"} />
                <ResultCard icon={<Megaphone className="h-5 w-5" />} label="Scenario price" value={f.money(scenario.sellingPrice)} sub={`Cost ${f.money(scenario.productCost)}`} />
              </div>
            )}
          </div>
        </section>
      </div>
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}

function ResultCard({
  icon,
  label,
  value,
  sub,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub: string;
  tone?: "good" | "bad";
}) {
  const toneClass =
    tone === "good" ? "text-[var(--profit)]" : tone === "bad" ? "text-[var(--expense)]" : "";
  return (
    <div className="rounded-xl border border-card-border bg-background/70 p-4">
      <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-[color:var(--pl-orange-tint)] text-primary">
        {icon}
      </div>
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`mt-1 text-2xl font-bold tabular-nums ${toneClass}`}>{value}</div>
      <div className="mt-1 text-xs text-muted-foreground">{sub}</div>
    </div>
  );
}
