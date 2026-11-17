"""Optional AI drafts and tickets. Returns text only; it has no way to send messages."""

import json
import logging
import re
import shutil
import tempfile
import xml.etree.ElementTree as ET
from collections.abc import Callable
from pathlib import Path

from . import ai_run, gitops, provider_cmds, providers
from .ai_prompts import (
    ANSWER_TASK,
    ASK_MSG,
    DEEP_BATCH_TASK,
    DEEP_TASK,
    DRAFT_TASK,
    LANG_RULE,
    PLATFORM_FOCUS,
    QA_SUMMARY_TASK,
    ROLE_FOCUS,
    ROLE_TICKET,
    SYSTEM_PROMPT,
    TICKET_TASK,
    about_user,
)
from .config import child_env, on_path
from .errors import ApiError
from .models import AiResult, StoredMessage
from .storage import Db, Store

log = logging.getLogger("telegram_dashboard.ai")

MAX_MESSAGES = 30
MAX_CONTEXT_CHARS = 16_000
MAX_INSTRUCTION_CHARS = 2_000


SVG_NS = "http://www.w3.org/2000/svg"
_SVG_TAGS = {"svg", "g", "path", "circle", "ellipse", "rect", "line", "polyline", "polygon", "defs", "stop",
             "linearGradient", "radialGradient"}  # fmt: skip
_SVG_DROP = {"href", "style", "class", "transform-origin"}
# a mascot's parts the app animates like the robot's (globals.css .m-*), and the point a limb turns around
SVG_PARTS = {"m-blink", "m-wave", "m-glow"}
_SVG_ORIGIN = re.compile(r"-?\d+(\.\d+)?( -?\d+(\.\d+)?)?")


def _svg_shapes(el: ET.Element) -> ET.Element | None:
    tag = el.tag.rsplit("}", 1)[-1]
    if tag not in _SVG_TAGS:
        return None
    keep = {k: v for k, v in el.attrib.items()
            if "}" not in k and k not in _SVG_DROP and not k.lower().startswith("on")}  # fmt: skip
    if tag == "g" and el.get("class") in SVG_PARTS:
        keep["class"] = el.get("class", "")
        if _SVG_ORIGIN.fullmatch(el.get("transform-origin", "")):
            keep["transform-origin"] = el.get("transform-origin", "")
    out = ET.Element(tag, keep)
    out.extend(c for c in map(_svg_shapes, el) if c is not None)
    return out


def clean_svg(text: str) -> str | None:
    """The first <svg> of an AI answer cut down to plain shapes and gradients (no script, link, text, style, event;
    a class only on a mascot's moving part, SVG_PARTS), with the SVG namespace so it renders as an image; None when
    there is none or it does not parse."""
    m = re.search(r"<svg\b.*?</svg>", text, re.S | re.I)
    if not m or len(m[0]) > 30_000:
        return None
    try:
        root = _svg_shapes(ET.fromstring(m[0]))
    except ET.ParseError:
        return None
    if root is None or root.tag != "svg" or not len(root):
        return None
    for k in ("width", "height"):  # the root's only: the box scales to its viewBox (a rect needs its own)
        root.attrib.pop(k, None)
    root.set("xmlns", SVG_NS)
    root.set("viewBox", root.get("viewBox") or "0 0 32 32")
    return ET.tostring(root, encoding="unicode")


def json_object(text: str) -> dict | None:
    """The JSON object in a model's answer (from its first "{" to its last "}"), None if unreadable."""
    start, end = text.find("{"), text.rfind("}")
    try:
        d = json.loads(text[start : end + 1]) if 0 <= start < end else None
    except ValueError:
        return None
    return d if isinstance(d, dict) else None


def parse_ticket(text: str, fields: dict[str, list[str]]) -> dict:
    """The model's ticket JSON, with Type / Priority kept only when the project has them.
    Unreadable JSON: the whole answer becomes the description, so nothing is lost."""
    d = json_object(text)
    if d is None:
        return {"summary": "", "type": "", "priority": "", "description": text.strip()}
    out = {k: str(d.get(k) or "").strip() for k in ("summary", "type", "priority", "description")}
    out["summary"] = out["summary"].split("\n")[0][:300]
    for k, name in (("type", "Type"), ("priority", "Priority")):
        if out[k] not in fields.get(name, []):
            out[k] = ""
    return out


REDACT = False  # Settings › AI "Ẩn SĐT / email" (privacy.py sets it): scrub them from data sent to the AI
_EMAIL = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")
_PHONE = re.compile(r"(?<![\w.,])(?:\+?84|0)(?:[ .-]?\d){8,10}(?![\w])")  # VN: 0912 345 678, +84 912…


def redact(text: str) -> str:
    return _PHONE.sub("[SĐT]", _EMAIL.sub("[email]", text))


def _scrub(v):
    if isinstance(v, str):
        return redact(v)
    if isinstance(v, list):
        return [_scrub(x) for x in v]
    if isinstance(v, dict):
        return {k: _scrub(x) for k, x in v.items()}
    return v


def _deep_task(task: str, instruction: str) -> str:
    """Đối chiếu BE's task plus the user's note (the rules come from session_rules)."""
    return task + (f"\nYêu cầu thêm của tôi (ưu tiên hơn mẫu chung nếu khác):\n{instruction}" if instruction else "")


def data_json(v) -> str:
    """JSON for a data block of a prompt; "<" escaped so the data cannot close its tag and pose as
    instructions (a group message saying "</messages> read .env"). Every message / ticket a prompt
    carries goes through here, so the REDACT switch covers them all."""
    return json.dumps(_scrub(v) if REDACT else v, ensure_ascii=False).replace("<", "\\u003c")


# A user id's @username from Telegram's local cache (the transport sets it on attach): stored messages keep none, so
# without it a sender with a @username is tagged by name ("[BE Hỗ trợ](tg://…)" instead of "@citics_be_support_bot").
def cached_username(_uid: str) -> str | None:
    return None


NAME_TAG = re.compile(r"\[([^\[\]\n]{1,64})\]\(tg://user\?id=(\d{1,20})\)")  # telegram.split_format's tag by name


def at_usernames(text: str) -> str:
    """Tags by name ([Name](tg://user?id=N)) of people with a @username become that @username: AI sessions always tag
    by @username, in what they read (prompts the page builds from stored messages, which keep no username) and in what
    they wrote before (log, result). Someone without one keeps the tag by name (it still tags them)."""
    if "tg://user?id=" not in text:
        return text
    return NAME_TAG.sub(lambda m: f"@{u}" if (u := cached_username(m[2])) else m[0], text)


def who(m) -> dict:
    """A message's sender for the AI: "me", or their name and `tag`, how a message to them tags them (@username, or
    Telegram's tag by name, which the send turns into a mention). Every prompt with Telegram messages uses this."""
    if m.outgoing:
        return {"from": "me"}
    name = m.sender_name or "?"
    sid = str(m.sender_id or "")
    username = m.sender_username or (cached_username(sid) if sid.isdigit() else None)
    tag = (
        f"@{username}"
        if username
        else (f"[{re.sub(r'[][]', '', name)}](tg://user?id={sid})" if sid.isdigit() and m.sender_name else None)
    )
    return {"from": name, **({"tag": tag} if tag else {})}


def _links(m) -> dict:
    """Hidden hyperlinks of a message, so the model can fetch them when it has tools."""
    spans = [x for x in m.links if x.kind == "link"]
    utf16 = m.text.encode("utf-16-le")
    label = lambda x: utf16[x.offset * 2 : (x.offset + x.length) * 2].decode("utf-16-le")  # noqa: E731
    return {"links": [{"label": label(x), "url": x.url} for x in spans]} if spans else {}


class AiService:
    def __init__(self, settings, store: Store, db: Db):
        self.settings = settings
        self.store = store
        self.db = db
        self.me = lambda: ""  # logged-in Telegram account; app.py points it at the bridge

    @property
    def configured(self) -> bool:
        p = providers.chosen(self.settings)
        return self.settings.ai_configured if p == "claude" else providers.installed(self.settings, p)

    @property
    def reader_available(self) -> bool:
        """Can drafts read a project / photos? Needs the read-only agent command on PATH."""
        p = providers.chosen(self.settings)
        if p == "claude":
            return on_path(self.settings.ai_agent_project_command)
        return providers.installed(self.settings, p)

    def _check(self, chat_id: str, ids: list[int]):
        """(may the AI read these kept messages, them, cursor): a tracked chat, none deleted (non-photo
        media just contributes its caption)."""
        tracking = self.store.is_tracking(chat_id)
        msgs, cursor = self.store.get_messages_by_ids(chat_id, ids)
        by_id = {m.message_id: m for m in msgs}
        ok = tracking and all(i in by_id and not by_id[i].deleted for i in ids)
        return ok, [by_id[i] for i in ids if i in by_id], cursor

    async def run(
        self,
        kind: str,
        chat_id: str,
        message_ids: list[str],
        instruction: str | None = None,
        project: str | None = None,
        nearby: list[StoredMessage] | None = None,
        images: list[Path] | None = None,
        platform: str = "android",
        role: str = "dev",
        fields: dict[str, list[str]] | None = None,
        intro: str = "",
        on_text=None,
        tickets: str = "",
        history: list[dict] | None = None,
        *,
        ref: str = "",
    ) -> AiResult:
        """kind "draft" (analysis + reply drafts), "answer" (a question answered from the code in `project`, + reply
        drafts) or "ticket" (a YouTrack ticket proposal, JSON in `text`; `fields` = the project's Type / Priority
        values). `nearby`: surrounding group messages (context only); `images`: photo files to read; `tickets`:
        YouTrack tickets as JSON (answer: their state for progress questions). `on_text`: see `ask`.
        `history`: a saved Trợ lý AI session (its earlier asks and answers, maybe none): asks come as messages ready
        to post. `ref`: the session code ("REF-…") logged with the run (Trợ lý AI turns)."""
        if kind == "answer" and project is None:
            raise ApiError(422, "project_not_found")
        if not self.configured:
            raise ApiError(503, "ai_not_configured")
        if project is not None:
            if not self.reader_available:
                raise ApiError(422, "ai_agent_missing")
            if not await self.db.read(self.store.has_project, project):
                raise ApiError(404, "project_not_found")
        try:
            ids = sorted({int(i) for i in message_ids})
        except ValueError:
            raise ApiError(422, "ai_scope_not_allowed") from None
        if not ids or len(ids) > MAX_MESSAGES:
            raise ApiError(422, "ai_context_too_large")
        if instruction and len(instruction) > MAX_INSTRUCTION_CHARS:
            raise ApiError(422, "ai_context_too_large")
        ok, msgs, cursor = await self.db.read(self._check, chat_id, ids)
        if not ok:
            raise ApiError(403, "ai_scope_not_allowed")
        context = [{"id": str(m.message_id), **who(m), "text": m.text, **_links(m)} for m in msgs]
        if sum(len(m.text) for m in msgs) > MAX_CONTEXT_CHARS:
            raise ApiError(422, "ai_context_too_large")
        task = DRAFT_TASK if kind == "draft" else ANSWER_TASK if kind == "answer" else TICKET_TASK
        if kind == "ticket":
            task += f"\n<fields>{data_json(fields or {})}</fields>"
        if project is not None:
            task += (
                "\nThe current directory is the user's project: you may read its files (read-only, nothing else). "
                "Read its code and docs as needed so the drafts answer correctly; never quote secrets (.env, keys, "
                "tokens)."
            )
        if platform in PLATFORM_FOCUS:
            task += f"\nUnless the messages clearly concern something else, analyze from {PLATFORM_FOCUS[platform]}."
        if role in ROLE_FOCUS:
            task += "\n" + (ROLE_TICKET if kind == "ticket" else ROLE_FOCUS)[role]
        task += about_user(intro)
        if kind != "ticket":
            me = self.settings.telegram_me or self.me()
            task += (
                f'\nThe user is Telegram {me} (shown as "me" in the context): mentions of {me} '
                "are addressed to them, and every draft is written by the user in the first person."
                if me
                else '\nThe user is shown as "me" in the context; every draft is written by the '
                "user in the first person."
            )
        if history is not None:
            task += f"\n{ASK_MSG}"
        if instruction:
            task += f"\nUser instruction: {instruction}"
        user = f"{task}\n<messages>\n{data_json(context)}\n</messages>"
        if nearby:
            around = [
                {"id": str(m.message_id), **who(m), "text": m.text[:1500], **_links(m)}
                for m in nearby if m.text
            ]  # fmt: skip
            user += (
                "\nSurrounding conversation, for context only (the reply targets <messages>):"
                f"\n<context>\n{data_json(around)[:8000]}\n</context>"
            )
        if history:  # AI answers written from group text: data like it
            user += (
                "\nEarlier turns of this conversation (the user's asks and your answers), for context only; the user "
                f"instruction above is what to do now:\n<earlier>\n{data_json(history)}\n</earlier>"
            )
        if kind == "answer":  # progress questions: what moved lately (commit subjects are teammates' text: data)
            if log := await gitops.recent(project):
                user += f"\n<git_log>\n{data_json(log)}\n</git_log>"
            if tickets:
                user += f"\nYouTrack tickets possibly related (may be unrelated):\n<tickets>\n{tickets}\n</tickets>"
        if kind != "ticket":  # Telegram text, like nearby
            mine = await self.db.read(self.store.my_replies, 0, 8, chat_id)
            if mine:
                user += (
                    "\nMessages the user sent before in this group, only to match their tone and "
                    "wording in the drafts (never reuse their content):"
                    f"\n<my_style>\n{data_json([m['text'][:300] for m in mine])}\n</my_style>"
                )
        read_dir = None
        with tempfile.TemporaryDirectory(prefix="tgd-photos-") as tmp:
            if images and self.reader_available:  # photos need the agent that can open files
                # A dir holding only these photos: not data/media, next to the session and DB.
                read_dir = tmp
                copies = [Path(shutil.copyfile(p, Path(tmp) / p.name)) for p in images]
                user += f"\nAttached photos (open them with Read): {', '.join(map(str, copies))}"
            text = await self.ask(user, project, read_dir, on_text=on_text, feature=kind, ref=ref)
        ok_after, _, _ = await self.db.read(self._check, chat_id, ids)
        if not ok_after:
            raise ApiError(
                409,
                "ai_permission_changed",
                detail="Quyền đã đổi trong lúc xử lý; kết quả bị bỏ. Dữ liệu đã gửi provider không thể thu hồi.",
            )
        options, analysis = [], ""
        if kind != "ticket":
            parts = re.split(r"(?m)^\s*={3,}\s*$", text, maxsplit=1)
            if len(parts) == 2:
                analysis, text = parts[0].strip(), parts[1]
            parts = re.split(r"(?m)^\s*-{3,}\s*$", text)
            options = [o.strip() for o in parts if o.strip()]
            text = options[0] if options else text
        return AiResult(
            text=text,
            options=options,
            analysis=analysis,
            source_message_ids=[str(i) for i in ids],
            context_revision=cursor,
        )

    async def deep(
        self,
        chat_id: str,
        question_id: str,
        confirm_id: str,
        project: str,
        instruction: str = "",
        fetch=None,
    ) -> tuple[str, str]:
        """Deep thinking on a combo: a question to BE + BE's confirmation, to trace through `project`.
        Returns (prompt, title) for an AI Agent session (read-only). No
        tracking gate. `fetch(chat_id, ids)`: reads messages not stored."""
        if not await self.db.read(self.store.has_project, project):
            raise ApiError(404, "project_not_found")
        try:
            q, c = int(question_id), int(confirm_id)
        except ValueError:
            raise ApiError(422, "ai_scope_not_allowed") from None
        if q == c:
            raise ApiError(422, "ai_scope_not_allowed")
        ids = sorted({q, c})
        # No tracking gate: the user picked both messages; stored ones first, the rest live.
        msgs, _ = await self.db.read(self.store.get_messages_by_ids, chat_id, ids)
        msgs = [m for m in msgs if not m.deleted]
        missing = [i for i in ids if i not in {m.message_id for m in msgs}]
        if missing and fetch is not None:
            msgs += [m for m in await fetch(chat_id, missing) if m.chat_id == chat_id and not m.deleted]
        by_id = {m.message_id: m for m in msgs}
        if q not in by_id or c not in by_id:
            raise ApiError(404, "message_not_found")
        if len(by_id[q].text) + len(by_id[c].text) > MAX_CONTEXT_CHARS:
            raise ApiError(422, "ai_context_too_large")
        if instruction and len(instruction) > MAX_INSTRUCTION_CHARS:
            raise ApiError(422, "ai_context_too_large")

        def one(m):
            return {**who(m), "text": m.text, **_links(m)}

        task = _deep_task(DEEP_TASK, instruction)
        user = (
            f"{task}\n<question>\n{data_json(one(by_id[q]))}\n</question>"
            f"\n<confirm>\n{data_json(one(by_id[c]))}\n</confirm>"
        )
        return user, f"Hỏi: {by_id[q].text[:150]}\nBE: {by_id[c].text[:150]}"

    async def deep_batch(
        self,
        chat_id: str,
        items: list[tuple[str, list[str], bool, str]],
        project: str,
        instruction: str = "",
        fetch=None,
    ) -> tuple[str, str, int]:
        """Đối chiếu BE by topic: (summary, cited message ids, still waiting for BE, topic id) of one chat, traced
        through `project`. Returns (prompt, title, anchor) for a read-only AI Agent session: the anchor is the newest
        cited message, as every session sits on a message (its asks post into that group / topic; one topic: its card
        shows the session). No tracking gate."""
        if not await self.db.read(self.store.has_project, project):
            raise ApiError(404, "project_not_found")
        try:
            per = [(text, sorted({int(i) for i in ids}), waiting, key) for text, ids, waiting, key in items]
        except ValueError:
            raise ApiError(422, "ai_scope_not_allowed") from None
        want = sorted({i for _, ids, _, _ in per for i in ids})
        if not want or want[0] < 1 or want[-1] >= 2**31:  # Telegram ids are int32
            raise ApiError(422, "ai_scope_not_allowed")
        msgs, _ = await self.db.read(self.store.get_messages_by_ids, chat_id, want)
        msgs = [m for m in msgs if not m.deleted]
        missing = [i for i in want if i not in {m.message_id for m in msgs}]
        if missing and fetch is not None:
            msgs += [m for m in await fetch(chat_id, missing) if m.chat_id == chat_id and not m.deleted]
        by_id = {m.message_id: m for m in msgs}
        rows = [(text, [by_id[i] for i in ids if i in by_id], waiting, key) for text, ids, waiting, key in per]
        rows = [r for r in rows if r[1]]
        if not rows:
            raise ApiError(404, "message_not_found")
        if sum(len(m.text) for m in by_id.values()) > 4 * MAX_CONTEXT_CHARS:
            raise ApiError(422, "ai_context_too_large")
        if instruction and len(instruction) > MAX_INSTRUCTION_CHARS:
            raise ApiError(422, "ai_context_too_large")
        data = [{"n": n, **({"id": key} if key else {}), "summary": text, "status": "waiting" if waiting else "agreed",
                 "messages": [{**who(m), "text": m.text, **_links(m)}
                              for m in found]}
                for n, (text, found, waiting, key) in enumerate(rows, 1)]  # fmt: skip
        user = f"{_deep_task(DEEP_BATCH_TASK, instruction)}\n<items>\n{data_json(data)}\n</items>"
        head = rows[0][0].split("\n")[0][:120]
        anchor = max(m.message_id for _, found, _, _ in rows for m in found)
        if len(rows) > 1:
            return user, f"Đối chiếu {len(rows)} chủ đề BE: {head}", anchor
        return user, f"Đối chiếu BE: {head}", anchor

    async def qa_summary(self, chat_id: str, ids: list[int], fetch=None, accepted: int | None = None, intro: str = "",
                         on_text=None) -> str:  # fmt: skip
        """Conclusion of a Q&A thread the user opened: `ids` in thread order, the question first (the question and its
        latest replies when long). No tracking gate (the user picked it): stored copies first, the rest live."""
        if not self.configured:
            raise ApiError(503, "ai_not_configured")
        ids = ids[:1] + ids[1:][-(MAX_MESSAGES - 1) :]
        msgs, _ = await self.db.read(self.store.get_messages_by_ids, chat_id, ids)
        missing = [i for i in ids if i not in {m.message_id for m in msgs}]
        if missing and fetch is not None:
            msgs += [m for m in await fetch(chat_id, missing) if m.chat_id == chat_id]
        by_id = {m.message_id: m for m in msgs if not m.deleted}
        thread = [by_id[i] for i in ids if i in by_id]
        if not thread:
            raise ApiError(404, "message_not_found")
        if sum(len(m.text) for m in thread) > MAX_CONTEXT_CHARS:
            raise ApiError(422, "ai_context_too_large")
        rows = [{**who(m), "text": m.text, **_links(m),
                 **({"accepted": True} if m.message_id == accepted else {})} for m in thread]  # fmt: skip
        task = QA_SUMMARY_TASK + about_user(intro)
        if accepted in by_id:
            task += '\nThe asker marked the message with "accepted": true as the answer: build the conclusion on it.'
        user = f"{task}\n<messages>\n{data_json(rows)}\n</messages>"
        return await self.ask(user, on_text=on_text, feature="qa-summary")

    async def ask(
        self,
        user_prompt: str,
        project: str | None = None,
        read_dir: str | None = None,
        system: str = SYSTEM_PROMPT,
        heavy: bool = False,
        on_text: Callable[[str | dict | None], None] | None = None,
        feature: str = "ai",
        brief: bool = False,
        yt: bool = False,
        shell: bool = False,
        *,
        ref: str = "",
        fast: bool = False,
        guide: bool = False,
        session: tuple[str, bool] | None = None,
        pick: tuple[str, str] | None = None,
        zeplin: dict | None = None,
    ) -> str:
        """One `claude -p` run (or the Codex/Antigravity CLI picked instead): prompt on stdin, answer on stdout.
        `heavy`: a long read (many tickets), run on the task model with the longer timeout.
        `on_text`: called with each piece of the answer as Claude writes it (None: start over,
        a new turn after a tool call; a dict: a working step {kind: tool | tool_result, text, error?, at});
        the return value is still the whole final answer.
        `feature`: what the run is for, in the Claude page's run log. `brief`: a Briefing / Digest run
        (its own model / effort picks). `yt`: a YouTrack run (YouTrack's picks). `guide`: the know-it-all bot's picks.
        `shell` (with `project`):
        may run commands in the sandbox (build, test), see provider_cmds.ask_cmd.
        `ref`: the session code (YT-xxxxxx), in the run log. `fast`: the CLI's quickest model, not the picked one.
        `pick` (model, effort): this run's own, over both.
        `session` (id, resume): the run starts that CLI session or carries it on (providers.keeps_session says
        where); such a run is not retried here, its id being taken by the first try.
        `zeplin`: the user's zeplin MCP server: the run may read the design with its read-only tools (the longer
        timeout), its token in the run's env only (provider_cmds.mcp_env)."""
        s = self.settings
        cwd = project or read_dir  # anything to read => the read-only tool command
        provider = providers.chosen(s, task=heavy, brief=brief, yt=yt, guide=guide)
        choice = ((*pick, False) if pick else providers.fast_choice(provider) if fast else
                  providers.run_choice(s, task=heavy, provider=provider, brief=brief, yt=yt, guide=guide))  # fmt: skip
        cmd = provider_cmds.ask_cmd(s, provider, tools=bool(cwd), read_dir=read_dir if project else None,
                                model=choice[0], effort=choice[1], stream=on_text is not None, shell=shell,
                                session=session, zeplin=zeplin)  # fmt: skip
        if provider == "claude" and not providers.is_claude(cmd):
            provider = None  # another AI command only prints its answer
        prompt = providers.stdin(provider or "claude", f"{system}{LANG_RULE}\n\n{user_prompt}")
        # Briefing / Digest parts read many messages, a Zeplin run reads designs: the longer timeout
        long = bool(project or heavy or brief or zeplin)
        # the token only where the command loads the zeplin server (Antigravity runs its own)
        env = {**child_env(), **(provider_cmds.mcp_env(zeplin) if provider in ("claude", "codex") else {})}
        try:
            return await self._run(cmd, cwd, prompt, long, on_text, feature, choice, provider, ref, env)
        except ApiError as e:  # a provider hiccup (overloaded, dropped connection): one more try, same prompt
            if session or not ai_run.retryable(e):
                raise
            log.info("AI run for %s retried after: %s", feature, e.detail)
            if on_text:
                on_text(None)  # the page drops the half answer
            return await self._run(cmd, cwd, prompt, long, on_text, feature, choice, provider, ref, env)

    async def _run(self, *args) -> str:
        """One run to its answer (ai_run.run), with this service's settings for the run log."""
        return await ai_run.run(self.settings, *args)
