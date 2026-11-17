import time
from pathlib import Path


def _mascot(client, h, **body):
    """Start a drawing and wait for it to settle (it runs in the background); its job as GET lists it."""
    job = client.post("/api/ai/mascot", json={"description": "con mèo", **body}, headers=h).json()
    for _ in range(50):
        got = next(j for j in client.get("/api/ai/mascot", headers=h).json() if j["id"] == job["id"])
        if got["state"] != "running":
            return got
        time.sleep(0.02)
    raise AssertionError("still running")


def test_ai_mascot_keeps_only_plain_shapes(client, monkeypatch):
    async def ask(self, user, *a, **kw):
        assert "con mèo" in user and "pixel art" in user and kw["feature"] == "mascot" and kw["fast"]
        return ('Here:\n```svg\n<svg viewBox="0 0 32 32" width="64" onload="x()"><script>alert(1)</script>'
                '<circle cx="16" cy="16" r="10" fill="#f80" onclick="y()" style="fill:url(javascript:z)"/>'
                '<rect x="2" y="3" width="4" height="5"/>'
                '<foreignObject><div/></foreignObject><text>hi</text><use href="#a"/></svg>\n```')

    monkeypatch.setattr("telegram_dashboard.ai.AiService.ask", ask)
    h = {"Origin": "http://127.0.0.1:8765"}
    job = _mascot(client, h, style="pixel")
    ns = 'xmlns="http://www.w3.org/2000/svg"'
    shapes = '<circle cx="16" cy="16" r="10" fill="#f80" /><rect x="2" y="3" width="4" height="5" />'
    # the root's width goes, the rect's stays
    assert (job["state"], job["svg"]) == ("done", f'<svg viewBox="0 0 32 32" {ns}>{shapes}</svg>')

    async def prose(self, user, *a, **kw):
        return "Sorry, I can't draw."

    monkeypatch.setattr("telegram_dashboard.ai.AiService.ask", prose)
    assert (_mascot(client, h)["state"], _mascot(client, h)["error"]) == ("error", "mascot_invalid")
    assert client.delete(f"/api/ai/mascot/{job['id']}", headers=h).status_code == 204
    assert job["id"] not in [j["id"] for j in client.get("/api/ai/mascot", headers=h).json()]


def test_ai_mascot_draws_after_a_reference_picture(client, monkeypatch):
    seen = {}

    async def ask(self, user, *a, **kw):
        path = user.split("open it with Read): ")[-1].split(". ")[0]
        seen.update(pick=kw["pick"])
        if "Read" in user:
            seen.update(dir=kw["read_dir"], fast=kw["fast"], bytes=Path(path).read_bytes())
        return '<svg viewBox="0 0 32 32"><circle cx="16" cy="16" r="9"/></svg>'

    monkeypatch.setattr("telegram_dashboard.ai.AiService.ask", ask)
    monkeypatch.setattr("telegram_dashboard.ai.AiService.reader_available", property(lambda self: True))
    h = {"Origin": "http://127.0.0.1:8765"}
    assert _mascot(client, h, image="data:image/png;base64,iVBORw0K")["state"] == "done"
    assert not seen["fast"]  # a reference picture: the picked model
    assert seen["bytes"] == b"\x89PNG\r\n" and not Path(seen["dir"]).exists()  # the folder goes with the run
    _mascot(client, h, model="opus", effort="high")
    assert seen["pick"] == ("opus", "high")  # the dialog's own pick
    for bad in ("data:image/svg+xml;base64,PHN2Zz4=", "data:image/png;base64,@@"):
        r = client.post("/api/ai/mascot", json={"description": "x", "image": bad}, headers=h)
        assert (r.status_code, r.json()["error"]["code"]) == (422, "mascot_image_invalid")


def test_ai_mascot_rig_groups_parts_and_keeps_every_shape(client, monkeypatch):
    still = (
        '<svg viewBox="0 0 32 32"><circle cx="12" cy="10" r="2"/><circle cx="20" cy="10" r="2"/>'
        '<path d="M21 15 L30 5"/></svg>'
    )
    rigged = ('<svg viewBox="0 0 32 32"><g class="m-blink" onclick="x()"><circle cx="12" cy="10" r="2"/>'
              '<circle cx="20" cy="10" r="2"/></g><g class="m-wave" transform-origin="21 15">'
              '<path d="M21 15 L30 5" class="evil"/></g><g class="m-glow" transform-origin="url(x)"/></svg>')
    answers = iter([still, rigged, still, "<svg viewBox='0 0 32 32'><g class='m-blink'><circle r='9'/></g></svg>"])

    async def ask(self, user, *a, **kw):
        return next(answers)

    monkeypatch.setattr("telegram_dashboard.ai.AiService.ask", ask)
    h = {"Origin": "http://127.0.0.1:8765"}
    job = _mascot(client, h)
    got = client.post(f"/api/ai/mascot/{job['id']}/rig", json={"model": "haiku"}, headers=h).json()
    assert got["rigged"] and 'class="m-blink"' in got["svg"] and 'transform-origin="21 15"' in got["svg"]
    assert "onclick" not in got["svg"] and "evil" not in got["svg"] and "url(" not in got["svg"]
    again = client.post(f"/api/ai/mascot/{job['id']}/rig", json={}, headers=h).json()  # kept: no second run
    assert again["svg"] == got["svg"]
    bad = _mascot(client, h)  # the rig redraws (one circle instead of three shapes): refused, the still one stays
    r = client.post(f"/api/ai/mascot/{bad['id']}/rig", json={}, headers=h)
    assert (r.status_code, r.json()["error"]["code"]) == (502, "mascot_rig_invalid")
    r = client.post("/api/ai/mascot/nope/rig", json={}, headers=h)
    assert (r.status_code, r.json()["error"]["code"]) == (404, "mascot_gone")
