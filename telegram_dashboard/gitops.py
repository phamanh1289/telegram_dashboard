"""What an AI Agent session changed in its project, and turning that into a branch + pull request (AI Agent › Thay đổi).

Only fixed git / gh commands with argument lists (no shell). Secret-looking files are never staged. Pushing and opening
the PR happen only on the user's click after they saw the file list (the page confirms first)."""

import asyncio
import json
import os
import re
import shutil
import tempfile

from .errors import ApiError

MAX_DIFF = 200_000  # chars of patch text sent to the page
TIMEOUT = 60.0
SECRET_FILE = re.compile(
    r"(^|/)(\.env(\.[\w.-]+)?|id_(rsa|dsa|ecdsa|ed25519)\w*|[^/]*\.(pem|key|p12|pfx|jks|keystore)|"
    r"credentials(\.json)?|secrets?\.(json|ya?ml|properties))$",
    re.I,
)
BASE_BRANCHES = {"main", "master", "develop", "dev"}


async def _git(cwd: str, *args: str, tool: str = "git", env: dict | None = None) -> tuple[int, str, str]:
    """Run git (or gh) in `cwd` to its end, or kill it after TIMEOUT. Uses the user's own credentials (push, gh)."""
    try:
        proc = await asyncio.create_subprocess_exec(
            tool, *args, cwd=cwd, stdin=asyncio.subprocess.DEVNULL,
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
            env={**os.environ, "GIT_TERMINAL_PROMPT": "0", **(env or {})},
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


async def recent(project: str, days: int = 14, limit: int = 40) -> dict | None:
    """The current branch and its latest commits (short hash, day, author, subject), for "is X done yet?" questions.
    None when `project` is not a git repo or git is missing (the answer then rests on the code alone)."""
    try:
        code, branch, _ = await _git(project, "branch", "--show-current")
        if code:
            return None
        code, out, _ = await _git(project, "log", f"--since={days}.days", "-n", str(limit), "--date=short",
                                  "--pretty=format:%h %ad %an: %s")  # fmt: skip
    except ApiError:  # git missing or timed out
        return None
    return {"branch": branch.strip(), "commits": out.splitlines() if not code else []}


async def _tree(project: str) -> str | None:
    """The whole working tree (tracked + untracked, .gitignore kept) as a git tree id, staged in a throwaway copy of
    the index so the user's own staging is untouched. None when `project` is not a git repo."""
    code, idx, _ = await _git(project, "rev-parse", "--path-format=absolute", "--git-path", "index")
    if code:
        return None
    with tempfile.TemporaryDirectory() as d:
        tmp = os.path.join(d, "index")
        if os.path.exists(idx.strip()):
            shutil.copyfile(idx.strip(), tmp)  # keeps the stat cache: only edited files get hashed
        env = {"GIT_INDEX_FILE": tmp}
        code, _, err = await _git(project, "add", "--all", env=env)
        if code:
            raise ApiError(409, "git_failed", detail=err.strip()[-300:])
        code, tree, err = await _git(project, "write-tree", env=env)
        if code:
            raise ApiError(409, "git_failed", detail=err.strip()[-300:])
    return tree.strip()


async def _subs(root: str) -> list[str]:
    """Checked-out submodules of the repo at `root` (paths from it): edits inside one never reach the parent's tree."""
    code, out, _ = await _git(root, "config", "--file", ".gitmodules", "--get-regexp", r"^submodule\..*\.path$")
    paths = [ln.split(" ", 1)[1] for ln in out.splitlines() if " " in ln] if not code else []
    return [p for p in paths if os.path.exists(os.path.join(root, p, ".git"))]


async def snapshot(project: str) -> str | None:
    """`_tree` of the repo, plus one per checked-out submodule (then JSON {"": repo tree, path: tree}). None when
    `project` is not a git repo."""
    code, top, _ = await _git(project, "rev-parse", "--show-toplevel")
    if code:
        return None
    root = top.strip()
    subs = {p: t for p in await _subs(root) if (t := await _tree(os.path.join(root, p)))}
    tree = await _tree(root)
    return json.dumps({"": tree, **subs}) if subs and tree else tree


async def _diff(cwd: str, a: str, b: str, prefix: str = "") -> tuple[list[dict], str]:
    """Files and patch between two tree-ishes of the repo at `cwd`, paths under `prefix` (a submodule's place);
    secret-looking files never read."""
    _, names, _ = await _git(cwd, "diff", "--no-renames", "--name-status", "-z", a, b)
    parts = names.split("\0")
    pairs = list(zip(parts[0:-1:2], parts[1::2], strict=True))  # "-z": status, path, ..., ""
    files = [{"path": prefix + p, "status": st, "secret": bool(SECRET_FILE.search(p))} for st, p in pairs]
    shown = [p for _, p in pairs if not SECRET_FILE.search(p)]
    if not shown:
        return files, ""
    opts = ("--no-renames", "--no-color", "--no-ext-diff", f"--src-prefix=a/{prefix}", f"--dst-prefix=b/{prefix}")
    git = ("--literal-pathspecs", "-c", "core.quotePath=false", "diff")
    _, patch, _ = await _git(cwd, *git, *opts, a, b, "--", *shown)
    return files, patch


async def _mixed(root: str, base: str, paths: list[str]) -> set[str]:
    """Of `paths`, the ones the user had already edited when the session started (HEAD against its start tree): a
    commit of such a file carries those edits too, though the session's diff does not show them."""
    if not paths:
        return set()
    git = ("--literal-pathspecs", "diff", "--no-renames", "--name-only", "-z")
    code, out, _ = await _git(root, *git, "HEAD", base, "--", *paths)
    return set() if code else set(filter(None, out.split("\0")))  # no HEAD yet (a repo without commits): none


async def changes(project: str, base: str | None = None) -> dict:
    """What changed: since `base` (the session's start `snapshot`) when given, else the working tree against HEAD.
    Checked-out submodules too (paths prefixed with theirs; one without a start tree: against its HEAD).
    Branch, changed files (secrets flagged; `mixed`: edited before the session too), `baseline` (False: no start
    tree, so everything in the working tree is listed), and the patch (secret-looking files never read)."""
    code, top, _ = await _git(project, "rev-parse", "--show-toplevel")
    if code:
        raise ApiError(422, "not_git_repo")
    _, branch, _ = await _git(project, "branch", "--show-current")
    root = top.strip()
    bases = json.loads(base) if base and base.startswith("{") else {"": base}
    subs = await _subs(root)
    if bases[""]:
        files, patch = await _diff(root, bases[""], await _tree(root))
    else:
        _, st, _ = await _git(root, "status", "--porcelain=v1", "-z", "--untracked-files=all")
        _, patch, _ = await _git(root, "-c", "core.quotePath=false", "diff", "HEAD", "--no-color", "--no-ext-diff")
        files = _files(st)
        for f in files:  # untracked files are not in `git diff HEAD`: show them as all-added (secrets never read)
            if f["status"] == "??" and not f["secret"] and len(patch) <= MAX_DIFF:
                patch += _new_file(root, f["path"], MAX_DIFF + 1 - len(patch))
    files = [f for f in files if f["path"] not in subs]  # a submodule's own files come next, not its commit pointer
    mixed = await _mixed(root, bases[""], [f["path"] for f in files]) if bases[""] else set()
    for f in files:
        f["mixed"] = f["path"] in mixed
    for p in subs:
        cwd = os.path.join(root, p)
        more, text = await _diff(cwd, bases.get(p) or "HEAD", await _tree(cwd), p + "/")
        files += more
        patch += text
    return {
        "root": root,
        "branch": branch.strip(),
        "files": files,
        "baseline": bool(bases[""]),
        "diff": patch[:MAX_DIFF],
        "truncated": len(patch) > MAX_DIFF,
    }


def _new_file(root: str, path: str, budget: int) -> str:
    """A new-file patch for an untracked file, read at most `budget` bytes; symlinks and paths outside the repo
    skipped."""
    full = os.path.join(root, path)
    if os.path.islink(full) or not os.path.realpath(full).startswith(os.path.realpath(root) + os.sep):
        return ""
    try:
        with open(full, "rb") as fh:
            data = fh.read(budget)
    except OSError:
        return ""
    head = f"diff --git a/{path} b/{path}\nnew file mode 100644\n"
    if b"\0" in data[:8000]:
        return head + f"Binary files /dev/null and b/{path} differ\n"
    lines = data.decode(errors="replace").splitlines()
    return head + f"--- /dev/null\n+++ b/{path}\n@@ -0,0 +1,{len(lines)} @@\n" + "".join(f"+{ln}\n" for ln in lines)


async def open_pr(
    project: str, branch: str, title: str, body: str, base: str | None = None, *, mixed_ok: bool = False
) -> dict:
    """Commit the changed files (since `base`, see `changes`) except secret-looking and submodule ones on a branch (a
    new `branch` when on a base branch or detached), push it and open a PR with gh. Only those paths are committed:
    other files the user changed or staged stay out. Returns url (None when gh is missing / failed: the branch is
    pushed), branch and the files left out. A commit takes whole files, so one that would carry more than the session's
    own edits (a file edited before it started, or no start tree at all) needs `mixed_ok`: the user saw the warning."""
    now = await changes(project, base)
    inner = tuple(p + "/" for p in await _subs(now["root"]))  # a submodule's files commit in its own repo, not here
    keep = [f["path"] for f in now["files"] if not f["secret"] and not f["path"].startswith(inner)]
    skipped = [f["path"] for f in now["files"] if f["path"] not in keep]
    if not keep:
        only_sub = any(f["path"].startswith(inner) for f in now["files"])
        raise ApiError(422, "submodule_only" if only_sub else "no_changes")
    mixed = [f["path"] for f in now["files"] if f.get("mixed") and f["path"] in keep]
    if not mixed_ok and (mixed or not now["baseline"]):
        raise ApiError(409, "mixed_changes" if mixed else "no_baseline", detail=", ".join(mixed)[:300] or None)
    cur = now["branch"]
    if not cur or cur in BASE_BRANCHES:
        code, _, err = await _git(project, "switch", "-c", branch)
        if code:
            raise ApiError(409, "git_failed", detail=err.strip()[-300:])
        cur = branch
    for cmd in (("add", "--all", "--", *keep), ("commit", "-m", title, "-m", body, "--", *keep)):
        code, _, err = await _git(project, "--literal-pathspecs", *cmd)
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
