"""Settings › Dữ liệu: what the app keeps on this machine (data/), how big each part is, and clearing one kind at a
time. The startup sweep (app.prune_media, claude.prune_runs, the launcher's log rotation) keeps them bounded anyway;
this is for doing it now."""

import asyncio
import contextlib
import json
import logging
import os
import shutil
import sqlite3
import tempfile
from datetime import UTC, datetime
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, Request
from pydantic import BaseModel, Field

from . import config, updater
from .agent import tasks_dir
from .claude import _runs_path
from .errors import ApiError
from .links import links_dir
from .storage import MIGRATIONS
from .tasks import remove_task

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
    move_error: Literal["", "failed", "old_left"] = ""  # the last "Đổi thư mục" (this run's startup)
    move_old: str = ""  # old_left: the folder to delete by hand


class MoveBody(BaseModel):
    path: str = Field(min_length=1, max_length=1024)
    adopt: bool = False  # the folder already holds a Radar data/: use that one, leave the current where it is


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
    """AI Agent / Trợ lý AI sessions marked done and not running: what "Phiên AI đã xong" clears.
    ponytail: list_tasks' newest 200; a clear with more done sessions than that takes another click."""
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
    logs = _files(p for n in LOGS if _size(p := data / n))  # a cleared log stays as an empty file
    login = _files([Path(f"{settings.session_path}.session")])
    config = _files(data.glob("*.json"))
    items = [
        *(DataItem(id=k, bytes=db[k]["bytes"], count=db[k]["count"], oldest=_ts(db[k]["oldest"]))
          for k in ("messages", "digests", "outbox")),
        DataItem(id="sessions", bytes=sess_bytes, count=len(done),
                 oldest=min((t["created_at"] for t in done), default=None)),  # list_tasks: already a datetime
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
        move_error=move_error[0], move_old=move_error[1],
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


move_error: tuple[str, str] = ("", "")  # (DataStats.move_error, .move_old), set by apply_move
PART = "data.moving"  # a copy to another disk, until it is whole


def _move_path(root: Path) -> Path:
    # {from, home}: a move asked in Settings, done at the next start. Beside the pointer: this install's own
    return config.default_home(root) / "data_move.json"


# iCloud Drive, Dropbox, OneDrive, Google Drive: a sync client copies the database and its -wal apart and corrupts it
# ponytail: by folder name; "Desktop & Documents in iCloud" and network shares are not seen (the dialog warns)
CLOUD = ("mobile documents", "cloudstorage", "icloud", "dropbox", "onedrive", "google drive", "googledrive")


def _taken(new: Path) -> bool:
    """Is there something at the target that is not ours to replace? A log the git launcher left in the install's
    data/ before the data moved does not count, so moving back there works."""
    return new.exists() and (not new.is_dir() or any(f.name not in LOGS for f in new.iterdir()))


def plan_move(settings, raw: str, *, adopt: bool = False) -> None:
    """Check the folder picked in Cài đặt › Dữ liệu and leave the move for the next start (apply_move): the
    running server holds the database, the Telegram session and the logs open. `adopt`: the folder has a Radar
    data/ already (a disk used by another install): switch to it, nothing is copied or deleted."""
    home = Path(raw.strip()).expanduser()
    if not home.is_absolute():
        raise ApiError(400, "data_move_relative")
    home, old = home.resolve(), settings.data_dir.resolve()
    install = config.default_home(settings.root).resolve()
    new = home / "data"
    if new == old:
        raise ApiError(400, "data_move_same")
    # inside data/ it would move into itself; inside the install an update's prune_versions may delete it
    if home.is_relative_to(old) or (home != install and home.is_relative_to(install)):
        raise ApiError(400, "data_move_inside")
    if home != install and any(c in part.lower() for part in home.parts for c in CLOUD):
        raise ApiError(400, "data_move_cloud")
    try:
        # never merged with, or written over, what is there (agent-links/ is emptied by task clean-ups)
        if (new / config.DB_NAME).is_file():
            if not adopt:
                raise ApiError(409, "data_move_has_data")  # the page asks: use that data?
            _check_db(new / config.DB_NAME)
            config.write_private_json(_move_path(settings.root), {"from": str(old), "home": str(home), "adopt": True})
            return
        if _taken(new) or (home != install and (home / "agent-links").exists()):
            raise ApiError(409, "data_move_used")
        home.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryFile(dir=home):
            pass
        full = home.stat().st_dev != old.stat().st_dev and shutil.disk_usage(home).free < _size(old) * 1.1
    except sqlite3.Error as e:  # not a database, damaged, or written by a newer app
        raise ApiError(409, "data_move_bad_data") from e
    except OSError as e:
        raise ApiError(400, "data_move_unwritable") from e
    if full:
        raise ApiError(409, "data_move_full")
    config.write_private_json(_move_path(settings.root), {"from": str(old), "home": str(home)})


def apply_move(root: Path) -> None:
    """Startup, server lock held, nothing open yet: do the move plan_move left. data/ is renamed (same disk) or
    copied under another name, checked and only then named data/; then the pointer switches and the old copy
    goes (it holds the Telegram session and tokens). A failure leaves the pointer and the old folder as they
    were. A run cut short is finished or redone by the next start: the plan is dropped only at the end. The plan
    may be days old (the app was closed first): the target is checked again, nothing found there is deleted."""
    sweep_left(root)
    plan = config._read_json(_move_path(root))
    if not plan:
        return
    try:
        old, home = Path(plan["from"]), Path(plan["home"])
        new = home / "data"
        if plan.get("adopt"):
            _check_db(new / config.DB_NAME, must=True)  # the disk may be gone since it was asked
            _set_home(root, home)
            config.kept_file(root).write_text(str(old))
            config._pointed.cache_clear()
            _move_path(root).unlink(missing_ok=True)
            return
        if config.data_home(root).resolve() != home:
            if old.is_dir():
                print(f"Đang chuyển dữ liệu sang {new} …", flush=True)  # a copy to another disk takes a while
                if _taken(new):
                    raise FileExistsError(new)
                shutil.rmtree(new, ignore_errors=True)  # empty, or the launcher's log
                try:
                    os.rename(old, new)
                except OSError:  # another disk
                    part = home / PART
                    shutil.rmtree(part, ignore_errors=True)  # ours, from a copy cut short
                    try:
                        shutil.copytree(old, part)
                        _check_db(part / config.DB_NAME)
                        os.rename(part, new)
                    except BaseException:
                        shutil.rmtree(part, ignore_errors=True)
                        raise
            elif not new.is_dir():
                raise FileNotFoundError(old)
            _set_home(root, home)
        shutil.rmtree(old, ignore_errors=True)
        # links saved for agents: other people's text, fetched again when a task needs them (tasks.py)
        shutil.rmtree(old.parent / "agent-links", ignore_errors=True)
        if old.exists():  # Windows: a file still held open
            config.left_file(root).write_text(str(old))
            config._pointed.cache_clear()
            sweep_left(root)
    except (OSError, sqlite3.Error, KeyError, shutil.Error) as e:
        global move_error
        log.error("data move failed: %s", e, exc_info=True)
        move_error = ("failed", "")
        with contextlib.suppress(OSError, KeyError):  # renamed, then the pointer could not be written: back
            if config.data_home(root).resolve() != Path(plan["home"]) and not Path(plan["from"]).exists():
                os.rename(Path(plan["home"]) / "data", plan["from"])
    _move_path(root).unlink(missing_ok=True)


def sweep_left(root: Path) -> None:
    """Every start: delete the old data/ a move left behind (Telegram session, tokens). Until it is gone it stays
    in Settings.secret_dirs and Cài đặt › Dữ liệu says where it is."""
    global move_error
    f = config.left_file(root)
    left = config._pointed(f)
    if not left:
        return
    if left.resolve() != config.data_root(root).resolve():  # never the data in use
        shutil.rmtree(left, ignore_errors=True)
    if left.exists() and left.resolve() != config.data_root(root).resolve():
        move_error = ("old_left", str(left))
        return
    f.unlink(missing_ok=True)
    config._pointed.cache_clear()


def _check_db(db: Path, *, must: bool = False) -> None:
    """Sound, and not from a newer app (its schema is ahead of this code). `must`: a missing file fails too."""
    if not db.is_file():
        if must:
            raise FileNotFoundError(db)
        return
    c = sqlite3.connect(db, timeout=5)
    try:
        if c.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
            raise sqlite3.DatabaseError("integrity_check")
        if c.execute("PRAGMA user_version").fetchone()[0] > len(MIGRATIONS):
            raise sqlite3.DatabaseError("newer schema")
    finally:
        c.close()


def _set_home(root: Path, home: Path) -> None:
    f = config.home_file(root)
    if home == config.default_home(root).resolve():
        f.unlink(missing_ok=True)
    else:
        tmp = f.with_suffix(".tmp")
        tmp.write_text(str(home))
        tmp.replace(f)
    config._pointed.cache_clear()


def build_router(settings) -> APIRouter:
    r = APIRouter(prefix="/api/data")

    @r.post("/move", status_code=202)
    async def move(body: MoveBody, request: Request) -> None:
        """Move data/ (and agent-links/) under another folder: planned here, done by the restart this asks for."""
        agent = request.app.state.agent
        if agent.busy or updater.restart_requested:  # a second ask would interrupt the shutdown under way
            raise ApiError(409, "agent_running")
        await asyncio.to_thread(plan_move, settings, body.path, adopt=body.adopt)
        updater.restart(agent)

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
                await remove_task(s, t["id"])
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
