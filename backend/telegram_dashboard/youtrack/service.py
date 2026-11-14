"""YouTrackDashboard: the app's one YouTrack service (client + reads, see client.py / queries.py), the team's
settings files (AI notes, saved prompts, workflow) and the background watch (new tickets, "Báo lại", snoozes).
HTTP: /api/yt/* in api.py (+ api_ai.py, api_flow.py), /api/youtrack/* in routes.py.
"""

import asyncio
import logging
import os
import re
import time

from pydantic import ValidationError

from ..ai_jobs import AiJobs
from ..config import _read_json, write_private_json
from ..telegram import bridge as telegram
from .client import FIELDS, YtError, _me, _normalize
from .flow_jobs import FlowJobs
from .queries import YtQueries
from .schemas import DEV_FLOW, NOTES_MAX, ROLES, AiNotes, SavedPrompts, Workflow

log = logging.getLogger(__name__)

WATCH_EVERY = 180  # s between background watch rounds (watch): new tickets, Báo lại, ticket snoozes
FINISHED = re.compile(r"^(fixed|done|resolved|verified|closed)$", re.I)  # whole names: not "Unresolved" / "Not fixed"
WAKE_MAX = 20  # ponytail: snoozed-until-ticket checks a round (one GET each); the snooze's own time is the backstop
WATCH_Q = "#Unresolved and (Assignee: me or QC: me)"  # every project: the server has no "current" one


class YouTrackDashboard(YtQueries):
    def __init__(self, settings):
        env = os.environ
        self.notes_path = settings.data_dir / "yt_ai.json"
        self.flow_jobs = None
        self.jobs = AiJobs()  # background AI runs (the page may leave and come back)
        self.prompts_path = settings.data_dir / "yt_prompts.json"
        self.workflow_path = settings.data_dir / "yt_workflow.json"
        self.watch_path = settings.data_dir / "yt_watch.json"  # {login, ids, states}: my open tickets at the last look
        self.watch_error = ""  # the last background round's failure, for the page ("" = fine)
        self.thresholds = {k: int(env.get(f"YT_{k.upper()}") or d) for k, d in (("wip", 4), ("stale", 7), ("dead", 30))}
        super().__init__(settings)

    async def start_flow_jobs(self, store):
        self.flow_jobs = FlowJobs(store)
        await self.flow_jobs.call("flow_jobs_recover")

    def notes(self) -> AiNotes:
        raw = _read_json(self.notes_path)
        return AiNotes(**{k: str(raw.get(k) or "")[:NOTES_MAX] for k in ROLES})

    def prompts(self) -> SavedPrompts:
        raw = _read_json(self.prompts_path)
        if not isinstance(raw.get("shown"), dict):  # the first version kept one list for everyone
            raw.pop("shown", None)
        try:
            return SavedPrompts(**raw)
        except ValidationError:  # a hand-edited file: start over rather than 500
            return SavedPrompts()

    def _workflows(self, project: str) -> dict:
        """{role: flow} of a project; a first-version file (one flow for all) goes to each role."""
        raw = _read_json(self.workflow_path).get(project)
        if not isinstance(raw, dict):
            return {}
        return {r: raw for r in ROLES} if "edges" in raw else raw

    def workflow(self, project: str, role: str, states: list[str]) -> Workflow:
        """One flow per project and role (dev / qa / po): {project: {role: Workflow}}.
        Nothing saved: Dev gets DEV_FLOW when the project has its states, else an empty flow."""
        saved = self._workflows(project).get(role)
        if saved is None:
            if role == "dev" and set(DEV_FLOW["pos"]) <= set(states):
                return Workflow(**DEV_FLOW, hidden=[s for s in states if s not in DEV_FLOW["pos"]])
            return Workflow()
        try:
            return Workflow(**saved)
        except ValidationError, TypeError:  # a hand-edited file: start over rather than 500
            return Workflow()

    def save_workflow(self, project: str, role: str, wf: Workflow) -> None:
        raw = _read_json(self.workflow_path)
        raw[project] = {**self._workflows(project), role: wf.model_dump()}
        write_private_json(self.workflow_path, raw)

    async def aclose(self) -> None:
        await self.shots.aclose()
        await self.jobs.stop_all()
        if self.flow_jobs:
            await self.flow_jobs.close()
        for c in [*self._retired, self._client]:
            if c:
                await c.aclose()

    async def watch(self, db, notify) -> None:
        """Background rounds, page open or not: a banner for an open ticket newly given to me (`notify`, None = no
        banner), "Báo lại" for my tickets that reached Fixed / Done, and tags snoozed until a ticket is done woken.
        A failed step keeps its error for the page (watch_error), logs it once and is tried again next round."""
        await asyncio.sleep(30)
        while True:
            errs = []
            for step in (lambda: self.watch_once(notify, db), lambda: self.wake_snoozes(db)):
                try:
                    if not self.mock:
                        await step()
                except Exception as e:
                    errs.append(e.message if isinstance(e, YtError) else f"{type(e).__name__}: {e}")
            err = "; ".join(dict.fromkeys(errs))
            if err and err != self.watch_error:
                log.warning("YouTrack watch failed: %s", err)
            self.watch_error = err
            await asyncio.sleep(WATCH_EVERY)

    async def watch_once(self, notify, db=None) -> list[dict]:
        """One round over my open tickets (every project: the server has no "current" one). Returns the newly mine.
        The snapshot persists, so a change made while the app was off is caught at start; a first look (or another
        account) only records."""
        me = await self.cached("me", lambda: _me(self))
        try:
            rows = await self._all(WATCH_Q)
        except YtError as e:
            if e.status != 400:  # 400: no QC field on this YouTrack
                raise
            rows = await self._all("#Unresolved and Assignee: me")
        saved = _read_json(self.watch_path)
        states = {r["id"]: r["state"] or "" for r in rows}
        snap = {"login": me["login"], "ids": list(states), "states": states}
        if saved.get("login") != me["login"]:
            write_private_json(self.watch_path, snap)
            return []
        before = saved.get("states") or dict.fromkeys(saved.get("ids") or [])  # an older file: states unknown
        try:
            if db is not None:
                done = await self._finished(me["login"], before, rows)
                try:
                    await self._loop_back(db, done)
                except Exception:  # not queued: keep their old state so the next round finds them again
                    states.update({r["id"]: before[r["id"]] or "" for r in done})
                    raise
        finally:
            write_private_json(self.watch_path, snap)
        now = time.monotonic()
        fresh = [
            r for r in rows
            if r["id"] not in before and r["reporter"] != me["name"]
            and now - self.touched.get(r["id"], -1e9) > WATCH_EVERY
        ]  # fmt: skip
        if notify is None:
            return fresh
        if len(fresh) > 3:
            await notify(f"{len(fresh)} ticket mới cho bạn", "", ", ".join(r["id"] for r in fresh[:10]))
        for r in fresh if len(fresh) <= 3 else []:
            # the summary only when Settings allow message text in banners (lock screen / Notification Center)
            body = (r["summary"] or "") if telegram.NOTIFY_PREVIEW else "Mở dashboard để xem chi tiết"
            sub = "Giao cho bạn" if r["assigneeLogin"] == me["login"] else "Nhờ bạn test"
            await notify(f"Ticket mới · {r['id']}", sub, body)
        return fresh

    async def _finished(self, login: str, before: dict, rows: list[dict]) -> list[dict]:
        """My tickets that reached Fixed / Done since the last look: one still listed moved to such a state; one gone
        from the open list is read again (resolved, or no longer mine)."""
        now, out = {r["id"]: r for r in rows}, []
        for i, was in before.items():
            r = now.get(i)
            if r is not None:  # state unknown (older snapshot): nothing to compare with
                if was is not None and (r["state"] or "") != was and FINISHED.match(r["state"] or ""):
                    out.append(r)
                continue
            try:
                r = _normalize(await self.yt(f"/api/issues/{i}", fields=FIELDS))
            except YtError as e:
                if e.status == 404:  # deleted, or no longer visible
                    continue
                raise
            if login in (r["assigneeLogin"], r.get("qcLogin")) and (r["resolved"] or FINISHED.match(r["state"] or "")):
                out.append(r)
        return out

    @staticmethod
    async def _loop_back(db, done: list[dict]) -> None:
        """Queue "Báo lại" for the stored Telegram messages that mention each ticket."""
        items = []
        for r in done:
            for m in await db.read(db.store.find_mentions, r["id"]):
                # My own "đã tạo VA-1" answers the tag it replied to; one not sent as a reply is answered in its thread.
                mid = (m["outgoing"] and m["reply_to_id"]) or m["message_id"]
                items.append((r["id"], r["state"] or "Done", m["chat_id"], mid))
        if items:
            await db.write(db.store.add_loop_items, items)

    async def wake_snoozes(self, db) -> None:
        """Tags snoozed "until VA-1 is done": wake those whose ticket is resolved / Fixed / Done."""
        for i in (await db.read(db.store.ticket_snoozes))[:WAKE_MAX]:
            try:
                r = _normalize(await self.yt(f"/api/issues/{i}", fields=FIELDS))
            except YtError as e:
                if e.status == 404:  # gone: the snooze's own time wakes it
                    continue
                raise
            if r["resolved"] or FINISHED.match(r["state"] or ""):
                await db.write(db.store.wake_ticket, i)
