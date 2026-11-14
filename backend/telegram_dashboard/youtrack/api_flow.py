"""A ticket's UI flow (/api/yt/flow*, /api/yt/ai/flow): read / save the attachment, Zeplin shots, AI render jobs."""

import asyncio
import json
import logging
import re
import time

from fastapi import Query, Request, Response

from .. import providers, zeplin
from ..ai import data_json, json_object
from ..ai_jobs import JOB_ID
from ..ai_run import flow_metrics
from ..links import ISSUE, _ours
from ..models import FlowJobDTO, FlowScopeDTO
from . import flow as uiflow
from . import flow_prompt
from .api_ai import _ai, background
from .client import YtError, YtUnreachable
from .schemas import AiFlow, FlowSave, FlowShots, _issue_id
from .service import YouTrackDashboard

log = logging.getLogger(__name__)

OWN_FLOW = 4000  # a description this long (or with a "Luồng màn" tree) is the story itself, not a pointer to one


def _clean(body: FlowSave) -> tuple[str, uiflow.Flow]:
    i = _issue_id(body.id)
    try:
        return i, uiflow.clean(body.flow, i)
    except ValueError:
        raise YtError(400, "UI flow không hợp lệ") from None


def _job_id(job_id: str) -> None:
    if not JOB_ID.fullmatch(job_id):
        raise YtError(400, "Mã lượt AI không hợp lệ")


def register(r, svc: YouTrackDashboard) -> None:
    @r.get("/flow")
    async def get_flow(issue: str = Query()):
        i = _issue_id(issue)
        svc.need_token()
        cur = await svc.flow_file(i)
        if cur is None:
            return {"att": None, "flow": None, "broken": False}
        att, flow, newer = cur
        return {"att": att, "flow": flow and flow.model_dump(), "broken": flow is None, "ticket_newer": newer}

    shots = svc.shots

    @r.post("/flow/shots")
    async def flow_shots(body: FlowShots):
        """The Zeplin screens a flow links: image URL, design size, where its texts / buttons sit (no AI, cached)."""
        try:
            got, missing = await shots.get([u for u in body.urls if providers.ZEPLIN.fullmatch(u)])
        except zeplin.ZeplinError as e:
            raise YtError(502, str(e)) from None
        return {"shots": {u: {k: v for k, v in x.items() if k != "texts"} for u, x in got.items()}, "missing": missing}

    @r.get("/flow/image")
    async def flow_image(u: str = Query(max_length=2000)):
        """One Zeplin image, same-origin, so the page can compress it into the file it saves."""
        try:
            data, kind = await zeplin.image(u)
        except zeplin.ZeplinError as e:
            raise YtError(502, str(e)) from None
        return Response(data, media_type=kind, headers={"Cache-Control": "private, max-age=86400"})

    flow_lock = asyncio.Lock()  # ponytail: one for every ticket, saves are rare; other users still race on YouTrack

    @r.post("/flow")
    async def save_flow(body: FlowSave, request: Request):
        """Save the ticket's UI flow as a new attachment, only over the version the user opened (409 otherwise);
        then drop the old file and comment what changed. Those two steps failing only warn: the new file is in."""
        i, new = _clean(body)
        svc.need_token()
        async with flow_lock:
            auth = svc._flow_auth
            cur = await svc.flow_file(i)
            old_id, old = cur[:2] if cur else (None, None)
            if old_id != body.base:
                raise YtError(409, "UI flow vừa được người khác cập nhật — mở lại để xem bản mới")
            ch = uiflow.changes(old, new)
            if not ch:
                raise YtError(400, "Không có thay đổi")
            new.rev = (old.rev if old else 0) + 1
            try:
                engine = (request.app.state.settings.static_dir / "uiflow.js").read_text(encoding="utf-8")
            except OSError:
                raise YtError(503, "Thiếu uiflow.js — build lại web") from None
            name = uiflow.NAME.format(issue=i)
            try:
                html = uiflow.build_html(new, engine, body.shots).encode()
            except ValueError as e:
                raise YtError(400, str(e)) from None
            try:
                try:
                    att, stored = await svc.upload(i, name, html, mime="text/html")
                except YtUnreachable:  # YouTrack may have stored it: never let a blind retry add a second file
                    raise YtError(502, "Không rõ đã lưu chưa — mở lại UI flow để kiểm tra trước khi lưu lại") from None
                if stored != name:  # renamed on upload: no read would ever find it (and every save would 409)
                    msg = "YouTrack lưu tệp dưới tên khác — chưa cập nhật được, UI flow trên ticket giữ nguyên"
                    try:  # take it back out; the old file is left as it was
                        await svc.detach(i, att)
                    except YtError as e:
                        raise YtError(502, f"{msg}. Chưa xoá được tệp thừa {stored}: {e.message}") from None
                    raise YtError(502, msg)
                svc.seed_flow(i, att, len(html), new, auth=auth)
                warn = ["Đã thay file UI flow hỏng trên ticket"] if old_id and old is None else []
                if old_id:
                    try:
                        await svc.detach(i, old_id)
                    except YtError as e:
                        warn.append(f"Đã tải bản mới nhưng chưa xoá được file cũ: {e.message}")
                head = f"UI flow {'mới' if new.rev == 1 else 'cập nhật'} (rev {new.rev}) — tệp đính kèm {name}"
                more = [f"- … và {len(ch) - 20} thay đổi khác"] if len(ch) > 20 else []
                try:
                    await svc.comment(i, "\n".join([head, *(f"- {c}" for c in ch[:20]), *more]))
                except YtError as e:
                    warn.append(f"Đã tải bản mới nhưng chưa post được comment: {e.message}")
            finally:
                svc.stale(i)
        return {"att": att, "rev": new.rev, "changes": ch, "warn": ". ".join(warn)}

    @r.post("/flow/diff")
    async def flow_diff(body: FlowSave):
        """What "Cập nhật" would write in its comment, against the file on the ticket now; nothing is written."""
        i, new = _clean(body)
        svc.need_token()
        cur = await svc.flow_file(i)
        att, old = cur[:2] if cur else (None, None)
        return {"changes": uiflow.changes(old, new), "base_changed": att != body.base}

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

    @r.post("/ai/flow")
    async def ai_flow(body: AiFlow, request: Request):
        """One AI run turns the ticket (AC, rules, Zeplin links) into UI flow data: cleaned, rev 0, not saved."""
        i = _issue_id(body.id)
        job_id = request.headers.get("x-ai-job", "")
        scope = svc.flow_scope()

        async def work(on_text=None, detached=False):
            # each stage as a {"kind": "stage"} step: the dialog shows what is read, drawn and checked, and how far
            def say(**e):
                if e.get("stage") == "metrics":
                    log.info("UI flow metrics %s", json.dumps(e))
                    return
                if on_text:
                    on_text({"kind": "stage", "at": round(time.time(), 1), **e})

            metrics = {}
            flow_metrics.set(metrics)
            began = time.perf_counter()
            mark = began
            say(stage="ticket", id=i)
            svc.need_token()
            detail = await svc.issue_detail(i)
            ticket = data_json(flow_prompt.source(detail))
            own = detail.get("description") or ""
            ids = []
            if "Luồng màn" not in own and len(own) <= OWN_FLOW:
                ids = [t["id"] for relation in detail.get("links", [])
                       if relation["rel"].lower() == "subtask of" for t in relation["issues"]]
                ids += [m[2].upper() for m in ISSUE.finditer(own) if _ours(svc, m[1])]
            ids = [sid for sid in dict.fromkeys(ids) if sid != i]
            parts = []
            for sid in ids:
                try:
                    parent = await svc.issue_detail(sid)
                except YtError as error:
                    if error.status not in (403, 404):
                        raise
                    parts.append(f"<story>{sid}: dashboard không đọc được ticket này ({error.status})</story>")
                else:
                    parts.append("<story>\n" + data_json(flow_prompt.source(parent)) + "\n</story>")
            story = "".join("\n" + part for part in parts)
            say(stage="ticket", id=i, done=True, chars=len(ticket) + len(story),
                stories=re.findall(r'<story>\s*\{"id":\s*"([^"]+)"', story),  # "id" is _ticket_json's first key
                lost=re.findall(r"<story>(\S+): dashboard không đọc được", story))  # fmt: skip
            # the texts of each linked Zeplin screen, read here (REST, cached): the AI used to open every screen through
            # the Zeplin MCP, 100-200 KB of layers each, minutes per render. No token / Zeplin down: AC only, as before
            urls = list(dict.fromkeys(zeplin.canonical(u) for u in providers.ZEPLIN.findall(f"{ticket}{story}")))
            if len(urls) > uiflow.MAX_SCREENS:
                raise YtError(413, "Nguồn có hơn 60 màn; thu hẹp phạm vi trước khi vẽ")
            say(stage="metrics", phase="ticket", elapsed_ms=round((time.perf_counter()-mark)*1000),
                bytes=len((ticket + story).encode()))
            mark = time.perf_counter()
            read = 0

            def ready(k: int):
                nonlocal read
                read += k
                say(stage="zeplin", n=read, of=len(urls))

            say(stage="zeplin", n=0, of=len(urls))
            try:
                got, missing = await shots.get(urls, done=ready) if urls else ({}, [])
            except zeplin.ZeplinError as e:
                log.info("UI flow render without Zeplin texts: %s", e)
                got, missing = {}, urls
                say(stage="zeplin", n=read, of=len(urls), done=True, error=str(e))
            else:
                texts = sum(1 for x in got.values() if x.get("texts"))
                say(stage="zeplin", n=len(urls), of=len(urls), done=True, texts=texts, missing=len(missing))
            design = {u: x["texts"] for u, x in got.items() if x.get("texts")}
            try:
                payload = flow_prompt.build(ticket, story, body.note, got, deep=body.deep)
            except flow_prompt.BudgetExceeded as error:
                raise YtError(413, str(error)) from None
            if missing:
                payload.warnings.append(f"Không đọc được thiết kế của {len(missing)} màn; "
                                        "kiểm tra tên màn và nút trước khi cập nhật.")
                payload.manifest["omitted"].append({"source": "zeplin", "kind": "unavailable_design",
                                                    "count": len(missing)})
            prompt = payload.prompt
            say(stage="metrics", phase="zeplin", elapsed_ms=round((time.perf_counter()-mark)*1000),
                screens=len(urls), bytes=len(data_json(design).encode()),
                cache_hits=metrics.get("cache_hits", 0), cache_misses=metrics.get("cache_misses", 0),
                requests=metrics.get("requests", 0), response_bytes=metrics.get("response_bytes", 0))
            say(stage="metrics", phase="prompt", parts={"ticket": len(ticket), "story": len(story),
                "labels": len(data_json(design)), "note": len(body.note)}, bytes=len(prompt.encode()),
                estimated_input_tokens=payload.manifest["estimated_input_tokens"],
                estimated_payload_tokens=payload.manifest["estimated_payload_tokens"], token_measurement="estimated")
            mark = time.perf_counter()
            start = {"stage": "ai", "deep": body.deep, "chars": len(prompt), "screens": len(urls)}
            say(**start)
            seen = uiflow.Progress()

            # the JSON as it is written: told as the screens / links it holds so far. Only stage steps reach the page:
            # raw deltas would make each replay (a reopened dialog) thousands of items
            def on_ai(t):
                nonlocal seen
                if isinstance(t, dict):  # a tool step (the Zeplin MCP): shown as it is
                    on_text(t)
                elif t is None:  # every message starts with one (Claude): a restart only once text was written
                    if seen.text:
                        seen = uiflow.Progress()
                        say(**start, again=True)
                else:
                    for e in seen.feed(t):
                        say(**e)

            if svc.flow_scope() != scope:
                raise YtError(409, "Tài khoản đã đổi; mở lại lượt vẽ trong tài khoản ban đầu")
            out = await _ai(svc, request, prompt, heavy=body.deep, on_text=on_ai if on_text else None, notes=False,
                            detached=detached, retry=False)  # fmt: skip
            usage = metrics.get("usage")
            usage = {k: v for k, v in usage.items() if isinstance(v, (int, float))} if isinstance(usage, dict) else None
            say(stage="metrics", phase="ai", elapsed_ms=round((time.perf_counter()-mark)*1000),
                bytes=len(out.encode()), actual_usage=usage)
            mark = time.perf_counter()
            say(stage="check", chars=len(out))
            raw = json_object(out)
            try:
                flow = uiflow.merge_ai(raw, payload.skeleton, i)
            except ValueError, TypeError, AttributeError:  # unreadable answer, or a shape clean refuses
                raise YtError(502, "AI trả về không đọc được, thử lại") from None
            flow.rev = 0  # whatever the AI wrote: the dialog saves over the version it opened
            for s in flow.screens:
                s.x = s.y = None  # the layout is the dialog's job
            kept = {}
            old = None
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
                    payload.warnings.append(f"Không đọc được file trên ticket để giữ chỉnh tay: {e.message}")
            if old is not None:
                flow, kept = uiflow.keep_manual(old, flow)
            dropped = len(raw.get("links") or []) - len(flow.links)  # raw: a dict, clean took it
            say(stage="check", done=True, screens=len(flow.screens), links=len(flow.links), dropped=max(0, dropped))
            if svc.flow_scope() != scope:
                raise YtError(409, "Tài khoản đã đổi; mở lại lượt vẽ trong tài khoản ban đầu")
            manifest = {**payload.manifest, "kept": kept}
            result = {"flow": flow.model_dump(), "manifest": manifest, "warnings": payload.warnings}
            if job_id and svc.flow_jobs:
                await svc.flow_jobs.update(scope, job_id, checkpoint=flow.model_dump(),
                                           result=result, stage="validated")
            say(stage="metrics", phase="validate", elapsed_ms=round((time.perf_counter()-mark)*1000),
                total_ms=round((time.perf_counter()-began)*1000))
            return result

        # with X-Ai-Job the render goes on when the dialog closes; the page reads it again by its id
        # one render per ticket: a new one stops the older (a reload / reopen that started over), not two CLIs
        if job_id and svc.flow_jobs:
            _job_id(job_id)
            got = await svc.flow_jobs.start(scope, job_id, i, body.base,
                                           lambda on_text: work(on_text, detached=True),
                                           request={"note": body.note, "deep": body.deep})
            if got is None:
                raise YtError(409, "Mã lượt AI đã dùng; nối lại lượt hiện có")
            return got
        return background(svc, request, work, key=f"flow:{i}") or await work()
