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


def test_extract_matches_data_block_by_id_in_any_attribute_order():
    f = u.clean(RAW, "VA-1")
    html = u.build_html(f, "")
    swapped = html.replace('type="application/json" id="uiflow-data"', 'id="uiflow-data" type="application/json"')
    assert swapped != html and u.extract(swapped) == f
    other = u.clean({"screens": [{"id": "z", "title": "Z", "items": []}], "links": []}, "VA-2")
    assert u.extract(u.build_html(f, "") + u.build_html(other, "")) == f


def test_changes_flags_property_only_edits_and_not_rev():
    old = u.clean(RAW, "VA-1")
    for edit in (lambda f: setattr(f.screens[2], "kind", "sheet"), lambda f: setattr(f.links[0], "when", "x"),
                 lambda f: setattr(f.screens[0], "zeplin", "https://zpl.io/q")):
        new = old.model_copy(deep=True)
        edit(new)
        assert u.changes(old, new) == ["Sửa thuộc tính màn / liên kết"]
    bumped = old.model_copy(deep=True, update={"rev": 5})
    assert u.changes(old, bumped) == []


def test_changes_add_remove_link_remove_screen_and_back_link_format():
    old = u.clean(RAW, "VA-1")
    new = old.model_copy(deep=True)
    new.links[2].to = "err"                                   # back: Đăng nhập -> Sai mã
    del new.links[1]                                          # Xác nhận -> Sai mã bị bỏ
    new.links.append(u.Link(src="login.otp", to="login", act="open"))
    assert u.changes(old, new) == [
        'Màn "Nhập OTP" (back): "Đăng nhập" → "Sai mã"',
        'Nối "Gửi OTP" (Đăng nhập) → "Đăng nhập"',
        'Bỏ nối "Xác nhận" (Nhập OTP) → "Sai mã"',
    ]
    gone = old.model_copy(deep=True)
    gone.screens.pop()
    gone.links = [k for k in gone.links if k.to != "err"]
    assert u.changes(old, gone)[0] == 'Xoá màn "Sai mã"'


def test_clean_truncates_long_strings_and_extra_items_instead_of_rejecting():
    raw = {"screens": [{"id": "a", "title": "t" * 100, "ac": "c" * 50, "parent": "a",
                        "items": [{"id": f"i{n}", "label": "l" * 81} for n in range(21)]}],
           "links": [{"src": "a.i0", "to": "a", "when": "w" * 90}] * (u.MAX_LINKS + 5)}
    f = u.clean(raw, "VA-1")
    s = f.screens[0]
    assert (len(s.title), len(s.ac), len(s.items), len(s.items[0].label), s.parent) == (80, 40, 20, 80, None)
    assert len(f.links) == u.MAX_LINKS and len(f.links[0].when) == 80


def test_malformed_shapes_raise_value_error_and_extract_returns_none():
    ok = RAW["screens"][:1]
    for bad in ({"screens": ["x"], "links": []}, {"screens": ok, "links": {"a": 1}},
                {"screens": [{"id": "a", "title": "A", "items": ["x"]}], "links": []}, []):
        with pytest.raises(ValueError):
            u.clean(bad, "VA-1")
    html = '<script type="application/json" id="uiflow-data">{"screens":["x"],"links":[],"ticket":"T"}</script>'
    assert u.extract(html) is None
