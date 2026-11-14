"""Mechanical rules from .claude/skills/avoiding-dashboard-pitfalls: each one broke for real once."""

import re
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / "web" / "src"


def _web_files():
    return [p for p in WEB.rglob("*") if p.suffix in (".ts", ".tsx", ".js", ".css") and "generated" not in p.name]


def _hits(files, pattern: re.Pattern) -> list[str]:
    return [f"{p.relative_to(ROOT)}:{n}" for p in files
            for n, line in enumerate(p.read_text(errors="ignore").splitlines(), 1) if pattern.search(line)]  # fmt: skip


def test_tailwind_max_container_variant():
    """Tailwind 4 writes it `@max-3xl:`; `max-@3xl:` emits no CSS and no error."""
    assert _hits(_web_files(), re.compile(r"\bmax-@\w")) == []


def test_dates_and_numbers_follow_ui_language():
    """The UI is vi + en (lib/i18n): dates / numbers go through fmtDate / fmtNum / locale(), never a fixed "vi-VN"."""
    files = [p for p in _web_files() if "lib/i18n/" not in p.as_posix()]
    assert _hits(files, re.compile(r"[\"']vi-VN[\"']")) == []


def test_no_native_select_outside_ui():
    """Single-value pickers use ui/dropdown.tsx (CLAUDE.md): the native popup ignores the app theme."""
    files = [p for p in _web_files() if "components/ui/" not in p.as_posix()]
    assert _hits(files, re.compile(r"<select\b")) == []


def test_no_zoneinfo():
    """The bundled Windows Python has no tz database: ZoneInfo("Asia/...") crashed 0.1.7 at startup. Use digest.VN."""
    assert _hits((ROOT / "backend" / "telegram_dashboard").rglob("*.py"), re.compile(r"\bZoneInfo\(")) == []


@pytest.mark.skipif(not shutil.which("git"), reason="git not installed")
def test_no_private_key_in_repo():
    """The release signing key lives in ~/.config and a GitHub secret only; no tracked or new file holds one."""
    out = subprocess.run(["git", "ls-files", "-co", "--exclude-standard"], cwd=ROOT,
                         capture_output=True, text=True, check=True).stdout  # fmt: skip
    marker = re.compile("PRIVATE" + " KEY-----")  # split: this file must not match itself
    files = [ROOT / f for f in out.splitlines() if (ROOT / f).is_file() and (ROOT / f).stat().st_size < 2_000_000]
    assert _hits(files, marker) == []


def test_actions_pinned_to_commit_sha():
    """Release jobs hold `contents: write` and the signing secret: a moved tag must not change what runs."""
    files = list((ROOT / ".github" / "workflows").glob("*.y*ml"))
    uses = re.compile(r"^\s*-?\s*uses:\s*(?!\./|docker://)\S+@(?![0-9a-f]{40}\b)")
    assert _hits(files, uses) == []


def test_guide_targets_exist_in_ui():
    """The live guide lights a step's control by its label or CSS (guide chapters’ `at`). A label renamed in the UI
    ("My team" → "Team") left the walk-through dark with no error; every label / aria-label / id it names must
    still be in the web code, written out or as the head of a template ("Đổi {field} {id}" → "Đổi Assignee")."""
    import json

    src = "\n".join(p.read_text(errors="ignore") for p in _web_files() if "lib/i18n/" not in p.as_posix())
    # a comment naming an old label is not the UI
    src = re.sub(r"/\*[\s\S]*?\*/|(?:^|(?<=\s))//.*", "", src, flags=re.M)
    heads = {h for h in re.findall(r"[\"'`]([^\"'`\n{$]{4,})(?:\{|\$\{)", src)}  # literal part before a placeholder

    def needles(at: str) -> list[str]:
        if at.startswith("css:"):
            sel = at[4:]
            attrs = re.findall(r'(?:aria-label|placeholder|title)[\^$*]?="([^"]+)"', sel)
            return attrs + re.findall(r"#([\w-]+)", sel) + re.findall(r'data-(?:testid|drill)="([^"]+)"', sel)
        label = re.split(r"\s(?:N|<[^>]*>)(?:\s|$)", at)[0].rstrip("….").strip()  # as findControl reads it
        return [label] if len(label) >= 2 else []

    missing = []
    chapters = (WEB / "shared" / "lib" / "guide" / "vi").glob("*.json")
    features = [f for chapter in chapters for f in json.loads(chapter.read_text())]
    assert features, "guide chapters must be checked"
    for f in features:
        for k, step in enumerate(f["how"]):
            at = step.get("at") if isinstance(step, dict) else None
            for a in at if isinstance(at, list) else [at] if at else []:
                missing += [f"{f['id']} step {k + 1}: {n}" for n in needles(a)
                            if n not in src and not any(n.startswith(h) for h in heads)]  # fmt: skip
    assert missing == []


def test_shared_frontend_does_not_import_features_or_app():
    """Reusable components stay independent; app composition and business adapters live outside shared."""
    shared = WEB / "shared"
    assert shared.is_dir()
    imports = re.compile(r"(?:\bfrom\s*|\bimport\s*\()\s*['\"]([^'\"]+)['\"]")
    bad = []
    for p in shared.rglob("*"):
        if p.suffix not in (".ts", ".tsx"):
            continue
        for source in imports.findall(p.read_text()):
            if source.startswith("@/"):
                target = WEB / source[2:]
            elif source.startswith("."):
                target = p.parent / source
            else:
                continue
            target = target.resolve()
            if any(target.is_relative_to(WEB / name) for name in ("features", "app")):
                bad.append(f"{p.relative_to(ROOT)}: {source}")
    assert bad == []


MAX_LINES = 1000  # target ≤ 600; a file past this is split along its seams, not grown (service.py hit 2149)


def test_source_files_stay_small():
    """One file per concern: 2000-line modules hid duplicates (6 copies of one SELECT) and blocked parallel edits."""
    files = [
        *(ROOT / "backend" / "telegram_dashboard").rglob("*.py"),
        *(ROOT / "tests").rglob("*.py"),
        *(p for p in _web_files() if p.suffix != ".css"),
        *(p for p in (ROOT / "web" / "tests").rglob("*") if p.suffix in {".ts", ".js", ".py"}),
        *(p for p in (ROOT / "scripts").rglob("*") if p.suffix in {".py", ".js", ".mjs", ".cjs"}),
    ]
    sizes = {p: len(p.read_text(errors="ignore").splitlines()) for p in files}
    assert [f"{p.relative_to(ROOT)}: {n}" for p, n in sizes.items() if n > MAX_LINES] == []


def test_python_deps_pinned():
    """`uvicorn==0.*` let a fresh lock pull any 0.x; every runtime and dev dependency is pinned to X.Y.Z."""
    import tomllib

    py = tomllib.loads((ROOT / "pyproject.toml").read_text())
    deps = py["project"]["dependencies"] + [d for g in py.get("dependency-groups", {}).values() for d in g]
    assert [d for d in deps if not re.fullmatch(r"[\w.-]+==\d+\.\d+\.\d+", d)] == []

