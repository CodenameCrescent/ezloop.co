import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getCurrencySymbol } from "@/lib/currencyUtils";
import { OTHER_CURRENCY } from "./DraftFromTransaction";
import { type QuickAddState } from "./UseQuickAddLogic";

export function CurrencyPicker({ f, typedIn, chooseCurrency, fxRate, setFxRate, fxLookup, suggestedRate, preview }: Pick<QuickAddState, "f" | "typedIn" | "chooseCurrency" | "fxRate" | "setFxRate" | "fxLookup" | "suggestedRate" | "preview">) {
  return (
    <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Amounts in</span>
                <div className="inline-flex rounded-md border border-card-border p-0.5 text-xs">
                  {[
                    { value: null, label: `${f.symbol} ${f.currency}` },
                    { value: OTHER_CURRENCY, label: `${getCurrencySymbol(OTHER_CURRENCY)} ${OTHER_CURRENCY}` },
                  ].map((option) => (
                    <button
                      key={option.label}
                      type="button"
                      aria-pressed={typedIn === option.value}
                      className={`rounded px-2 py-1 ${typedIn === option.value ? "bg-muted font-medium text-foreground" : "text-muted-foreground"}`}
                      onClick={() => chooseCurrency(option.value)}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
              {typedIn && (
                <div className="rounded-lg border border-card-border p-3">
                  <Label className="text-xs text-muted-foreground" htmlFor="qa-fx-rate">
                    Exchange rate: {getCurrencySymbol(typedIn)}1 = {f.symbol}
                  </Label>
                  <Input
                    id="qa-fx-rate"
                    inputMode="decimal"
                    placeholder="e.g. 278.50"
                    value={fxRate}
                    onChange={(e) => setFxRate(e.target.value)}
                  />
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {fxLookup.isLoading
                      ? "Getting today's rate…"
                      : suggestedRate
                        ? fxRate.trim() === suggestedRate
                          ? "Today's rate, filled in for you. Change it to match what your bank actually gave you."
                          : `Today's rate is ${suggestedRate}. Yours is kept as typed.`
                        : "Couldn't get today's rate — type the one your bank used."}{" "}
                    It stays fixed on this entry, so later rate changes never move its profit.
                  </p>
                  {preview && (
                    <p className="mt-2 text-sm">
                      = <span className="t-num font-medium">{f.moneyCents(preview.amountCents)}</span>{" "}
                      <span className="text-muted-foreground">in your books</span>
                    </p>
                  )}
                </div>
              )}
            </div>
  );
}
