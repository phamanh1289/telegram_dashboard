"""Cài đặt › Dữ liệu › Đổi thư mục: planned by the running server, done at the next start."""

import os
import shutil
import sqlite3

import pytest
from telegram_dashboard import config, local_data
from telegram_dashboard.config import Settings
from telegram_dashboard.errors import ApiError
from telegram_dashboard.local_data import PART


def _other_disk(monkeypatch):
    """data/ and the picked folder on two disks: no rename between them, the finished copy still renames in place."""
    rename = os.rename

    def cross(a, b):
        if PART not in str(a):
            raise OSError(18, "EXDEV")
        rename(a, b)

    monkeypatch.setattr(os, "rename", cross)


def _install(tmp_path):
    s = Settings(root=tmp_path / "app")
    s.data_dir.mkdir(parents=True)
    sqlite3.connect(s.db_path).execute("CREATE TABLE t(x)").connection.close()
    (s.data_dir / "account.session").write_text("secret")
    return s, s.data_dir


@pytest.mark.parametrize("other_disk", [False, True])
def test_move_and_back(tmp_path, monkeypatch, other_disk):
    s, old = _install(tmp_path)
    if other_disk:
        _other_disk(monkeypatch)
    home = tmp_path / "elsewhere"
    local_data.plan_move(s, str(home))
    assert s.data_dir == old  # nothing moves under a running server
    local_data.apply_move(s.root)
    assert s.data_dir == home.resolve() / "data" and s.db_path.is_file() and not old.exists()
    assert (s.data_dir / "account.session").read_text() == "secret"
    assert local_data.move_error == ("", "") and not local_data._move_path(s.root).exists()
    old.mkdir()
    (old / "server.log").write_text("the git launcher's, made again at each start")
    local_data.plan_move(s, str(s.root))  # the install's own folder: the pointer goes
    local_data.apply_move(s.root)
    assert s.data_dir == old and s.db_path.is_file() and not config.home_file(s.root).exists()


def test_refused_targets(tmp_path):
    s, old = _install(tmp_path)
    used = tmp_path / "used"
    (used / "data").mkdir(parents=True)
    (used / "data" / "x").write_text("theirs")
    for path, code in (("rel", "data_move_relative"), (str(s.root), "data_move_same"),
                       (str(old / "in"), "data_move_inside"), (str(s.root / "sub"), "data_move_inside"),
                       (str(tmp_path / "Dropbox" / "radar"), "data_move_cloud"),
                       (str(used), "data_move_used")):  # fmt: skip
        with pytest.raises(ApiError) as e:
            local_data.plan_move(s, path)
        assert e.value.code == code
    assert not local_data._move_path(s.root).exists()


def test_failed_copy_keeps_the_old_folder(tmp_path, monkeypatch):
    s, old = _install(tmp_path)
    home = tmp_path / "elsewhere"
    local_data.plan_move(s, str(home))
    _other_disk(monkeypatch)
    monkeypatch.setattr(local_data, "_check_db", lambda p: (_ for _ in ()).throw(sqlite3.DatabaseError("bad")))
    local_data.apply_move(s.root)
    assert s.data_dir == old and s.db_path.is_file() and not (home / "data").exists()
    assert local_data.move_error == ("failed", "")
    monkeypatch.setattr(local_data, "move_error", ("", ""))


def test_target_filled_after_planning_is_left_alone(tmp_path):
    s, old = _install(tmp_path)
    home = tmp_path / "elsewhere"
    local_data.plan_move(s, str(home))
    (home / "data").mkdir()
    (home / "data" / "theirs").write_text("put there while the app was closed")
    local_data.apply_move(s.root)
    assert s.data_dir == old and s.db_path.is_file() and (home / "data" / "theirs").is_file()
    assert local_data.move_error == ("failed", "")
    local_data.move_error = ("", "")


def test_another_root_keeps_its_own_data(tmp_path):
    s, _ = _install(tmp_path)
    local_data.plan_move(s, str(tmp_path / "elsewhere"))
    local_data.apply_move(s.root)
    other = Settings(root=tmp_path / "e2e")  # the Playwright fixture server, a second install
    assert other.data_dir == tmp_path / "e2e" / "data"
    assert s.secret_dirs == [s.data_dir, (s.root / "data").resolve()]  # a log from before the move stays denied
    assert other.secret_dirs == [other.data_dir.resolve()]


def test_old_folder_left_behind_stays_denied_until_deleted(tmp_path, monkeypatch):
    s, old = _install(tmp_path)
    local_data.plan_move(s, str(tmp_path / "a"))
    local_data.apply_move(s.root)
    a = s.data_dir
    local_data.plan_move(s, str(tmp_path / "b"))
    _other_disk(monkeypatch)
    rmtree = shutil.rmtree
    monkeypatch.setattr(shutil, "rmtree", lambda p, **k: None if p == a else rmtree(p, **k))  # a file held open
    local_data.apply_move(s.root)
    assert s.data_dir == (tmp_path / "b" / "data").resolve() and a.exists()
    assert local_data.move_error == ("old_left", str(a)) and a in s.secret_dirs
    monkeypatch.setattr(shutil, "rmtree", rmtree)
    local_data.move_error = ("", "")
    local_data.apply_move(s.root)  # the next start, no plan: the sweep alone
    assert not a.exists() and not config.left_file(s.root).exists() and a not in s.secret_dirs
    assert local_data.move_error == ("", "")


def test_use_the_data_already_there(tmp_path):
    s, old = _install(tmp_path)
    theirs = Settings(root=tmp_path / "disk")  # a data/ another install left on a shared disk
    theirs.data_dir.mkdir(parents=True)
    c = sqlite3.connect(theirs.db_path)
    c.execute("CREATE TABLE theirs(x)")
    c.close()
    with pytest.raises(ApiError) as e:
        local_data.plan_move(s, str(tmp_path / "disk"))
    assert e.value.code == "data_move_has_data"  # asked first, never by default
    local_data.plan_move(s, str(tmp_path / "disk"), adopt=True)
    local_data.apply_move(s.root)
    assert s.data_dir == theirs.data_dir.resolve() and (old / "account.session").is_file()  # nothing deleted
    assert sqlite3.connect(s.db_path).execute("SELECT name FROM sqlite_master").fetchone()[0] == "theirs"
    assert local_data.move_error == ("", "")

    back = Settings(root=tmp_path / "newer")
    back.data_dir.mkdir(parents=True)
    c = sqlite3.connect(back.db_path)
    c.execute("PRAGMA user_version=9999")
    c.close()
    with pytest.raises(ApiError) as e:
        local_data.plan_move(s, str(tmp_path / "newer"), adopt=True)
    assert e.value.code == "data_move_bad_data"


def test_crash_after_rename_is_finished(tmp_path):
    s, old = _install(tmp_path)
    home = tmp_path / "elsewhere"
    local_data.plan_move(s, str(home))
    os.rename(old, home / "data")  # the start that died before writing the pointer
    local_data.apply_move(s.root)
    assert s.data_dir == home.resolve() / "data" and s.db_path.is_file()
