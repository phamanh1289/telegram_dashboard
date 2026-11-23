import pytest
from conftest import A, B, msg
from telegram_dashboard.storage import Store


@pytest.fixture
def store(tmp_path):
    return Store(tmp_path / "db.sqlite3")


def put(store, ref, parts, *, hash="h1", source="yt_article", tickets=(), title="T"):
    return store.doc_upsert(
        source,
        ref,
        title=title,
        path=ref if source == "file" else f"/d/{ref}",
        hash=hash,
        chars=10,
        size=10,
        updated_at=100,
        tickets=list(tickets),
        parts=parts,
    )


def test_search_is_accent_free_and_finds_d_stroke(store):
    i = put(store, "VA-A-1", [(1, "# Điều kiện", "Điều kiện giải ngân khoản vay")])
    assert [r["doc_id"] for r in store.doc_search("dieu kien giai ngan")] == [i]
    hit = store.doc_search("giai nga")[0]
    assert hit["body"] == "Điều kiện giải ngân khoản vay"  # prefix match, original accents back
    assert hit["heading"] == "# Điều kiện"


def test_fts_syntax_in_a_query_is_plain_words(store):
    put(store, "VA-A-1", [(1, "", "ticket VA-12033 a:b")])
    for q in ("VA-12033", "a:b", '"', "*", 'x" OR "y', "-", ""):
        store.doc_search(q)  # no error
    assert store.doc_search("VA-12033")


def test_same_hash_keeps_summary_new_hash_replaces_parts(store):
    i = put(store, "R", [(1, "a", "old body")])
    store.doc_set_summary(i, "sum", "sh")
    assert put(store, "R", [(1, "x", "ignored")], title="T2") == i
    assert store.doc_get(i)["summary"] == "sum" and store.doc_get(i)["title"] == "T2"
    assert [p["body"] for p in store.doc_parts(i)] == ["old body"]
    assert put(store, "R", [(1, "n", "new one"), (5, "m", "new two")], hash="h2") == i
    assert [(p["part"], p["line"], p["body"]) for p in store.doc_parts(i)] == [(0, 1, "new one"), (1, 5, "new two")]
    assert store.doc_get(i)["summary"] is None and store.doc_search("old") == []


def test_filters_and_any_word(store):
    a = put(store, "A", [(1, "", "alpha beta")], tickets=["VA-1"])
    b = put(store, "/f/b.md", [(1, "", "alpha gamma")], source="file")
    assert {r["doc_id"] for r in store.doc_search("alpha")} == {a, b}
    assert [r["doc_id"] for r in store.doc_search("alpha", source="file")] == [b]
    assert [r["doc_id"] for r in store.doc_search("alpha", ticket="VA-1")] == [a]
    assert [r["doc_id"] for r in store.doc_search("alpha", doc=b)] == [b]
    assert store.doc_search("beta gamma") == []
    assert {r["doc_id"] for r in store.doc_search("beta gamma", any_word=True)} == {a, b}
    assert [d["id"] for d in store.doc_list(ticket="VA-1")] == [a]


def test_delete_clear_stats(store):
    put(store, "A", [(1, "", "one")])
    put(store, "/x/1", [(1, "", "two")], source="file")
    put(store, "/x/2", [(1, "", "three")], source="file")
    put(store, "/y/3", [(1, "", "four")], source="file")
    assert store.doc_delete(source="file", ref_prefix="/x/", keep={"/x/1"}) == 1
    assert store.doc_search("three") == [] and store.doc_search("two")
    assert store.doc_delete(source="file", path_prefix="/y/") == 1
    assert store.doc_stats()["count"] == 2
    store.doc_clear()
    assert store.doc_stats() == {"count": 0, "oldest": None} and store.doc_search("one") == []


def test_search_tracked_folds_and_skips_untracked_and_deleted(env):
    env.track(A)
    env.store.apply_message(msg(A, 1, "Điều kiện giải ngân"))
    env.store.apply_message(msg(A, 2, "giải ngân xong"))
    env.store.apply_message(msg(A, 3, "Điều kiện giải ngân nữa"))
    env.store.apply_message(msg(B, 4, "Điều kiện giải ngân"))  # B not tracked: not stored
    env.store.apply_deletion(A, ["3"])
    assert [r["message_id"] for r in env.store.search_tracked("dieu kien giai")] == [1]
    assert env.store.search_tracked("") == []


def test_parts_of_the_first_docs_schema_survive_the_move_to_doc_ranges(tmp_path):
    import sqlite3

    from telegram_dashboard.storage.common import fold
    from telegram_dashboard.storage.schema import MIGRATIONS, SCHEMA, _doc_parts_by_doc

    path = tmp_path / "old.sqlite3"
    c = sqlite3.connect(path, isolation_level=None)
    c.row_factory = sqlite3.Row
    c.create_function("fold", 1, fold)
    c.executescript(SCHEMA)
    before = MIGRATIONS.index(_doc_parts_by_doc)
    for step in MIGRATIONS[:before]:
        step(c)
    c.execute(f"PRAGMA user_version={before}")
    c.execute(
        "INSERT INTO docs(id,source,ref,title,path,hash,chars,fetched_at) VALUES(7,'file','/a.md','a','/a','h',1,1)"
    )
    c.execute(
        "INSERT INTO doc_parts(heading,body,doc_id,part,line,text,title) "
        "VALUES('# dieu','giai ngan',7,0,1,'giải ngân','# Điều')"
    )
    c.close()
    store = Store(path)
    assert store.doc_parts(7) == [{"part": 0, "line": 1, "heading": "# Điều", "body": "giải ngân"}]
    assert [r["doc_id"] for r in store.doc_search("giai ngan")] == [7]
    store.doc_delete(source="file")
    assert store.doc_parts(7) == [] and store.doc_search("giai") == []
