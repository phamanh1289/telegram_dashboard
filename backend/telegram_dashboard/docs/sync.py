"""One library sync: (1) the store dir against its rows, (2) the chosen projects' Knowledge Base articles, (3) the
chosen folders. Runs when asked (opening the Tài liệu screen, refresh); no background timer.

A project's articles are listed with GET /api/admin/projects/{shortName}/articles?fields=idReadable,summary,updated
paged by $top/$skip ("Articles in a Project", YouTrack REST docs). Taken from the docs, not checked with a live call
(no token in the dev worktree), so a 403 / 404 there (admin endpoint closed to the user, or not on that server) falls
back to GET /api/articles (no project filter, per the same docs) with project(shortName), kept to the project here.
Only articles whose `updated` changed are downloaded.

Errors land in `lib.errors` as {source, ref, code, detail}; a failed source keeps its indexed docs."""

import asyncio
import os
import time
import zlib
from pathlib import Path

from ..youtrack.client import YtError, YtUnreachable
from .extract import EXTS, read_text
from .library import Library, folder_prefix, sha1

PAGE = 100
MAX_FILES = 2000  # per folder: a picked home dir must not index the whole disk
SKIP_DIRS = {"node_modules", "__pycache__"}  # and every dot dir (.git, .venv…)
# what a broken / encrypted / odd file raises past read_text's ValueError(code)
_READ_ERRORS = (OSError, RuntimeError, EOFError, NotImplementedError, zlib.error)


def _err(errors: list, source: str, ref: str, code: str, detail: str = "") -> None:
    errors.append({"source": source, "ref": ref, "code": code, "detail": detail})


def _yt_err(errors: list, ref: str, e: YtError) -> None:
    _err(errors, "yt_article", ref, "yt_unreachable" if isinstance(e, YtUnreachable) else f"yt_{e.status}", e.message)


async def _reconcile(lib: Library, errors: list) -> None:
    """Rows whose file is gone leave; a file edited by hand is indexed again from the file; one that can't be read
    (not UTF-8, no permission) keeps its row and is reported."""
    keep = set()
    for r in await lib.db.read(lib.db.store.doc_list, source="yt_article"):
        p = lib.path_of(r)
        try:
            text = await asyncio.to_thread(p.read_text, encoding="utf-8")
        except FileNotFoundError:
            continue
        except (OSError, ValueError) as e:
            keep.add(r["ref"])
            _err(errors, "yt_article", r["ref"], "unreadable", type(e).__name__)
            continue
        keep.add(r["ref"])
        if sha1(text) != r["hash"]:
            await lib.index("yt_article", r["ref"], r["title"], text, path=p, size=len(text.encode()),
                            updated_at=r["updated_at"])  # fmt: skip
    await lib.db.write(lib.db.store.doc_delete, source="yt_article", keep=keep)


async def _pages(yt, path: str, fields: str) -> list[dict]:
    listed, skip = [], 0
    while True:
        page = await yt.yt(path, fields=fields, **{"$top": PAGE, "$skip": skip})
        listed += page
        if len(page) < PAGE:
            return listed
        skip += PAGE


async def _listed(yt, project: str) -> list[dict]:
    try:
        return await _pages(yt, f"/api/admin/projects/{project}/articles", "idReadable,summary,updated")
    except YtError as e:
        if isinstance(e, YtUnreachable) or e.status not in (403, 404):
            raise
        closed = e
    every = await _pages(yt, "/api/articles", "idReadable,summary,updated,project(shortName)")
    mine = [a for a in every if (a.get("project") or {}).get("shortName") == project]
    if not mine:  # a wrong / removed / hidden project: report it, never read as "no articles" (that drops its cache)
        raise closed
    return mine


async def _project(lib: Library, yt, project: str, errors: list) -> None:
    try:
        listed = await _listed(yt, project)
    except YtError as e:  # 401 / 403 / network: shown in the UI, the stored articles stay
        _yt_err(errors, project, e)
        return
    have = {r["ref"]: r for r in await lib.db.read(lib.db.store.doc_list, source="yt_article")}
    for a in listed:
        aid = a.get("idReadable")
        if not aid or (aid in have and have[aid]["updated_at"] == a.get("updated")):
            continue
        try:
            await lib.fetch(yt, aid)
        except YtError as e:
            _yt_err(errors, aid, e)
            if isinstance(e, YtUnreachable) or e.status in (401, 403):
                return  # the rest would fail the same way; nothing is dropped
    await lib.drop_articles(f"{project}-A-", keep={a["idReadable"] for a in listed if a.get("idReadable")})


def _walk(folder: str, errors: list) -> tuple[list[tuple[Path, int, int]], set[str], bool]:
    """(resolved path, mtime ms, size) of each supported file under `folder`, the refs of files it could not stat
    (their rows stay), and whether the walk was complete (a dir it could not list: nothing under it is dropped).
    Symlinks are not followed out of the folder; dot dirs and node_modules are skipped."""
    root = Path(folder).resolve()
    prefix, out, failed, complete = folder_prefix(folder), [], set(), [True]

    def onerror(e: OSError) -> None:
        complete[0] = False
        _err(errors, "file", e.filename or folder, "unreadable", type(e).__name__)

    for dirpath, dirnames, filenames in os.walk(root, followlinks=False, onerror=onerror):
        dirnames[:] = sorted(d for d in dirnames if not d.startswith(".") and d not in SKIP_DIRS)
        for name in sorted(filenames):
            p = Path(dirpath) / name
            if p.suffix.lower() not in EXTS:
                continue
            rp = p
            try:
                rp = p.resolve()
                if not str(rp).startswith(prefix):
                    _err(errors, "file", str(p), "outside_folder")
                    continue
                st = rp.stat()
            except OSError as e:
                failed.add(str(rp))
                _err(errors, "file", str(p), "unreadable", type(e).__name__)
                continue
            if len(out) >= MAX_FILES:
                _err(errors, "file", folder, "too_many_files", str(MAX_FILES))
                return out, failed, False
            out.append((rp, int(st.st_mtime * 1000), st.st_size))
    return out, failed, complete[0]


async def _folder(lib: Library, folder: str, errors: list) -> None:
    if not Path(folder).is_dir():  # renamed, unmounted: its docs stay until the user drops the folder
        _err(errors, "file", folder, "folder_missing")
        return
    files, failed, complete = await asyncio.to_thread(_walk, folder, errors)
    have = {r["ref"]: r for r in await lib.db.read(lib.db.store.doc_list, source="file")}
    for path, mtime, size in files:
        row = have.get(str(path))
        if row and row["updated_at"] == mtime and row["size"] == size:
            continue
        try:
            text = await asyncio.to_thread(read_text, path)
        except ValueError as e:
            _err(errors, "file", str(path), str(e.args[0]) if e.args else "unreadable")
            continue
        except _READ_ERRORS as e:  # one bad file never stops the sync
            _err(errors, "file", str(path), "unreadable", type(e).__name__)
            continue
        await lib.index("file", str(path), path.name, text, path=path, size=size, updated_at=mtime)
    if complete:  # a capped walk or an unlistable dir did not see every file: keep the rest
        await lib.db.write(lib.db.store.doc_delete, source="file", path_prefix=folder_prefix(folder),
                           keep={str(p) for p, _, _ in files} | failed)  # fmt: skip


async def run(lib: Library, yt) -> None:
    """A second call waits for the one running, then runs."""
    async with lib.sync_lock:
        errors: list[dict] = []
        await _reconcile(lib, errors)
        src = lib.sources()
        for p in src["projects"]:
            await _project(lib, yt, p, errors)
        for f in src["folders"]:
            await _folder(lib, f, errors)
        lib.errors, lib.synced_at = errors, time.time()
