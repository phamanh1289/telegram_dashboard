import subprocess
import sys
import time
from types import SimpleNamespace

import pytest
from telegram_dashboard import uninstall


@pytest.mark.skipif(sys.platform == "win32", reason="macOS layout and /bin/sh")
def test_uninstall_deletes_only_this_installs_files_after_the_server_exits(tmp_path, monkeypatch):
    home, h = tmp_path / "home", tmp_path / "home/Applications/Telegram Dashboard"
    (h / "versions/1.0.0").mkdir(parents=True)
    (h / "data").mkdir()
    launch = home / "Applications/Radar.app/Contents/MacOS/launch"
    launch.parent.mkdir(parents=True)
    launch.write_text(f"exec open '{h}/Start Dashboard Telegram.command'")
    bin_ = home / ".local/bin"
    bin_.mkdir(parents=True)
    (bin_ / "myradar").write_text(f"exec '{h}/Start Dashboard Telegram.command'")
    (bin_ / "other-tool").write_text("echo hi")  # the user's own: kept
    agents = home / ".gemini/antigravity-cli/agents"
    agents.mkdir(parents=True)
    (agents / "telegram-dashboard-read.md").write_text("x")
    (agents / "mine.md").write_text("x")
    moved = tmp_path / "disk/data"  # Cài đặt › Dữ liệu › Đổi thư mục
    moved.mkdir(parents=True)
    (moved.parent / "keep.txt").write_text("the folder picked for data/ is the user's")
    run = home / ".telegram_dashboard"
    run.mkdir()
    monkeypatch.setattr(uninstall.Path, "home", lambda: home)
    monkeypatch.setattr(uninstall, "RUN_DIR", run)

    paths = uninstall.targets(SimpleNamespace(data_dir=moved), h)
    assert set(paths) == {h, run, moved, agents / "telegram-dashboard-read.md", home / "Applications/Radar.app",
                          bin_ / "myradar"}  # fmt: skip

    server = subprocess.Popen(["sleep", "1"])  # stands in for the running server
    monkeypatch.setattr(uninstall.os, "getpid", lambda: server.pid)
    uninstall._spawn(h, paths)
    time.sleep(0.5)
    assert h.exists()  # nothing goes while the server runs
    server.wait()
    for _ in range(50):
        if not any(p.exists() for p in paths):
            break
        time.sleep(0.1)
    assert not any(p.exists() for p in paths)
    assert (bin_ / "other-tool").exists() and (agents / "mine.md").exists() and (moved.parent / "keep.txt").exists()
