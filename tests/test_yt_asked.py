from telegram_dashboard.youtrack.asked import asks_me


def test_po_counts_only_a_line_that_asks_the_po():
    po = lambda text: asks_me(text, "anhpt", "Phạm Tuấn Anh", po=True)  # noqa: E731
    assert not po("linhlh chốt thay PO (10/11/2026):\n\nHỏi: thông báo chưa có design.\n\nChốt: phương án 1.")
    assert not po("PO đã chốt phương án 1, không cần sửa code.")
    assert not po("Release lúc 3 PM?")
    assert po("Cần PO xác nhận luồng mất lead")
    assert po("PO ơi, màn này giữ toast chung được không")
    assert po("Mất lead thì mở danh sách nào vậy PO?")
    assert not asks_me("PO cần xác nhận", "anhpt", None, po=False)  # Dev / QA: PO asks are not theirs
    assert asks_me("@anhpt xem giúp", "anhpt", None, po=False)
