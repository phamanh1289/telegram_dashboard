from fastapi import FastAPI
from fastapi.testclient import TestClient
from telegram_dashboard import ai, privacy
from telegram_dashboard.config import Settings
from telegram_dashboard.telegram import bridge as telegram


def test_switches_persist_and_apply_live(tmp_path):
    s = Settings(root=tmp_path)
    app = FastAPI()
    app.include_router(privacy.build_router(s))
    c = TestClient(app)
    try:
        assert c.get("/api/privacy").json() == {"redact": False, "notify_preview": False}
        assert c.put("/api/privacy", json={"redact": True, "notify_preview": True}).status_code == 200
        assert ai.REDACT and telegram.NOTIFY_PREVIEW
        assert "0912345678" not in ai.data_json({"text": "gọi 0912345678 hoặc a@b.vn"})
        assert privacy.load(s).redact  # survives a restart (data/config.json)
    finally:
        privacy._apply(privacy.Privacy())
