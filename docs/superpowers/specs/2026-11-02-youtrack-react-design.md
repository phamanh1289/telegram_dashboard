# YouTrack tab in React, Lead / Dev modes, AI per mode

## Goal
Move the YouTrack module (`web/public/yt`, vanilla JS) into the Next/React app so both modules share one top bar,
one Claude dialog, one settings dialog and one component set; add two working modes and AI help for each.
AI stays read-only: it returns text, it never writes to YouTrack or Telegram.

## Stack
Next 16 (static export) + React 19 + TanStack Query + Tailwind 4 tokens (`/design/tokens.css`) + `motion`.
No new dependency.

## Routes
- `/youtrack/` new page (`web/src/app/youtrack/page.tsx`). `trailingSlash` so FastAPI serves `out/youtrack/index.html`.
- `/yt/` (old) keeps working until the new page is accepted; the module switch points to `/youtrack/`.

## Shared shell (`components/shell.tsx`)
`TopBar` (module switch with a sliding pill, Claude quota → Claude dialog, theme, shared settings) and `Toaster`,
used by the Telegram inbox and YouTrack. `SharedSettingsDialog` takes `stream` as optional.

## Modes
Toggle in the sidebar, saved in localStorage and `?mode=`.
- **Dev**: home = "Hôm nay" (my open tickets ranked: blocked/overdue/critical/due soon/aging, with reasons),
  Ticket table defaults to "My task".
- **Lead**: home = "Brief" (attention strip, aging, WIP over limit, team AI brief), Dashboard first in the nav.
Same data, only default page and default filters differ.

## Pages (feature parity with /yt/)
- **Ticket**: search, AI filter sentence, priority / type / state chips with counts, sprint + people multi-selects,
  scope (My task / Android team / All), group (none / assignee / sprint / module), sort, columns, dense,
  show resolved, highlight High+, "mới" since last visit, copy ID / link, bulk pick (assignee + AI review),
  CSV export, 600-row cap with "Hiện thêm", empty state with global lookup by ID, hover description preview,
  keys `/` `⌘K` `j` `k` `x` `Enter` `Esc`.
- **Ticket sheet**: meta, assignee change with undo, description, links, Telegram mentions, comments + new comment,
  prev / next, AI (tóm tắt, đủ thông tin chưa + draft, vì sao kẹt, soạn trả lời), hand-off to Claude Code.
- **Dashboard**: every tile of the old one (attention, aging with state picker, KPIs, sprint progress, burndown,
  velocity, lead time, WIP with limit, QC load, state distribution, throughput, carry-over, bugs, flow, by user,
  readiness, bug/feature mix); every number opens its ticket list; AI report / review / release notes.
- TV mode and print.

## AI (backend `yt_dashboard.py`, all read-only)
- `ai/tickets` gains `kind: review | today`; `today` ranks one person's tickets into a day plan.
- `ai/data` gains `kind: ask` + `question`: answers a question from the dashboard numbers.
- `ai/ticket` gains `kind: reply`: drafts a reply to the latest comments.
- Home briefs are cached per day / project / mode in localStorage, so opening the tab does not spend quota;
  a "Làm mới" button reruns.

## Out of scope
`?mock=1` sample data (dev aid), AI that writes, scheduled runs.

## Verification
Typecheck, lint, Python tests for the new prompt kinds, browser check of `/youtrack/` against the running backend.
