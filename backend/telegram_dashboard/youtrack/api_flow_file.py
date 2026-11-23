"""A ticket's UI flow file (/api/yt/flow, /flow/delete, /flow/html, /flow/md, /flow/shots, /flow/image): read, save
and remove the attachment, export it, read the Zeplin shots. The AI render and its jobs are in api_flow.py."""

import asyncio
import time

from fastapi import Query, Request, Response

from .. import providers, zeplin
from . import flow as uiflow
from . import flow_changes, flow_md, flow_prompt
from .api_flow import _story_ids
from .client import YtError, YtUnreachable, _me
from .schemas import FlowDelete, FlowHtml, FlowMd, FlowSave, FlowShots, _issue_id
from .service import YouTrackDashboard


def _clean(body: FlowSave) -> tuple[str, uiflow.Flow]:
    i = _issue_id(body.id)
    try:
        return i, uiflow.clean(body.flow, i)
    except ValueError:
        raise YtError(400, "UI flow không hợp lệ") from None


def _engine(request: Request) -> str:
    try:
        return (request.app.state.settings.static_dir / "uiflow.js").read_text(encoding="utf-8")
    except OSError:
        raise YtError(503, "Thiếu uiflow.js — build lại web") from None


async def _yours(svc: YouTrackDashboard, author: dict | None) -> bool:
    """The file was uploaded by the token's own user (or YouTrack does not say who): only then may it be replaced or
    removed. Anyone may still open, edit (a local draft) and download it."""
    return author is None or author["id"] == (await svc.cached("me", lambda: _me(svc))).get("id")


def _only_author(author: dict) -> YtError:
    return YtError(403, f"Chỉ {author['name']} (người lưu UI flow này) mới cập nhật / xoá được file trên ticket. "
                        "Bản bạn sửa vẫn giữ làm nháp trên máy.")  # fmt: skip


def register(r, svc: YouTrackDashboard) -> None:
    @r.get("/flow")
    async def get_flow(issue: str = Query()):
        i = _issue_id(issue)
        svc.need_token()
        cur = await svc.flow_file(i)
        if cur is None:
            return {"att": None, "flow": None, "broken": False}
        att, flow, newer, author = cur
        return {"att": att, "flow": flow and flow.model_dump(), "broken": flow is None, "ticket_newer": newer,
                "author": author, "yours": await _yours(svc, author)}  # fmt: skip

    shots = svc.shots

    @r.post("/flow/shots")
    async def flow_shots(body: FlowShots):
        """The Zeplin screens a flow links: image URL, design size, where its texts / buttons sit (no AI, cached)."""
        urls = [u for u in body.urls if providers.ZEPLIN.fullmatch(u)]
        try:  # `stale`: the last read of them all, when there is an older one, without waiting for Zeplin
            old = await shots.last(urls) if body.stale else None
            got, missing = (old, []) if old is not None else await shots.get(urls)
        except zeplin.ZeplinError as e:
            raise YtError(502, str(e)) from None
        page = {u: {k: v for k, v in x.items() if k not in ("texts", "platform", "dp", "list")} for u, x in got.items()}
        return {"shots": page, "missing": missing, "stale": old is not None}

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
            if cur and not await _yours(svc, cur[3]):
                raise _only_author(cur[3])
            # the design as saved now: the shots sent (read live), the old signature for a screen not read this time
            urls = {s.zeplin for s in new.screens if s.zeplin}
            new.design = {
                u: d for u, d in {**(old.design if old else {}), **uiflow.design_of(body.shots)}.items() if u in urls
            }
            ch = flow_changes.changes(old, new)
            if not ch:
                raise YtError(400, "Không có thay đổi")
            new.rev = (old.rev if old else 0) + 1
            engine = _engine(request)
            name = uiflow.file_name(new)
            # the same name as another file on the ticket (one attached by hand, a copy): the saver's name tells them
            # apart; the flow file being replaced does not count
            atts = (await svc.yt(f"/api/issues/{i}", fields="attachments(id,name,removed)")).get("attachments") or []
            others = {a.get("name") for a in atts if a.get("id") != old_id and not a.get("removed")}
            if name in others:
                name = uiflow.file_name(new, (await svc.cached("me", lambda: _me(svc))).get("name") or "")
            try:
                html = uiflow.build_html(new, engine, body.shots).encode()
            except ValueError as e:
                raise YtError(400, str(e)) from None
            try:
                try:
                    att, name = await svc.upload(i, name, html, mime="text/html")  # as YouTrack stored it
                except YtUnreachable:  # YouTrack may have stored it: never let a blind retry add a second file
                    raise YtError(502, "Không rõ đã lưu chưa — mở lại UI flow để kiểm tra trước khi lưu lại") from None
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

    @r.post("/flow/delete")
    async def delete_flow(body: FlowDelete):
        """Remove the ticket's UI flow file, only the version the user saw (409 otherwise), then say so in a comment
        (the comment failing only warns: the file is gone)."""
        i = _issue_id(body.id)
        svc.need_token()
        async with flow_lock:
            cur = await svc.flow_file(i)
            if (cur[0] if cur else None) != body.base:
                raise YtError(409, "UI flow vừa được người khác cập nhật — mở lại để xem bản mới")
            if cur and not await _yours(svc, cur[3]):
                raise _only_author(cur[3])
            try:
                await svc.detach(i, body.base)
            except YtUnreachable:  # YouTrack may have removed it: look before trying again
                raise YtError(502, "Không rõ đã xoá chưa — mở lại UI flow để kiểm tra") from None
            finally:
                svc.stale(i)
            warn = []
            try:
                gone = f" — tệp đính kèm {uiflow.file_name(cur[1])}" if cur and cur[1] else ""
                await svc.comment(i, f"Đã xoá UI flow{gone}")
            except YtError as e:
                warn.append(f"Đã xoá file nhưng chưa ghi được bình luận: {e.message}")
        return {"warnings": warn}

    @r.post("/flow/html")
    async def flow_html(body: FlowHtml, request: Request):
        """The flow on screen (draft included) as the standalone file, to open locally; nothing is written."""
        i, new = _clean(body)
        try:
            html = uiflow.build_html(new, _engine(request), body.shots, theme=body.theme)
            return {"name": uiflow.file_name(new), "html": html}
        except ValueError as e:
            raise YtError(400, str(e)) from None

    @r.post("/flow/md")
    async def flow_markdown(body: FlowMd):
        """The flow on screen (draft included) as one Markdown document for an AI agent: every screen with its design's
        texts, the AC quoted from the ticket / stories, the ways through, what is missing. Read, never written: the
        flow, its file and the map stay as they are."""
        i, flow = _clean(body)
        svc.need_token()
        urls = list(dict.fromkeys(s.zeplin for s in flow.screens if s.zeplin))

        async def designs():
            try:
                return (await shots.get(urls))[0] if urls else {}, ""
            except zeplin.ZeplinError as e:  # no token / Zeplin down: the document says so, the rest is still worth it
                return {}, str(e)

        async def story(sid):
            try:
                return flow_prompt.source(await svc.issue_detail(sid))
            except YtError as error:
                if error.status not in (403, 404):
                    raise
                return sid  # not readable here: listed in the document as missing

        # the designs, the ticket and its stories at once (Zeplin takes seconds when its read is cold)
        reading = asyncio.ensure_future(designs())
        try:
            detail = await svc.issue_detail(i)
            read = await asyncio.gather(*(story(sid) for sid in _story_ids(svc, detail, i)))
            got, error = await reading
        finally:
            reading.cancel()  # a ticket read that failed: the Zeplin read is not waited for
        sources = [flow_prompt.source(detail), *(x for x in read if isinstance(x, dict))]
        lost = [x for x in read if isinstance(x, str)]
        o = flow_md.Options(sources=body.sources, paths=body.paths, data=body.data, note=body.note, lost=lost,
                            zeplin_error=error, ticket_url="" if svc.mock else f"{svc.base}/issue/{i}")
        md = flow_md.build(flow, sources, got, o, at=time.strftime("%d/%m/%Y %H:%M"))
        return {"name": f"uiflow-{i}.md", "md": md, "tokens": flow_prompt.estimate(md)}
