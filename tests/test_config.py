import json

from conftest import ORIGIN

from telegram_dashboard.config import Settings


def test_ui_config_wins_over_env(tmp_path, monkeypatch):
    monkeypatch.setenv("TELEGRAM_API_ID", "111")
    monkeypatch.setenv("TELEGRAM_API_HASH", "a" * 32)
    monkeypatch.setenv("AI_REQUIRE_CONSENT", "1")
    assert Settings.from_env(tmp_path).telegram_api_id == 111  # .env still works

    (tmp_path / "data").mkdir()
    Settings(root=tmp_path).save_config(telegram_api_id=222, telegram_api_hash="b" * 32)
    Settings(root=tmp_path).save_config(ai_require_consent=False)  # merges, keeps the API keys
    s = Settings.from_env(tmp_path)
    assert (s.telegram_api_id, s.telegram_api_hash, s.ai_require_consent) == (222, "b" * 32, False)
    assert (tmp_path / "data" / "config.json").stat().st_mode & 0o777 == 0o600
    assert json.loads((tmp_path / "data" / "config.json").read_text())["telegram_api_id"] == 222


def test_consent_toggle_from_settings(client, settings):
    st = client.get("/api/status").json()
    assert st["state"] in ("setup_required", "connecting", "connected", "stopped")
    off = client.put("/api/settings/consent", json={"ai_require_consent": False}, headers={"Origin": ORIGIN})
    assert off.status_code == 204
    assert client.get("/api/status").json()["ai_require_consent"] is False
    assert client.app.state.ai.settings.ai_require_consent is False  # AI sees it without a restart
    assert Settings.from_env(settings.root).ai_require_consent is False  # and it survives one
