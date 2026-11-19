"""Document library: `docs` rows, their parts (`doc_parts`, original text) and the contentless FTS5 index of the parts
(`doc_fts`, same rowid). Matching runs on `fold()` text (accent-less, "Điều" -> "dieu"). A part's id is
`doc_id << 20 | part`, so a doc's parts are one id range in both tables (no scan of every part to read / drop one)."""

import json

from .common import _like, fold, now_ts

_LIST = (
    "id,source,ref,title,path,hash,chars,size,updated_at,fetched_at,tickets,parent,summary IS NOT NULL AS has_summary"
)
_COLS = _LIST + ",summary,summary_hash"
KEEP_REVS = 20  # updates kept per document (doc_revs), newest
KEEP_AI = 1000  # Tài liệu's AI history rows kept (doc_ai), newest
SHIFT = 20  # parts per doc < 2**20: a 200k-char doc of one-line headings stays far below


def _span(doc_id: int) -> tuple[int, int]:
    return doc_id << SHIFT, (doc_id << SHIFT) | ((1 << SHIFT) - 1)


# A Knowledge Base article is "in the sources" when its project (the ID before "-A-") is chosen whole, or it is a chosen
# article or under one (`parent` chain); the others are the AI Agent's cache (hidden from the list and search, read
# again by the Agent). ?P / ?R: the chosen projects / articles as JSON (P NULL: no such filter), ?O: 1 for the cache,
# 0 for the rest. Files and messages are never cached articles.
_KB = (
    "(?{P} IS NULL OR d.source!='yt_article' OR ("
    "substr(d.ref, 1, instr(d.ref, '-A-') - 1) IN (SELECT value FROM json_each(?{P})) "
    "OR d.ref IN (WITH RECURSIVE b(ref) AS (SELECT value FROM json_each(?{R}) UNION "
    "SELECT x.ref FROM docs x JOIN b ON x.parent=b.ref WHERE x.source='yt_article') SELECT ref FROM b)"
    ") != ?{O})"
)


def _kb(projects: list[str] | None, roots: list[str] | None, cache: bool) -> tuple[str | None, str, int]:
    return (None if projects is None else json.dumps(projects)), json.dumps(roots or []), int(cache)


def _drop_parts(c, doc_id: int) -> None:
    c.execute("DELETE FROM doc_fts WHERE rowid BETWEEN ? AND ?", _span(doc_id))
    c.execute("DELETE FROM doc_parts WHERE id BETWEEN ? AND ?", _span(doc_id))


def _fts_query(q: str, any_word: bool) -> str:
    """Every word as a quoted FTS5 string (so `a:b`, `-`, `OR` are plain words). Typed words (all of them): the last
    one is a prefix, as it may be half typed. A question (any word): whole words, "gì" must not match "giai"."""
    words = [w for w in (x.replace('"', "") for x in fold(q).split()) if w]
    if not words:
        return ""
    terms = [f'"{w}"' for w in words]
    if not any_word:
        terms[-1] += "*"
    return (" OR " if any_word else " ").join(terms)


def ai_key(question: str) -> str:
    """A question as matched against the saved ones: accent-less, case-less, spaces and end punctuation aside."""
    return " ".join(fold(question).split()).rstrip(" ?.!…")


def _ai_row(r, *, stale: bool) -> dict:
    return {**{k: r[k] for k in ("id", "session", "kind", "doc_id", "doc_title", "question", "text", "at")},
            "cites": json.loads(r["cites"]), "stale": stale}  # fmt: skip


def _doc(row) -> dict:
    d = dict(row)
    d["tickets"] = json.loads(d["tickets"])
    return d


class Docs:
    def doc_upsert(
        self,
        source: str,
        ref: str,
        *,
        title: str,
        path: str,
        hash: str,
        chars: int,
        size: int,
        updated_at: int | None,
        tickets: list[str],
        parts: list[tuple[int, str, str]],
        parent: str | None = None,
        rev: dict | None = None,
        by: str | None = None,
    ) -> int:
        """Insert or refresh a document. Same hash keeps parts and summary; a new hash replaces every part and, for a
        document stored before, records `rev` (what changed, docs.parts.changes) by `by`, keeping KEEP_REVS."""
        meta = (title, path, chars, size, updated_at, now_ts(), json.dumps(tickets), parent)
        with self._conn(write=True) as c:
            row = c.execute("SELECT id, hash FROM docs WHERE source=? AND ref=?", (source, ref)).fetchone()
            if row and row["hash"] == hash:
                c.execute(
                    "UPDATE docs SET title=?,path=?,chars=?,size=?,updated_at=?,fetched_at=?,tickets=?,parent=? "
                    "WHERE id=?",
                    (*meta, row["id"]),
                )
                return row["id"]
            if row:
                doc_id = row["id"]
                c.execute(
                    "UPDATE docs SET title=?,path=?,chars=?,size=?,updated_at=?,fetched_at=?,tickets=?,parent=?,"
                    "hash=?,summary=NULL,summary_hash=NULL WHERE id=?",
                    (*meta, hash, doc_id),
                )
                _drop_parts(c, doc_id)
                if rev:
                    c.execute(
                        "INSERT INTO doc_revs(doc_id,at,by,changes) VALUES(?,?,?,?)",
                        (doc_id, updated_at or now_ts() * 1000, by, json.dumps(rev, ensure_ascii=False)),
                    )
                    c.execute(
                        "DELETE FROM doc_revs WHERE doc_id=?1 AND id NOT IN "
                        "(SELECT id FROM doc_revs WHERE doc_id=?1 ORDER BY id DESC LIMIT ?2)",
                        (doc_id, KEEP_REVS),
                    )
            else:
                doc_id = c.execute(
                    "INSERT INTO docs(title,path,chars,size,updated_at,fetched_at,tickets,parent,hash,"
                    "source,ref) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
                    (*meta, hash, source, ref),
                ).lastrowid
            base = doc_id << SHIFT
            c.executemany(
                "INSERT INTO doc_parts(id,doc_id,part,line,heading,body) VALUES(?,?,?,?,?,?)",
                [(base | n, doc_id, n, line, h, b) for n, (line, h, b) in enumerate(parts)],
            )
            c.executemany(
                "INSERT INTO doc_fts(rowid,heading,body) VALUES(?,?,?)",
                [(base | n, fold(h), fold(b)) for n, (_, h, b) in enumerate(parts)],
            )
            return doc_id

    def doc_find(self, source: str, ref: str) -> dict | None:
        with self._conn() as c:
            row = c.execute(f"SELECT {_COLS} FROM docs WHERE source=? AND ref=?", (source, ref)).fetchone()
        return _doc(row) if row else None

    def doc_get(self, id: int) -> dict | None:
        with self._conn() as c:
            row = c.execute(f"SELECT {_COLS} FROM docs WHERE id=?", (id,)).fetchone()
        return _doc(row) if row else None

    def doc_list(
        self,
        *,
        source: str | None = None,
        ticket: str | None = None,
        projects: list[str] | None = None,
        roots: list[str] | None = None,
        cache: bool = False,
    ) -> list[dict]:
        """`projects` / `roots` (the chosen projects / articles): the articles outside them only with `cache`, else only
        the others."""
        with self._conn() as c:
            rows = c.execute(
                f"SELECT {_LIST} FROM docs d WHERE (?1 IS NULL OR source=?1) "
                f"AND (?2 IS NULL OR tickets LIKE ?2 ESCAPE '\\') AND {_KB.format(P=3, R=4, O=5)} "
                "ORDER BY COALESCE(updated_at, fetched_at) DESC, id",
                (source, _like(json.dumps(ticket)) if ticket else None, *_kb(projects, roots, cache)),
            ).fetchall()
        return [_doc(r) for r in rows]

    def doc_parts(self, id: int) -> list[dict]:
        with self._conn() as c:
            rows = c.execute(
                "SELECT part, line, heading, body FROM doc_parts WHERE id BETWEEN ? AND ? ORDER BY id", _span(id)
            ).fetchall()
        return [dict(r) for r in rows]

    def doc_search(
        self,
        q: str,
        *,
        source: str | None = None,
        ticket: str | None = None,
        doc: int | None = None,
        any_word: bool = False,
        limit: int = 30,
        projects: list[str] | None = None,
        roots: list[str] | None = None,
        cache: bool = False,
    ) -> list[dict]:
        match = _fts_query(q, any_word)
        if not match:
            return []
        kb = _kb(projects, roots, cache)
        with self._conn() as c:
            rows = c.execute(
                "SELECT p.doc_id, p.part, p.line, p.heading, p.body, bm25(doc_fts) AS rank FROM doc_fts f "
                "JOIN doc_parts p ON p.id=f.rowid JOIN docs d ON d.id=p.doc_id WHERE doc_fts MATCH ?1 "
                "AND (?2 IS NULL OR d.source=?2) AND (?3 IS NULL OR d.tickets LIKE ?3 ESCAPE '\\') "
                f"AND (?4 IS NULL OR p.doc_id=?4) AND {_KB.format(P=6, R=7, O=8)} ORDER BY rank LIMIT ?5",
                (match, source, _like(json.dumps(ticket)) if ticket else None, doc, limit, *kb),
            ).fetchall()
        return [dict(r) for r in rows]

    def doc_set_parents(self, parents: dict[str, str | None]) -> None:
        """Articles moved in the Knowledge Base tree since they were stored (the listing gives every one's parent)."""
        with self._conn(write=True) as c:
            c.executemany(
                "UPDATE docs SET parent=? WHERE source='yt_article' AND ref=? AND parent IS NOT ?",
                [(p, ref, p) for ref, p in parents.items()],
            )

    def doc_revs(self, id: int) -> list[dict]:
        """A document's recorded updates, newest first."""
        with self._conn() as c:
            rows = c.execute("SELECT at, by, changes FROM doc_revs WHERE doc_id=? ORDER BY id DESC", (id,)).fetchall()
        return [{"at": r["at"], "by": r["by"], **json.loads(r["changes"])} for r in rows]

    def doc_set_summary(self, id: int, text: str, hash: str) -> None:
        with self._conn(write=True) as c:
            c.execute("UPDATE docs SET summary=?, summary_hash=? WHERE id=?", (text, hash, id))

    def doc_ai_add(self, session: str, kind: str, *, doc_id: int | None, question: str, text: str, cites: list) -> None:
        """Record one Hỏi answer / Tóm tắt (kind ask / summary) with the document's version and title as now."""
        with self._conn(write=True) as c:
            d = c.execute("SELECT hash, title FROM docs WHERE id=?", (doc_id,)).fetchone()
            c.execute(
                "INSERT INTO doc_ai(session,kind,doc_id,doc_hash,doc_title,question,qkey,text,cites,at) "
                "VALUES(?,?,?,?,?,?,?,?,?,?)",
                (session, kind, doc_id, d and d["hash"], d["title"] if d else "", question, ai_key(question), text,
                 json.dumps(cites, ensure_ascii=False), now_ts()),
            )  # fmt: skip
            c.execute(
                "DELETE FROM doc_ai WHERE id <= (SELECT id FROM doc_ai ORDER BY id DESC LIMIT 1 OFFSET ?)", (KEEP_AI,)
            )

    def doc_ai_find(self, doc_id: int, question: str) -> dict | None:
        """The last answer to the same question on this version of the document (its text unchanged since)."""
        with self._conn() as c:
            r = c.execute(
                "SELECT a.* FROM doc_ai a JOIN docs d ON d.id=a.doc_id AND d.hash=a.doc_hash "
                "WHERE a.kind='ask' AND a.doc_id=? AND a.qkey=? ORDER BY a.id DESC LIMIT 1",
                (doc_id, ai_key(question)),
            ).fetchone()
        return r and _ai_row(r, stale=False)

    def doc_ai_sessions(self, doc_id: int | None = None) -> list[dict]:
        """The AI conversations, newest first: last activity, turns, the first question (or the first summary's
        document). `doc_id`: those with a turn on that document."""
        with self._conn() as c:
            rows = c.execute(
                "SELECT a.session, MAX(a.at) at, COUNT(*) n, f.kind, f.question, f.doc_id, f.doc_title FROM doc_ai a "
                "JOIN doc_ai f ON f.id=(SELECT MIN(id) FROM doc_ai WHERE session=a.session) "
                "WHERE ?1 IS NULL OR a.session IN (SELECT session FROM doc_ai WHERE doc_id=?1) "
                "GROUP BY a.session ORDER BY MAX(a.id) DESC",
                (doc_id,),
            ).fetchall()
        return [dict(r) for r in rows]

    def doc_ai_turns(self, session: str) -> list[dict]:
        """A conversation's turns in order; `stale`: its document changed (or went) since."""
        with self._conn() as c:
            rows = c.execute(
                "SELECT a.*, d.hash IS NULL OR d.hash IS NOT a.doc_hash AS stale FROM doc_ai a "
                "LEFT JOIN docs d ON d.id=a.doc_id WHERE a.session=? ORDER BY a.id",
                (session,),
            ).fetchall()
        return [_ai_row(r, stale=bool(r["stale"]) and r["doc_id"] is not None) for r in rows]

    def doc_ai_delete(self, sessions: list[str]) -> None:
        with self._conn(write=True) as c:
            c.executemany("DELETE FROM doc_ai WHERE session=?", [(s,) for s in sessions])

    def doc_delete(
        self,
        *,
        source: str,
        ref_prefix: str | None = None,
        path_prefix: str | None = None,
        keep: set[str] | None = None,
        only: set[str] | None = None,
    ) -> int:
        """Drop documents of a source (optionally under a ref / path prefix, or only the `only` refs) except `keep`."""
        with self._conn(write=True) as c:
            rows = c.execute(
                "SELECT id, ref FROM docs WHERE source=?1 AND (?2 IS NULL OR ref LIKE ?2 ESCAPE '\\') "
                "AND (?3 IS NULL OR path LIKE ?3 ESCAPE '\\')",
                (
                    source,
                    _like(ref_prefix)[1:] if ref_prefix else None,
                    _like(path_prefix)[1:] if path_prefix else None,
                ),
            ).fetchall()
            ids = [r["id"] for r in rows if r["ref"] not in (keep or ()) and (only is None or r["ref"] in only)]
            for i in ids:
                _drop_parts(c, i)
                c.execute("DELETE FROM doc_revs WHERE doc_id=?", (i,))
                c.execute("DELETE FROM docs WHERE id=?", (i,))
            return len(ids)

    def doc_clear(self) -> None:
        with self._conn(write=True) as c:
            c.execute("DELETE FROM doc_fts")
            c.execute("DELETE FROM doc_parts")
            c.execute("DELETE FROM doc_revs")
            c.execute("DELETE FROM doc_ai")  # its AI history goes with the library
            c.execute("DELETE FROM docs")

    def doc_stats(self) -> dict:
        with self._conn() as c:
            row = c.execute("SELECT COUNT(*) n, MIN(fetched_at) oldest FROM docs").fetchone()
        return {"count": row["n"], "oldest": row["oldest"]}
