# UI flow phases 3–4

Implemented on `features/refactor-ui-diagram`, continuing the uncommitted phases 0–2. No release, commit, push or real-provider run is implied.

## Phase 3

Flow input uses its own payload, deduplicated sources and whole JSON units. Mandatory description, AC/rules, correction comments and user notes remain intact. Optional design labels fit the remaining budget; a source manifest records omissions and uncertainty. The dialog displays this manifest and keeps it in its draft/recovered result.

The initial budgets remain 12,000/24,000 estimated input tokens for Nhanh/Kỹ. These are conservative heuristics, not provider tokenizer measurements or corpus-tuned optima. Overflow of mandatory data raises an explicit error before AI, asking for a narrower scope or Kỹ. There is no AI summary pass or automatic repair/retry.

Code creates stable screen/button IDs, canonical design URLs, known metadata and unambiguous structured relationships. The adapter asks AI for missing relationships/conditions, then merges and validates against the deterministic skeleton. Ambiguous text remains available to AI and produces a review warning. Schema stays v1; no search/hotspot/note features from later phases were added.

## Phase 4

- Zeplin uses one service-wide semaphore of four, canonical scoped inflight dedup, shielded subscriber cancellation and a 512-screen/one-hour cache. Token/config/account changes isolate cache entries; shutdown drains outstanding readers.
- Parsed attachments use a bounded cache keyed by fresh attachment identity and rights generation. Each read still checks metadata; a new identity loads HTML again. Save seeds parsed data; HTML/base64 is not retained by this cache. Cross-instance atomic save limitations from phase 0–2 remain.
- The image proxy reads upstream in bounded 64 KiB chunks, stopping at the byte cap regardless of content-length. It buffers at most the allowed image size before returning a successful response, so cap failures remain explicit errors. Cancellation closes response and client.
- Client packing allows three active image decodes across simultaneous saves. Completed data URI cache is limited to 64 entries/16 MiB. Failed encodes retry; image and canvas resources are released. No object URLs are created. Missing images preserve flow JSON and warn through the existing save UI.
- Renderer property commits reuse unchanged screen/link DOM and update incident link geometry. Camera, selection and coordinates survive image updates. No Canvas/WebGL rewrite or viewport culling was needed by the baseline.

## Synthetic performance

Same Apple M5/24 GB/arm64, headless Chromium 156, 1440×900, 5/20/60-screen datasets. Raw samples: `uiflow-phase4-before.json`, `uiflow-phase4-after.json`. One cold/warm pair per size is a local baseline, not a statistical speed claim.

60 screens / 300 links, milliseconds (cold / warm):

| Stage | Before | After |
|---|---:|---:|
| Property commit | 4.4 / 5.6 | 3.7 / 4.6 |
| Gesture commit | 5.9 / 4.3 | 1.0 / 0.9 |
| Image pack | 120.5 / 0.2 | 209.6 / 0.2 |

Pan/drag p95 remained about 17 ms, below the 32 ms baseline target. Cold packing slows under the decode cap; the benefit is bounded concurrency and memory. No real AI latency/token or YouTrack/Zeplin network improvement is claimed. Search does not exist yet; existing focus/highlight uses the current renderer without rebuilding flow.

## Verification

Final test results are recorded below. All production builds and browser tests run in scratch at `/tmp/uiflow-integration-2IfIB5`, app/control ports 8873/8874. The running app's `web/out` and port 8765 are untouched during this task.

Synthetic source corpus (`tests/test_flow_prompt.py`, raw `uiflow-phase3-corpus.json`):

| Screens / links retained | Before estimated payload tokens | After estimated total input tokens |
|---|---:|---:|
| 5 / 4 | 26,929 | 11,997 |
| 20 / 19 | 105,125 | 11,983 |
| 60 / 59 | 313,672 | 11,992 |

The baseline includes unbounded synthetic decorative labels; these reductions do not predict typical ticket savings. Each case keeps its mandatory condition text and all deterministic screens/edges after adapter merge. The after estimate includes a 2,048-token envelope allowance within the selected budget, plus a 6,144-token output reserve against an assumed 32,768 context floor. Context capacity is an explicit conservative assumption, not provider metadata detection. Real-provider quality/coverage calibration remains unverified.

Integration browser run: **107 passed**, 1.4 min, including source warning/draft recovery, page-wide pack concurrency/cache/cleanup, unchanged-node commits and late-image camera/selection preservation. Scratch production build, generated API types, typecheck and ESLint passed. No real AI or YouTrack write was used. No `WORKING-CONTEXT.md` exists in this repository.

Final combined Python verification: **191 passed**, 4.68 s (`test_flow_prompt`, `test_flow_jobs`, `test_flow_cache`, `test_uiflow`, `test_yt_dashboard`, `test_ai`, `test_repo_guards`, `test_storage_sync`). Changed Python modules/tests Ruff and final diff check passed. CodeGraph sync completed. `web/out` remained byte-identical to the artifact present at task start.
