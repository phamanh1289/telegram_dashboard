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


def test_only_a_zip_signed_with_the_release_key_installs(tmp_path, monkeypatch):
    import rsa

    pub, priv = rsa.newkeys(1024)
    key = tmp_path / "k.pem"
    key.write_bytes(pub.save_pkcs1())
    monkeypatch.setattr(updater, "RELEASE_KEY", key)
    z = tmp_path / "pkg.zip"
    z.write_bytes(b"zip bytes")
    good = rsa.sign(b"zip bytes", priv, "SHA-256")
    assert updater._signed(z, good)
    assert not updater._signed(z, good[:-1] + bytes([good[-1] ^ 1]))
    z.write_bytes(b"other bytes")
    assert not updater._signed(z, good)


def test_the_shipped_release_key_loads():
    import rsa
    from telegram_dashboard.updater import RELEASE_KEY

    assert rsa.PublicKey.load_pkcs1(RELEASE_KEY.read_bytes()).n.bit_length() >= 3072


def test_auto_update_installs_then_waits_for_the_user_to_restart(tmp_path, monkeypatch):
    import asyncio
    from types import SimpleNamespace

    async def no_sleep(_):
        return None

    async def check(_root):
        updater.behind = 1
        return {}

    async def apply(_root):
        return {"updated": True}

    async def installed(_root):
        return "v1.2.0"

    restarts = []
    monkeypatch.setattr(updater.asyncio, "sleep", no_sleep)
    monkeypatch.setattr(updater, "check", check)
    monkeypatch.setattr(updater, "apply", apply)
    monkeypatch.setattr(updater, "_installed", installed)
    monkeypatch.setattr(updater, "auto_enabled", lambda _s: True)
    monkeypatch.setattr(updater, "restart", restarts.append)
    monkeypatch.setattr(updater, "pending", "")
    monkeypatch.setattr(updater, "home", lambda: tmp_path)  # an installed release: versions/<ver>, its own web/out
    agent = SimpleNamespace(busy=False)
    asyncio.run(updater.auto_loop(SimpleNamespace(root=tmp_path), agent))
    assert updater.pending == "v1.2.0"
    assert restarts == []  # the page asks first (POST /api/update/restart)

    # a git checkout rebuilt web/out in place: it restarts now; a version it can't read still owes the restart
    async def unreadable(_root):
        raise OSError("gone")

    monkeypatch.setattr(updater, "home", lambda: None)
    monkeypatch.setattr(updater, "_installed", unreadable)
    asyncio.run(updater.auto_loop(SimpleNamespace(root=tmp_path), agent))
    assert updater.pending == "new" and restarts == [agent]
