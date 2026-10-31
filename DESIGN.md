# DESIGN.md — Citics work dashboards (locked system)

Two modules, one product: **Telegram Inbox** (`/`, Next + Tailwind 4 + shadcn) and **YouTrack** (`/yt/`, vanilla ES modules). Both read the same tokens: [`web/public/design/tokens.css`](web/public/design/tokens.css) and [`web/public/design/base.css`](web/public/design/base.css). Change a value there, never a literal in a component.

Palette: custom, warm neutral. A cream ground with a faint top-to-bottom warm wash (`--ground-wash`) and near-white cards (light), or a near-neutral warm graphite (dark: low chroma so it never reads as muddy brown; ground < sidebar < card in clear steps, cards lit by a 1px top highlight); primary button is espresso ink. Two signals that never share a job: **terracotta highlight** for where you are and what you act on, **honey-amber signal** for what needs you. Chroma stays ≤ 0.15 so nothing glares. Every text pair ≥ 4.5:1, marks and borders ≥ 3:1, in both modes. Layout and components came from the Hallmark Coral build; only the colours changed.

## Principles

1. **The task, not the tool.** Someone triaging mentions or chasing tickets should see what needs them first: the oldest waiting message, the ticket stuck longest. Everything else is one step away.
2. **Terracotta = here / act, amber = needs you.** Highlight (`--color-hl`) marks the selection, the current tab, module and filter, the primary button, links and focus. Signal (`--color-signal`) marks overdue, waiting > 4h, new since last visit. Neither is decoration.
3. **Density is the design.** Controls 30–36px tall with a 44px hit area; tables before cards; one card recipe.
4. **Figures are set, not decorated.** IDs, times, counts, ages, percentages in Geist Mono tabular. No icon tiles on stats, no trend arrows nobody measured, no gradients.
5. **Motion is state.** `--dur-micro` / `--dur-short`, `transform` + `opacity` only, `prefers-reduced-motion` respected. Never `transition: all`; never animate width/height/top/left.

## Tokens (names)

| Role | Token |
| --- | --- |
| Ground / raised / pressed | `--color-paper`, `--color-paper-2`, `--color-paper-3` |
| Records (cards, rows, sheets, popovers) | `--color-cotton` |
| Text strong / body / quiet | `--color-ink`, `--color-ink-2`, `--color-ink-3` |
| Hairline / control border | `--color-rule`, `--color-rule-2` |
| Highlight: fill / as text / selected background / text on fill | `--color-hl`, `--color-hl-2`, `--color-hl-wash`, `--color-hl-ink` |
| Primary action fill / its label | `--color-board`, `--color-board-type` (= highlight) |
| Signal (needs you) / as text / wash | `--color-signal`, `--color-signal-2`, `--color-signal-wash` |
| Focus ring | `--color-focus` (2px, offset 2px, instant) |
| Data state | `--color-ok`, `--color-warn`, `--color-error`, `--color-info` and their `-wash` |
| Categorical marks (workflow tiers, ticket types) | `--cat-1` … `--cat-6` |
| Depth | `--edge-stock` (record edge), `--cast-stock` (resting cast, light only), `--cast-pop` (menus, drawers, dialogs), `--press-groove` (segmented controls) |
| Type | `--font-body` (Be Vietnam Pro), `--font-figure` (Geist Mono); scale `--text-xs`…`--text-3xl` (1.2 ratio) |
| Space | `--space-3xs` 2 · `2xs` 4 · `xs` 8 · `sm` 12 · `md` 16 · `lg` 24 · `xl` 40 |
| Motion | `--dur-micro` 120ms, `--dur-short` 220ms, `--ease-out` |
| Radius | `--radius-card` 8, `--radius-input` 6, `--radius-pill` (avatars and counts only) |

In the Next app these map onto shadcn names in `globals.css` (`--background`, `--card`, `--primary`…); use the Tailwind utilities (`bg-card`, `text-muted-foreground`) or `var(--color-*)`. `--color-signal` and `--color-ink-3` are deliberately not shadcn's `accent`/`muted`.

## Type

- Be Vietnam Pro 400/500/600 (Vietnamese-native grotesk). Dark mode body drops to 350.
- Page title `--text-lg` 600; section/card head `--text-sm` or `--text-md` 600, sentence case.
- Labels, table heads, nav, tags: body face, a step smaller, sentence case, **untracked, never uppercase**.
- Reading text (message bodies, ticket descriptions) `--text-md`/15px, line-height 1.55, max ~70ch.
- Figures: `.num` / `.fig` → Geist Mono tabular.

## Components

- **Button** — primary: highlight fill, white label, 36px (30px small), radius 6, lifts 1px on hover, presses 1px on active. Secondary: cotton with `--edge-stock`. Ghost: transparent, paper-3 on hover. Destructive: error text, error-wash on hover. All eight states: default, hover, focus-visible, active, disabled (opacity .5, no pointer), loading (spinner replaces icon, label stays), error, success.
- **Segmented control** (2–4 options: scope, tabs inside a card): a groove (`--press-groove`, paper-2) with a cotton card riding in it to the chosen stop.
- **Tabs** (page-level): text tabs with a 2px ink underline on the current one; count in a mono pill.
- **Input / select** — 36px, radius 6, 1px `--color-rule-2`, cotton fill; focus ring highlight.
- **Chip / filter** — 28px, radius 8, rule-2 border; selected = highlight fill, white label. A count inside is mono.
- **Card** — cotton, radius 8, `--edge-stock` + `--cast-stock`, 16px padding, head row 600 + quiet meta at right. Never a card inside a card (use a rule or a paper-2 well).
- **Table** — sticky head in paper-2, heads ink-3 `--text-xs` 500 sentence case, rows 40px (compact 32px), hairline rules, hover paper-2, selected row hl-wash with a 3px highlight left mark. Numbers right-aligned mono.
- **Badge / state** — text + a small square swatch of its category colour (not colour alone); `-wash` background only for error/warn/ok states.
- **Avatar** — 24px circle, initials on a hue derived from the name at fixed L/C.
- **Popover / menu / dialog / drawer** — cotton, `--cast-pop`, radius 8; scrim `--scrim`; drawer slides with `transform`.
- **Toast** — board fill, bottom centre, auto-dismiss 3s, one action max.
- **Empty / loading / error** — every data region: skeleton in the shape of what's coming; empty = what belongs here + the one action; error = what broke + retry.

## Shell

- Both modules share one **module switch**: the left rail top shows the two modules (Telegram Inbox, YouTrack) as a segmented choice with the current one pressed; on narrow screens it becomes the first item of the menu. Switching uses a cross-document view transition.
- Header: page title left, the module's controls right, 56px, paper ground, one hairline under.
- Sidebar ≤ 248px, collapses to a 64px rail (icons + tooltips) by `transform`/opacity, never by animating width; under 60rem it becomes an off-canvas sheet.
- Theme toggle: one key `localStorage.theme` = `light` | `dark` shared by both modules (default: OS preference); the root carries both `class="dark"` and `data-theme`.

## Accessibility floor

Contrast ≥ 4.5:1 body, 3:1 large text and UI; focus visible instantly; status never by colour alone; hit targets 44px; keyboard paths kept (j/k/r/x/a, `/`, Ctrl/⌘K, Esc); `prefers-reduced-motion` honoured; content readable without animation.

## Don'ts

Purple/blue gradients, glow, radial background blobs (the one allowed gradient is the faint linear `--ground-wash` on the ground, plus the selected-row wash fade), emoji as icons, uppercase tracked labels, middle-dot meta strings, decorative status dots, KPI walls with icon tiles, card-in-card, `transition: all`, `overflow-x: hidden`, `100vw`, colour literals outside the token files.
