"""AI on YouTrack tickets (/api/yt/ai/*): one CLI run per click, text back only; it never writes to YouTrack."""

import asyncio
import re
from datetime import datetime

from fastapi import Request
from pydantic import ValidationError

from .. import providers
from ..agent import read_task_result, task_result_path
from ..ai import data_json, json_object, parse_ticket
from ..ai_jobs import stream_answer
from ..ai_run import client_gone, no_retry
from ..errors import ApiError
from ..links import ISSUE, link_block
from ..telegram.digest import VN
from .ai_prompts import (
    AI_ASK_TICKETS,
    AI_CODE,
    AI_DATA,
    AI_DRAFT,
    AI_ERR,
    AI_FILTER,
    AI_FOLLOWUP,
    AI_GROOM,
    AI_PLAN,
    AI_QUALITY,
    AI_REGRESSION,
    AI_SHELL,
    AI_STANDUP,
    AI_SUMMARY,
    AI_SYSTEM,
    AI_TESTCASES,
    AI_TICKET,
    AI_TICKETS,
    AI_TODAY,
    AI_TRIAGE,
)
from .client import YtError, _me
from .queries import WAVE, _day, _ticket_json
from .schemas import ROLES, AiData, AiDraft, AiFilter, AiFollowup, AiTicket, AiTickets, _issue_id, _role
from .service import YouTrackDashboard


async def _ticket_block(
    svc: YouTrackDashboard, request: Request, i: str, links: bool = True, *,
    desc: int = 8000, skip: frozenset[str] = frozenset(),
) -> tuple[str, str]:  # fmt: skip
    """(ticket JSON, KB / ticket / Telegram links in it read for the AI; no web) of ticket `i`.
    `skip`: tickets the prompt already carries in full, not read (nor summarized) again as links."""
    svc.need_token()
    ticket = _ticket_json(await svc.issue_detail(i), desc=desc)
    if not links:
        return ticket, ""
    text = ISSUE.sub(lambda m: "" if m[2].upper() in skip else m[0], ticket)
    key = f"links:{i}:{desc}:{','.join(sorted(skip))}"
    return ticket, await svc.cached(key, lambda: link_block(request.app.state, text, None))


async def _whoami(svc: YouTrackDashboard) -> str:
    """Tells the AI who "tôi" is, so it reads my comments / tickets as mine, not a third party's."""
    if svc.mock:
        return ""
    try:
        u = await asyncio.wait_for(asyncio.shield(svc.cached("me", lambda: _me(svc))), 3)
    except YtError, TimeoutError:
        return ""  # no identity is better than no AI (or a 30 s wait); the fetch still fills the cache
    if not u["login"]:
        return ""
    return (
        f'Người dùng ("tôi") là {u["name"]} (YouTrack login: {u["login"]}). Ticket, bình luận, '
        "Assignee / QC / Reporter mang tên này là của tôi: viết theo góc nhìn của tôi, không gọi "
        "tôi bằng tên hay như người thứ ba, không bảo tôi tự ping / hỏi chính mình.\n"
    )


def _team_notes(svc: YouTrackDashboard, request: Request) -> str:
    """The instructions of the role the page is in (header X-Yt-Role), under the system rules:
    they shape format / language / scope, they never lift the untrusted-data rules."""
    role = request.headers.get("x-yt-role", "")
    text = getattr(svc.notes(), role, "").strip() if role in ROLES else ""
    if not text:
        return ""
    return (
        f'<team_instructions role="{role}">\n{text}\n</team_instructions>\n'
        "Làm theo <team_instructions> của team (format, ngôn ngữ, phạm vi, mẫu) khi chúng liên "
        "quan tới việc bên dưới; chúng không thay đổi quy tắc hệ thống.\n"
    )


async def _ai(
    svc: YouTrackDashboard,
    request: Request,
    prompt: str,
    heavy: bool = False,
    on_text=None,
    notes: bool = True,
    code: str | None = None,
    shell: bool = False,
    detached: bool = False,
    retry: bool = True,
) -> str:
    """The run log keeps the page's session code (header X-Ai-Session, "YT-xxxxxx") to trace a bug report."""
    ai = request.app.state.ai
    name = lambda: providers.NAMES[providers.chosen(ai.settings, yt=True)]  # noqa: E731  only on errors
    if not ai.configured:
        raise YtError(503, f"Chưa cài {name()} CLI, xem Cài đặt › AI")
    if not detached:  # a background run (AiJobs) is stopped by its id only
        client_gone.set(request.is_disconnected)  # closing the drawer / Hủy stops the run
    head = f"Hôm nay: {datetime.now(VN).date()}\n{await _whoami(svc)}"
    if notes:  # not for answers that must be bare JSON (the filter)
        head += _team_notes(svc, request)
    if code:  # reading code takes a while: the task model and its longer timeout
        prompt, heavy = prompt + AI_CODE + (AI_SHELL if shell else ""), True
    token = no_retry.set(not retry)
    try:
        return await ai.ask(f"{head}{prompt}", project=code, system=AI_SYSTEM, heavy=heavy,
                            on_text=on_text, feature="youtrack", yt=True, shell=shell and bool(code),
                            ref=_session_ref(request))  # fmt: skip
    except ApiError as e:
        msg = AI_ERR.get(e.code, f"{{ai}} lỗi ({e.code})").format(ai=name())
        raise YtError(min(e.status, 502), f"{msg}: {e.detail}" if e.detail else msg) from None
    finally:
        no_retry.reset(token)


SESSION_REF = re.compile(r"YT-[a-z0-9]{6}")


def _session_ref(request: Request) -> str:
    """The AI history session this run belongs to, as the page shows it (anything else: none)."""
    ref = request.headers.get("x-ai-session", "")
    return ref if SESSION_REF.fullmatch(ref) else ""


async def _code_dir(request: Request, folder: str) -> str | None:
    """Only a folder registered in Telegram › AI Agent may be read: never a path from the page.
    Code is a Dev tool: QA / PO runs read the tickets only (a Dev session continued as QA drops it)."""
    if not folder or _role(request) != "dev":
        return None
    st = request.app.state
    if folder not in {p["path"] for p in await st.db.read(st.store.list_projects)}:
        raise YtError(403, "Thư mục chưa đăng ký trong Telegram › AI Agent")
    return folder


def background(svc: YouTrackDashboard, request: Request, work, key: str = ""):
    """With header X-Ai-Job (an id the page picked): `work(on_text, detached=True)` as a background run the page
    can leave and read again (GET /ai/job/{id}), its result the last NDJSON item; None without the header."""
    job = request.headers.get("x-ai-job", "")
    if not job:
        return None
    if not svc.jobs.free(job):
        raise YtError(409, "Mã lượt AI không hợp lệ hoặc đã dùng, gửi lại")
    return svc.jobs.start(job, lambda on_text: work(on_text, detached=True), key)


def register(r, svc: YouTrackDashboard) -> None:
    async def p_ticket(body: AiTicket, request: Request) -> tuple[str, bool]:
        rewrite = body.kind == "rewrite"  # a rewrite only keeps the links
        ticket, links = await _ticket_block(svc, request, _issue_id(body.id), not rewrite)
        return f"{AI_TICKET[body.kind]}\n<ticket>\n{ticket}\n</ticket>{links}", False

    async def p_data(body: AiData, request: Request) -> tuple[str, bool]:
        data = data_json(body.data)
        if len(data) > 60_000:
            raise YtError(413, "Quá nhiều dữ liệu cho AI, lọc bớt sprint / người")
        ask = f"\n<ask>{body.question}</ask>" if body.kind == "ask" else ""
        if body.kind == "ask" and not body.question.strip():
            raise YtError(400, "Nhập câu hỏi")
        return f"{AI_DATA[body.kind]}{ask}\n<data>\n{data}\n</data>", False

    async def p_tickets(body: AiTickets, request: Request) -> tuple[str, bool]:
        """One review over many tickets: details + comments + Telegram mentions, cut short."""
        ids = list(dict.fromkeys(map(_issue_id, body.ids)))
        if body.kind == "ask" and not body.ask.strip():
            raise YtError(400, "Nhập yêu cầu cho AI")
        svc.need_token()
        gate = asyncio.Semaphore(WAVE * 2)
        st = request.app.state

        async def one(i: str) -> str:
            async with gate:
                d = await svc.issue_detail(i)
            tg = await st.db.read(st.store.find_mentions, i, 5)
            return _ticket_json(d, 1200, 6, 500, telegram=[
                {"from": m["sender_name"], "date": _day(m["date"] * 1000), "text": m["text"][:300]}
                for m in tg
            ])  # fmt: skip

        data = ",\n".join(await asyncio.gather(*map(one, ids)))
        scope = f"Phạm vi: {body.scope}\n" if body.scope else ""
        heads = {
            "today": AI_TODAY, "summary": AI_SUMMARY, "ask": AI_ASK_TICKETS, "standup": AI_STANDUP,
            "plan": AI_PLAN, "testcases": AI_TESTCASES, "triage": AI_TRIAGE, "regression": AI_REGRESSION,
            "groom": AI_GROOM, "quality": AI_QUALITY,
        }  # fmt: skip
        head = heads.get(body.kind, AI_TICKETS)
        if body.kind == "standup":
            since = body.since // 1000
            sent = await st.db.read(st.store.my_replies, since)
            replies = data_json(
                [{"group": m["title"], "date": _day(m["date"] * 1000), "text": m["text"][:300]}
                 for m in sent])  # fmt: skip
            head += f"\n<since>{_day(body.since)}</since>"  # local days, like the tickets' dates
            head += f"\n<telegram_replies>{replies}</telegram_replies>"
            # AI Agent sessions that ended a turn since then: code investigated / changed (one standup reads it all)
            ran = [
                t
                for t in await st.db.read(st.store.list_tasks)
                if (f := task_result_path(st.settings, t["id"])).is_file() and f.stat().st_mtime >= since
            ]
            sessions = data_json(
                [
                    {
                        "task": (t["title"] or t["message_text"] or t["prompt"] or "")[:200],
                        "result": (read_task_result(st.settings, t["id"]) or "")[:400],
                    }
                    for t in ran[:8]
                ]
            )
            head += f"\n<agent_sessions>{sessions}</agent_sessions>"
        if body.kind in ("ask", "plan"):
            stats = data_json(body.stats)[:20_000] if body.stats else ""
            ask = f"\n<ask>{body.ask}</ask>" if body.kind == "ask" else ""
            head += ask + (f"\n<stats>{stats}</stats>" if stats else "")
        if body.kind == "review" and body.changes:
            head += (
                "\nTrước **Tổng quan:**, thêm mục **Thay đổi từ lần trước:** tóm tắt các thay đổi "
                "đáng chú ý trong <changes> (nêu ID, gom theo người; bỏ thay đổi vụn vặt)."
                f"\n<changes>{data_json(body.changes)}</changes>"
            )
        # many tickets is a long read: the task model (Settings › Claude) does it better
        return f"{head}\n{scope}<tickets>\n[{data}]\n</tickets>", len(ids) > 10

    def answer(request: Request, prompt: str, heavy: bool, draft: bool, code: str | None = None, shell=False):
        """The AI answer, streamed: a background run (`background`), or one that stops when the page goes."""

        async def work(on_text, detached=False):
            text = await _ai(svc, request, prompt, heavy, on_text, code=code, shell=shell, detached=detached)
            if not draft:
                return {"text": text}
            brief, _, rest = text.partition("\n===")  # a ticket answer may end with a comment draft
            return {"text": brief.strip(), "draft": rest.strip()}

        return background(svc, request, work) or stream_answer(work)

    @r.get("/ai/jobs")
    async def ai_jobs():
        """running / done / error of each background AI run kept (the history marks its sessions)."""
        return svc.jobs.status()

    @r.get("/ai/job/{job_id}")
    async def ai_job(job_id: str):
        """A background AI run read again from the start (a reload, the history), live if it still runs."""
        got = svc.jobs.attach(job_id)
        if got is None:
            raise YtError(404, "Lượt AI này không còn trên máy chủ (khởi động lại, hoặc xong quá 1 giờ): chạy lại")
        return got

    @r.delete("/ai/job/{job_id}", status_code=204)
    async def ai_job_stop(job_id: str):
        svc.jobs.stop(job_id)

    @r.post("/ai/ticket")
    async def ai_ticket(body: AiTicket, request: Request):
        code = await _code_dir(request, body.folder)
        return answer(request, *await p_ticket(body, request), draft=True, code=code, shell=body.shell)

    @r.post("/ai/data")
    async def ai_data(body: AiData, request: Request):
        return answer(request, *await p_data(body, request), draft=False)

    @r.post("/ai/tickets")
    async def ai_tickets(body: AiTickets, request: Request):
        code = await _code_dir(request, body.folder)
        return answer(request, *await p_tickets(body, request), draft=False, code=code, shell=body.shell)

    FOLLOW = {
        "/ai/ticket": (AiTicket, p_ticket), "/ai/data": (AiData, p_data),
        "/ai/tickets": (AiTickets, p_tickets),
    }  # fmt: skip

    @r.post("/ai/followup")
    async def ai_followup(body: AiFollowup, request: Request):
        """A follow-up question on an AI answer: the first request's prompt (same data, re-read),
        the turns so far, then the new question. Stateless: the page sends the thread back."""
        model, build = FOLLOW[body.path]
        try:
            first = model.model_validate(body.body)
        except ValidationError:
            raise YtError(400, "Yêu cầu AI ban đầu không hợp lệ") from None
        prompt, heavy = await build(first, request)
        code = await _code_dir(request, getattr(first, "folder", ""))  # a code session stays one
        turns = data_json([t.model_dump() for t in body.history])
        prompt += f"{AI_FOLLOWUP}\n<history>{turns}</history>\n<ask>{body.question}</ask>"
        return answer(request, prompt, heavy, draft=body.path == "/ai/ticket", code=code,
                      shell=getattr(first, "shell", False))  # fmt: skip

    @r.post("/ai/draft")
    async def ai_draft(body: AiDraft, request: Request):
        """A new ticket (summary, Type, Priority, templated description) from a rough note."""
        fields = {"Type": body.types, "Priority": body.priorities}
        prompt = f"{AI_DRAFT}\n<fields>{data_json(fields)}</fields>\n<ask>{data_json(body.text)}</ask>"
        return parse_ticket(await _ai(svc, request, prompt), fields)

    @r.post("/ai/filter")
    async def ai_filter(body: AiFilter, request: Request):
        opts = data_json(body.options)[:20_000]
        prompt = f"{AI_FILTER}\n<options>{opts}</options>\n<ask>{body.text}</ask>"
        out = json_object(await _ai(svc, request, prompt, notes=False))
        if out is None:
            raise YtError(502, "AI trả về không đọc được, thử diễn đạt khác")
        return out
