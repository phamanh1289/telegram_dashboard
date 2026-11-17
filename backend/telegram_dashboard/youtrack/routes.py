import logging
import re
from collections.abc import Callable
from dataclasses import replace

from fastapi import APIRouter, Request

from ..config import Settings, write_private_json
from ..errors import ApiError
from ..models import (
    YouTrackAuth,
    YouTrackIssue,
    YouTrackRequest,
    YouTrackUser,
)
from ..telegram.routes import photo_file
from .client import YtError, whoami
from .service import YouTrackDashboard

log = logging.getLogger(__name__)


def build_router(
    get_settings: Callable[[], Settings], set_settings: Callable[[Settings], None], yt_dashboard: YouTrackDashboard,
) -> APIRouter:
    router = APIRouter()

    @router.put("/api/youtrack/auth")
    async def youtrack_auth(body: YouTrackAuth) -> YouTrackUser:
        """Check a pasted URL + token with YouTrack, keep it in data/ (0600), use it now."""
        url = body.url.rstrip("/")
        user = await whoami(url, body.token)
        get_settings().ensure_data_dir()
        write_private_json(get_settings().youtrack_path, {"url": url, "token": body.token})
        set_settings(replace(get_settings(), youtrack_url=url, youtrack_token=body.token))
        yt_dashboard.set_auth(url, body.token)
        return YouTrackUser(**user)


    @router.post("/api/youtrack/issues")
    async def youtrack_issue(body: YouTrackRequest, request: Request) -> YouTrackIssue:
        if not get_settings().youtrack_configured:
            raise ApiError(503, "youtrack_not_configured")
        project = body.project or get_settings().youtrack_project
        if not project:
            raise ApiError(422, "youtrack_project_not_found")
        issue_id, url = await yt_dashboard.create_issue(body.summary, body.description, project, body.markdown)
        sets = (("Type", body.type), ("Priority", body.priority), ("Assignee", body.assignee))
        cmd = " ".join(f"{k} {{{v}}}" for k, v in sets if v)
        warning = ""
        if cmd:
            post = {"query": cmd, "issues": [{"idReadable": issue_id}]}
            try:
                await yt_dashboard.yt("/api/commands", post=post, fields="id")
            except YtError as e:
                log.warning("ticket %s created, fields not set: %s", issue_id, e.message)
                warning = f"Chưa đặt được Type / Priority / Assignee: {e.message}."
        if body.chat_id and body.message_id:  # the tag's screenshot goes with the bug report
            photo = await photo_file(request, body.chat_id, int(body.message_id))
            if photo is not None:
                try:
                    await yt_dashboard.attach(issue_id, photo)
                except YtError as e:
                    log.warning("ticket %s created, photo not attached: %s", issue_id, e.message)
                    warning = f"{warning} Không đính kèm được ảnh.".strip()
        yt_dashboard.stale()  # the YouTrack page shows it on its next refresh
        return YouTrackIssue(id=issue_id, url=url, warning=warning)


    async def _find_issues(query: str, top: int) -> list[YouTrackIssue]:
        """YouTrack's own search (its relevance order); [] when it refuses the query (400). A bad token /
        no YouTrack is raised: "no matching ticket" would make the user file a duplicate."""
        try:
            rows = await yt_dashboard.yt("/api/issues", query=query, fields="idReadable,summary", **{"$top": top})
        except YtError as e:
            if e.status != 400:
                raise
            log.warning("tickets not looked up: %s %s", e.status, e.message)
            return []
        base = get_settings().youtrack_url.rstrip("/")
        return [
            YouTrackIssue(id=i["idReadable"], url=f"{base}/issue/{i['idReadable']}",
                          summary=i.get("summary") or "")
            for i in rows
        ]  # fmt: skip


    def _open_in(project: str, q: str, min_len: int) -> str | None:
        """YQL for the project's open tickets matching q's words, or None (nothing to search)."""
        words = re.findall(rf"\w{{{min_len},}}", q)[:8]  # plain words only: query syntax chars never reach YQL
        project = re.sub(r"[^\w-]", "", project) or get_settings().youtrack_project
        if not get_settings().youtrack_configured or not words or not project:
            return None
        return f"project: {project} #Unresolved {' '.join(words)}"  # shortName: no braces


    @router.get("/api/youtrack/similar")
    async def youtrack_similar(q: str, project: str = "") -> list[YouTrackIssue]:
        """Open tickets whose text matches q (YouTrack's own relevance): ones possibly related."""
        query = _open_in(project, q, 3)
        return await _find_issues(query, 5) if query else []


    @router.get("/api/youtrack/search")
    async def youtrack_search(q: str, project: str = "") -> list[YouTrackIssue]:
        """A ticket to comment on: an ID (VA-123) finds that one in any state; words search the
        project's open tickets (2+ letters: short Vietnamese words count)."""
        if not get_settings().youtrack_configured:
            return []
        if m := re.fullmatch(r"\s*([A-Za-z][A-Za-z0-9]*-\d+)\s*", q):
            return await _find_issues(f"issue ID: {m[1].upper()}", 1)
        query = _open_in(project, q, 2)
        return await _find_issues(query, 10) if query else []


    return router
