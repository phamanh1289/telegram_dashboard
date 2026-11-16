import json

import pytest
from telegram_dashboard.ai import data_json
from telegram_dashboard.youtrack import flow as uiflow
from telegram_dashboard.youtrack import flow_prompt as p

URL = "https://app.zeplin.io/project/p/screen/"


def detail(i="VA-1", description="AC1: giữ yêu cầu", comments=None):
    return {"id": i, "summary": "OTP", "description": description, "comments": comments or [],
            "assignee": "omit me", "estimate": 100, "sprints": ["sprint"], "qc": "omit me too"}


def build(own, stories=(), **kwargs):
    return p.build(data_json(own), "".join("<story>" + data_json(s) + "</story>" for s in stories),
                   kwargs.pop("note", ""), kwargs.pop("shots", {}), **kwargs)


def test_complete_requirements_comments_note_and_conflicting_sources_never_truncated():
    own = detail(description="AC1 BR1 " + "bắt buộc " * 1000, comments=[{"text": "Correction " + "x" * 4000}])
    changed = detail(description="Bản mới AC2 BR2")
    result = build(own, [own, changed], note="ghi chú nguyên vẹn")
    assert own["description"] in result.prompt and own["comments"][0]["text"] in result.prompt
    assert changed["description"] in result.prompt and "ghi chú nguyên vẹn" in result.prompt
    assert "assignee" not in result.prompt and "sprints" not in result.prompt and "estimate\"" not in result.prompt
    assert result.manifest["sources"] == ["VA-1"]
    assert result.manifest["omitted"] == [{"source": "VA-1", "kind": "duplicate_source", "count": 1}]


def test_whole_source_goes_untrimmed_and_only_past_any_context_refuses():
    own = detail(description="AC1 " + "x" * 40_000)
    result = build(own, shots={URL+"a": {"texts": ["Nút " + "y" * 200]}})
    assert own["description"] in result.prompt and "Nút" in result.prompt and not result.warnings
    assert set(result.manifest["parts"]) == {"ticket", "story", "zeplin", "note", "rules"}
    with pytest.raises(p.BudgetExceeded, match="tách ticket"):
        build(detail(description="x" * 3 * p.HARD_CONTEXT))


def test_labels_are_whole_deduplicated_and_a_large_input_is_a_risk_not_a_cut():
    labels = [f"Nhãn hoàn chỉnh {n}: " + "x" * 200 for n in range(600)]
    result = build(detail(), shots={URL+"a": {"texts": labels + labels}})
    design = json.loads(result.prompt.split("<zeplin>")[1].split("</zeplin>")[0])
    assert design[URL+"a"] == labels and result.manifest["omitted"] == []
    assert result.manifest["estimated_input_tokens"] > p.RISK_TOKENS
    assert [r["code"] for r in result.manifest["risks"]] == ["tokens"]


def test_explicit_tree_builds_ids_buttons_and_links_code_keeps_metadata_over_ai():
    text = f'[Login]({URL}a)\n├─ “Go” → [Home]({URL}b)\n└─ “Again” → Login'
    result = build(detail(description=text), shots={URL+"a": {"title": "Đăng nhập", "w": 375, "h": 812}})
    a, b = result.skeleton["screens"]
    assert a["id"] == p.stable_id(URL+"a") and a["title"] == "Đăng nhập"
    assert len(result.skeleton["links"]) == 2
    flow = uiflow.merge_ai({"adapter": 1, "screens": [{"id": a["id"], "title": "AI invented", "zeplin": "fake"}],
                           "links": []}, result.skeleton, "VA-1")
    assert flow.screens[0].title == "Đăng nhập" and flow.screens[0].zeplin == URL+"a"
    assert len(flow.links) == 2 and flow.links[0].to == b["id"]
    assert result.skeleton == build(detail(description=text), shots={URL+"a": {"title": "Đăng nhập"}}).skeleton


def test_ambiguous_tree_is_not_guessed_and_legacy_ids_remap_by_url():
    result = build(detail(description=f'[Login]({URL}a)\n├─ “Go” → unknown'))
    assert not result.skeleton["links"] and result.manifest["ambiguous_lines"] == 1
    assert p.unclear("├─ “Go” → unknown", {}) == {"why": "unknown", "name": "unknown", "hint": ""}
    assert p.unclear("├─ “Go” → Đăng nhap", {"Đăng nhập": {"s1"}})["hint"] == "Đăng nhập"
    assert p.unclear("A → B", {})["why"] == "format"
    assert p.not_mobile({"w": 1440, "h": 3000}) and p.not_mobile({"w": 1024, "h": 768})
    assert not p.not_mobile({"w": 375, "h": 812}) and not p.not_mobile({"w": 1290, "h": 2796})
    web = build(detail(description=f"[Home]({URL}a)"), shots={URL+"a": {"title": "Home", "w": 1440, "h": 900}})
    assert [(r["code"], r["lines"][0]["urls"]) for r in web.manifest["risks"]] == [("web", [URL+"a"])]
    both = build(detail(description=f"[Home]({URL}a)\n[App]({URL}b)"),
                 shots={URL+"a": {"w": 1440, "h": 900}, URL+"b": {"w": 375, "h": 812}})
    assert [(r["code"], r["lines"][0]["no"]) for r in both.manifest["risks"]] == [("web", 1), ("mobile", 2)]
    assert result.warnings
    raw = {"screens": [{"id": "old", "title": "wrong", "zeplin": URL+"a", "items": []}],
           "links": [{"src": "old", "to": "old", "act": "back"}]}
    flow = uiflow.merge_ai(raw, result.skeleton, "VA-1")
    assert len(flow.screens) == 1 and flow.links[0].to == result.skeleton["screens"][0]["id"]


@pytest.mark.parametrize("count", [5, 20, 60])
def test_corpus_keeps_screen_edge_requirement_coverage_and_warns_on_many_screens(count):
    names = [f"Screen {n}" for n in range(count)]
    screens = "\n".join(f'[{name}]({URL}{n})' for n, name in enumerate(names))
    edges = "\n".join(f'{names[n]} -- "Next" --> {names[n+1]}' for n in range(count-1))
    own = detail(description=f"AC1 BR1: full mandatory condition\n{screens}\n{edges}")
    shots = {URL+str(n): {"texts": ["Decorative " + str(i) + "x"*60 for i in range(20)]} for n in range(count)}
    result = build(own, shots=shots)
    assert len(result.skeleton["screens"]) == count and len(result.skeleton["links"]) == count-1
    assert "AC1 BR1: full mandatory condition" in result.prompt
    assert ("screens" in [r["code"] for r in result.manifest["risks"]]) == (count > p.RISK_SCREENS)
    merged = uiflow.merge_ai({"adapter": 1, "screens": [], "links": []}, result.skeleton, "VA-1")
    assert len(merged.screens) == count and len(merged.links) == count-1


async def test_endpoint_precheck_counts_and_screens_mode_runs_no_ai_and_only_past_context_refuses(tmp_path):
    import httpx
    from fastapi import FastAPI
    from telegram_dashboard.config import Settings
    from telegram_dashboard.storage import Store
    from telegram_dashboard.youtrack import api, api_flow
    from telegram_dashboard.youtrack import service as yt

    svc = yt.YouTrackDashboard(Settings(root=tmp_path, youtrack_url="http://yt", youtrack_token="secret"))
    await svc.start_flow_jobs(Store(tmp_path / "test.db"))
    seen = []
    tree = f"[Login]({URL}a)\n├─ “Go” → [Home]({URL}b)"
    own = detail(description="AC1 " + "x" * 40_000 + " FULL-TAIL\n" + tree, comments=[{"text": "Correction"}])
    own["links"] = []

    async def read(*args):
        return own

    async def infer(*args, heavy=False, **kwargs):
        seen.append((args[2], heavy))
        return json.dumps({"screens": [{"id": "a", "title": "A", "items": []}], "links": []})

    svc.detail = read
    from unittest.mock import patch

    app = FastAPI()
    app.include_router(api.build_router(svc))
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        with patch.object(api_flow, "_ai", infer):
            check = (await client.post("/api/yt/flow/precheck", json={"id": "VA-1"})).json()
            assert check["screens"] == 2 and check["tokens"] > 10_000 and check["parts"]["ticket"] > 10_000
            assert not seen  # counted by code: no AI
            only = await client.post("/api/yt/ai/flow", json={"id": "VA-1", "mode": "screens"},
                                     headers={"X-Ai-Job": "screens-job-1"})
            done = json.loads(only.text.splitlines()[-1])["done"]
            assert len(done["flow"]["screens"]) == 2 and done["flow"]["links"] == [] and not seen
            full = await client.post("/api/yt/ai/flow", json={"id": "VA-1"}, headers={"X-Ai-Job": "full-job-1"})
            assert "done" in json.loads(full.text.splitlines()[-1])
            assert "FULL-TAIL" in seen[0][0] and seen[0][1] is True  # whole source, the user's (heavy) picks
            advice = await client.post("/api/yt/ai/flow/advice", json={"id": "VA-1"})
            assert advice.json()["text"] and "FULL-TAIL" not in seen[1][0] and seen[1][1] is False
            asked = await client.post("/api/yt/ai/flow/ask", json={
                "id": "VA-1", "question": "#1 là gì?", "history": [{"q": "trước", "a": "đáp"}]})
            assert asked.json()["text"] and "#1 là gì?" in seen[2][0] and "KHÔNG tin cậy" in seen[2][0]
            assert "FULL-TAIL" not in seen[2][0] and seen[2][1] is False  # the lines and names only, light model
            own["description"] = "x" * 3 * p.HARD_CONTEXT
            svc.stale("VA-1")
            big = await client.post("/api/yt/ai/flow", json={"id": "VA-1"}, headers={"X-Ai-Job": "big-job-1"})
            assert json.loads(big.text.splitlines()[-1])["error"]["status"] == 413 and len(seen) == 3
    await svc.aclose()


def test_validated_checkpoint_recovery_keeps_manifest_and_warnings(tmp_path):
    from telegram_dashboard.storage import Store

    store = Store(tmp_path / "test.db")
    flow = uiflow.clean({"screens": [{"id": "a", "title": "A", "items": []}], "links": []}, "VA-1").model_dump()
    result = {"flow": flow, "manifest": {"sources": ["VA-1"]}, "warnings": ["Kiểm tra nguồn"]}
    store.flow_job_create("scope", "job-0001", "VA-1")
    store.flow_job_update("scope", "job-0001", status="running", checkpoint=flow, result=result)
    store = Store(store.path)
    store.flow_jobs_recover()
    assert store.flow_job_get("scope", "job-0001")["result"] == result


def test_invalid_adapter_and_malformed_items_fail_without_an_automatic_repair_call():
    base = {"screens": [{"id": "a", "title": "A", "items": []}], "links": []}
    with pytest.raises(ValueError):
        uiflow.merge_ai({"adapter": 2, "screens": [], "links": []}, base, "VA-1")
    with pytest.raises(ValueError):
        uiflow.merge_ai({"adapter": 1, "screens": [{"id": "a", "items": [{}]}], "links": []}, base, "VA-1")


def test_cost_comes_from_past_runs_on_the_same_model_only():
    rows = [{"feature": "youtrack", "ok": True, "cost": 0.01, "model": "claude-haiku-5-5", "input_tokens": 0,
             "cache_read": 5000, "cache_write": 0, "output_tokens": 5000},
            {"feature": "youtrack", "ok": True, "cost": 9.0, "model": "claude-opus-5-5", "output_tokens": 10},
            {"feature": "telegram", "ok": True, "cost": 9.0, "model": "claude-haiku-5-5", "output_tokens": 10}]
    usd, runs = p.cost(rows, "haiku", 8000, 10)  # 8000 in + 10 screens × 1000 out at 0.01 / 10 000 tokens
    assert (usd, runs) == (0.018, 1)
    assert p.cost(rows, "sonnet", 8000, 10) == (None, 0)



def test_rerender_keeps_the_flow_on_screen_so_the_ai_writes_only_what_is_new():
    text = f'[Login]({URL}a)\n├─ “Go” → [Home]({URL}b)'
    login, home = p.stable_id(URL+"a"), p.stable_id(URL+"b")
    previous = {"screens": [
        {"id": login, "title": "Login", "kind": "screen", "zeplin": URL+"a", "ac": "AC1",
         "items": [{"id": "x", "label": "X"}]},
        {"id": home, "title": "Home", "zeplin": URL+"b", "items": []},
        {"id": "err", "title": "Lỗi", "kind": "popup", "parent": login, "zeplin": "", "items": []},
        {"id": "gone", "title": "Gone", "zeplin": URL+"z", "items": []}],  # its design left the ticket
        "links": [{"src": f"{login}.x", "to": "err", "act": "open"}, {"src": login, "to": "gone"}]}
    result = build(detail(description=text), previous=previous)
    ids = [s["id"] for s in result.skeleton["screens"]]
    assert ids == [login, home, "err"] and result.skeleton["screens"][0]["ac"] == "AC1"
    assert {"src": f"{login}.x", "to": "err", "act": "open"} in result.skeleton["links"]
    assert result.manifest["reused"] == 1  # the link to the gone screen is dropped


def test_split_parts_share_the_ac_keep_own_screens_and_combine_once():
    screens = "\n".join(f"[S{n}]({URL}{n})" for n in range(30))
    shots = {URL+str(n): {"texts": [f"Nút {n}"]} for n in range(30)}
    result = build(detail(description=f"AC9 chung\n{screens}"), shots=shots)
    parts = p.split(result)
    assert len(parts) == result.manifest["chunks"] == 3
    assert all("AC9 chung" in x and "<other_screens>" in x for x in parts)
    assert "Nút 0" in parts[0] and "Nút 0" not in parts[1]  # each part: its own screens' Zeplin texts only
    assert p.split(build(detail())) == [build(detail()).prompt]  # small: one prompt, unchanged
    a = {"screens": [{"id": "pop", "title": "P"}, {"id": "x"}], "links": [{"src": "x", "to": "pop"}]}
    b = {"screens": [{"id": "pop", "title": "P2"}], "links": [{"src": "x", "to": "pop"}]}
    both = p.combine([a, b])
    assert [s["id"] for s in both["screens"]] == ["pop", "x"] and len(both["links"]) == 1


async def test_endpoint_split_runs_each_part_and_joins_one_flow(tmp_path):
    import httpx
    from fastapi import FastAPI
    from telegram_dashboard.config import Settings
    from telegram_dashboard.storage import Store
    from telegram_dashboard.youtrack import api, api_flow
    from telegram_dashboard.youtrack import service as yt

    svc = yt.YouTrackDashboard(Settings(root=tmp_path, youtrack_url="http://yt", youtrack_token="secret"))
    await svc.start_flow_jobs(Store(tmp_path / "test.db"))
    own = detail(description="AC1\n" + "\n".join(f"[S{n}]({URL}{n})" for n in range(25)))
    own["links"] = []
    prompts = []

    async def read(*args):
        return own

    async def infer(*args, **kwargs):
        prompts.append(args[2])
        return json.dumps({"adapter": 1, "screens": [{"id": "err", "title": "Lỗi", "kind": "popup"}], "links": []})

    svc.detail = read
    from unittest.mock import patch

    app = FastAPI()
    app.include_router(api.build_router(svc))
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        with patch.object(api_flow, "_ai", infer):
            r = await client.post("/api/yt/ai/flow", json={"id": "VA-1", "split": True},
                                  headers={"X-Ai-Job": "split-job-1"})
            lines = [json.loads(x) for x in r.text.splitlines()]
            flow = lines[-1]["done"]["flow"]
            assert len(prompts) == 3 and len(flow["screens"]) == 26  # 25 skeleton + one popup written by every part
            draws = [x["step"]["title"] for x in lines if x.get("step", {}).get("stage") == "draw"]
            assert sorted(draws) == ["Phần 1/3", "Phần 2/3", "Phần 3/3"]
    await svc.aclose()


def test_split_tokens_count_every_part():
    from telegram_dashboard.youtrack import flow_prompt as fp

    screens = [{"id": f"s{i}", "title": f"S{i}", "zeplin": f"z{i}", "items": []} for i in range(fp.PART_SCREENS + 1)]
    payload = fp.Payload("p", {"screens": screens, "links": []}, {}, [], "<ticket>" + "x" * 4000 + "</ticket>",
                         {f"z{i}": ["label"] for i in range(len(screens))}, "")
    parts = fp.split(payload)
    assert len(parts) == 2
    assert fp.split_tokens(payload) == sum(fp.estimate(p) + fp.ENVELOPE_RESERVE for p in parts)
    assert fp.split_tokens(payload) > fp.estimate(parts[0]) + fp.ENVELOPE_RESERVE  # the ticket is paid twice


def test_left_out_screen_takes_its_unclear_lines_and_numbers_stay_gapless():
    from telegram_dashboard.youtrack import flow_prompt as fp

    base = {"screens": [{"id": "a", "title": "47 A", "zeplin": "za", "items": []}], "links": []}
    amb = {'Màn 47 A -- "x" --> Màn Z': {"why": "unknown", "name": "Z", "hint": ""}}
    amb |= {f"dòng {i} lạ": {"why": "format", "name": "", "hint": ""} for i in range(fp.RISK_AMBIGUOUS + 1)}
    risk = next(r for r in fp.risks(0, base, amb, left=["47 A"]) if r["code"] == "ambiguous")
    assert [x["no"] for x in risk["lines"]] == list(range(1, fp.RISK_AMBIGUOUS + 2))
    assert all("47 A" not in x["line"] for x in risk["lines"])


def test_platform_group_lists_every_screen_past_the_line_cap():
    from telegram_dashboard.youtrack import flow_prompt as fp

    n = fp.SHOW_LINES + 5
    screens = [{"id": f"s{i}", "title": f"W{i}", "zeplin": f"https://app.zeplin.io/project/p/screen/{i}", "items": []}
               for i in range(n)]
    shots = {s["zeplin"]: {"w": 1440, "h": 900} for s in screens}
    web = next(r for r in fp.risks(0, {"screens": screens, "links": []}, {}, shots) if r["code"] == "web")
    assert len(web["lines"]) == n  # the dialog's skip names them all
