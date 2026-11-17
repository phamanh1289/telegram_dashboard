"""Outbox: sends from the dashboard, claimed and finished once each."""

import sqlite3
from datetime import UTC, datetime

from ..errors import ApiError
from ..models import OutboxDTO, StoredMessage
from ..telegram.qa import has_tag, qa_code
from .common import content_hash, now_ts, reply_code
from .threads import _attached


class Outbox:
    # ---- outbox --------------------------------------------------------
    @staticmethod
    def _outbox_row(c: sqlite3.Connection, request_id: str) -> sqlite3.Row | None:
        return c.execute("SELECT * FROM outbox WHERE request_id=?", (request_id,)).fetchone()

    @staticmethod
    def _outbox_dto(r: sqlite3.Row) -> OutboxDTO:
        return OutboxDTO(
            request_id=r["request_id"],
            code=r["code"],
            chat_id=r["chat_id"],
            reply_to_message_id=str(r["reply_to_message_id"]),
            status=r["status"],
            message_id=None if r["message_id"] is None else str(r["message_id"]),
            error_code=r["error_code"],
            retry_after=r["retry_after"],
        )

    def outbox_create(
        self,
        request_id: str,
        chat_id: str,
        reply_to: int,
        text: str,
        random_id: int,
        quote: bool = True,
        *,
        qa: bool = False,
        qa_role: str | None = None,
    ) -> tuple[OutboxDTO, bool]:
        """Returns (record, created). Same id with different payload => 409. `qa`: a "#QA…" line under a text that
        tags someone, minted once here (the hash is over the text as typed), so a retry sends the same code; `qa_role`
        (BE / PO / QC) goes in it: "#QA_BE_…"."""
        qa_key = f"\nqa{qa_role or ''}" if qa else ""
        h = content_hash(f"{chat_id}\n{reply_to}\n{text}" + ("" if quote else "\nnew") + qa_key)
        with self._conn(write=True) as c:
            row = self._outbox_row(c, request_id)
            if row is not None:
                if row["text_hash"] != h:
                    raise ApiError(409, "request_payload_mismatch")
                return self._outbox_dto(row), False
            chat = self._chat(c, chat_id)
            # A new message (not quote) only borrows the target's topic: it may be a message read live and never
            # stored (Đối chiếu BE from Với BE / Briefing).
            # ponytail: unstored => General topic, fetch it if forums need it.
            target = self._msg(c, chat_id, reply_to)
            attached = target is None and _attached(c, chat_id, reply_to)
            if chat is None or not (chat["tracking"] or attached):
                raise ApiError(409, "not_tracking")
            if quote and (target["deleted"] if target is not None else not attached):
                raise ApiError(404, "reply_not_found")
            ts = now_ts()
            if qa and has_tag(text):
                text = f"{text.strip()}\n{qa_code(datetime.now(UTC), role=qa_role)}"
            c.execute(
                "INSERT INTO outbox (request_id,chat_id,reply_to_message_id,text,text_hash,"
                "random_id,status,created_at,updated_at,code,quote) VALUES (?,?,?,?,?,?,'pending',?,?,?,?)",
                (request_id, chat_id, reply_to, text, h, random_id, ts, ts, reply_code(request_id), int(quote)),
            )
            return self._outbox_dto(self._outbox_row(c, request_id)), True

    def outbox_get(self, request_id: str) -> OutboxDTO | None:
        with self._conn() as c:
            r = self._outbox_row(c, request_id)
            return None if r is None else self._outbox_dto(r)

    def outbox_claim(self, request_id: str, allow_unknown: bool = False) -> dict | None:
        """Atomically move pending/failed (and unknown on explicit retry) to sending.

        Returns send parameters, or None when another caller owns it / nothing to send.
        """
        allowed = ("pending", "failed") + (("unknown",) if allow_unknown else ())
        with self._conn(write=True) as c:
            r = self._outbox_row(c, request_id)
            if r is None or r["status"] not in allowed or not r["text"]:
                return None
            chat = self._chat(c, r["chat_id"])
            if chat is None or not (chat["tracking"] or _attached(c, r["chat_id"], r["reply_to_message_id"])):
                return None
            c.execute(
                "UPDATE outbox SET status='sending', error_code=NULL, retry_after=NULL, "
                "updated_at=? WHERE request_id=?",
                (now_ts(), request_id),
            )
            topic = self._msg(c, r["chat_id"], r["reply_to_message_id"])
            return {
                "chat_id": r["chat_id"],
                "reply_to": r["reply_to_message_id"] if r["quote"] else None,  # None: a new message
                "text": r["text"],
                "random_id": r["random_id"],
                "topic_id": None if topic is None else topic["topic_id"],
            }

    def outbox_finish(
        self,
        request_id: str,
        status: str,
        *,
        message_id: int | None = None,
        error_code: str | None = None,
        retry_after: int | None = None,
        sent: StoredMessage | None = None,
    ) -> OutboxDTO:
        """Record the result; a sent message is upserted in the same transaction."""
        with self._conn(write=True) as c:
            r = self._outbox_row(c, request_id)
            if r is None:
                raise ApiError(404, "request_not_found")
            c.execute(
                "UPDATE outbox SET status=?, message_id=?, error_code=?, retry_after=?, "
                "updated_at=?, text=CASE WHEN ?='sent' THEN '' ELSE text END, "
                "sent_at=CASE WHEN ?='sent' THEN ? ELSE sent_at END WHERE request_id=?",
                (status, message_id, error_code, retry_after, now_ts(), status, status, now_ts(), request_id),
            )
            if sent is not None:
                chat = self._chat(c, sent.chat_id)
                if chat is not None and chat["tracking"]:
                    self._upsert_message(c, sent, chat)
            if status == "sent" and r["quote"]:  # replying from the dashboard handles the tag
                self._mark(c, r["chat_id"], r["reply_to_message_id"], True, "dashboard")
            return self._outbox_dto(self._outbox_row(c, request_id))

    def outbox_recover(self) -> None:
        """After restart: unclaimed pending is certainly unsent; sending is unknown."""
        with self._conn(write=True) as c:
            ts = now_ts()
            c.execute(
                "UPDATE outbox SET status='failed', error_code='restart', updated_at=? WHERE status='pending'",
                (ts,),
            )
            c.execute(
                "UPDATE outbox SET status='unknown', error_code='restart', updated_at=? WHERE status='sending'",
                (ts,),
            )
