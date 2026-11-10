"""Mechanical rules from .claude/skills/avoiding-dashboard-pitfalls: each one broke for real once."""

import re
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / "web" / "src"


def _web_files():
    return [p for p in WEB.rglob("*") if p.suffix in (".ts", ".tsx", ".css") and "generated" not in p.name]


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
    assert _hits((ROOT / "telegram_dashboard").rglob("*.py"), re.compile(r"\bZoneInfo\(")) == []


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
