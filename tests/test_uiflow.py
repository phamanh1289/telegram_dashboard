import pytest
from telegram_dashboard.youtrack import flow as u

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
    assert [(k.src, k.to) for k in f.links] == [("login.otp", "code"), ("code.ok", "err"), ("code", "login")]


def test_clean_rejects_empty_duplicate_and_oversized():
    for bad in ({"screens": [], "links": []},
                {"screens": [RAW["screens"][0]] * 2, "links": []},
                {"screens": [{"id": f"s{i}", "title": "t", "items": []} for i in range(u.MAX_SCREENS + 1)],
                 "links": []}):
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
    assert html.count("</script>") == 3            # engine + data + ảnh, không thêm cái nào từ nhãn
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
    moved = old.model_copy(deep=True)
    moved.screens[0].x = 99.0
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


def _live(n=6):
    screens = [{"id": f"S{i}B" if i % 2 else f"S{i}", "title": f"Màn {i}",
                "items": [{"id": f"B{i}", "label": f"Nút {i}"}]} for i in range(n)]
    links = [{"src": f"{screens[i]['id']}.B{i}", "to": screens[i + 1]["id"]} for i in range(n - 1)]
    return {"screens": screens, "links": links}


def _lower(raw):
    low = {"screens": [{**s, "id": s["id"].lower(), "items": [{**i, "id": i["id"].lower()} for i in s["items"]]}
                       for s in raw["screens"]],
           "links": [{**k, "src": k["src"].lower(), "to": k["to"].lower()} for k in raw["links"]]}
    return low


def test_changes_ignores_regenerated_ids_with_same_titles():
    raw = _live()
    assert u.changes(u.clean(raw, "VA-1"), u.clean(_lower(raw), "VA-1")) == []


def test_changes_after_id_regen_shows_only_real_differences():
    raw = _live()
    low = _lower(raw)
    low["links"][0]["to"] = "s3b"                              # Nút 0: Màn 1 -> Màn 3
    low["screens"].pop(5)                                      # Màn 5 bị gộp / xoá
    low["links"] = [k for k in low["links"] if "s5" not in k["src"] and k["to"] != "s5b"]
    assert u.changes(u.clean(raw, "VA-1"), u.clean(low, "VA-1")) == [
        'Xoá màn "Màn 5"',
        '"Nút 0" (Màn 0): "Màn 1" → "Màn 3"',
        'Bỏ nối "Nút 4" (Màn 4) → "Màn 5"',
    ]


def test_changes_summarises_mostly_unrelated_render():
    old = u.clean(_live(), "VA-1")
    new = u.clean({"screens": [{"id": f"n{i}", "title": f"Khác {i}", "items": []} for i in range(3)],
                   "links": [{"src": "n0", "to": "n1"}]}, "VA-1")
    assert u.changes(old, new) == ["Render lại: 3 màn, 1 liên kết (trước: 6 màn, 5 liên kết)"]


def _layer(kind, name, x, y, w, h, content="", layers=()):
    return {"type": kind, "name": name, "content": content, "layers": list(layers),
            "rect": {"x": 0, "y": 0, "width": w, "height": h, "absolute": {"x": x, "y": y}}}


def test_zeplin_hits_tap_area_is_the_button_and_icon_glyphs_go():
    from telegram_dashboard import zeplin
    btn = _layer("group", "Button/Primary", 20, 500, 335, 50, layers=[
        _layer("group", "Stack", 148, 514, 79, 22, layers=[_layer("text", "Type", 148, 514, 79, 22, "Tìm căn hộ")])])
    back = _layer("group", "Back_Nav", 20, 50, 40, 40, layers=[_layer("text", "i", 20, 50, 40, 40, "\U00100189")])
    text = _layer("text", "t", 40, 620, 200, 20, "Giá  trung\nbình")
    long = _layer("group", "Card", 20, 600, 335, 300, layers=[text])
    root = _layer("group", "Screen", 0, 0, 375, 2928, layers=[btn, back, long])
    got = zeplin.hits([root], 375)
    assert got[:2] == [["Tìm căn hộ", 20, 500, 335, 50], ["Giá trung bình", 40, 620, 200, 20]]
    assert ["Back_Nav", 20, 50, 40, 40] in got and not any(h[0] == "" for h in got)


def test_html_embeds_only_the_shots_its_screens_link():
    raw = {"screens": [{"id": "a", "title": "A", "zeplin": "https://zpl.io/a", "items": []}], "links": []}
    f = u.clean(raw, "VA-1")
    pic = u.Shot(src="data:image/webp;base64,AAAA", w=375, h=812, hits=[("Tìm", 1, 2, 3, 4)])
    html = u.build_html(f, "/*e*/", {"https://zpl.io/a": pic, "https://zpl.io/other": pic})
    assert 'id="uiflow-shots">{"https://zpl.io/a"' in html and "zpl.io/other" not in html
    assert u.extract(html) == f


def test_shot_refuses_anything_but_an_image_data_uri():
    with pytest.raises(ValueError):
        u.Shot(src="https://evil/x.png", w=1, h=1)
    with pytest.raises(ValueError):
        u.Shot(src="data:text/html;base64,AAAA", w=1, h=1)


def test_zeplin_image_proxy_only_reads_zeplin_image_hosts():
    from telegram_dashboard import zeplin
    assert zeplin._image_host("https://img.zeplin.io/p/x.png?key=1")
    assert zeplin._image_host("https://public-cdn.zeplin.dev/a/b.png")
    for bad in ("http://img.zeplin.io/x", "https://img.zeplin.io.evil.com/x", "https://127.0.0.1/x", "file:///etc/passwd"):
        assert not zeplin._image_host(bad)


def test_zeplin_texts_for_the_ai_and_links_as_tickets_write_them():
    from telegram_dashboard import zeplin
    root = _layer("group", "S", 0, 0, 375, 812, layers=[
        _layer("text", "b", 20, 500, 100, 20, "Tìm căn hộ"), _layer("text", "a", 20, 50, 100, 20, "Tiêu đề"),
        _layer("text", "c", 20, 600, 100, 20, "Tìm căn hộ"), _layer("text", "i", 0, 0, 10, 10, "\U00100189")])
    assert zeplin.texts([root]) == ["Tiêu đề", "Tìm căn hộ"]
    z = "https://app.zeplin.io/project/6a86b68fa244cff502f98251/screen/6a86b912c7dfad3ef64e765c"
    assert zeplin.canonical(z + "),") == z and zeplin.canonical("https://zpl.io/aB3)\\n|") == "https://zpl.io/aB3"


def test_progress_tells_each_screen_and_link_once_as_the_json_streams():
    import json as _json
    text = _json.dumps({k: RAW[k][:3] for k in ("screens", "links")}, ensure_ascii=False)
    p, out = u.Progress(), []
    for i in range(0, len(text), 7):  # deltas cut anywhere, mid-string included
        out += p.feed(text[i : i + 7])
    draw = [e for e in out if e["stage"] == "draw"]
    link = [e for e in out if e["stage"] == "link"]
    assert [e["title"] for e in draw] == ["Đăng nhập", "Nhập OTP", "Sai mã"] and draw[-1]["items"] == 2
    assert [e["n"] for e in link] == [1, 2, 3]
    assert link[0] == {"stage": "link", "n": 1, "items": 2, "from": "Đăng nhập", "item": "Gửi OTP", "to": "Nhập OTP"}
    assert link[2]["item"] == "" and link[2]["to"] == "Đăng nhập"  # back: the screen itself, no button


def test_progress_cuts_at_the_links_key_not_a_links_value():
    text = ('{"screens": [{"id": "a", "title": "A", "items": [{"id": "links", "label": "links"}]},'
            ' {"id": "b", "title": "B", "items": []}], "links": [{"src": "a.links", "to": "b"}]}')
    p, out = u.Progress(), []
    for ch in text:
        out += p.feed(ch)
    assert [e["title"] for e in out if e["stage"] == "draw"] == ["A", "B"]
    assert [e for e in out if e["stage"] == "link"] == [
        {"stage": "link", "n": 1, "items": 1, "from": "A", "item": "links", "to": "B"}]


def test_progress_tells_every_screen_and_link_a_big_delta_closes():
    import json as _json

    text = _json.dumps({k: RAW[k][:3] for k in ("screens", "links")}, ensure_ascii=False)
    out = u.Progress().feed(text)  # the whole answer in one delta
    assert [e["title"] for e in out if e["stage"] == "draw"] == ["Đăng nhập", "Nhập OTP", "Sai mã"]
    assert [e["n"] for e in out if e["stage"] == "link"] == [1, 2, 3]


def test_v1_reads_as_v2_with_rect_and_note_round_trip():
    raw = {"v": 1, **RAW}
    f = u.clean(raw, "VA-1")
    assert f.v == 2 and f.screens[0].note == "" and f.screens[0].items[0].rect is None
    raw2 = f.model_dump()
    raw2["screens"][0]["note"] = "n" * 5000
    raw2["screens"][0]["items"][0]["rect"] = {"x": 0.1, "y": 0.2, "w": 0.3, "h": 0.1}
    raw2["screens"][1]["items"][0]["rect"] = {"x": 0.9, "y": 0, "w": 0.2, "h": 0.1}  # ngoài ảnh: bỏ rect
    f2 = u.clean(raw2, "VA-1")
    assert len(f2.screens[0].note) == u.MAX_NOTE
    assert f2.screens[0].items[0].rect == u.Rect(x=0.1, y=0.2, w=0.3, h=0.1)
    assert f2.screens[1].items[0].rect is None
    assert u.extract(u.build_html(f2, "")) == f2
    assert u.changes(f, f2) == ['Thêm ghi chú màn "Đăng nhập"', 'Vẽ vùng bấm "Gửi OTP" (Đăng nhập)']


def test_newer_version_is_refused_not_broken():
    with pytest.raises(u.TooNew):
        u.clean({"v": 3, **RAW}, "VA-1")
    with pytest.raises(u.TooNew):
        u.extract('<script type="application/json" id="uiflow-data">{"v": 9, "ticket": "VA-1"}</script>')
    with pytest.raises(ValueError):
        u.clean({"v": "2", **RAW}, "VA-1")


def test_merge_ai_never_takes_rect_or_note_from_the_model():
    skel = {"screens": [{"id": "a", "title": "A", "items": [{"id": "x", "label": "X"}]}], "links": []}
    raw = {"adapter": 1, "screens": [
        {"id": "a", "items": [{"id": "y", "label": "Y", "rect": {"x": 0, "y": 0, "w": 0.1, "h": 0.1}}]},
        {"id": "b", "title": "B", "note": "bịa",
         "items": [{"id": "z", "label": "Z", "rect": {"x": 0, "y": 0, "w": 0.1, "h": 0.1}}]},
    ], "links": []}
    f = u.merge_ai(raw, skel, "VA-1")
    assert all(i.rect is None for s in f.screens for i in s.items) and all(s.note == "" for s in f.screens)


def test_start_screen_is_kept_only_when_it_exists_and_listed_as_a_change():
    f = u.clean({**RAW, "start": "code"}, "VA-1")
    assert f.start == "code"
    assert u.clean({**RAW, "start": "ghost"}, "VA-1").start is None
    g = f.model_copy(deep=True)
    g.start = "home" if any(s.id == "home" for s in g.screens) else "err"
    assert any(c.startswith("Đặt màn bắt đầu") for c in u.changes(f, g))


def test_keep_manual_carries_notes_rects_start_and_positions_across_a_render():
    old = u.clean(RAW, "VA-1")
    old.screens[0].note = "giữ"
    old.screens[0].items[0].rect = u.Rect(x=0.1, y=0.1, w=0.2, h=0.1)
    old.start = "code"
    for n, s in enumerate(old.screens):
        s.x, s.y = n * 700.0, 0.0
    # the AI renamed every id: matched back by title / label
    new = u.clean({"screens": [
        {"id": "a", "title": "Đăng nhập", "items": [{"id": "x", "label": "Gửi OTP"}]},
        {"id": "b", "title": "Nhập OTP", "items": [{"id": "y", "label": "Xác nhận"}]},
        {"id": "c", "title": "Sai mã", "kind": "popup", "parent": "b", "items": []},
    ], "links": [{"src": "a.x", "to": "b"}]}, "VA-1")
    got, kept = u.keep_manual(old, new)
    login = next(s for s in got.screens if s.id == "login")
    assert login.note == "giữ" and login.items[0].rect == old.screens[0].items[0].rect
    assert got.start == "code" and (login.x, login.y) == (0.0, 0.0)
    assert kept == {"positions": 3, "notes": 1, "rects": 1, "start": 1}
    # a new screen the old flow did not have: positions start over (no overlap), the rest is still kept
    more = u.clean({**new.model_dump(), "screens": [*new.model_dump()["screens"],
                                                    {"id": "d", "title": "Mới", "items": []}]}, "VA-1")
    got, kept = u.keep_manual(old, more)
    assert kept["positions"] == 0 and kept["notes"] == 1 and all(s.x is None for s in got.screens)
