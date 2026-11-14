import json
import time

import httpx
from yt_test_helpers import issue, make


async def test_watch_once_banners_only_tickets_newly_mine(tmp_path, monkeypatch):
    from telegram_dashboard.telegram import bridge as telegram

    monkeypatch.setattr(telegram, "NOTIFY_PREVIEW", False)
    rows = []

    def mine(n, rep="PO", qc=False):
        i = issue(n)
        i["reporter"] = {"login": "x", "fullName": rep}
        i["customFields"][1]["value"] = {"login": "z" if qc else "me", "fullName": "Z" if qc else "Me"}
        return i

    def handler(req):
        if req.url.path == "/api/users/me":
            return httpx.Response(200, json={"login": "me", "fullName": "Me"})
        return httpx.Response(200, json=rows)

    svc = make(handler)
    svc.watch_path = tmp_path / "yt_watch.json"
    sent = []

    async def notify(*a):
        sent.append(a)

    rows[:] = [mine(1)]
    assert await svc.watch_once(notify) == [] and sent == []  # first look: record only
    rows[:] = [mine(1), mine(2), mine(3, qc=True), mine(4, rep="Me"), mine(5)]
    svc.touched["VA-5"] = time.monotonic()  # I just assigned it from the dashboard
    await svc.watch_once(notify)
    assert sent == [
        ("Ticket mới · VA-2", "Giao cho bạn", "Mở dashboard để xem chi tiết"),
        ("Ticket mới · VA-3", "Nhờ bạn test", "Mở dashboard để xem chi tiết"),
    ]
    await svc.watch_once(notify)
    assert len(sent) == 2  # no repeat
    rows[:] = [mine(n) for n in range(10, 15)]
    await svc.watch_once(notify)
    assert sent[-1] == ("5 ticket mới cho bạn", "", "VA-10, VA-11, VA-12, VA-13, VA-14")  # one banner, not five
    svc.watch_path.write_text(json.dumps({"login": "other", "ids": []}))
    rows[:] = [mine(20)]
    assert await svc.watch_once(notify) == []  # another account: record only


async def test_watch_queues_bao_lai_and_wakes_ticket_snoozes(tmp_path):
    from datetime import UTC, datetime, timedelta

    from telegram_dashboard.events import Hub
    from telegram_dashboard.models import StoredMessage
    from telegram_dashboard.storage import Db, Store

    st = Store(tmp_path / "d.sqlite3")
    db = Db(st, Hub())
    st.set_tracking("c1", True, "G", "group")

    def msg(mid, text, reply=None, out=False):
        return StoredMessage(chat_id="c1", message_id=mid, sender_id="9", sender_name="A", text=text,
                             date=datetime(2026, 11, 1, tzinfo=UTC), edit_date=None, reply_to_id=reply, topic_id=None,
                             outgoing=out, media_kind=None, deleted=False)  # fmt: skip

    for m in (msg(1, "VA-2 lỗi?"), msg(2, "hỏi"), msg(3, "đã tạo VA-3", reply=2, out=True), msg(4, "chờ VA-9")):
        st.apply_message(m)
    st.set_snooze("c1", 4, datetime.now(UTC) + timedelta(days=7), "ticket:VA-9")
    rows, one = [], {}

    def mine(n, state="Open", resolved=None):
        i = issue(n, state)
        i["customFields"][1]["value"] = {"login": "me", "fullName": "Me"}
        return {**i, "resolved": resolved}

    def handler(req):
        if req.url.path == "/api/users/me":
            return httpx.Response(200, json={"login": "me", "fullName": "Me"})
        if req.url.path.startswith("/api/issues/"):
            return httpx.Response(200, json=one[req.url.path.rsplit("/", 1)[1]])
        return httpx.Response(200, json=rows)

    svc = make(handler)
    svc.watch_path = tmp_path / "yt_watch.json"
    rows[:] = [mine(2), mine(3), mine(5)]
    await svc.watch_once(None, db)  # first look: record only
    assert st.loop_items() == []
    rows[:] = [mine(3, "Fixed"), mine(5, "In Progress")]  # VA-2 left the open list: read again
    one["VA-2"] = mine(2, "Done", resolved=5)
    rev = st.loop_rev
    await svc.watch_once(None, db)
    # my own "đã tạo VA-3" is answered on the tag it replied to; VA-5 moved, but not to a finished state
    assert {(i["ticket"], i["message_id"]) for i in st.loop_items()} == {("VA-2", 1), ("VA-3", 2)}
    assert st.loop_rev > rev
    await svc.watch_once(None, db)
    assert len(st.loop_items()) == 2  # queued once
    st.set_handled("c1", 2, True, "reply")  # my reply (any device) answers it
    assert [i["ticket"] for i in st.loop_items()] == ["VA-2"]
    st.done_loop("c1", 1, "VA-2")  # Bỏ qua
    assert st.loop_items() == [] and st.add_loop_items([("VA-2", "Done", "c1", 1)]) == 0  # never queued again

    one["VA-9"] = mine(9, "In Progress")
    await svc.wake_snoozes(db)
    assert st.get_message("c1", 4).snoozed_until is not None
    one["VA-9"] = mine(9, "Done")
    await svc.wake_snoozes(db)
    assert st.get_message("c1", 4).snoozed_until is None
    await svc.aclose()
