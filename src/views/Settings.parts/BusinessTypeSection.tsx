import { Check } from "lucide-react";
import { isFeatureOverridden } from "@workspace/domain";
import { BUSINESS_TYPE_OPTIONS } from "@/lib/businessTypes";
import { GATED_FEATURE_OPTIONS, type SettingsPageState, Section, Row } from "./UseSettingsPageLogic";

export function BusinessTypeSection({ businessType, updateSettings, features, featureOverrides }: Pick<SettingsPageState, "businessType" | "updateSettings" | "features" | "featureOverrides">) {
  return (
    <Section title="Business type">
          <Row
            label="What kind of business is this?"
            hint="Sets which features you see and which starting expense types we suggest. You can always create your own."
          >
            <div className="grid max-w-2xl grid-cols-1 gap-2 sm:grid-cols-2">
              {BUSINESS_TYPE_OPTIONS.map((option) => {
                const checked = businessType === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => updateSettings({ businessType: option.value })}
                    className={`flex min-h-[76px] items-start gap-3 rounded-xl border px-3 py-3 text-left transition-all ${
                      checked
                        ? " bg-[color:var(--pl-orange-tint)] text-foreground"
                        : "border-border bg-muted/20 text-muted-foreground hover: hover:text-foreground"
                    }`}
                  >
                    <span
                      className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
                        checked ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/40"
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
          <Row
            label="Features"
            hint="On or off by default for your business type. Override any of them here."
          >
            <div className="max-w-2xl space-y-1.5">
              {GATED_FEATURE_OPTIONS.map((option) => {
                const on = features[option.value] ?? false;
                const overridden = isFeatureOverridden(businessType, option.value, featureOverrides);
                return (
                  <label
                    key={option.value}
                    className="flex cursor-pointer items-start gap-3 rounded-xl border border-border bg-muted/20 px-3 py-2.5"
                  >
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={on}
                      onChange={(e) =>
                        updateSettings({ featureOverrides: { [option.value]: e.target.checked } })
                      }
                    />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-foreground">
                        {option.label}
                        {overridden && (
                          <button
                            type="button"
                            title="Go back to the default for your business type"
                            onClick={(e) => {
                              e.preventDefault();
                              updateSettings({ featureOverrides: { [option.value]: null } });
                            }}
                            className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[10px] font-normal text-muted-foreground hover:text-foreground"
                          >
                            overridden · reset
                          </button>
                        )}
                      </span>
                      <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
                        {option.description}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
          </Row>
        </Section>
  );
}
