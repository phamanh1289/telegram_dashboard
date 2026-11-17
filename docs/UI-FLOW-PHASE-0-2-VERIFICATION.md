# UI flow phases 0–2 — verification

Date: 2026-11-14. Branch: `features/refactor-ui-diagram`.

## Baseline

Source: `e6ad838` (fresh `origin/master`). Environment: macOS 27.0 arm64, Node/Chromium versions recorded with the browser dataset run below. Browser validation runs in scratch copies on separate ports. Port 8765 was not used. A root build mistake and restoration of `web/out` are recorded in the operational note below.

- `uv run pytest -q tests/test_uiflow.py tests/test_ai.py tests/test_repo_guards.py`: **77 passed**, 4.32 s.
- `npm run typecheck`: passed.
- Static build in `/tmp/uiflow-baseline-JvU3y3`: passed.
- Existing browser flow suites (`uiflow.spec.ts`, `flow-dialog.spec.ts`): **80 passed**, 58.2 s, ports 8871/8872.

## Measurement limits

Fixture timings are local code/browser timings. They do not establish real YouTrack upload latency, real Zeplin/network latency, AI quality, or provider tokens. No real ticket content, prompts, or images are recorded in default telemetry. Estimated input tokens must remain explicitly labelled as estimates. No latency/token reduction percentage is claimed for this milestone.

## Synthetic dataset timings

Artifacts: `uiflow-baseline-before.json` and `uiflow-baseline-after.json`; reproduce with `node web/tests/uiflow-benchmark.cjs`. One cold and one warm run per size, same Apple M5 / 24 GB / arm64 machine, headless Chromium 156.0.8078.4 at 1440×900. Times below are milliseconds. This sample count is a baseline, not a statistically established performance improvement.

| Screens / links | Before mount cold / warm | After mount cold / warm | Before pack cold / warm | After pack cold / warm | After drag frame p95 cold / warm |
|---|---:|---:|---:|---:|---:|
| 5 / 25 | 10.2 / 2.8 | 9.9 / 1.2 | 41.5 / 0.2 | 42.1 / 0 | 17.2 / 17.0 |
| 20 / 100 | 13.2 / 6.0 | 11.9 / 3.4 | 54.3 / 0 | 52.5 / 0.1 | 16.9 / 16.9 |
| 60 / 300 | 17.5 / 9.4 | 19.1 / 8.3 | 124.9 / 0 | 131.0 / 0.1 | 17.3 / 17.2 |

Cold synthetic image requests: 4 / 19 / 59; warm: zero. Each dataset deliberately has one screen without an image. Also covers branches, cycles, overlays, disconnected screens, tall images, duplicate labels and unmatched controls; separate malformed and legacy fixtures cover import failures.

## Implemented behavior

- SQLite migration stores scoped job metadata, original request options, cursor events, validated checkpoints and results. Terminal event/result/status commit together. Registration, replacement and cancellation serialize; a pre-start cancellation creates a tombstone. A failed event writer cancels its producer and exposes an error.
- Startup recovery revalidates complete checkpoints and completes code-only work. Other unfinished runs become interrupted, with an explicit AI retry action. Unresolved jobs are retained; processed terminal history expires after 30 days at startup. No service queue/dependency was added.
- IndexedDB drafts are scoped by server/account fingerprint and ticket, committed after 500 ms, with ordered writes, flushes on close/hide, error/Retry states and explicit discard. The fingerprint follows credentials; changing credentials isolates prior drafts rather than migrating them silently.
- Upload locks replacement; operation IDs reject stale completions. Drafts track uncertain uploads across reload and re-read attachment metadata before another attempt. Attachment conflicts preserve the draft. Existing cross-instance compare-and-swap limits remain.
- Closing disconnects only the subscriber. Reconnect uses an event cursor; cancelling keeps the ID until acknowledged. Restart retry preserves the original note and depth choice. Renderer failures retry from existing data without another AI call; cancelled gestures restore coordinates without an undo entry.

## Runtime measurements

Backend numeric-only `UI flow metrics` log entries cover ticket/story time and bytes, Zeplin cache hits/misses/requests/bytes, prompt character parts and UTF-8 bytes, AI time/output bytes, provider usage when supplied, and validation time. Character-derived input-token counts are labelled `estimated`; absent provider usage remains unavailable. Browser `performance` entries cover mount, pack and upload, with counts/bytes only. No ticket/prompt/image payload is written to this telemetry.

## Operational note

One build command was accidentally launched from the repository root and regenerated the ignored `web/out`. It was stopped; `web/out` was replaced with the original-source baseline scratch build and verified byte-for-byte identical to that baseline (60 files). This restores pre-change source behavior, not the exact pre-task build ID/artifact bytes. The app was not restarted and port 8765 was not used. All validation builds after that correction ran in scratch.


## Final checks

- Python: `uv run pytest -q tests/test_flow_jobs.py tests/test_uiflow.py tests/test_yt_dashboard.py tests/test_ai.py tests/test_repo_guards.py tests/test_storage_sync.py`: **169 passed**, 5.02 s.
- Chromium editor and integration: **96 passed** in the combined run (1.2 min); after the final lifecycle fixes, **24 dialog/renderer tests passed**, 58.4 s. The unchanged editor suite contains **76 tests** (100 distinct browser tests in total). Separate scratch app/control ports: 8873/8874.
- `npm run typecheck`, `npm run lint`, scratch production build, changed Python module Ruff, and `git diff --check`: passed.
- Browser regressions cover reload/autosave, quota write error and Retry, failed restoration, interrupted explicit resume, completed replacement recovery, delayed pre-start cancellation, cancellation network failure, save/render exclusion, edits during upload, focus/reconnect exclusion, conflicts and uncertain uploads. Renderer regression confirms Retry uses retained data with zero AI calls/uploads. Engine regressions cover cancelled gestures and partial-mount cleanup.
- Persistence tests exercise a new Store/service over the same SQLite file, startup checkpoints, incomplete AI state, account isolation, cursors, pre-start/concurrent cancellation, terminal atomicity, storage failure and retention. These are controlled restart tests, not an OS process crash test against real credentials.
- No real AI, real Zeplin or YouTrack writes were used for verification. No commit or push was requested/performed. No `WORKING-CONTEXT.md` exists in this repository.
