import zipfile

from telegram_dashboard import updater
from telegram_dashboard.config import Settings


def test_release_unpack_and_prune(tmp_path, monkeypatch):
    assert updater._ver("v1.10.0") > updater._ver("1.9.3")

    z = tmp_path / "pkg.zip"
    with zipfile.ZipFile(z, "w") as f:
        f.writestr("Telegram Dashboard/current", "1.1.0")
        f.writestr("Telegram Dashboard/versions/1.1.0/app/VERSION", "1.1.0")
        exe = zipfile.ZipInfo("Telegram Dashboard/versions/1.1.0/python/bin/python3")
        exe.external_attr = 0o755 << 16
        f.writestr(exe, "#!")
    home = tmp_path / "home"
    (home / "versions/1.0.0").mkdir(parents=True)
    updater._extract(z, "1.1.0", home / "versions/1.1.0")
    assert (home / "versions/1.1.0/app/VERSION").read_text() == "1.1.0"
    assert (home / "versions/1.1.0/python/bin/python3").stat().st_mode & 0o111

    (home / "current").write_text("1.1.0")
    monkeypatch.setenv("TD_HOME", str(home))
    updater.prune_versions()
    assert [p.name for p in (home / "versions").iterdir()] == ["1.1.0"]
    assert Settings.from_env(tmp_path).data_dir == home / "data"  # data lives outside versions/
