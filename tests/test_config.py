import json

from telegram_dashboard.config import Settings


def test_ui_config_wins_over_env(tmp_path, monkeypatch):
    monkeypatch.setenv("TELEGRAM_API_ID", "111")
    monkeypatch.setenv("TELEGRAM_API_HASH", "a" * 32)
    assert Settings.from_env(tmp_path).telegram_api_id == 111  # .env still works

    (tmp_path / "data").mkdir()
    Settings(root=tmp_path).save_config(telegram_api_id=222, telegram_api_hash="b" * 32)
    Settings(root=tmp_path).save_config(extra=1)  # merges, keeps the API keys
    s = Settings.from_env(tmp_path)
    assert (s.telegram_api_id, s.telegram_api_hash) == (222, "b" * 32)
    assert (tmp_path / "data" / "config.json").stat().st_mode & 0o777 == 0o600
    assert json.loads((tmp_path / "data" / "config.json").read_text())["telegram_api_id"] == 222

