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


def test_mandatory_over_mode_budget_renders_whole_and_trims_only_labels():
    own = detail(description="AC1 " + "x" * 40_000)
    shots = {URL+"a": {"texts": ["Nút " + "y" * 200]}}
    fast = build(own, shots=shots)
    assert own["description"] in fast.prompt and "Nút" not in fast.prompt
    assert any("Chọn Kỹ" in w for w in fast.warnings)
    result = build(own, shots=shots, deep=True)
    assert own["description"] in result.prompt and "Nút" in result.prompt
    assert result.manifest["budget"] == 24_000
    for deep in (False, True):
        with pytest.raises(p.BudgetExceeded, match="thu hẹp"):
            build(detail(description="x" * 90_000), deep=deep)


def test_optional_labels_are_whole_deduplicated_and_manifest_declares_omissions():
    labels = [f"Nhãn hoàn chỉnh {n}: " + "x" * 200 for n in range(300)]
    result = build(detail(), shots={URL+"a": {"texts": labels + labels}})
    design = json.loads(result.prompt.split("<zeplin>")[1].split("</zeplin>")[0])
    assert design[URL+"a"] == labels[:len(design[URL+"a"]) ]
    assert result.manifest["estimated_input_tokens"] <= 12_000
    assert result.manifest["omitted"][0]["count"] == len(labels)-len(design[URL+"a"])
    assert result.manifest["measurement"] == "estimated" and result.warnings


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
    assert result.warnings
    raw = {"screens": [{"id": "old", "title": "wrong", "zeplin": URL+"a", "items": []}],
           "links": [{"src": "old", "to": "old", "act": "back"}]}
    flow = uiflow.merge_ai(raw, result.skeleton, "VA-1")
    assert len(flow.screens) == 1 and flow.links[0].to == result.skeleton["screens"][0]["id"]


@pytest.mark.parametrize("count", [5, 20, 60])
def test_corpus_keeps_screen_edge_requirement_coverage_with_smaller_bounded_prompt(count):
    names = [f"Screen {n}" for n in range(count)]
    screens = "\n".join(f'[{name}]({URL}{n})' for n, name in enumerate(names))
    edges = "\n".join(f'{names[n]} -- "Next" --> {names[n+1]}' for n in range(count-1))
    own = detail(description=f"AC1 BR1: full mandatory condition\n{screens}\n{edges}")
    shots = {URL+str(n): {"texts": ["Decorative " + str(i) + "x"*60 for i in range(200)]} for n in range(count)}
    result = build(own, shots=shots)
    baseline = uiflow.AI_FLOW + data_json(own) + data_json(shots)
    assert len(result.skeleton["screens"]) == count and len(result.skeleton["links"]) == count-1
    assert "AC1 BR1: full mandatory condition" in result.prompt
    assert p.estimate(result.prompt) < p.estimate(baseline)
    assert result.manifest["estimated_input_tokens"] <= result.manifest["budget"]
    merged = uiflow.merge_ai({"adapter": 1, "screens": [], "links": []}, result.skeleton, "VA-1")
    assert len(merged.screens) == count and len(merged.links) == count-1


async def test_endpoint_full_source_renders_in_fast_and_only_context_overflow_blocks_ai(tmp_path):
    import httpx
    from fastapi import FastAPI
    from telegram_dashboard.config import Settings
    from telegram_dashboard.storage import Store
    from telegram_dashboard.youtrack import api, api_flow
    from telegram_dashboard.youtrack import service as yt

    svc = yt.YouTrackDashboard(Settings(root=tmp_path, youtrack_url="http://yt", youtrack_token="secret"))
    await svc.start_flow_jobs(Store(tmp_path / "test.db"))
    seen = []
    own = detail(description="AC1 " + "x" * 40_000 + " FULL-TAIL", comments=[{"text": "Correction " + "y"*2000}])
    own["links"] = []

    async def read(*args):
        return own

    async def infer(*args, **kwargs):
        seen.append(args[2])
        return json.dumps({"screens": [{"id": "a", "title": "A", "items": []}], "links": []})

    svc.detail = read
    from unittest.mock import patch

    app = FastAPI()
    app.include_router(api.build_router(svc))
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        with patch.object(api_flow, "_ai", infer):
            fast = await client.post("/api/yt/ai/flow", json={"id": "VA-1"}, headers={"X-Ai-Job": "fast-job-1"})
            assert "done" in json.loads(fast.text.splitlines()[-1]) and "FULL-TAIL" in seen.pop()
            deep = await client.post("/api/yt/ai/flow", json={"id": "VA-1", "deep": True},
                                     headers={"X-Ai-Job": "deep-job-1"})
            result = json.loads(deep.text.splitlines()[-1])["done"]
            assert result["manifest"]["budget"] == 24_000 and len(seen) == 1
            assert "FULL-TAIL" in seen[0] and own["comments"][0]["text"] in seen[0]
            assert result["manifest"]["estimated_input_tokens"] <= 24_000
            own["description"] = "x" * 90_000
            svc.stale("VA-1")
            big = await client.post("/api/yt/ai/flow", json={"id": "VA-1", "deep": True},
                                    headers={"X-Ai-Job": "big-job-1"})
            assert json.loads(big.text.splitlines()[-1])["error"]["status"] == 413 and len(seen) == 1
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
