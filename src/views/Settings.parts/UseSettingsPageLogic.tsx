import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { useStore } from "@/lib/store";
import { DEMO_PRODUCTS } from "@/lib/seed";
import { Check } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { getEffectiveBusinessModels, BUSINESS_MODEL_OPTIONS } from "@/lib/businessModel";
import type { BusinessModel } from "@/lib/types";
import { type GatedFeature, type BusinessType } from "@workspace/domain";

export const GATED_FEATURE_OPTIONS: { value: GatedFeature; label: string; description: string }[] = [
  {
    value: "order_outcomes",
    label: "Order outcomes",
    description: "Track whether an order was delivered, returned, refused, or cancelled.",
  },
  {
    value: "rto",
    label: "Returns to origin (RTO)",
    description: "Cost the orders that come back — you paid shipping both ways and earned nothing.",
  },
  {
    value: "courier_cost_rules",
    label: "Courier cost rules",
    description: "Charge delivery cost per order by weight or zone instead of estimating monthly.",
  },
  {
    value: "cod_fees",
    label: "Cash-on-delivery fees",
    description: "The courier's cut for collecting cash on your behalf.",
  },
  /**
   * This one was missing from the list, which made it the only gated feature
   * with no switch anywhere in the app. It defaults ON for service businesses
   * and OFF for ecommerce, so an ecommerce account had two whole pages — Hours
   * and Worth having — that could not be reached or turned on.
   */
  {
    value: "client_profitability",
    label: "Hours and client profitability",
    description:
      "Log hours against clients and see which ones are actually worth having. Adds the Hours and Worth having pages.",
  },
];

export const FASHION_DEMO_PRODUCTS = [
  { name: "Embroidered Lawn Kurta", imageColor: "354 78% 62%" },
  { name: "Linen Co-ord Set", imageColor: "217 91% 62%" },
  { name: "Classic Black Abaya", imageColor: "271 76% 66%" },
  { name: "Printed Chiffon Dupatta", imageColor: "330 80% 60%" },
  { name: "Everyday Tote Bag", imageColor: "38 92% 60%" },
  { name: "Streetwear Oversized Tee", imageColor: "158 70% 48%" },
];

export function readDevAccountId(): string {
  try {
    return localStorage.getItem("profit_loop_dev_account_id") || "local-user";
  } catch {
    return "local-user";
  }
}

/** SettingsPage's state and handlers, kept out of its render so each file stays short. */
export function useSettingsPageLogic() {
  const { settings, products, updateSettings, resetAll, reseed } = useStore();
  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmDemo, setConfirmDemo] = useState(false);
  const [confirmErase, setConfirmErase] = useState(false);
  const router = useRouter();
  const navigate = (to: string) => router.push(to);
  const isFashionTest =
    process.env.NEXT_PUBLIC_LOCAL_AUTH_BYPASS === "true" &&
    readDevAccountId() === "test-fashion";
  const demoProducts = isFashionTest ? FASHION_DEMO_PRODUCTS : DEMO_PRODUCTS;
  const selectedBusinessModels = getEffectiveBusinessModels(settings, products);
  // Server-resolved: business type's defaults with the owner's overrides applied.
  const businessType = (settings.businessType ?? "ecommerce") as BusinessType;
  const featureOverrides = settings.featureOverrides ?? {};
  const features = settings.features ?? {};

  const toggleBusinessModel = (model: BusinessModel) => {
    if (model === "mixed") {
      updateSettings({ businessModels: ["mixed"] });
      return;
    }
    const current = selectedBusinessModels.includes("mixed")
      ? []
      : selectedBusinessModels.filter((item) => item !== "mixed");
    const next = current.includes(model)
      ? current.filter((item) => item !== model)
      : [...current, model];
    updateSettings({ businessModels: next.length ? next : ["mixed"] });
  };

  /*
   * Export JSON and Import JSON were removed here, and in `store.tsx` with
   * them.
   *
   * Import never imported anything — `importJson` only raised an info toast,
   * and this handler then fired `toast.success("Data imported")` on top of it,
   * so the owner picked their backup file and was told it had been restored
   * when nothing had happened. Export was the matching half: it serialised the
   * legacy adapter shape built from the store's ONE 200-row page under a label
   * reading "Download everything as a JSON file", in a format nothing could
   * read back even once restore existed.
   *
   * A backup that cannot be restored is worse than no backup, because people
   * rely on it. Getting data in is the spreadsheet importer's job; taking it
   * back out is "Imported files" above.
   */
  const handleLoadDemo = () => {
    reseed();
    toast.success("Demo data loaded — welcome to Profit Loop!");
    navigate("/");
  };

  const handleErase = () => {
    resetAll();
    toast.success("All data erased");
    setConfirmErase(false);
  };

  return {
    settings,
    updateSettings,
    selectedBusinessModels,
    toggleBusinessModel,
    businessType,
    features,
    featureOverrides,
    isFashionTest,
    demoProducts,
    setConfirmDemo,
    setConfirmReset,
    setConfirmErase,
    confirmDemo,
    handleLoadDemo,
    confirmReset,
    confirmErase,
    handleErase,
  };
}

export type SettingsPageState = ReturnType<typeof useSettingsPageLogic>;

export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="app-panel overflow-hidden">
      <div className="border-b border-card-border px-5 py-3">
        <h2 className="text-sm font-semibold">{title}</h2>
      </div>
      <div className="divide-y divide-card-border">{children}</div>
    </div>
  );
}

export function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
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

export function BusinessSection({ settings, updateSettings, selectedBusinessModels, toggleBusinessModel }: Pick<SettingsPageState, "settings" | "updateSettings" | "selectedBusinessModels" | "toggleBusinessModel">) {
  return (
    <Section title="Business">
          <Row label="Business name" hint="Shown in the top-left of the app">
            <Input
              value={settings.businessName}
              onChange={(e) => updateSettings({ businessName: e.target.value })}
              className="max-w-sm"
            />
          </Row>
          <Row label="Currency symbol" hint="How money is displayed everywhere">
            <Input
              value={settings.currencySymbol}
              onChange={(e) => updateSettings({ currencySymbol: e.target.value })}
              className="max-w-[120px]"
            />
          </Row>
          <Row label="Locale" hint="Number formatting">
            <Select
              value={settings.locale}
              onValueChange={(v) => updateSettings({ locale: v })}
            >
              <SelectTrigger className="max-w-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="en-IN">English (India)</SelectItem>
                <SelectItem value="en-US">English (US)</SelectItem>
                <SelectItem value="en-GB">English (UK)</SelectItem>
              </SelectContent>
            </Select>
          </Row>
          <Row
            label="How does your business make money?"
            hint="This helps Profit Loop show only the sections that matter to your business."
          >
            <div className="grid max-w-2xl grid-cols-1 gap-2 sm:grid-cols-2">
              {BUSINESS_MODEL_OPTIONS.map((option) => {
                const checked = selectedBusinessModels.includes(option.value);
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => toggleBusinessModel(option.value)}
                    className={`flex min-h-[76px] items-start gap-3 rounded-xl border px-3 py-3 text-left transition-all ${
                      checked
                        ? " bg-[color:var(--pl-orange-tint)] text-foreground"
                        : "border-border bg-muted/20 text-muted-foreground hover: hover:text-foreground"
                    }`}
                  >
                    <span
                      className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                        checked
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-muted-foreground/40"
                      }`}
                    >
                      {checked && <Check className="h-3 w-3" />}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold">{option.label}</span>
                      <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
                        {option.description}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </Row>
        </Section>
  );
}
