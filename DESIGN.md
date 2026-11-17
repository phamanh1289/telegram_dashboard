# DESIGN.md — Citics work dashboards (locked system)

Two modules, one product, one Next app (Tailwind 4 + shadcn / Base UI): **Telegram Inbox** (`/`) and **YouTrack** (`/youtrack/`, `web/src/features/youtrack/components/`), plus **Cài đặt** (`/settings/`). All read the same tokens: [`web/src/app/tokens.css`](web/src/app/tokens.css) and [`web/src/app/base.css`](web/src/app/base.css) (imported by `globals.css`; each member's look is applied before first paint by the boot script in `web/src/app/layout.tsx`). Change a value there, never a literal in a component.

Palette: custom, warm neutral. A cream ground with a faint top-to-bottom warm wash (`--ground-wash`) and near-white cards (light), or a low-chroma blue slate (dark, hue 255 in `tokens.css`: cool so the warm highlight and amber read clearly; ground < sidebar < card in clear steps, cards lit by a 1px top highlight); primary button is espresso ink. Two signals that never share a job: **terracotta highlight** (a deeper, redder copper in dark mode, where lifted terracotta read too close to the amber) for where you are and what you act on, **honey-amber signal** for what needs you. Chroma stays ≤ 0.15 so nothing glares. Every text pair ≥ 4.5:1, marks and borders ≥ 3:1, in both modes. Layout and components came from the Hallmark Coral build; only the colours changed.

## Principles

1. **The task, not the tool.** Someone triaging mentions or chasing tickets should see what needs them first: the oldest waiting message, the ticket stuck longest. Everything else is one step away.
2. **Terracotta = here / act, amber = needs you.** Highlight (`--color-hl`) marks the selection, the current tab, module and filter, links and focus. The primary button is espresso ink (`--color-board`), not highlight. Signal (`--color-signal`) marks overdue, waiting > 4h, new since last visit. Neither is decoration.
3. **Density is the design.** Controls 30–36px tall with a 44px hit area; tables before cards; one card recipe.
4. **Figures are set, not decorated.** IDs, times, counts, ages, percentages in Quicksand (proportional digits). No icon tiles on stats, no trend arrows nobody measured, no gradients.
5. **Motion is state.** `--dur-micro` / `--dur-short`, `transform` + `opacity` only, `prefers-reduced-motion` respected. Never `transition: all`; never animate width/height/top/left.

## Tokens (names)

| Role | Token |
| --- | --- |
| Ground / raised / pressed | `--color-paper`, `--color-paper-2`, `--color-paper-3` |
| Records (cards, rows, sheets, popovers) | `--color-cotton` |
| Text strong / body / quiet | `--color-ink`, `--color-ink-2`, `--color-ink-3` |
| Hairline / control border | `--color-rule`, `--color-rule-2` |
| Highlight: fill / as text / selected background / text on fill | `--color-hl`, `--color-hl-2`, `--color-hl-wash`, `--color-hl-ink` |
| Primary action fill / its label | `--color-board`, `--color-board-type` (espresso ink; light ink in dark mode) |
| Signal (needs you) / as text / wash | `--color-signal`, `--color-signal-2`, `--color-signal-wash` |
| Focus ring | `--color-focus` (2px, offset 2px, instant) |
| Data state | `--color-ok`, `--color-warn`, `--color-error`, `--color-info` and their `-wash` |
| Code / key chips in message text | `--color-code`, `--color-code-wash` (slate blue: the one cool hue, never a state) |
| Categorical marks (workflow tiers, ticket types) | `--cat-1` … `--cat-6` |
| Depth | `--edge-stock` (record edge), `--cast-stock` (resting cast, light only), `--cast-pop` (menus, drawers, dialogs), `--press-groove` (segmented controls) |
| Type | `--font-body` (Quicksand by default; each member can pick another face, below), `--font-figure` (= `--font-body`, one face); scale `--text-2xs`…`--text-3xl` (12 · 13 · 15 · 16 · 17 · 20 · 22 · 26 · 32px, by role below) |
| Space | `--space-3xs` 2 · `2xs` 4 · `xs` 8 · `sm` 12 · `md` 16 · `lg` 24 · `xl` 40 |
| Motion | `--dur-micro` 120ms, `--dur-short` 220ms, `--ease-out` |
| Radius | `--radius-card` 10, `--radius-input` 8, `--radius-pill` (avatars and counts only) |

In the Next app these map onto shadcn names in `globals.css` (`--background`, `--card`, `--primary`…); use the Tailwind utilities (`bg-card`, `text-muted-foreground`) or `var(--color-*)`. `--color-signal` and `--color-ink-3` are deliberately not shadcn's `accent`/`muted`.

## Type

- One face at a time, three weights: regular / medium / bold (`font-normal` / `font-medium` / `font-bold`; no `font-semibold`). Regular and medium follow the face (`--font-weight-normal` / `--font-weight-medium`, `w` in `lib/fonts.ts`): rounded faces (Quicksand, Nunito) read at 500 / 600 because their 400 is a hairline, the others 400 / 500; bold is 700 everywhere. Never write a numeric weight in a component.
- Text never looks thin: grayscale smoothing (`antialiased`) only in dark mode; light mode keeps the OS default.
- Hierarchy is colour + weight before size: the thing to act on (message, ticket title, row title) is `text-ink` regular; who/what it is (sender, ticket id) `text-ink` medium; secondary prose `text-ink-2`; meta (time, group, counts) `text-xs text-ink-3`. Never put the row's main content in `ink-2`/`ink-3`. Default Quicksand; Cài đặt chung › Font chữ swaps it per browser (Quicksand, Be Vietnam Pro, Inter, Nunito, the system face; list in `lib/fonts.ts`, all with Vietnamese). The boot script in `app/layout.tsx` sets `--font-body` and loads only the picked face; never hard-code a family in a component.
- Sizes by role, only from the scale (`text-2xs`…`text-3xl`; never `text-[Npx]` / `text-[N rem]` in components, except the drawn AI scenes in `ai/fetching.tsx`):
  - `text-2xs` 12px: badges, counts in pills, kbd, avatar initials.
  - `text-xs` 13px: meta, labels, table heads, nav section labels, small buttons (`xs`).
  - `text-sm` 15px: UI body (body default), list titles, buttons, section/card head 700.
  - `text-md` 16px: reading text (message bodies, ticket descriptions, AI answers, composer, ticket title), line-height 1.55, max ~70ch.
  - `text-base` 17px: dialog title, detail head (reply composer), dashboard section head.
  - `text-lg` 20px: page title (page header of every module, Cài đặt section).
  - `text-xl` 22px: the one hero line of a page (Hôm nay summary, Cài đặt title, onboarding).
  - `text-2xl` / `text-3xl` 26 / 32px: big figures (KPI tiles, countdowns).
- Labels, table heads, nav, tags: body face, a step smaller, sentence case, **untracked, never uppercase**.
- Figures: `.num` / `.fig` → Quicksand (proportional digits).

## Components

- **Button** — primary: `--color-board` fill (espresso ink), `--color-board-type` label, 36px (30px small), radius 8, lifts 1px on hover, presses 1px on active. Secondary: cotton with `--edge-stock`. Ghost: transparent, paper-3 on hover. Destructive: error text, error-wash on hover. All eight states: default, hover, focus-visible, active, disabled (opacity .5, no pointer), loading (spinner replaces icon, label stays), error, success.
- **Segmented control** (2–4 options: scope, tabs inside a card): a groove (`--press-groove`, paper-2) with a cotton card riding in it to the chosen stop.
- **Tabs** (page-level): text tabs with a 2px ink underline on the current one; count in a mono pill.
- **Input / select** — 36px, radius 8, 1px `--color-rule-2`, cotton fill; focus ring highlight.
- **Chip / filter** — 28px, radius 8, rule-2 border; selected = highlight fill, white label. A count inside is mono.
- **Card** — cotton, radius 10, `--edge-stock` + `--cast-stock`, 16px padding, head row 700 + quiet meta at right. Never a card inside a card (use a rule or a paper-2 well).
- **Table** — sticky head in paper-2, heads ink-3 `--text-xs` 500 sentence case, rows 40px (compact 32px), hairline rules, hover paper-2, selected row hl-wash with a 3px highlight left mark. Numbers right-aligned mono.
- **Badge / state** — text + a small square swatch of its category colour (not colour alone); `-wash` background only for error/warn/ok states.
- **Avatar** — 24px circle, initials on a hue derived from the name at fixed L/C.
- **Popover / menu / dialog / drawer** — cotton, `--cast-pop`, radius 10; scrim `--scrim`; drawer slides with `transform`.
- **Toast** — board fill, bottom centre, auto-dismiss 3s, one action max.
- **Empty / loading / error** — every data region: skeleton in the shape of what's coming; empty = what belongs here + the one action; error = what broke + retry.

## Shell

- **Top bar** (`TopBar`, `components/shell.tsx`), shared by Telegram, YouTrack and Cài đặt: 44px, paper-2, one hairline under. Left: the **module switch** (Telegram, YouTrack) as a segmented pill with the current module pressed; the pill morphs between modules with a React `ViewTransition`; under 640px only the icons show (labels stay for screen readers). A "needs you" count on the YouTrack switch is signal. Right: AI quota, guide (F1), theme toggle, Cài đặt (dot = update available).
- **Page header** under it: the sidebar toggle, page title left, the page's controls right (search and day range only on tag lists), 56px min, one hairline under. A connection problem lasting a few seconds adds a thin warn strip under it with a retry.
- **Sidebar** 15.5rem (Telegram) / 15rem (YouTrack): views, then groups or pages, footer. Collapses to a 64px rail (icons + Hint tooltips; it opens over the page on hover / focus). Telegram clips the rail with `clip-path` and swaps the grid column once; YouTrack swaps the column once and slides the page with a `transform` (WAAPI). Neither animates width frame by frame. Under 48rem (768px) it becomes an off-canvas sheet with a scrim.
- **Toast** (`Toaster`, `components/shell.tsx`): one button max; an undo next to an action stays on the `z` key.
- Theme toggle: one key `localStorage.theme` = `light` | `dark` shared by both modules (default: OS preference); the root carries both `class="dark"` and `data-theme`.

## Language

- The UI is Vietnamese + English (`web/src/shared/lib/i18n`): the default follows the machine (`navigator.languages` starting with `vi` → Vietnamese, else English); Cài đặt chung › Ngôn ngữ overrides it per browser (`localStorage.lang`), and the boot script sets `<html lang>` before first paint.
- Every new UI string has both: write the Vietnamese as the key (`useT()` → `t("…")` in components, plain `t` in handlers) and add its English to the area's `lib/i18n/en/*.ts`; a missing English fails typecheck. Placeholders `{n}`; plurals as a function value.
- Dates and numbers via `fmtDate` / `fmtDay` / `fmtClock` / `fmtNum` / `locale()` (Vietnam time, `en-GB` order for English); never a fixed `"vi-VN"`.
- English runs longer: leave room in `truncate` rows and narrow buttons, prefer shorter wording over wider layouts.

## Accessibility floor

Contrast ≥ 4.5:1 body, 3:1 large text and UI; focus visible instantly; status never by colour alone; hit targets 44px; keyboard paths kept (j/k/r/x/a, `/`, Ctrl/⌘K, Esc); `prefers-reduced-motion` honoured; content readable without animation.

## Don'ts

Purple/blue gradients, glow, radial background blobs (the one allowed gradient is the faint linear `--ground-wash` on the ground, plus the selected-row wash fade), emoji as icons, uppercase tracked labels, middle-dot meta strings, decorative status dots, KPI walls with icon tiles, card-in-card, `transition: all`, `overflow-x: hidden`, `100vw`, colour literals outside the token files.
