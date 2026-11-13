import pytest

from telegram_dashboard import uiflow as u

RAW = {"screens": [
    {"id": "login", "title": "Đăng nhập", "items": [{"id": "otp", "label": "Gửi OTP"}]},
    {"id": "code", "title": "Nhập OTP", "items": [{"id": "ok", "label": "Xác nhận"}]},
    {"id": "err", "title": "Sai mã", "kind": "popup", "parent": "code", "items": []},
], "links": [
    {"src": "login.otp", "to": "code", "ac": "AC-1"},
    {"src": "code.ok", "to": "err", "act": "open"},
    {"src": "code", "to": "login", "act": "back"},
    {"src": "code.ok", "to": "ghost"},          # đích không tồn tại
    {"src": "nope.x", "to": "code"},            # nguồn không tồn tại
]}


def test_clean_drops_broken_links_and_sets_ticket():
    f = u.clean(RAW, "VA-1")
    assert f.ticket == "VA-1" and f.rev == 0
    assert [(l.src, l.to) for l in f.links] == [("login.otp", "code"), ("code.ok", "err"), ("code", "login")]


def test_clean_rejects_empty_duplicate_and_oversized():
    for bad in ({"screens": [], "links": []},
                {"screens": [RAW["screens"][0]] * 2, "links": []},
                {"screens": [{"id": f"s{i}", "title": "t", "items": []} for i in range(u.MAX_SCREENS + 1)], "links": []}):
        with pytest.raises(ValueError):
            u.clean(bad, "VA-1")


def test_clean_keeps_only_zeplin_urls_and_unknown_parent_becomes_none():
    raw = {"screens": [{"id": "a", "title": "A", "zeplin": "javascript:alert(1)", "parent": "zz", "items": []},
                       {"id": "b", "title": "B", "zeplin": "https://zpl.io/abc", "items": []}], "links": []}
    f = u.clean(raw, "VA-1")
    assert (f.screens[0].zeplin, f.screens[0].parent, f.screens[1].zeplin) == ("", None, "https://zpl.io/abc")


def test_html_round_trip_and_script_escape():
    f = u.clean(RAW, "VA-1")
    f.screens[0].title = 'x</script><script>alert(1)</script>'
    html = u.build_html(f, "/*ENGINE*/")
    assert html.count("</script>") == 2            # engine + data, không thêm cái nào từ nhãn
    assert "/*ENGINE*/" in html and "http" not in html.split("/*ENGINE*/")[0]   # không link ngoài trong khung
    assert u.extract(html) == f
    with pytest.raises(ValueError):
        u.build_html(f, "</SCRIPT>")


def test_extract_returns_none_for_foreign_or_broken_files():
    assert u.extract("<html>no data</html>") is None
    assert u.extract('<script type="application/json" id="uiflow-data">{oops</script>') is None
    assert u.extract('<script type="application/json" id="uiflow-data">{"screens":[],"links":[]}</script>') is None


def test_changes_lists_retarget_add_remove_rename_in_vietnamese():
    old = u.clean(RAW, "VA-1")
    new = old.model_copy(deep=True)
    new.links[0].to = "err"                                   # Gửi OTP: Nhập OTP -> Sai mã
    new.screens.append(u.Screen(id="home", title="Trang chủ", items=[]))
    new.screens[1].title = "OTP"
    assert u.changes(old, new) == [
        'Đổi tên màn "Nhập OTP" → "OTP"',
        'Thêm màn "Trang chủ"',
        '"Gửi OTP" (Đăng nhập): "Nhập OTP" → "Sai mã"',
    ]
    assert u.changes(None, old) == ["Tạo UI flow: 3 màn, 3 liên kết"]
    assert u.changes(old, old) == []
    moved = old.model_copy(deep=True); moved.screens[0].x = 99.0
    assert u.changes(old, moved) == ["Sắp xếp lại vị trí màn"]
