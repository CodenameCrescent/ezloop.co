import { Sliders, Info } from "lucide-react";
import { TopBar } from "@/components/TopBar";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useStore } from "@/lib/store";
import { CURRENCY_OPTIONS, RATES_LAST_UPDATED, getCurrencySymbol } from "@/lib/currencyUtils";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="app-panel overflow-hidden">
      <div className="border-b border-card-border px-5 py-3">
        <h2 className="text-sm font-semibold">{title}</h2>
      </div>
      <div className="divide-y divide-card-border">{children}</div>
    </div>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 px-5 py-4">
      <div className="min-w-0">
        <Label className="text-sm">{label}</Label>
        {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

export default function Preferences() {
  const { settings, updateSettings } = useStore();
  const rawCurrency = settings.currency ?? "PKR";
  const activeCurrency = rawCurrency === "Rs" ? "PKR" : rawCurrency;

  function handleCurrencyChange(code: string) {
    updateSettings({
      currency: code,
      currencySymbol: getCurrencySymbol(code),
    });
  }

  return (
    <>
      <TopBar
        title="Preferences"
        subtitle="Customise how Profit Loop looks and behaves"
      />
      <div className="app-page-shell max-w-3xl">
        {/* Theme switch removed: the app is light-only by decision (DESIGN.md). */}
        <Section title="Display Currency">
          <div className="px-5 py-4 space-y-4">
            <div>
              <Label className="text-sm mb-1 block">Currency</Label>
              <p className="text-xs text-muted-foreground mb-3">
                Amounts are stored in PKR. Choosing another currency converts the display using fixed rates — your data is never altered.
              </p>
              <select
                value={activeCurrency}
                onChange={(e) => handleCurrencyChange(e.target.value)}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              >
                {CURRENCY_OPTIONS.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-start gap-2 rounded-lg border border-muted/50 bg-muted/10 px-4 py-3 text-xs text-muted-foreground">
              <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <span>
                Exchange rates last updated <span className="text-foreground font-medium">{RATES_LAST_UPDATED}</span>.
                Rates are approximate and for display purposes only.
                All stored data remains in PKR.
              </span>
            </div>
          </div>
        </Section>

        <Section title="Notifications">
          <Row
            label="Toast notifications"
            hint="Show small confirmation messages when data is saved or updated"
          >
            <Switch
              checked={settings.toastsEnabled}
              onCheckedChange={(v) => updateSettings({ toastsEnabled: v })}
            />
          </Row>
        </Section>

        <div className="flex items-center gap-2 text-xs text-muted-foreground pt-2">
          <Sliders className="h-3.5 w-3.5" />
          <span>More preferences can be found in <a href="/settings" className="underline underline-offset-2 hover:text-foreground">General Settings</a>.</span>
        </div>
      </div>
    </>
  );
}
