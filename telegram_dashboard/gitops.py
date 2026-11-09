"""What an AI Agent session changed in its project, and turning that into a branch + pull request (AI Agent › Thay đổi).

Only fixed git / gh commands with argument lists (no shell). Secret-looking files are never staged. Pushing and opening
the PR happen only on the user's click after they saw the file list (the page confirms first)."""

import asyncio
import os
import re

from .errors import ApiError

MAX_DIFF = 200_000  # chars of patch text sent to the page
TIMEOUT = 60.0
SECRET_FILE = re.compile(r"(^|/)(\.env(\.[\w.-]+)?|id_(rsa|dsa|ecdsa|ed25519)\w*|[^/]*\.(pem|key|p12|pfx|jks|keystore)|"
                         r"credentials(\.json)?|secrets?\.(json|ya?ml|properties))$", re.I)
BASE_BRANCHES = {"main", "master", "develop", "dev"}


async def _git(cwd: str, *args: str, tool: str = "git") -> tuple[int, str, str]:
    """Run git (or gh) in `cwd` to its end, or kill it after TIMEOUT. Uses the user's own credentials (push, gh)."""
    try:
        proc = await asyncio.create_subprocess_exec(
            tool, *args, cwd=cwd, stdin=asyncio.subprocess.DEVNULL,
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
            env={**os.environ, "GIT_TERMINAL_PROMPT": "0"},
        )  # fmt: skip
    except OSError:
        raise ApiError(422, "git_missing" if tool == "git" else "gh_missing") from None
    try:
        out, err = await asyncio.wait_for(proc.communicate(), TIMEOUT)
    except TimeoutError:
        proc.kill()
        await proc.wait()
        raise ApiError(504, "git_timeout") from None
    return proc.returncode or 0, out.decode(errors="replace"), err.decode(errors="replace")


def _files(porcelain: str) -> list[dict]:
    """`git status --porcelain=v1 -z` entries: path and its two-letter status (renames keep the new path)."""
    out, parts = [], porcelain.split("\0")
    i = 0
    while i < len(parts):
        e = parts[i]
        i += 1
        if len(e) < 4:
            continue
        status, path = e[:2], e[3:]
        if "R" in status or "C" in status:
            i += 1  # the old path follows
        out.append({"path": path, "status": status.strip() or "?", "secret": bool(SECRET_FILE.search(path))})
    return out


async def changes(project: str) -> dict:
    """The working tree against HEAD: branch, changed files (secrets flagged), and the patch (tracked files)."""
    code, top, _ = await _git(project, "rev-parse", "--show-toplevel")
    if code:
        raise ApiError(422, "not_git_repo")
    _, branch, _ = await _git(project, "branch", "--show-current")
    _, st, _ = await _git(project, "status", "--porcelain=v1", "-z", "--untracked-files=all")
    _, patch, _ = await _git(project, "diff", "HEAD", "--no-color", "--no-ext-diff")
    files = _files(st)
    return {"root": top.strip(), "branch": branch.strip(), "files": files,
            "diff": patch[:MAX_DIFF], "truncated": len(patch) > MAX_DIFF}


async def open_pr(project: str, branch: str, title: str, body: str) -> dict:
    """Commit every changed file except secret-looking ones on a branch (a new `branch` when on a base branch or
    detached), push it and open a PR with gh. Returns url (None when gh is missing / failed: the branch is pushed),
    branch and the files left out."""
    now = await changes(project)
    keep = [f["path"] for f in now["files"] if not f["secret"]]
    skipped = [f["path"] for f in now["files"] if f["secret"]]
    if not keep:
        raise ApiError(422, "no_changes")
    cur = now["branch"]
    if not cur or cur in BASE_BRANCHES:
        code, _, err = await _git(project, "switch", "-c", branch)
        if code:
            raise ApiError(409, "git_failed", detail=err.strip()[-300:])
        cur = branch
    if skipped:  # one the user staged by hand stays out too
        await _git(project, "reset", "-q", "--", *skipped)
    for cmd in (("add", "--all", "--", *keep), ("commit", "-m", title, "-m", body)):
        code, _, err = await _git(project, *cmd)
        if code:
            raise ApiError(409, "git_failed", detail=err.strip()[-300:])
    code, _, err = await _git(project, "push", "-u", "origin", cur)
    if code:
        raise ApiError(409, "git_push_failed", detail=err.strip()[-300:])
    try:
        code, out, err = await _git(project, "pr", "create", "--title", title, "--body", body, "--head", cur, tool="gh")
    except ApiError:
        return {"url": None, "branch": cur, "skipped": skipped, "note": "Đã đẩy nhánh; máy chưa có gh nên chưa mở PR."}
    url = next((ln for ln in out.split() if ln.startswith("https://")), None)
    note = None if url else f"Đã đẩy nhánh; gh chưa mở được PR: {err.strip()[-200:]}"
    return {"url": url, "branch": cur, "skipped": skipped, "note": note}
