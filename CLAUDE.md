# Profit Loop — Architecture Contract

Re-read this before writing code in any session. If a requested change would violate an invariant below, stop and flag it to the owner instead of implementing it.

## What this app is

Profit-tracking SaaS (a "business doctor") for non-technical owners of ANY business type: ecommerce, freelancing, services, subscriptions, real estate. It is cross-vertical — nothing may be hardcoded to ecommerce-only concepts. The surface stays beginner-friendly; the core is allowed to be complex. The UI never exposes backend vocabulary (provider, connectionId, externalId, amountMode, metadataJson) — it speaks human ("Added From", "Kind", "How often?").

## Repo rules

- Auth is NextAuth v4 (JWT session cookie) over Supabase Auth (the user store); the app's user id is the Supabase `auth.users.id`. Keep LOCAL_AUTH_BYPASS and the `x-profit-loop-dev-user-id` header; Paddle billing is KEEP. Pages are gated twice: `src/proxy.ts` (`http/pageGate.ts`) redirects a request with no valid session cookie to `/` for every page not on its public list (cookie only, no DB; never `/api` or static files), and each layout's `requireSignedIn()` (`src/lib/api/functions/session.ts`) makes the full check, revocation included. Keep both. The API checks in `handle()` (`authenticate` in `http/guards.ts`). `src/app/api/auth/[...nextauth]` is the one route outside `handle()`; sign-up and password reset go through `handle()` like any endpoint. supabase-js runs only on the server (`src/lib/api/functions/auth`), with a NEW anon client per call. A session is honoured only while its account exists, is not deleted or banned, and was not revoked by a password reset (`auth/accountStatus.ts`, cached 60 s); password sign-in is rate-limited before Supabase is asked (`auth/signInLimits.ts`, in memory per instance; client IPs trusted only on Vercel via `http/clientIp.ts`). OAuth links only to an existing account whose email is confirmed.
- The API contract lives ONLY in `src/core/contract` (Zod schemas). No OpenAPI, no codegen. The server validates request AND response shapes with these schemas in dev; the frontend imports the same schemas for its typed hooks. One source of truth, zero generation steps.
- DB changes go through `drizzle-kit generate` producing committed migration files, applied with `npm run db:migrate`, which prints each pending file's SQL and a `<tag>@<hash>` token. Applying needs `--apply --reviewed=<every token>` (the hash binds the review to the exact file), plus `--allow=<tag>` for destructive/incompatible files; drift (a skipped or edited-after-apply file) blocks applying. Always read the generated SQL before applying to the shared database (README → "Changing the database schema"). `drizzle-kit push` and `drizzle-kit migrate` are refused in `drizzle.config.ts`.
- The development Supabase database is SHARED with real accounts and the deployed app. Never run destructive operations against it without the owner's explicit approval. Scripts that write use `scripts/guard.ts` (target printed, `--shared-db` + typed confirmation off-localhost; wiping scripts never target a real account). The dev bypass only works under a LIVE `npm run dev` launcher (it answers an HMAC challenge with a per-run key; an env var alone does nothing), on a server whose port answers on no network address, and only for the ids in `src/lib/devAccounts.ts`. Integration tests only run against localhost (`assertLocalTestDatabases`).
- Domain logic lives in `src/core/domain`: pure TypeScript with no Express, React, or Drizzle imports, unit-tested with node:test. Server routes orchestrate; the UI never computes money.

## Project layout

One Next.js app (App Router, npm). Nothing else runs: no Express, no Vite.

| Path | What lives there |
|---|---|
| `src/core/domain` | Pure money logic (imported as `@workspace/domain`) |
| `src/core/db` | Drizzle schema and pool (`@workspace/db`); migrations in `drizzle/migrations` |
| `src/core/contract` | Zod API contract (`@workspace/api-contract`) |
| `src/app/api/**/route.ts` | The API. One file per URL (`[id]` folders for ids), each with its own `export async function GET/POST/PUT/PATCH/DELETE` holding that endpoint's code |
| `src/app/api/<resource>/functions.ts` | Server code only that API folder uses (its service and mappers), imported by its `route.ts` files as `./functions` / `../functions`. Code a second API folder, a script or another service needs lives in `src/lib/api/functions` instead — no API folder imports another's `functions.ts` |
| `src/lib/api/functions` | Shared server code. `services/` = the shared money logic (ledger, read, catalog, business, person…); `http/` = `handle()`/`handleRaw()` and the guards (auth, business, feature, rate limit), contract validation, error envelope; `helpers/` = mappers shared by several API folders; `auth/`, `integrations/`, `lib/`, `scripts/` |
| `src/lib/api-helpers/client.ts` | Every call the browser makes, one function per endpoint; `transport.ts` beside it adds the auth, business and dev-account headers |
| `src/app` | Pages. `(app)` = inside one business (sidebar, period); `(account)` = signed in, above any business |
| `src/views` | Screen components the pages render (was `pages/` in the Vite app) |
| `src/api/hooks.ts` | React Query hooks over `client.ts`: caching and invalidation |
| `src/components`, `src/lib` | UI components and client helpers |

Fixed old-URL redirects live in `next.config.ts`; add new ones there, not in a page.

**UI files stay at 350 lines or fewer** (`src/views`, `src/components`, `src/app` pages, `src/api`, and the browser-side `src/lib`). When one grows past that, move whole declarations into a sibling `<File>.parts/` folder and re-export them from `<File>`, so import paths never change. A big component keeps its render in `<File>` and moves its state and handlers into a `use<Name>Logic` hook; its sections become child components typed from `ReturnType<typeof use<Name>Logic>`.

**Adding an endpoint:** define it in `src/core/contract`; write `export async function METHOD(request: NextRequest, …) { return handle(request, contract, options, async ({ req, params, query, body }) => …) }` in `src/app/api/<path>/route.ts`, with code only that folder needs in its `functions.ts` (options: `business: false` for account-level, `feature`, `write: true` for mutations, and pass `params` on dynamic routes); add one line to `src/lib/api-helpers/client.ts`; wrap it in a hook if a screen reads it. Never answer a request without `handle`/`handleRaw` — that is where auth, business scoping and the CSRF check for signed-in writes (`http/csrf.ts`) happen, and the isolation test walks every contract endpoint to catch one that skips it. **Every id a request REFERENCES (person, category, project, item, source) must be checked with `assertOwnedRefs` (`services/ownership.ts`) before anything is written**, and every lookup that turns a stored id into a name or price filters by `business_id` — the foreign-reference sweep (`route-tests/foreignRefs.integration.test.ts`) fails otherwise.

`src/lib/api/functions` and every `src/app/api/**/functions.ts` are server-only. Nothing under `src/components`, `src/views`, `src/api` or `src/lib/api-helpers` may import from them (ESLint enforces it).

## The four layers (every feature maps into these)

1. **Sources** — channels money flows through (a store, a marketplace account, "Manual", a bank). Every transaction has a `source_id`.
2. **Catalog** — RevenueItems / ExpenseItems defined once with their economics (price, cost components, recurrence). Catalog entries describe the business; they never move money by themselves.
3. **Ledger** — a Transaction header plus N TransactionLines per money event. The single source of truth; every screen reads it.
4. **Engines** — recurring posting now; sync, attribution, and insights later. Engines write ONLY through the same domain services the UI uses — never raw SQL, never bespoke endpoints.

## Non-negotiable invariants

- **Money is integers in minor units (cents/paisa)** stored in `bigint` columns with Drizzle `mode: "number"`. No floats in money math anywhere. Rates and quantities are decimal strings, computed with decimal.js inside domain code.
- **Cost snapshots freeze at line creation**: when a line is written, resolve the item's effective CostComponents into a `cost_snapshot` JSON on that line; all profit math reads snapshots forever after. Editing catalog costs never changes historical profit.
- **CostComponents are effective-dated** (`effective_from` / `effective_to`); an edit closes the old version and inserts a new one — versions are never mutated in place.
- **Append-only ledger**: refunds, chargebacks, and corrections are NEW transactions carrying `parent_transaction_id`. Voiding is a status change. Money rows are never hard-deleted — with one owner-approved exception: a customer deleting their whole account erases everything in it (`src/app/api/account/functions.ts`, DECISIONS.md 2026-09-28). The rule protects a business's history from its own edits; it is not a reason to keep a departed customer's books.
- **Type vs Category vs Source are orthogonal.** `type` is a system enum that changes behavior; `category` is a user-defined label tree used only for grouping; `source` records where the money flowed. Never merge or conflate them.
- **Taxes collected are not revenue**: a header-level field, excluded from every revenue and profit number.
- **The profit ladder is computed in exactly one module** (`src/core/domain/profit.ts`) with one vocabulary used verbatim in the UI: **Gross revenue → Net revenue → Contribution profit → True profit**. Fixed costs are never allocated per unit or per item; item-level screens stop at contribution profit.
- **Origin transparency**: every transaction records its `origin` (`manual | recurring_engine | integration | import`) and the UI shows it. `external_ref` and a `unique(source_id, external_ref)` constraint exist NOW so future integrations dedupe cleanly from day one.
- **One-off entries must work with zero catalog setup**: a transaction line may be unlinked, carrying only a label. Fast entry is a product requirement, not an edge case.

## Integrations — how they plug in

**Shopify is the worked example — read it before writing a second connector.** OAuth (`routes/shopify-oauth.ts`), webhooks (`routes/shopify-webhooks.ts`), normalization (`integrations/shopifyNormalize.ts`, pure and unit-tested), and the sync (`integrations/shopify.ts`) were rebuilt on the money core and meet every rule below. `integrations/connectors.ts` is the registry: `live: false` connectors say so plainly rather than inventing figures, which is what the old ones did. A connected account carries `integrations.source_id` — a store IS a channel, so the two are one row's worth of truth, not two matched by name.

Everything below is the contract that connector meets, and that any new connector (Stripe, a marketplace, a bank feed) must meet from the start. A connector plugs into the EXISTING core — it does not invent a parallel money path. The hooks are already in the schema and services:

- **Connectors normalize, then call the same domain services.** A connector's only job is to translate an external payload into the domain inputs and call `createTransaction` / `createRefund` / `voidTransaction` in `src/lib/api/functions/services/ledger.ts` — the identical path the UI and the recurring engine use. No connector writes raw SQL, no connector gets a bespoke money endpoint. This is the "engines write only through the same domain services" invariant applied to sync.
- **Dedup rides `unique(source_id, external_ref)`.** Every imported transaction sets `origin: "integration"` and `external_ref` = the platform's order/charge id. The partial-unique index `transactions_source_external_ref_uq` makes a re-sync a no-op at the database level (the same idempotency shape the recurring engine gets from `unique(schedule_id, scheduled_for)`). Backfills and webhook replays are therefore safe by construction.
- **Item mapping rides `RevenueItemSource.external_id`.** A catalog item is linked to its listing on a source through `revenue_item_sources` (`external_id` + optional `price_override_cents`). A connector resolves an incoming line to a catalog item by looking up `(source_id, external_id)`; unmapped lines fall back to label-only lines (zero-catalog entry still works), to be mapped later.
- **The money-truth hierarchy governs conflicts.** When two sources describe the same money, precedence is fixed: **the platform owns order facts** (what sold, quantities, discounts, tax), **the processor owns fee facts** (the real settlement/processing fee — write it as a cost component or a fee line, never trust the platform's estimate), and **payouts are never revenue** (a bank/processor payout is a transfer of money already recorded as sales — reconcile against it, never post it as income). A connector that sees a payout matches it to existing ledger rows; it does not create revenue.

The point of this note: a session rebuilding Shopify — or building Stripe — works against these four hooks, not by adding new tables or endpoints, and not by extending the legacy path the current connector still sits on.

## Working docs

- `DESIGN.md` — the design contract. Re-read before changing anything visual. Eight rules: surfaces separate by value not by line (the hairline and shadow that dark mode adds are tokens that resolve to nothing in light); colour means money (green gained, red lost, grey neutral, orange is the brand mark and NEVER encodes data) — and **money is never colour alone**, it always carries a sign, arrow or baseline position, because green/red fail colour-blind separation at ΔE 4.9 and cannot be re-stepped; every hue has a text value and a `-solid` fill value, and **chart identity uses the five validated `--pl-cat-*` slots, never the tag hues**; three radii; **both themes ship**, system-detected, dark authored to the same contrast contracts rather than inverted; motion explains and never decorates, and `prefers-reduced-motion` gets none of it; five type steps with one `.t-hero` per screen; **every chart sits in a `ChartFrame`** which owns loading/empty (a chart may not render its own), and chart primitives take plain input, never an `EndpointResponse` type. Tokens live in exactly one file, `src/index.css`; motion in `src/lib/motion.ts`; chart tones in `src/lib/chartTone.ts`. No component names a hex.
- **Money display**: cents in, string out. `lib/money.ts` shapes; `useFormatters()` binds the symbol. Use `f.moneyCents(...)` — never `formatCents(x, f.symbol)`, which is how a settings symbol once got paired with an unconverted figure. The currency setting is a LABEL: the server already returns cents in the business's base currency, and the UI does no conversion.
- `DECISIONS.md` — append-only decision log (date, decision, why). Add an entry whenever a locked decision is made or revisited.

