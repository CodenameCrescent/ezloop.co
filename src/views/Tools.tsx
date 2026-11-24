import { useState } from "react";
import { TopBar } from "@/components/TopBar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Calculator,
  Megaphone,
  Coins,
  ShieldCheck,
  Percent,
  PackageCheck,
} from "lucide-react";
import { useFormatters } from "@/lib/store";
import {
  calculateBreakEvenTransactionCount,
  calculatePriceForTargetMargin,
  calculateSafeAdSpend,
  calculateTrueProfitPerTransaction,
} from "@/lib/finance";

/** `embedded` drops the TopBar so Plan › What-if can host these beside Scenarios. */
export default function Tools({ embedded = false }: { embedded?: boolean }) {
  const f = useFormatters();
  return (
    <>
      {!embedded && <TopBar title="Tools" subtitle="Decision calculators for profit, offers, ads, and cash" />}
      <div className={embedded ? "grid grid-cols-2 gap-4" : "grid grid-cols-2 gap-4 px-8 py-6"}>
        <ProfitCalculator f={f} />
        <BreakEvenCalculator f={f} />
        <SafeAdSpendCalculator f={f} />
        <MarginTarget f={f} />
      </div>
    </>
  );
}

function ToolCard({
  icon: Icon,
  title,
  subtitle,
  children,
}: {
  icon: typeof Calculator;
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-card-border bg-card p-5">
      <div className="mb-4 flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[color:var(--pl-orange-tint)] text-primary">
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <h2 className="text-sm font-semibold">{title}</h2>
          <p className="text-xs text-muted-foreground">{subtitle}</p>
        </div>
      </div>
      {children}
    </div>
  );
}

function Result({
  label,
  value,
  tone,
  hint,
}: {
  label: string;
  value: string;
  tone?: "good" | "bad";
  hint?: string;
}) {
  const color =
    tone === "good"
      ? "text-primary bg-[color:var(--pl-orange-tint)]"
      : tone === "bad"
        ? "text-destructive bg-[color:var(--pl-red-tint)]"
        : "border-border bg-muted/30";
  return (
    <div className={`mt-4 rounded-lg border ${color} px-4 py-3`}>
      <p className="text-[11px] font-semibold uppercase tracking-wider opacity-80">
        {label}
      </p>
      <p className="mt-1 text-2xl font-semibold tabular">{value}</p>
      {hint && <p className="mt-1 text-[11px] opacity-80">{hint}</p>}
    </div>
  );
}

function ProfitCalculator({ f }: { f: ReturnType<typeof useFormatters> }) {
  const [sp, setSp] = useState("1599");
  const [cp, setCp] = useState("650");
  const [del, setDel] = useState("150");
  const [ad, setAd] = useState("180");

  const { profit, marginPct: margin } = calculateTrueProfitPerTransaction({
    sellingPrice: Number(sp) || 0,
    costPrice: Number(cp) || 0,
    deliveryCost: Number(del) || 0,
    adCost: Number(ad) || 0,
  });

  return (
    <ToolCard
      icon={Calculator}
      title="True Profit"
      subtitle="See your net profit on one sale, job, or payment"
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label={`Selling price (${f.symbol})`} value={sp} onChange={setSp} />
        <Field label={`Cost price (${f.symbol})`} value={cp} onChange={setCp} />
        <Field label={`Delivery (${f.symbol})`} value={del} onChange={setDel} />
        <Field label={`Ad cost (${f.symbol})`} value={ad} onChange={setAd} />
      </div>
      <Result
        label="Net profit per transaction"
        value={(profit < 0 ? "-" : "") + f.money(Math.abs(profit))}
        tone={profit >= 0 ? "good" : "bad"}
        hint={`${margin.toFixed(1)}% margin`}
      />
    </ToolCard>
  );
}

function BreakEvenCalculator({ f }: { f: ReturnType<typeof useFormatters> }) {
  const [adBudget, setAdBudget] = useState("5000");
  const [profitPerOrder, setProfitPerOrder] = useState("250");

  const ppo = Number(profitPerOrder) || 0;
  const orders = calculateBreakEvenTransactionCount(Number(adBudget) || 0, ppo);

  return (
    <ToolCard
      icon={PackageCheck}
      title="Break-Even Transactions"
      subtitle="How many sales or client payments cover your ad budget"
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label={`Ad budget (${f.symbol})`} value={adBudget} onChange={setAdBudget} />
        <Field
          label={`Profit / transaction (${f.symbol})`}
          value={profitPerOrder}
          onChange={setProfitPerOrder}
        />
      </div>
      <Result
        label="Break-even transactions"
        value={orders > 0 ? `${orders} orders` : "—"}
        tone={orders > 0 ? "good" : "bad"}
        hint={
          orders > 0
            ? `Every transaction beyond #${orders} adds profit.`
            : "Profit per transaction must be positive."
        }
      />
    </ToolCard>
  );
}

function SafeAdSpendCalculator({ f }: { f: ReturnType<typeof useFormatters> }) {
  const [profitPerOrder, setProfitPerOrder] = useState("250");
  const [expectedOrders, setExpectedOrders] = useState("20");

  const safe = calculateSafeAdSpend(Number(profitPerOrder) || 0, Number(expectedOrders) || 0);

  return (
    <ToolCard
      icon={ShieldCheck}
      title="Safe Ad Spend"
      subtitle="Maximum ad spend that still leaves you profitable"
    >
      <div className="grid grid-cols-2 gap-3">
        <Field
          label={`Profit / transaction (${f.symbol})`}
          value={profitPerOrder}
          onChange={setProfitPerOrder}
        />
        <Field
          label="Expected transactions"
          value={expectedOrders}
          onChange={setExpectedOrders}
        />
      </div>
      <Result
        label="Safe ad spend cap"
        value={f.money(safe)}
        tone="good"
        hint="Spending more puts you at risk of net loss."
      />
    </ToolCard>
  );
}

function MarginTarget({ f }: { f: ReturnType<typeof useFormatters> }) {
  const [cost, setCost] = useState("650");
  const [targetMargin, setTargetMargin] = useState("35");

  const m = Math.min(99, Math.max(0, Number(targetMargin) || 0));
  const sp = calculatePriceForTargetMargin(Number(cost) || 0, m);

  return (
    <ToolCard
      icon={Percent}
      title="Price for a Target Margin"
      subtitle="Find the right selling price to hit your goal"
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label={`Total cost (${f.symbol})`} value={cost} onChange={setCost} />
        <Field
          label="Target margin (%)"
          value={targetMargin}
          onChange={setTargetMargin}
        />
      </div>
      <Result
        label="Recommended selling price"
        value={f.money(Math.round(sp))}
        tone="good"
        hint={`Includes a ${m.toFixed(0)}% net margin over your costs.`}
      />
    </ToolCard>
  );
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      <Input
        type="number"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
