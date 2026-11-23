"""One library sync: (1) the store dir against its rows, (2) the chosen Knowledge Base projects and branches (a chosen
article and every one under it, by parentArticle), (3) the chosen folders. Runs when asked (opening the Tài liệu
screen, refresh); no background timer.

A project's articles are listed with GET /api/admin/projects/{shortName}/articles?fields=idReadable,summary,updated,
ordinal,parentArticle(idReadable)
paged by $top/$skip ("Articles in a Project", YouTrack REST docs). Taken from the docs, not checked with a live call
(no token in the dev worktree), so a 403 / 404 there (admin endpoint closed to the user, or not on that server) falls
back to GET /api/articles (no project filter, per the same docs) with project(shortName), kept to the project here.
Only articles whose `updated` changed are downloaded, FETCHES at a time.

Errors land in `lib.errors` as {source, ref, code, detail}; a failed source keeps its indexed docs. A sources change
(`lib.stop`) ends the sync at its next doc: nothing more is written or dropped, errors and synced_at stay as is."""

import asyncio
import os
import time
import zlib
from pathlib import Path

from ..youtrack.client import YtError, YtUnreachable, pages
from .extract import EXTS, read_text
from .library import Library, folder_prefix, sha1

FETCHES = 4  # articles downloaded at once
MAX_FILES = 2000  # per folder: a picked home dir must not index the whole disk
SKIP_DIRS = {"node_modules", "__pycache__"}  # and every dot dir (.git, .venv…)
# what a broken / encrypted / odd file raises past read_text's ValueError(code)
_READ_ERRORS = (OSError, RuntimeError, EOFError, NotImplementedError, zlib.error)


class _Stopped(Exception):
    pass


def _go(lib: Library) -> None:
    if lib.stop:
        raise _Stopped


def _err(errors: list, source: str, ref: str, code: str, detail: str = "") -> None:
    errors.append({"source": source, "ref": ref, "code": code, "detail": detail})


def _yt_err(errors: list, ref: str, e: YtError) -> None:
    _err(errors, "yt_article", ref, "yt_unreachable" if isinstance(e, YtUnreachable) else f"yt_{e.status}", e.message)


async def _reconcile(lib: Library, errors: list) -> None:
    """Rows whose file is gone leave; a file edited by hand is indexed again from the file; one that can't be read
    (not UTF-8, no permission) keeps its row and is reported."""
    keep = set()
    for r in await lib.db.read(lib.db.store.doc_list, source="yt_article"):
        _go(lib)
        p = lib.path_of(r)
        try:
            st = await asyncio.to_thread(p.stat)
            if st.st_size == r["size"] and st.st_mtime <= r["fetched_at"]:  # untouched since it was indexed
                keep.add(r["ref"])
                continue
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
                            updated_at=r["updated_at"], parent=r["parent"])  # fmt: skip
    await lib.write(lib.db.store.doc_delete, source="yt_article", keep=keep)


FIELDS = "idReadable,summary,updated,ordinal,parentArticle(idReadable)"


def parent_of(a: dict) -> str | None:
    return (a.get("parentArticle") or {}).get("idReadable")


async def listed(yt, project: str, every: dict) -> list[dict]:
    """A project's articles ({idReadable, summary, updated, ordinal, parentArticle}). `every`: this sync's listing of
    all articles, fetched once for every project that falls back to it."""
    try:
        return await pages(yt, f"/api/admin/projects/{project}/articles", fields=FIELDS)
    except YtError as e:
        if isinstance(e, YtUnreachable) or e.status not in (403, 404):
            raise
        closed = e
    if "all" not in every:
        every["all"] = await pages(yt, "/api/articles", fields=f"{FIELDS},project(shortName)")
    mine = [a for a in every["all"] if (a.get("project") or {}).get("shortName") == project]
    if not mine:  # a wrong / removed / hidden project: report it, never read as "no articles" (that drops its cache)
        raise closed
    return mine


def _branches(rows: list[dict], roots: list[str], errors: list) -> set[str]:
    """The IDs of `roots` and every article under them; a root not listed (deleted, moved out, hidden) is reported."""
    kids: dict[str, list[str]] = {}
    for a in rows:
        kids.setdefault(parent_of(a) or "", []).append(a["idReadable"])
    ids, out = {a["idReadable"] for a in rows}, set()
    todo = []
    for r in roots:
        if r in ids:
            todo.append(r)
        else:
            _err(errors, "yt_article", r, "yt_404")
    while todo:
        if (a := todo.pop()) not in out:
            out.add(a)
            todo.extend(kids.get(a, ()))
    return out


async def _project(lib: Library, yt, project: str, errors: list, every: dict, roots: list[str] | None = None) -> None:
    """`roots`: only those branches of the project (None: all of it)."""
    try:
        rows = [a for a in await listed(yt, project, every) if a.get("idReadable")]
    except YtError as e:  # 401 / 403 / network: shown in the UI, the stored articles stay
        _yt_err(errors, project, e)
        return
    have = {r["ref"]: r for r in await lib.db.read(lib.db.store.doc_list, source="yt_article")}
    wanted = None if roots is None else _branches(rows, roots, errors)
    todo = [a["idReadable"] for a in rows if (wanted is None or a["idReadable"] in wanted)
            and not (a["idReadable"] in have and have[a["idReadable"]]["updated_at"] == a.get("updated"))]  # fmt: skip
    sem, dead = asyncio.Semaphore(FETCHES), []

    async def one(aid: str) -> None:
        async with sem:
            if dead or lib.stop:
                return
            try:
                await lib.fetch(yt, aid)
            except YtError as e:
                _yt_err(errors, aid, e)
                if isinstance(e, YtUnreachable) or e.status in (401, 403):
                    dead.append(e)  # the rest would fail the same way

    await asyncio.gather(*(one(aid) for aid in todo))
    _go(lib)
    # the listing's tree: articles moved / reordered since they were stored, and any download that came without it
    await lib.write(lib.db.store.doc_set_tree, {a["idReadable"]: (parent_of(a), a.get("ordinal")) for a in rows})
    if dead:
        return  # nothing is dropped
    await lib.drop_articles(f"{project}-A-", keep={a["idReadable"] for a in rows})  # deleted on YouTrack


def _walk(folder: str, errors: list, guarded=()) -> tuple[list[tuple[Path, int, int]], set[str], bool]:
    """(resolved path, mtime ms, size) of each supported file under `folder`, the refs of files it could not stat
    (their rows stay), and whether the walk was complete (a dir it could not list: nothing under it is dropped).
    Symlinks are not followed out of the folder; dot dirs, node_modules and `guarded` (this app, its data: tokens)
    are skipped."""
    root = Path(folder).resolve()
    if any(root.is_relative_to(g) for g in guarded):  # saved before the guard: its docs go
        return [], set(), True
    prefix, out, failed, complete = folder_prefix(folder), [], set(), [True]

    def onerror(e: OSError) -> None:
        complete[0] = False
        _err(errors, "file", e.filename or folder, "unreadable", type(e).__name__)

    for dirpath, dirnames, filenames in os.walk(root, followlinks=False, onerror=onerror):
        dirnames[:] = sorted(d for d in dirnames if not d.startswith(".") and d not in SKIP_DIRS
                             and (Path(dirpath) / d).resolve() not in guarded)  # fmt: skip
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
    files, failed, complete = await asyncio.to_thread(_walk, folder, errors, lib.settings.guarded_dirs)
    have = {r["ref"]: r for r in await lib.db.read(lib.db.store.doc_list, source="file")}
    for path, mtime, size in files:
        _go(lib)
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
        await lib.write(lib.db.store.doc_delete, source="file", path_prefix=folder_prefix(folder),
                           keep={str(p) for p, _, _ in files} | failed)  # fmt: skip


async def run(lib: Library, yt, *, max_age: float = 0) -> None:
    """A second call waits for the one running, then runs unless that one ended less than `max_age` seconds ago."""
    async with lib.sync_lock:
        if lib.synced_at is not None and time.time() - lib.synced_at < max_age:
            return
        errors: list[dict] = []
        try:
            await _reconcile(lib, errors)
            src, every = lib.sources(), {}
            branches: dict[str, list[str]] = {}
            for a in src["articles"]:
                branches.setdefault(a.split("-A-")[0], []).append(a)
            for p in [*src["projects"], *sorted(set(branches) - set(src["projects"]))]:
                _go(lib)
                await _project(lib, yt, p, errors, every, None if p in src["projects"] else branches[p])
            for f in src["folders"]:
                _go(lib)
                await _folder(lib, f, errors)
        except _Stopped:
            return
        lib.errors, lib.synced_at = errors, time.time()
