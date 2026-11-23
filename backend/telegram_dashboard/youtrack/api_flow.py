"""A ticket's UI flow render (/api/yt/flow/precheck, /api/yt/ai/flow*, /api/yt/flow/jobs*): what a render sends, the AI
run and its jobs. The file itself (read, save, delete, export, Zeplin shots) is in api_flow_file.py."""

import asyncio
import json
import logging
import re
import tempfile
import time

from fastapi import Query, Request

from .. import providers, zeplin
from ..ai import data_json, json_object
from ..ai_jobs import JOB_ID
from ..ai_run import flow_metrics
from ..claude import claude_runs
from ..links import ISSUE, _ours
from . import flow as uiflow
from . import flow_changes, flow_locate, flow_merge, flow_prompt
from .api_ai import _ai, _feature, background
from .client import YtError
from .flow_models import FlowCheckDTO, FlowJobDTO, FlowRiskDTO, FlowScopeDTO
from .schemas import AiFlow, FlowAsk, FlowPrecheck, _issue_id
from .service import YouTrackDashboard

log = logging.getLogger(__name__)

PART_RUNS = 3  # parts of a split render run at once: faster, without flooding the CLI / quota
COST_DAYS = 30  # the run log read for a render's $ estimate
OWN_FLOW = 4000  # a description this long (or with a "Luồng màn" tree) is the story itself, not a pointer to one


def _story_ids(svc: YouTrackDashboard, detail: dict, i: str) -> list[str]:
    """The stories a ticket points to (its parent, the tickets its description names), unless its own description
    already is the story (long, or with a "Luồng màn" tree). Shared by the render and the Markdown export."""
    own = detail.get("description") or ""
    ids = []
    if "Luồng màn" not in own and len(own) <= OWN_FLOW:
        ids = [t["id"] for relation in detail.get("links", []) if relation["rel"].lower() == "subtask of"
               for t in relation["issues"]]
        ids += [m[2].upper() for m in ISSUE.finditer(own) if _ours(svc, m[1])]
    return [sid for sid in dict.fromkeys(ids) if sid != i]


def _job_id(job_id: str) -> None:
    if not JOB_ID.fullmatch(job_id):
        raise YtError(400, "Mã lượt AI không hợp lệ")


def register(r, svc: YouTrackDashboard) -> None:
    shots = svc.shots

    @r.get("/flow/scope")
    async def flow_scope() -> FlowScopeDTO:
        return {"scope": svc.flow_scope()}

    @r.get("/flow/jobs")
    async def flow_jobs(issue: str | None = None) -> list[FlowJobDTO]:
        return await svc.flow_jobs.call("flow_job_get", svc.flow_scope(), issue=_issue_id(issue) if issue else None)

    async def flow_job_required(job_id):
        _job_id(job_id)
        got = await svc.flow_jobs.get(svc.flow_scope(), job_id)
        if got is None:
            raise YtError(404, "Không tìm thấy lượt vẽ trong tài khoản này")
        return got

    @r.get("/flow/jobs/{job_id}")
    async def flow_job_status(job_id: str) -> FlowJobDTO:
        return await flow_job_required(job_id)

    @r.get("/flow/jobs/{job_id}/events")
    async def flow_job_events(job_id: str, after: int = Query(0, ge=0)):
        await flow_job_required(job_id)
        return svc.flow_jobs.stream(svc.flow_scope(), job_id, after)

    @r.delete("/flow/jobs/{job_id}")
    async def flow_job_cancel(job_id: str) -> FlowJobDTO:
        _job_id(job_id)
        return await svc.flow_jobs.cancel(svc.flow_scope(), job_id)

    @r.post("/flow/jobs/{job_id}/processed")
    async def flow_job_processed(job_id: str) -> FlowJobDTO:
        await flow_job_required(job_id)
        await svc.flow_jobs.update(svc.flow_scope(), job_id, processed=True)
        return await flow_job_required(job_id)

    async def gather(i: str, note: str, say=lambda **e: None, previous: dict | None = None, draw=None,
                     target="mobile", *, links: bool = True):
        """Ticket + stories + linked Zeplin texts -> the prompt (whole, with its risks). Shared by the render, the
        pre-check and the advice: the reads are cached and shared while in flight, so a render pressed during the
        pre-check waits on the same Zeplin reads, and leaves out the other platform from them itself (`target`)."""
        metrics = {}
        flow_metrics.set(metrics)
        mark = time.perf_counter()
        say(stage="ticket", id=i)
        svc.need_token()
        detail = await svc.issue_detail(i)
        ticket = data_json(flow_prompt.source(detail))
        ids = _story_ids(svc, detail, i)

        async def read(sid):
            try:
                return "<story>\n" + data_json(flow_prompt.source(await svc.issue_detail(sid))) + "\n</story>"
            except YtError as error:
                if error.status not in (403, 404):
                    raise
                return f"<story>{sid}: dashboard không đọc được ticket này ({error.status})</story>"

        story = "".join("\n" + part for part in await asyncio.gather(*map(read, ids)))  # stories at once, in order
        say(stage="ticket", id=i, done=True, chars=len(ticket) + len(story),
            stories=re.findall(r'<story>\s*\{"id":\s*"([^"]+)"', story),  # "id" is _ticket_json's first key
            lost=re.findall(r"<story>(\S+): dashboard không đọc được", story))  # fmt: skip
        # the texts of each linked Zeplin screen, read here (REST, cached). No token / Zeplin down: AC only, as before
        urls = list(dict.fromkeys(zeplin.canonical(u) for u in providers.ZEPLIN.findall(f"{ticket}{story}")))
        if len(urls) > uiflow.MAX_SCREENS:
            raise YtError(413, f"Nguồn có hơn {uiflow.MAX_SCREENS} màn; tách ticket trước khi vẽ")
        say(
            stage="metrics",
            phase="ticket",
            elapsed_ms=round((time.perf_counter() - mark) * 1000),
            bytes=len((ticket + story).encode()),
        )
        mark = time.perf_counter()
        read_n = 0

        def ready(k: int):
            nonlocal read_n
            read_n += k
            say(stage="zeplin", n=read_n, of=len(urls))

        say(stage="zeplin", n=0, of=len(urls))
        try:
            got, missing = await shots.get(urls, done=ready) if urls else ({}, [])
        except zeplin.ZeplinError as e:
            log.info("UI flow render without Zeplin texts: %s", e)
            got, missing = {}, urls
            say(stage="zeplin", n=read_n, of=len(urls), done=True, error=str(e))
        else:
            texts = sum(1 for x in got.values() if x.get("texts"))
            say(stage="zeplin", n=len(urls), of=len(urls), done=True, texts=texts, missing=len(missing))
        try:
            payload = flow_prompt.build(ticket, story, note, got, previous=previous, draw=draw, target=target,
                                        links=links)  # fmt: skip
        except flow_prompt.BudgetExceeded as error:
            raise YtError(413, str(error)) from None
        payload.shots = got
        if missing:
            payload.warnings.append(
                f"Không đọc được thiết kế của {len(missing)} màn; kiểm tra tên màn và nút trước khi cập nhật."
            )
            payload.manifest["omitted"].append(
                {"source": "zeplin", "kind": "unavailable_design", "count": len(missing)}
            )
        say(
            stage="metrics",
            phase="zeplin",
            elapsed_ms=round((time.perf_counter() - mark) * 1000),
            screens=len(urls),
            cache_hits=metrics.get("cache_hits", 0),
            cache_misses=metrics.get("cache_misses", 0),
            requests=metrics.get("requests", 0),
            response_bytes=metrics.get("response_bytes", 0),
        )
        say(
            stage="metrics",
            phase="prompt",
            parts=payload.manifest["parts"],
            bytes=len(payload.prompt.encode()),
            estimated_input_tokens=payload.manifest["estimated_input_tokens"],
            estimated_payload_tokens=payload.manifest["estimated_payload_tokens"],
            token_measurement="estimated",
        )
        return payload, metrics, len(urls)

    async def _check(payload, request: Request) -> FlowCheckDTO:
        m = payload.manifest
        ai = getattr(request.app.state, "ai", None)  # an app without the AI service: the counts, no $ estimate
        model, usd, runs = "", None, 0
        if ai is not None:
            model = providers.run_choice(ai.settings, task=True, yt=True)[0]  # the render's model: heavy YouTrack pick
            rows = await asyncio.to_thread(claude_runs, ai.settings, COST_DAYS)
            usd, runs = flow_prompt.cost(rows, model, m["estimated_input_tokens"], m["screens"])
        return FlowCheckDTO(
            tokens=m["estimated_input_tokens"],
            parts=m["parts"],
            screens=m["screens"],
            links=m["links"],
            risks=[FlowRiskDTO(**x) for x in m["risks"]],
            warnings=payload.warnings,
            model=model,
            cost_usd=usd,
            cost_runs=runs,
            chunks=m["chunks"],
            split_tokens=flow_prompt.split_tokens(payload) if m["chunks"] > 1 else 0,
        )

    @r.post("/flow/precheck")
    async def flow_precheck(body: FlowPrecheck, request: Request) -> FlowCheckDTO:
        """What a render will send, counted by code (no AI, no token): the dialog warns before a costly run."""
        payload, _, _ = await gather(_issue_id(body.id), body.note, target=body.target)
        return await _check(payload, request)

    @r.post("/ai/flow/advice")
    async def flow_advice(body: FlowPrecheck, request: Request):
        """A light model reads the pre-check's numbers (never the ticket's text): why it is costly, what to do."""
        check = await _check((await gather(_issue_id(body.id), body.note, target=body.target))[0], request)
        # numbers only, as ADVICE says: the risks' lines and the warnings quote the ticket / Zeplin titles
        nums = check.model_dump(exclude={"risks": {"__all__": {"lines"}}, "warnings": True})
        prompt = f"{flow_prompt.ADVICE}\n<check>{data_json(nums)}</check>"
        return {"text": await _ai(svc, request, prompt, heavy=False, notes=False, retry=False,
                                  feature=_feature("flow-advice"))}  # fmt: skip

    @r.post("/ai/flow/ask")
    async def flow_ask(body: FlowAsk, request: Request):
        """The pre-check's Q&A: a light model reads the unclear lines (numbered as shown) and the screen names, then
        the thread and the question; it explains and rewrites lines. Its answers go into the render's note."""
        payload = (await gather(_issue_id(body.id), body.note, target=body.target))[0]
        # every numbered line the dialog shows (unclear ones and the other platform's): any "#n" can be asked about
        lines = [ln for x in payload.manifest["risks"] for ln in x.get("lines") or []]
        flow = {"lines": lines, "screens": [s["title"] for s in payload.skeleton["screens"]]}
        turns = data_json([t.model_dump() for t in body.history])
        prompt = (
            f"{flow_prompt.FLOW_ASK}\n<flow>{data_json(flow)}</flow>\n<history>{turns}</history>"
            f"\n<ask>{body.question}</ask>"
        )
        return {"text": await _ai(svc, request, prompt, heavy=False, notes=False, retry=False,
                                  feature=_feature("flow-ask"))}  # fmt: skip

    @r.post("/ai/flow")
    async def ai_flow(body: AiFlow, request: Request):
        """Ticket (AC, rules, Zeplin links) -> UI flow data: cleaned, rev 0, not saved. "screens" mode: the design
        skeleton only, built by code (no AI, no token); "flow": one AI run adds the links, on the user's model."""
        i = _issue_id(body.id)
        job_id = request.headers.get("x-ai-job", "")
        scope = svc.flow_scope()

        async def by_parts(prompts, detached):
            """Each part one AI run, PART_RUNS at a time; a part's screens show as it lands. Any part failing
            fails the render (a flow with a hole is worse than a retry)."""
            gate, n, got = asyncio.Semaphore(PART_RUNS), len(prompts), []

            async def one(k, text):
                async with gate:
                    out = await _ai(svc, request, text, heavy=True, notes=False, detached=detached, retry=False,
                                    feature="flow")  # fmt: skip
                raw = json_object(out)
                if not isinstance(raw, dict) or not isinstance(raw.get("screens"), list):
                    raise YtError(502, f"Phần {k + 1}/{n}: AI trả về không đọc được; thử lại hoặc chọn model mạnh hơn")
                got.append(raw)
                items = sum(len(x.get("items") or []) for x in raw["screens"] if isinstance(x, dict))
                say_part(stage="draw", n=len(got), title=f"Phần {k + 1}/{n}", items=items)
                return raw

            runs = [asyncio.ensure_future(one(k, t)) for k, t in enumerate(prompts)]
            try:
                return flow_prompt.combine(await asyncio.gather(*runs))
            finally:  # one part failed: the others (running or still queued) stop, not burn quota on a dead render
                for run in runs:
                    run.cancel()

        say_part = lambda **e: None  # noqa: E731  set by work: the stage line of the run being drawn

        async def locate(flow, got, warnings, detached):
            """Buttons with no Zeplin layer: one AI run looks at the screen images and places them. It never fails
            the render: what it could not place is said in `warnings` and drawn by hand."""
            todo = flow_locate.missing(flow, got or {})
            if not todo:
                return
            n = sum(len(items) for _, items in todo)
            say_part(stage="check", locate=n)
            placed, why = 0, ""
            try:
                with tempfile.TemporaryDirectory(prefix="tgd-flow-") as tmp:  # a folder holding only these images
                    prompt, files = await flow_locate.save(todo[: flow_locate.MAX_SCREENS], tmp)
                    if files:
                        out = await _ai(svc, request, prompt, notes=False, detached=detached, retry=False,
                                        read_dir=tmp, feature="flow")  # fmt: skip
                        placed = flow_locate.apply(json_object(out), files)
            except YtError as e:
                if e.status == 499:  # Hủy: the render stops, not just this step
                    raise
                why = f" ({e.message})"
            if placed < n:
                warnings.append(
                    f"{n - placed} nút không có layer trên Zeplin và AI chưa tìm được vị trí trên ảnh{why}: "
                    "vẽ vùng bấm bằng tay."
                )

        async def work(on_text=None, detached=False):
            # each stage as a {"kind": "stage"} step: the dialog shows what is read, drawn and checked, and how far
            def say(**e):
                if e.get("stage") == "metrics":
                    log.info("UI flow metrics %s", json.dumps(e))
                if on_text:
                    on_text({"kind": "stage", "at": round(time.time(), 1), **e})

            nonlocal say_part
            say_part = say
            began = time.perf_counter()
            old, lost = None, ""
            if body.keep:  # the flow on screen, unsaved edits included
                try:
                    old = uiflow.clean(body.keep, i)
                except ValueError:
                    old = None
            elif body.base:  # a resumed run (no flow sent): the file it started from
                try:
                    cur = await svc.flow_file(i)
                    old = cur[1] if cur and cur[0] == body.base else None
                except YtError as e:  # the render itself is fine: say what was not carried over, do not fail it
                    lost = f"Không đọc được file trên ticket để giữ chỉnh tay: {e.message}"
            # "Chỉ vẽ phần mới": the AI starts from the flow on screen and writes only what is new
            previous = old.model_dump() if old is not None and body.reuse and body.mode == "flow" else None
            payload, metrics, screens = await gather(i, body.note, say, previous, draw=body.draw, target=body.target,
                                                     links=body.mode == "flow")  # fmt: skip
            mark = time.perf_counter()
            if body.mode == "screens":
                say(stage="check", chars=0)
                try:
                    # the screens' UI only: no buttons from the ticket's flow lines, no links (those are "flow")
                    shown = [{**x, "items": []} for x in payload.skeleton["screens"]]
                    flow = uiflow.clean({**payload.skeleton, "screens": shown, "links": []}, i)
                except ValueError:
                    raise YtError(
                        422, 'Ticket chưa có màn Zeplin hay cây Luồng màn để dựng; chọn "Màn + liên kết" để AI đọc AC'
                    ) from None
                raw = {"links": []}
            else:
                prompt = payload.prompt
                start = {
                    "stage": "ai",
                    "chars": len(prompt),
                    "screens": screens,
                    "estimated_input_tokens": payload.manifest["estimated_input_tokens"],
                }
                say(**start)
                # the screens as the prompt names them (short ids): a link is told in their titles and labels
                known = {x["id"]: (x.get("title") or x["id"], {b["id"]: b.get("label") or b["id"] for b in x["items"]})
                         for x in (payload.shown or payload.skeleton)["screens"]}  # fmt: skip
                seen = uiflow.Progress(known)

                # the JSON as it is written: told as the screens / links it holds so far. Only stage steps reach the
                # page: raw deltas would make each replay (a reopened dialog) thousands of items
                def on_ai(t):
                    nonlocal seen
                    if isinstance(t, dict):  # a tool step (the Zeplin MCP): shown as it is
                        on_text(t)
                    elif t is None:  # every message starts with one (Claude): a restart only once text was written
                        if seen.text:
                            seen = uiflow.Progress(known)
                            say(**start, again=True)
                    else:
                        for e in seen.feed(t):
                            say(**e)

                if svc.flow_scope() != scope:
                    raise YtError(409, "Tài khoản đã đổi; mở lại lượt vẽ trong tài khoản ban đầu")
                prompts = flow_prompt.split(payload) if body.split else [prompt]
                if len(prompts) > 1:  # "Chia phần": the parts at once (PART_RUNS), joined into one answer
                    out = json.dumps(await by_parts(prompts, detached))
                else:  # the user's own model / effort (the heavy picks: a long read), whatever the size: warned
                    out = await _ai(svc, request, prompt, heavy=True, on_text=on_ai if on_text else None,
                                    notes=False, detached=detached, retry=False, feature="flow")  # fmt: skip
                usage = metrics.get("usage")
                usage = (
                    {k: v for k, v in usage.items() if isinstance(v, (int, float))} if isinstance(usage, dict) else None
                )
                say(
                    stage="metrics",
                    phase="ai",
                    elapsed_ms=round((time.perf_counter() - mark) * 1000),
                    bytes=len(out.encode()),
                    actual_usage=usage,
                )
                mark = time.perf_counter()
                say(stage="check", chars=len(out))
                raw = json_object(out)
                try:
                    raw = flow_merge.unalias(raw, payload.back)  # the prompt's short ids -> the skeleton's own
                    flow = flow_merge.merge_ai(raw, payload.skeleton, i)
                except ValueError, TypeError, AttributeError:  # unreadable answer, or a shape clean refuses
                    raise YtError(502, "AI trả về không đọc được; thử lại hoặc chọn model / effort mạnh hơn") from None
            flow.rev = 0  # whatever was drawn: the dialog saves over the version it opened
            flow.device = body.target  # the frame of the platform picked: a web design is not drawn in a phone
            cuts = {zeplin.canonical(u): x.get("cut") for u, x in (payload.shots or {}).items()}
            # a note on the map, the flow's name: a person's, never the AI's (keep_manual carries the old file's)
            flow.memos, flow.title = [], ""
            for s in flow.screens:
                s.x = s.y = None  # the layout is the dialog's job
                # a long list shows its first screenful of items; a screen the flow already had: as it was (keep_manual)
                s.fold = cuts.get(zeplin.canonical(s.zeplin)) or None
            kept = {}
            if lost:
                payload.warnings.append(lost)
            if old is not None:
                flow, kept = flow_changes.keep_manual(old, flow)
            if body.mode == "flow":  # "screens" promises no AI, no token
                await locate(flow, payload.shots, payload.warnings, detached)
            # raw: a dict, clean took it. A link to a screen the model wrote but that has no design is not a broken
            # one: that screen is left out on purpose (AI_FLOW_PATCH), added from Zeplin once it has a design.
            # ponytail: by the model's own ids; a remapped legacy id counts as waiting
            ids = {x.id for x in flow.screens}
            own = {x.get("id") for x in raw.get("screens") or [] if isinstance(x, dict)} - ids
            asked = [x for x in raw.get("links") or [] if isinstance(x, dict)]
            waiting = sum(1 for x in asked if x.get("to") in own or str(x.get("src", "")).partition(".")[0] in own)
            dropped = len(asked) - waiting - len(flow.links)
            say(stage="check", done=True, screens=len(flow.screens), links=len(flow.links), dropped=max(0, dropped))
            if svc.flow_scope() != scope:
                raise YtError(409, "Tài khoản đã đổi; mở lại lượt vẽ trong tài khoản ban đầu")
            manifest = {**payload.manifest, "kept": kept, "mode": body.mode}
            result = {"flow": flow.model_dump(), "manifest": manifest, "warnings": payload.warnings}
            if job_id and svc.flow_jobs:
                await svc.flow_jobs.update(
                    scope, job_id, checkpoint=flow.model_dump(), result=result, stage="validated"
                )
            say(
                stage="metrics",
                phase="validate",
                elapsed_ms=round((time.perf_counter() - mark) * 1000),
                total_ms=round((time.perf_counter() - began) * 1000),
            )
            return result

        # with X-Ai-Job the render goes on when the dialog closes; the page reads it again by its id
        # one render per ticket: a new one stops the older (a reload / reopen that started over), not two CLIs
        if job_id and svc.flow_jobs:
            _job_id(job_id)
            got = await svc.flow_jobs.start(
                scope,
                job_id,
                i,
                body.base,
                lambda on_text: work(on_text, detached=True),
                request={"note": body.note, "mode": body.mode, "split": body.split, "target": body.target,
                         "draw": body.draw, "reuse": body.reuse},  # fmt: skip
            )
            if got is None:
                raise YtError(409, "Mã lượt AI đã dùng; nối lại lượt hiện có")
            return got
        return background(svc, request, work, key=f"flow:{i}") or await work()
