# DESIGN.md — the design contract

Re-read before changing anything visual. Superseded the light-only contract on
2026-08-16; the rules that survived are here, the ones that did not are named at
the bottom so nobody re-derives them from an old screenshot.

**Tokens live in exactly one file: `artifacts/profit-tracker/src/index.css`.** No
component names a hex. Ever. If a colour you need is not a token, add the token.

---

## 1. Surfaces separate by value

A card reads as raised because it is a different value from the page — not
because it is drawn with a line.

In **light** that is the entire mechanism: no border, no shadow, anywhere on the
page plane. In **dark**, value alone is too weak at the top of the ramp (a card
and the page are a few percent apart), so a card also carries a hairline and a
whisper of shadow. Neither is a decision a component gets to make: both come
from `--pl-surface-line` and `--pl-surface-shadow`, which resolve to nothing in
light and to something in dark. `.pl-surface` applies them; `Surface` is the
component.

Only true overlays — dialogs, dropdowns, toasts — get `--pl-overlay-shadow`,
because they really do float.

**One surface per screen may wear the brand** — and there are two strengths of
it, which are ALTERNATIVES and never a pair:

- `Surface variant="hero"` (`--pl-hero-wash`) — a hint of brand on a normal
  card. Use it where the headline block still has to read as a card.
- `Surface variant="brand"` (`--pl-hero-solid`, `.pl-hero-solid`) — the card
  **is** the brand colour: `#ff4f30` at the top-left running to `#ff7d46` at
  the bottom-right. Everything on it takes `--pl-on-hero`, which is white in
  light and near-black in dark, because the brand fill flips (§5). No child
  names a colour; the class sets `color` so they inherit it. It cancels the
  surface line and shadow locally — a hairline over a saturated fill reads as
  a printing error.

Either one, once. A second turns it into wallpaper, and a page with a washed
card *and* a brand card has two things claiming to be what the page is for.

### The brand block is the one place identity outranks the contrast floor

The owner chose those two stops. **White on them measures 3.27:1 and 2.54:1** —
under the 4.5 this app holds everywhere else, and under 3 at the light end.
That is a decision, not an oversight, and it is written down so nobody
"corrects" it back and nobody assumes the rest of the file is that loose.

What follows from it, and is binding:

- **Nothing but the dashboard headline may use it.** The failure is survivable
  on one 56px figure and four short lines. It is not survivable on a card with
  a table, a form, or body copy in it.
- **Captions on this block are a step larger and a weight heavier** than their
  equivalent on a white card (13px medium where the page uses `.t-micro`,
  15px medium where it uses `.t-body`). Once the fill is fixed, type is the
  only lever left.
- **Never fade the text to 80% white.** It is the first thing everyone tries
  and it moves the ratio the wrong way. Hierarchy comes from the type scale
  (§7).
- **Dark is the clean theme here.** Same gradient, near-black label: 5.68 and
  7.32. Worth knowing when judging a screenshot — the light one is the one
  under strain.

## 2. Colour means money

- **Green is money gained. Red is money lost. Grey is neutral.**
- **Orange is the brand mark** — the logo, the focus ring, the primary action,
  the "you are here" rail, and the one brand block per screen (§1). It is never
  a number, and it never means good or bad. A brand block is a place, not a
  verdict: the same orange is behind a record year and behind a loss.
- Every other hue is allowed on a **Tag** and nowhere else.

## 3. Every hue has two values

A `-solid` for fills, bars and chart marks (needs 3:1) and a plain one for text
(needs 4.5:1). Reaching for the solid where text belongs is the bug this split
exists to prevent.

Contrast is verified against the **recessed panel**, which is the tightest of the
three surfaces a token can land on. Both themes clear it on all 24 routes.

### 3a. Money is never colour alone

Measured with a colour-blindness simulator, money green and money red separate by
**ΔE 4.9 under deuteranopia** — below the floor of 6 — and it cannot be fixed by
re-stepping (darkening the green made it *worse*, at 2.0). Green-and-red is the
worst pair in the space and it is the pair this product's meaning rests on.

So the convention stays and the rule changes: **every money mark also carries a
sign, an arrow, or above/below-baseline position.** `moneyMark()` in
`src/lib/chartTone.ts` returns the colour and its second channel together so the
two cannot be taken from different places. Position is the strongest of the
three, because it also needs no reading — which is why `DivergingBar` splits its
axis instead of left-aligning both directions.

Test it by stripping the page to greyscale. If direction stops being readable,
the rule has been broken.

**On a brand block there is no colour channel at all**, and that is allowed
precisely because colour was never the load-bearing one. The dashboard headline
carries its direction two other ways: a SIGN on the figure (`−Rs 12,345`,
written by the component rather than by `Intl`, which buries the minus after
the symbol) and the WORD above it — "True profit" or "Lost after costs". Both
survive greyscale, which green-and-red never did. A loss on the brand block is
louder than it was in red, because it changes the label and not just the hue.

### 3b. Chart colours: identity is not money

Five validated categorical slots, `--pl-cat-1..5`, for a category / source /
platform / cost component — things that are *different from* each other, never
*more than*. They pass all six checks (lightness band, chroma floor, CVD
separation, normal-vision separation, contrast) in **both** themes; re-run
`validate_palette.js` on any change rather than eyeballing a replacement.

Assigned in **fixed order, never cycled** — a sixth category folds into "Other".
`--chart-1..5` alias these. **Tag hues are for tags**: measured as chart fills
they fail badly (amber at 1.58:1 on white, teal↔pink at ΔE 1.1).

## 4. Three radii

10px (`--pl-r-sm`) for controls, tags, inputs. 16px (`--pl-r-md`) for cards.
A pill (`--pl-r-full`) for buttons and avatars. Nothing else — every Tailwind
`rounded-*` utility is collapsed onto these three.

The gap between the two steps is the point. A card at 16 reads as a soft
surface rather than a box with the corners knocked off; a 32px-tall input at
16 would be *mostly* corner, and the two steps have to stay tellable apart at
a glance. Widening the card radius is a token edit, not a per-component one —
if a card looks wrong at 16, the answer is not a local `rounded-*`.

## 5. Both themes, and the machine decides first

`defaultTheme="system"`. A laptop set to dark opens the app in dark with nobody
touching a setting. `ThemeToggle` (Light / **Auto** / Dark) overrides in either
direction and remembers; "Auto" exists because a two-way switch cannot express
"go back to whatever the computer says".

`index.html` applies the saved class **before first paint** — React cannot, and
without it every load flashes white. Storage key: `profit-loop-theme`.

**Dark is a re-authoring, not an inversion.** Two rules deliberately flip:

- A recessed panel is **lighter** than the card in dark. Going darker collides
  with the page and the well disappears.
- The brand fill goes **bright** and its label goes near-black (`--pl-on-orange`),
  because on a dark surface the fill has to be the light thing to read as a
  button.

## 6. Motion explains, it does not decorate

The vocabulary lives in `src/lib/motion.ts` and mirrors `--pl-dur-*` in the CSS.
Something moves to say where it came from, that a number changed, or what is
selected now. Nothing moves to be seen moving.

- `Reveal` / `Stagger` — blocks arrive top-down, 10px and a fade, 50ms apart.
  That order is the reading order.
- `AnimatedNumber` — **the hero figure only.** Six numbers counting at once say
  nothing and delay the page becoming readable. It refuses to animate in a
  hidden tab and lands on the true value if the tab is hidden mid-count,
  because a half-counted number is a wrong number.
- Shared-layout rails (`layoutId`) mark the current nav item, so changing page
  slides the marker rather than blinking it.
- `.pl-press` — a pressable thing dips 2.5%. Feedback, not a flourish.

**`prefers-reduced-motion` gets none of it.** `useMotionPrefs` zeroes every
duration so components keep one code path, and a global CSS damper catches
anything that ships its own animation.

## 7. Type

Inter, and only Inter. Five steps — 12 · 14 · 17 · 22 · 56 — named for the job
they do: `.t-micro`, `.t-body` / `.t-secondary`, `.t-section` / `.t-verdict`,
`.t-title`, `.t-hero`, plus `.t-num` for a figure in a column.
**One `.t-hero` per screen** — if two things use it, neither is big.

The gap between steps grows as the type grows, deliberately: at reading sizes the
eye cannot see a small ratio, so a 13 beside a 14 buys nothing; at display size
only a large ratio makes one thing dominant.

`tabular-nums` belongs where figures align **vertically** — table columns, axis
ticks — and on the animated hero, where digits changing width mid-count would
jitter. A static stat-tile value takes proportional figures: tabular gives every
digit the width of a zero, which makes a large standalone number sit loose.

## 8. Charts

Every chart sits in a `ChartFrame`, which owns the title, legend, loading, empty
and table view **exclusively**. `state` is a required prop — the four-state
`FigureState`, not a boolean — and `empty` is read only when it is `settled`, so
"no data yet" can never be shown while data is in flight *or* when it never
arrived. No primitive renders an empty state of its own. On refetch the last good
render holds at reduced opacity rather than flashing a skeleton.

It was `loading: boolean` until 2026-08-28, and a boolean was one state short:
`isLoading` is false for a request that FAILED and for one that PAUSED, so both
fell through to `empty` — and every `emptyMessage` in this app is a sentence
about the business ("No revenue recorded in this period."). See §9.

Primitives live in `src/components/charts/` — `TimeSeries`, `Sparkline`,
`ShareBar`, `DivergingBar`, `Dumbbell`, `Meter`, `Ladder` — and every one takes
**plain chart-shaped input, never an `EndpointResponse` type**. Coupling a
primitive to one endpoint is what made five pages hand-roll their own bars.

Two of them — `Meter` and `Sparkline` — take an `inline` prop that suppresses
the frame requirement. It is a narrow, named exemption for a mark that is an
INDICATOR inside something else (a table row, a stat card, the hero), whose
container already owns loading and emptiness. It is deliberately not a general
`skipGuard`: the moment the escape hatch is easier to reach for than the frame,
the frame stops being a rule.

**A chart may not animate if it cannot be made to land.** `AnimatedNumber`
refuses to count in a hidden tab because a half-counted figure is a wrong
figure; the same is true of a half-swept ring, and recharts offers no way to
land one — its `isAnimationActive` sweep is driven by `requestAnimationFrame`
and simply stops where the frames stopped. Caught on the dashboard with
`visibilityState` still reporting "visible": the donut froze a few degrees in
and claimed the business had spent 2% of its revenue. The ring therefore does
not animate at all. The hero figure still counts, which is the one animated
element §6 allows a screen.

`Sparkline`'s geometry is `sparkGeometry()`, tested separately, because the
parts worth getting wrong are arithmetic and invisible to a test that renders a
path: a flat series draws flat down the middle rather than stretched to fill
its box (stretching turns rounding noise into a dramatic climb — the commonest
way a sparkline lies), and the fill hangs to the **zero rule** when the series
crosses zero rather than to the floor, so a losing stretch is never shaded as
a gain.

Marks: bars ≤24px with a 4px rounded data-end; 2px lines; ≥8px markers; area
fills ~10%; **solid** hairline gridlines, never dashed; a 2px surface gap between
touching fills; labels selective, never one per point. **Text never wears the
data colour** — the mark beside it carries the identity.

## 9. A missing figure says why it is missing

**No screen shows a figure it does not have, and no screen invents a reason for
not having one.** A figure has four states, not two, and which one it is gets
decided in exactly one module: `src/lib/figureState.ts`.

| state | what it means | what the screen shows |
|---|---|---|
| `loading` | in flight | skeleton, or the page's own "Working it out…" |
| `settled` | the server answered, and the answer was nothing | **an em dash**, or an empty state that instructs |
| `offline` | the browser is offline, so the request is paused | "Offline" · "You're offline." |
| `failed` | the request failed | "Couldn't load" · "The server didn't answer." |

The em dash belongs to `settled` **only**. It is the honest empty — a real
period that really was quiet — and letting it cover the other two is how a
failed request came to read as a business that did nothing.

Three rules:

- **Amber, never red or green.** Colour means money (§2) and a request that did
  not land is not money lost. `--pl-amber`, the same signal the People gap strip
  already uses for "something about this DATA needs attention".
- **Words never wear the figure's typography.** No `tabular-nums` on
  "Couldn't load". Anything numeric-looking in a money slot gets read as an
  amount. `FigureSlot` holds this so no page has to remember it.
- **A figure in hand outranks every failure.** `figureState(query, hasFigure)`
  returns `settled` when the caller already has a number, so a failed refetch
  never blanks out a good one — the rule `ChartFrame` already followed.

`figureStateSentence(state, subject)` writes the sentence; `FIGURE_STATE_COPY`
holds the two words for a slot. Both live in the one module, so no two screens
describe the same state differently.

---

## What changed on 2026-08-16, and why

| Was | Now |
|---|---|
| Light mode only; no `.dark` block, `forcedTheme="light"` | Dual theme, system-detected, with a Light/Auto/Dark control |
| Warm beige base (`#f8f6f2`) | Cleaner cool-neutral base (`#f6f7f9`) |
| `--pl-ink-2` and `--pl-ink-3` within 0.2 of each other | Real hierarchy (7.4 / 5.9 on white) |
| No motion system | `lib/motion.ts` + `Reveal`, `Stagger`, `AnimatedNumber` |
| Nav dot in front of every leaf | One shared-layout rail marking the current item |
| Two nav rows could be "active" at once | `resolveActiveHref` — longest match wins, exactly one |

Rules 1–4 are unchanged in substance. They were right; they just had no dark
counterpart.

## What changed on 2026-08-17, and why

| Was | Now |
|---|---|
| Money encoded by colour alone | Colour **plus** a sign, arrow, or baseline position — green/red fail CVD at ΔE 4.9 and cannot be re-stepped |
| Tag hues reached for as chart fills | Five validated `--pl-cat-*` slots; tag hues measured and rejected (amber 1.58:1, teal↔pink ΔE 1.1) |
| `--chart-1..5` held money colours, unused | Alias the categorical slots — identity has one name, money keeps its own |
| Charts showed their empty message while loading | `ChartFrame` owns both; `loading` is required, so the bug fails typecheck |
| Nine hand-rolled bar implementations across pages | Seven primitives, each taking plain input rather than one endpoint's response |
| The currency setting multiplied every figure by a rate hardcoded in May 2025 | Currency is a **label**; the server already converts to the business's base currency |
| Number columns were digits to compare mentally | Optional in-cell bars behind the figures (`Column.bar`) |

## What changed on 2026-09-24, and why

The dashboard headline, rebuilt against the owner's reference design.

| Was | Now |
|---|---|
| One washed card holding the figure AND the ring | A **brand block** (`Surface variant="brand"`) for the figure; the ring floats on the page beside it with no card — it explains the headline rather than making a second claim |
| The headline figure coloured green or red | White (near-black in dark) on the brand fill, carrying a **sign** and a **changed label** instead — both survive greyscale, which green/red never did (§3a) |
| Change and margin as tinted pills | Two plain facts on one line. A pill reads as a status, which a margin is not, and a row of them made the headline look like a row of tags |
| A sentence restating the figures in words | Deleted. It said what the figure and the ring beside it already said |
| Four figures in one bordered strip | Four separate cards, each with its own trend line. `StatStrip` stays for pages whose figures are read as a set |
| No trend beside any figure | `Sparkline` + `StatTile.trend`. The delta answers "up or down since last time"; the line answers "is this where it has been" |
| The period named only by a preset ("This Year") | `PageHeader meta` states the real window beside the title — a preset means different dates in January and in September |
| The donut swept in on mount | It does not animate: a sweep that cannot be landed can leave a wrong money split on screen |
| `--pl-r-sm: 6px`, `--pl-r-md: 8px` | 10 / 16, matching the reference design. Still three radii; §4 rewritten to the new values |
| Hero gradient picked to keep white text above 4.5:1 | The owner's two stops, `#ff4f30` → `#ff7d46`. White measures 3.27 and 2.54 — identity outranks the floor **on this one block only**, and §1 now says so out loud, with what follows from it |
