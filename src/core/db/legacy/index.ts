/**
 * TODO(R3/R5): delete. Legacy money tables — DROPPED from the database by the
 * R2 destructive migration but still exported here so pre-rewrite api-server
 * routes keep compiling until R3 replaces them. Any runtime query against
 * these tables fails with "relation does not exist"; that is expected and
 * tracked in REWRITE_PLAN.md.
 *
 * `products` and `inventory` are GONE from here as well as from the database:
 * SKU and stock-keeping are not part of this product. The Shopify connector
 * used to resolve and create product rows through them and no longer does —
 * see the note in integrations/shopify.ts.
 *
 * `ad_spend` is GONE too, and unlike the rest it has a live successor: the real
 * `ad_spend` table in `schema/adSpend.ts`, written through
 * `services/adSpend.ts`. The legacy definition was deleted rather than left
 * here because it named the same table, so a stale writer pointing at it would
 * have aimed at real rows the moment the new table existed.
 */
export * from "./orders";
export * from "./transactions";
export * from "./expenseItems";
export * from "./expenses";
export * from "./customerMerges";
