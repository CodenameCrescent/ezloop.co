/** Hardcoded exchange rates — base is PKR (1 PKR = X units of target currency). */
export const RATES_LAST_UPDATED = "May 2025";

export const PKR_RATES: Record<string, number> = {
  PKR: 1,
  USD: 1 / 278,
  EUR: 1 / 302,
  GBP: 1 / 352,
  AED: 1 / 75.7,
  SAR: 1 / 73.9,
  INR: 1 / 3.32,
  BDT: 1 / 2.56,
};

export interface CurrencyOption {
  code: string;
  label: string;
  symbol: string;
}

export const CURRENCY_OPTIONS: CurrencyOption[] = [
  { code: "PKR", label: "PKR — Pakistani Rupee", symbol: "Rs" },
  { code: "USD", label: "USD — US Dollar", symbol: "$" },
  { code: "EUR", label: "EUR — Euro", symbol: "€" },
  { code: "GBP", label: "GBP — British Pound", symbol: "£" },
  { code: "AED", label: "AED — UAE Dirham", symbol: "AED" },
  { code: "SAR", label: "SAR — Saudi Riyal", symbol: "SAR" },
  { code: "INR", label: "INR — Indian Rupee", symbol: "₹" },
  { code: "BDT", label: "BDT — Bangladeshi Taka", symbol: "৳" },
];

export function getCurrencySymbol(code: string): string {
  return CURRENCY_OPTIONS.find((c) => c.code === code)?.symbol ?? code;
}

export function convertFromPKR(pkrAmount: number, toCurrency: string): number {
  const rate = PKR_RATES[toCurrency] ?? 1;
  return pkrAmount * rate;
}
