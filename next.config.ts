import type { NextConfig } from "next";

/** Old paths. Every one lands on its new home in a single hop, so bookmarks keep working. */
const LEGACY_REDIRECTS: Array<[string, string]> = [
  ["/record", "/record/transactions"],
  ["/setup", "/setup/revenue"],
  // Folded into People: a client is a person and so is a team member.
  ["/setup/clients", "/setup/people"],
  ["/setup/team", "/setup/people"],
  ["/plan", "/plan/action-plan"],
  ["/workbench", "/setup/revenue"],
  ["/workbench/business/revenues", "/setup/revenue"],
  ["/workbench/business/expenses", "/setup/expenses"],
  ["/workbench/transactions", "/record/transactions"],
  ["/workbench/transactions/revenue", "/record/transactions"],
  ["/workbench/transactions/expenses", "/record/transactions"],
  ["/workbench/hours", "/record/hours"],
  ["/workbench/recurring", "/record/recurring"],
  ["/workbench/people", "/setup/people"],
  ["/workbench/clients", "/setup/people"],
  ["/workbench/team", "/setup/people"],
  ["/workbench/profitability", "/insights/worth-having"],
  ["/workbench/offers", "/setup/revenue"],
  ["/workbench/inventory", "/setup/revenue"],
  ["/workbench/clients-customers", "/setup/people"],
  ["/workbench/marketing-data", "/setup/expenses"],
  ["/workbench/marketing", "/setup/expenses"],
  ["/tools", "/plan/what-if"],
  ["/growth", "/plan/action-plan"],
  ["/growth/action-plan", "/plan/action-plan"],
  ["/growth/decisions", "/plan/action-plan"],
  ["/growth/forecasts", "/plan/forecasts"],
  ["/growth/scenarios", "/plan/what-if"],
  ["/growth/goals", "/plan/action-plan"],
  ["/growth/experiments", "/plan/what-if"],
  ["/growth/opportunities", "/plan/action-plan"],
  ["/growth/alerts", "/insights"],
  ["/reports", "/reports/overview"],
  ["/reports/tax-reports", "/reports/overview"],
  ["/reports/export-data", "/reports/overview"],
  ["/settings/users-roles", "/settings"],
  ["/money", "/money/profit-loss"],
  ["/money/revenue", "/setup/revenue"],
  ["/money/costs-expenses", "/setup/expenses"],
  ["/products", "/setup/revenue"],
  ["/offers", "/setup/revenue"],
  ["/orders", "/record/transactions"],
  ["/transactions", "/record/transactions"],
  ["/clients-customers", "/setup/people"],
  ["/customers", "/setup/people"],
  ["/marketing-data", "/setup/expenses"],
  ["/marketing", "/setup/expenses"],
  ["/inventory", "/setup/revenue"],
  ["/finance", "/money/profit-loss"],
  ["/finance/overview", "/money/profit-loss"],
  ["/finance/revenue", "/setup/revenue"],
  ["/finance/expenses", "/setup/expenses"],
  ["/finance/profit-loss", "/money/profit-loss"],
  ["/finance/cash-flow", "/money/cash-flow"],
  ["/finance/budget", "/money/budget"],
  ["/finance/insights", "/insights/leaks"],
  ["/analytics/customers", "/insights/customers"],
  ["/analytics/financial-insights", "/insights/leaks"],
  ["/analytics/:rest*", "/insights"],
  ["/integrations/:rest+", "/integrations"],
  ["/ads", "/insights"],
  ["/decisions", "/plan/action-plan"],
];

/**
 * Same policy the Express API set with helmet. `'unsafe-eval'` stays because
 * Next's dev runtime needs it; Google sign-in is a full-page redirect, not a frame.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https:",
  "style-src 'self' 'unsafe-inline' https:",
  "img-src 'self' data: blob: https:",
  "connect-src 'self' https: wss:",
  "font-src 'self' data: https:",
  "object-src 'none'",
  "media-src 'self'",
  "frame-src 'self' https:",
  "worker-src 'self' blob:",
].join("; ");

const nextConfig: NextConfig = {
  // pino and pg are Node-only and resolve their own files at runtime.
  serverExternalPackages: ["pino", "pg"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async redirects() {
    return LEGACY_REDIRECTS.map(([source, destination]) => ({ source, destination, permanent: false }));
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: CSP },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
        ],
      },
    ];
  },
};

export default nextConfig;
