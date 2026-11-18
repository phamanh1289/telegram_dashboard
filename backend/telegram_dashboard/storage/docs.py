"""Document library: `docs` rows and their FTS5 parts (`doc_parts`). Matching runs on `fold()` text
(accent-less, "Điều" -> "dieu"); the original heading/body ride along in UNINDEXED columns."""

import json

from .common import _like, fold, now_ts

_COLS = "id,source,ref,title,path,hash,chars,size,updated_at,fetched_at,tickets,summary,summary_hash"


def _fts_query(q: str, any_word: bool) -> str:
    """Every word as a quoted FTS5 string (so `a:b`, `-`, `OR` are plain words); the last one is a prefix."""
    words = [w for w in (x.replace('"', "") for x in fold(q).split()) if w]
    if not words:
        return ""
    terms = [f'"{w}"' for w in words]
    terms[-1] += "*"
    return (" OR " if any_word else " ").join(terms)


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
    ) -> int:
        """Insert or refresh a document. Same hash keeps parts and summary; a new hash replaces every part."""
        meta = (title, path, chars, size, updated_at, now_ts(), json.dumps(tickets))
        with self._conn(write=True) as c:
            row = c.execute("SELECT id, hash FROM docs WHERE source=? AND ref=?", (source, ref)).fetchone()
            if row and row["hash"] == hash:
                c.execute(
                    "UPDATE docs SET title=?,path=?,chars=?,size=?,updated_at=?,fetched_at=?,tickets=? WHERE id=?",
                    (*meta, row["id"]),
                )
                return row["id"]
            if row:
                doc_id = row["id"]
                c.execute(
                    "UPDATE docs SET title=?,path=?,chars=?,size=?,updated_at=?,fetched_at=?,tickets=?,"
                    "hash=?,summary=NULL,summary_hash=NULL WHERE id=?",
                    (*meta, hash, doc_id),
                )
                c.execute("DELETE FROM doc_parts WHERE doc_id=?", (doc_id,))
            else:
                doc_id = c.execute(
                    "INSERT INTO docs(title,path,chars,size,updated_at,fetched_at,tickets,hash,"
                    "source,ref) VALUES(?,?,?,?,?,?,?,?,?,?)",
                    (*meta, hash, source, ref),
                ).lastrowid
            c.executemany(
                "INSERT INTO doc_parts(heading,body,doc_id,part,line,text,title) VALUES(?,?,?,?,?,?,?)",
                [(fold(h), fold(b), doc_id, n, line, b, h) for n, (line, h, b) in enumerate(parts)],
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

    def doc_list(self, *, source: str | None = None, ticket: str | None = None) -> list[dict]:
        with self._conn() as c:
            rows = c.execute(
                f"SELECT {_COLS} FROM docs WHERE (?1 IS NULL OR source=?1) "
                "AND (?2 IS NULL OR tickets LIKE ?2 ESCAPE '\\') ORDER BY COALESCE(updated_at, fetched_at) DESC, id",
                (source, _like(json.dumps(ticket)) if ticket else None),
            ).fetchall()
        return [_doc(r) for r in rows]

    def doc_parts(self, id: int) -> list[dict]:
        with self._conn() as c:
            rows = c.execute(
                "SELECT part, line, title AS heading, text AS body FROM doc_parts WHERE doc_id=? ORDER BY part", (id,)
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
    ) -> list[dict]:
        match = _fts_query(q, any_word)
        if not match:
            return []
        with self._conn() as c:
            rows = c.execute(
                "SELECT p.doc_id, p.part, p.line, p.title AS heading, p.text AS body, bm25(doc_parts) AS rank "
                "FROM doc_parts p JOIN docs d ON d.id=p.doc_id WHERE doc_parts MATCH ?1 "
                "AND (?2 IS NULL OR d.source=?2) AND (?3 IS NULL OR d.tickets LIKE ?3 ESCAPE '\\') "
                "AND (?4 IS NULL OR p.doc_id=?4) ORDER BY rank LIMIT ?5",
                (match, source, _like(json.dumps(ticket)) if ticket else None, doc, limit),
            ).fetchall()
        return [dict(r) for r in rows]

    def doc_set_summary(self, id: int, text: str, hash: str) -> None:
        with self._conn(write=True) as c:
            c.execute("UPDATE docs SET summary=?, summary_hash=? WHERE id=?", (text, hash, id))

    def doc_delete(
        self,
        *,
        source: str,
        ref_prefix: str | None = None,
        path_prefix: str | None = None,
        keep: set[str] | None = None,
    ) -> int:
        """Drop documents of a source (optionally under a ref / path prefix) except the `keep` refs."""
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
            ids = [r["id"] for r in rows if r["ref"] not in (keep or ())]
            for i in ids:
                c.execute("DELETE FROM doc_parts WHERE doc_id=?", (i,))
                c.execute("DELETE FROM docs WHERE id=?", (i,))
            return len(ids)

    def doc_clear(self) -> None:
        with self._conn(write=True) as c:
            c.execute("DELETE FROM doc_parts")
            c.execute("DELETE FROM docs")

    def doc_stats(self) -> dict:
        with self._conn() as c:
            row = c.execute("SELECT COUNT(*) n, MIN(fetched_at) oldest FROM docs").fetchone()
        return {"count": row["n"], "oldest": row["oldest"]}
