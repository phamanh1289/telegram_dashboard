"""Tài liệu's AI history (doc_ai): answers and summaries kept per conversation, a repeated question on the same
version of a document given back without an AI run."""

import pytest
from test_docs_api import Ai, _origin, add, done  # noqa: F401 (_origin: the autouse fixture)


@pytest.fixture
def ai(client):
    fake = Ai()
    client.app.state.ai.ask = fake.ask
    return fake


def ask(client, doc, question, session="s1", **kw):
    return done(client.post("/api/docs/ask", json={"question": question, "doc": doc, "session": session, **kw}))


def test_the_same_question_on_the_same_document_comes_back_saved(client, ai):
    doc = add(client, "VA-A-1", "Điều kiện giải ngân: đủ chữ ký")
    first = ask(client, doc, "Điều kiện giải ngân?")
    assert first["saved_at"] is None and len(ai.calls) == 1
    again = ask(client, doc, "  dieu kien GIAI ngan ", session="s2")  # accents, case, spaces, end mark aside
    assert again["saved_at"] and again["text"] == first["text"] and len(ai.calls) == 1
    assert ask(client, doc, "Điều kiện giải ngân?", fresh=True)["saved_at"] is None and len(ai.calls) == 2


def test_a_changed_document_asks_the_ai_again_and_marks_the_old_turn(client, ai):
    doc = add(client, "VA-A-1", "Điều kiện giải ngân: đủ chữ ký")
    ask(client, doc, "Điều kiện?")
    assert add(client, "VA-A-1", "Điều kiện giải ngân: đủ chữ ký và CCCD") == doc
    assert ask(client, doc, "Điều kiện?")["saved_at"] is None and len(ai.calls) == 2
    turns = client.get("/api/docs/ai/s1").json()
    assert [t["stale"] for t in turns] == [True, False]
    assert turns[0]["doc_title"] == "Bài VA-A-1" and turns[0]["cites"][0]["doc"] == doc


def test_sessions_list_newest_first_filter_by_document_and_delete(client, ai):
    a = add(client, "VA-A-1", "Điều kiện giải ngân")
    b = add(client, "VA-A-2", "Phí trễ hạn")
    ask(client, a, "Điều kiện?", session="one")
    ask(client, b, "Phí?", session="two")
    all_ = client.get("/api/docs/ai").json()
    assert [s["session"] for s in all_] == ["two", "one"] and all_[1]["question"] == "Điều kiện?"
    assert [s["session"] for s in client.get("/api/docs/ai", params={"doc": a}).json()] == ["one"]
    assert client.delete("/api/docs/ai", params={"session": ["one", "two"]}).status_code == 204
    assert client.get("/api/docs/ai").json() == []


def test_summaries_are_kept_once_and_outlive_a_change(client, ai):
    doc = add(client, "VA-A-1", "Điều kiện giải ngân")
    done(client.post(f"/api/docs/{doc}/summary", params={"session": "s1"}))
    done(client.post(f"/api/docs/{doc}/summary", params={"session": "s1"}))  # from the cache: not a new turn
    add(client, "VA-A-1", "Điều kiện giải ngân mới")
    turns = client.get("/api/docs/ai/s1").json()
    assert [(t["kind"], t["stale"]) for t in turns] == [("summary", True)]
    assert client.get("/api/docs/ai").json()[0]["kind"] == "summary"


def test_a_bad_session_id_is_refused(client, ai):
    doc = add(client, "VA-A-1", "Điều kiện giải ngân")
    assert client.post("/api/docs/ask", json={"question": "x", "doc": doc, "session": "a/b"}).status_code == 422
    assert client.post(f"/api/docs/{doc}/summary", params={"session": "a b"}).status_code == 422
