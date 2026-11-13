"""Settings › Dữ liệu: what the app keeps on this machine (data/), how big each part is, and clearing one kind at a
time. The startup sweep (app.prune_media, claude.prune_runs, the launcher's log rotation) keeps them bounded anyway;
this is for doing it now."""

import asyncio
import contextlib
import json
import logging
import os
import sqlite3
from datetime import UTC, datetime
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, Request
from pydantic import BaseModel

from .agent import delete_task_files, tasks_dir
from .claude import _runs_path
from .errors import ApiError
from .links import links_dir

log = logging.getLogger(__name__)

KEEP_DAYS = 30  # "older than": messages and the send log
LOGS = ("server.log", "server.log.1")  # the git launcher's (Start Dashboard Telegram.command)

Item = Literal["messages", "sessions", "digests", "outbox", "media", "runs", "logs"]


class DataItem(BaseModel):
    id: str  # an Item, or "login" / "config" (shown, not cleared here)
    bytes: int
    count: int
    oldest: datetime | None = None


class DataTable(BaseModel):
    name: str
    rows: int
    bytes: int


class DataChat(BaseModel):
    chat_id: str
    title: str
    rows: int
    bytes: int  # estimated from its text


class DataPart(BaseModel):
    id: str  # db | sessions | media | runs | logs | login | config (the rest of data/ is total minus these)
    bytes: int


class DataStats(BaseModel):
    dir: str
    total: int  # everything under data/
    parts: list[DataPart]  # on disk, for the overview bar
    db: int  # dashboard.sqlite3 with its -wal / -shm
    db_free: int  # space of deleted rows not yet given back (compact)
    keep_days: int
    items: list[DataItem]
    tables: list[DataTable]
    chats: list[DataChat]


def _size(p: Path) -> int:
    with contextlib.suppress(OSError):
        if p.is_file():
            return p.stat().st_size
        return sum(f.stat().st_size for f in p.rglob("*") if f.is_file())
    return 0


def _files(paths) -> tuple[int, int, datetime | None]:
    """Bytes, count, oldest mtime."""
    sizes, oldest = 0, None
    n = 0
    for p in paths:
        with contextlib.suppress(OSError):
            st = p.stat()
            sizes += st.st_size
            n += 1
            at = datetime.fromtimestamp(st.st_mtime, UTC)
            oldest = at if oldest is None or at < oldest else oldest
    return sizes, n, oldest


def _session_files(settings, task_id: str) -> list[Path]:
    d = tasks_dir(settings)
    return [d / f"{task_id}{s}" for s in (".md", ".result.md", ".log.jsonl")]


def _ts(v) -> datetime | None:
    return datetime.fromtimestamp(v, UTC) if isinstance(v, int) else None


def _before() -> int:
    return int(datetime.now(UTC).timestamp()) - KEEP_DAYS * 86_400


def _done_sessions(s) -> list[dict]:
    """AI Agent / Trợ lý AI sessions marked done and not running: what "Phiên AI đã xong" clears."""
    return [t for t in s.store.list_tasks() if t["handled"] and not s.agent.running(t["id"])]


def stats(s, settings) -> DataStats:
    data = settings.data_dir
    db = s.store.data_stats(_before())
    done = _done_sessions(s)
    sess = [p for t in done for p in _session_files(settings, t["id"])]
    sess_bytes, _, _ = _files(sess)
    sess_bytes += sum(_size(links_dir(settings, t["id"])) for t in done)
    media = _files((data / "media").glob("*.jpg"))
    runs, first = _runs_path(settings), ""
    with contextlib.suppress(OSError), open(runs) as fh:
        first = next(fh, "")
    logs = _files(p for n in LOGS if (p := data / n).is_file())
    login = _files([Path(f"{settings.session_path}.session")])
    config = _files(data.glob("*.json"))
    items = [
        *(DataItem(id=k, bytes=db[k]["bytes"], count=db[k]["count"], oldest=_ts(db[k]["oldest"]))
          for k in ("messages", "digests", "outbox")),
        DataItem(id="sessions", bytes=sess_bytes, count=len(done),
                 oldest=min((_ts(t["created_at"]) for t in done), default=None)),
        DataItem(id="media", bytes=media[0], count=media[1], oldest=media[2]),
        DataItem(id="runs", bytes=_size(runs), count=_lines(runs), oldest=_first_at(first)),
        DataItem(id="logs", bytes=logs[0], count=logs[1]),  # an mtime is its latest line, not its oldest
        DataItem(id="login", bytes=login[0], count=login[1]),
        DataItem(id="config", bytes=config[0], count=config[1]),
    ]  # fmt: skip
    db_bytes = sum(_size(Path(f"{settings.db_path}{x}")) for x in ("", "-wal", "-shm"))
    on_disk = {"db": db_bytes, "sessions": _size(tasks_dir(settings)), "media": media[0], "runs": _size(runs),
               "logs": logs[0], "login": login[0], "config": config[0]}  # fmt: skip
    return DataStats(
        dir=str(data), total=_size(data), keep_days=KEEP_DAYS, db=db_bytes, db_free=db["free"],
        parts=[DataPart(id=k, bytes=v) for k, v in on_disk.items()],
        items=items, tables=[DataTable(**t) for t in db["tables"]], chats=[DataChat(**c) for c in db["chats"]],
    )  # fmt: skip


def _lines(p: Path) -> int:
    with contextlib.suppress(OSError), open(p, "rb") as fh:
        return sum(1 for _ in fh)
    return 0


def _first_at(line: str) -> datetime | None:
    with contextlib.suppress(ValueError, TypeError, AttributeError):
        return datetime.fromisoformat(json.loads(line)["at"])
    return None


def _clear_files(settings, item: str) -> None:
    data = settings.data_dir
    if item == "media":
        for p in (data / "media").glob("*.jpg"):
            p.unlink(missing_ok=True)
    elif item == "runs":
        _runs_path(settings).unlink(missing_ok=True)
    elif item == "logs":
        log = data / LOGS[0]
        if log.is_file():  # truncated in place: the running server keeps appending to the same open file
            os.truncate(log, 0)
        (data / LOGS[1]).unlink(missing_ok=True)


def build_router(settings) -> APIRouter:
    r = APIRouter(prefix="/api/data")

    @r.get("")
    async def get_data(request: Request) -> DataStats:
        return await asyncio.to_thread(stats, request.app.state, settings)

    @r.delete("/{item}", status_code=204)
    async def clear(item: Item, request: Request) -> None:
        s = request.app.state
        if item == "messages":
            await s.db.write(s.store.prune_messages, _before())
        elif item == "digests":
            await s.db.write(s.store.clear_digests)
        elif item == "outbox":
            await s.db.write(s.store.clear_sent, _before())
        elif item == "sessions":
            for t in await s.db.read(_done_sessions, s):
                if s.agent.running(t["id"]):  # started again since the list was read
                    continue
                await s.db.write(s.store.delete_task, t["id"])
                await asyncio.to_thread(delete_task_files, settings, t["id"])
        else:
            try:
                await asyncio.to_thread(_clear_files, settings, item)
            except OSError as e:
                raise ApiError(500, "data_clear_failed") from e
            return
        await compact(s)

    return r


async def compact(s) -> None:
    """After a database clear: give the space back. Busy (a long read) is not an error, the rows are gone anyway."""
    try:
        await s.db.write(s.store.compact)
    except sqlite3.OperationalError as e:
        log.warning("compact skipped: %s", e)
