import pytest
from telegram_dashboard.youtrack import flow as u
from telegram_dashboard.youtrack import flow_changes as fc
from telegram_dashboard.youtrack import flow_merge

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
    assert fc.changes(old, new) == [
        'Đổi tên màn "Nhập OTP" → "OTP"',
        'Thêm màn "Trang chủ"',
        '"Gửi OTP" (Đăng nhập): "Nhập OTP" → "Sai mã"',
    ]
    assert fc.changes(None, old) == ["Tạo UI flow: 3 màn, 3 liên kết"]
    assert fc.changes(old, old) == []
    moved = old.model_copy(deep=True)
    moved.screens[0].x = 99.0
    assert fc.changes(old, moved) == ["Sắp xếp lại vị trí màn"]


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
        assert fc.changes(old, new) == ["Sửa thuộc tính màn / liên kết"]
    bumped = old.model_copy(deep=True, update={"rev": 5})
    assert fc.changes(old, bumped) == []


def test_changes_add_remove_link_remove_screen_and_back_link_format():
    old = u.clean(RAW, "VA-1")
    new = old.model_copy(deep=True)
    new.links[2].to = "err"                                   # back: Đăng nhập -> Sai mã
    del new.links[1]                                          # Xác nhận -> Sai mã bị bỏ
    new.links.append(u.Link(src="login.otp", to="login", act="open"))
    assert fc.changes(old, new) == [
        'Màn "Nhập OTP" (back): "Đăng nhập" → "Sai mã"',
        'Nối "Gửi OTP" (Đăng nhập) → "Đăng nhập"',
        'Bỏ nối "Xác nhận" (Nhập OTP) → "Sai mã"',
    ]
    gone = old.model_copy(deep=True)
    gone.screens.pop()
    gone.links = [k for k in gone.links if k.to != "err"]
    assert fc.changes(old, gone)[0] == 'Xoá màn "Sai mã"'


def test_clean_truncates_long_strings_and_extra_items_instead_of_rejecting():
    raw = {"screens": [{"id": "a", "title": "t" * 100, "ac": "c" * 50, "parent": "a",
                        "items": [{"id": f"i{n}", "label": "l" * 81} for n in range(u.MAX_ITEMS + 1)]}],
           "links": [{"src": "a.i0", "to": "a", "when": "w" * 90}] * (u.MAX_LINKS + 5)}
    f = u.clean(raw, "VA-1")
    s = f.screens[0]
    assert (len(s.title), len(s.ac), len(s.items), len(s.items[0].label), s.parent) == (80, 40, u.MAX_ITEMS, 80, None)
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
    assert fc.changes(u.clean(raw, "VA-1"), u.clean(_lower(raw), "VA-1")) == []


def test_changes_after_id_regen_shows_only_real_differences():
    raw = _live()
    low = _lower(raw)
    low["links"][0]["to"] = "s3b"                              # Nút 0: Màn 1 -> Màn 3
    low["screens"].pop(5)                                      # Màn 5 bị gộp / xoá
    low["links"] = [k for k in low["links"] if "s5" not in k["src"] and k["to"] != "s5b"]
    assert fc.changes(u.clean(raw, "VA-1"), u.clean(low, "VA-1")) == [
        'Xoá màn "Màn 5"',
        '"Nút 0" (Màn 0): "Màn 1" → "Màn 3"',
        'Bỏ nối "Nút 4" (Màn 4) → "Màn 5"',
    ]


def test_changes_summarises_mostly_unrelated_render():
    old = u.clean(_live(), "VA-1")
    new = u.clean({"screens": [{"id": f"n{i}", "title": f"Khác {i}", "items": []} for i in range(3)],
                   "links": [{"src": "n0", "to": "n1"}]}, "VA-1")
    assert fc.changes(old, new) == ["Render lại: 3 màn, 1 liên kết (trước: 6 màn, 5 liên kết)"]


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
    # VA Ban-TTS 01: title + subtitle in one layer; the card is found by its title alone, from the lines, which stay
    # out of the hits (the design's signature): a saved flow is not told its design changed
    card = _layer("group", "Card", 99, 433, 210, 80, layers=[
        _layer("text", "t", 150, 450, 150, 40, "Căn hộ\nXác minh nhanh bằng GCNXDĐ, hoặc tìm kiếm dự án…")])
    tag = _layer("text", "t", 20, 600, 200, 40, "MỚI\nTra cứu quy hoạch")  # the name on the second line
    screen = [_layer("group", "Screen", 0, 0, 375, 812, layers=[card, tag])]
    got, lines = zeplin.hits(screen, 375), zeplin.lines(screen, 375)
    sub = "Xác minh nhanh bằng GCNXDĐ, hoặc tìm kiếm dự án…"
    assert [h[0] for h in got][:2] == [f"Căn hộ {sub}", "MỚI Tra cứu quy hoạch"]
    assert lines == [["Căn hộ", 99, 433, 210, 80], [sub, 99, 433, 210, 80],
                     ["MỚI", 20, 600, 200, 40], ["Tra cứu quy hoạch", 20, 600, 200, 40]]
    assert zeplin.unplaced(["Căn hộ", "Tra cứu quy hoạch"], got) == [0]  # the whole card is too long for its title
    assert zeplin.unplaced(["Căn hộ", "Tra cứu quy hoạch"], got + lines) == []
    # the AI reads a card by its title: one line per layer
    assert zeplin.texts(screen) == ["Căn hộ", "MỚI"]


def test_html_embeds_only_the_shots_its_screens_link():
    raw = {"screens": [{"id": "a", "title": "A", "zeplin": "https://zpl.io/a", "items": []}], "links": []}
    f = u.clean(raw, "VA-1")
    pic = u.Shot(src="data:image/webp;base64,AAAA", w=375, h=812, hits=[("Tìm", 1, 2, 3, 4)])
    html = u.build_html(f, "/*e*/", {"https://zpl.io/a": pic, "https://zpl.io/other": pic})
    assert 'id="uiflow-shots">{"https://zpl.io/a"' in html and "zpl.io/other" not in html
    listed = u.Shot(src="data:image/webp;base64,AAAA", w=375, h=6936, cut=0.1114)
    assert '"cut": 0.1114' in u.build_html(f, "/*e*/", {"https://zpl.io/a": listed})  # the file folds at the list too
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
    assert fc.changes(f, f2) == ['Thêm ghi chú màn "Đăng nhập"', 'Vẽ vùng bấm "Gửi OTP" (Đăng nhập)']


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
    f = flow_merge.merge_ai(raw, skel, "VA-1")
    assert all(i.rect is None for s in f.screens for i in s.items) and all(s.note == "" for s in f.screens)


def test_merge_ai_accepts_ac_list_and_unknown_kind():  # VA-12584: patch answer gave ac=[...] and kind "web"/"map"
    skel = {"screens": [{"id": "a", "title": "A", "items": []}], "links": []}
    raw = {"adapter": 1, "screens": [{"id": "a", "kind": "web", "ac": ["AC1.2", "AC4.5"]},
                                     {"id": "b", "title": "B", "kind": "map", "ac": []}],
           "links": [{"src": "a", "to": "b", "ac": ["AC3.5"]}]}
    f = flow_merge.merge_ai(raw, skel, "VA-1")
    assert [(s.kind, s.ac) for s in f.screens] == [("screen", "AC1.2, AC4.5")]
    assert f.links == []  # "b" has no design behind it: not drawn, nor the link to it
    # a ticket with no design at all: the model's screens are the map, as before
    drawn = {"adapter": 1, "screens": [{"id": "a", "title": "A"}, {"id": "b", "title": "B"}], "links": raw["links"]}
    text_only = flow_merge.merge_ai(drawn, {"screens": [], "links": []}, "VA-1")
    assert [s.id for s in text_only.screens] == ["a", "b"] and len(text_only.links) == 1


def test_merge_ai_never_draws_a_screen_without_a_design():
    a = {"id": "a", "title": "A", "zeplin": "https://zpl.io/a", "items": [{"id": "go", "label": "Đi"}]}
    err = {"id": "err", "title": "Lỗi mạng", "kind": "popup"}
    raw = {"adapter": 1, "screens": [{"id": "a", "kind": "screen"}, err],
           "links": [{"src": "a.go", "to": "err", "act": "open", "when": "mất mạng"}],
           "pending": [{"title": "Xác nhận xoá"}]}  # an older model's answer: ignored
    f = flow_merge.merge_ai(raw, {"screens": [a], "links": []}, "VA-1")
    assert [s.id for s in f.screens] == ["a"] and f.links == [] and "pending" not in f.model_dump()
    # a file saved before still opens: its old keys are dropped
    old = u.clean({**f.model_dump(), "pending": [{"title": "x"}], "acs": ["AC1"]}, "VA-1").model_dump()
    assert "pending" not in old and "acs" not in old


def test_start_screen_is_kept_only_when_it_exists_and_listed_as_a_change():
    f = u.clean({**RAW, "start": "code"}, "VA-1")
    assert f.start == "code"
    assert u.clean({**RAW, "start": "ghost"}, "VA-1").start is None
    g = f.model_copy(deep=True)
    g.start = "home" if any(s.id == "home" for s in g.screens) else "err"
    assert any(c.startswith("Đặt màn bắt đầu") for c in fc.changes(f, g))


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
    got, kept = fc.keep_manual(old, new)
    login = next(s for s in got.screens if s.id == "login")
    assert login.note == "giữ" and login.items[0].rect == old.screens[0].items[0].rect
    assert got.start == "code" and (login.x, login.y) == (0.0, 0.0)
    assert kept == {"positions": 3, "notes": 1, "rects": 1, "start": 1}
    # a new screen the old flow did not have: positions start over (no overlap), the rest is still kept
    more = u.clean({**new.model_dump(), "screens": [*new.model_dump()["screens"],
                                                    {"id": "d", "title": "Mới", "items": []}]}, "VA-1")
    got, kept = fc.keep_manual(old, more)
    assert kept["positions"] == 0 and kept["notes"] == 1 and all(s.x is None for s in got.screens)


def test_design_signature_ignores_text_order_and_a_redesign_alone_is_a_change():
    a = {"https://zpl.io/a": {"w": 375, "h": 812, "hits": [["Gửi", 0, 0, 1, 1], ["OTP", 0, 0, 1, 1]]}}
    b = {"https://zpl.io/a": {"w": 375, "h": 812, "hits": [["OTP", 0, 0, 1, 1], ["Gửi", 0, 0, 1, 1]]}}
    assert u.design_of(a) == u.design_of(b) == {"https://zpl.io/a": ["375x812", "Gửi", "OTP"]}
    old = u.clean(RAW, "VA-1")
    old.design = {"https://zpl.io/a": ["375x812", "Gửi"]}
    new = old.model_copy(deep=True)
    assert fc.changes(old, new) == []
    new.design = u.design_of(a)
    assert fc.changes(old, new) == ["Cập nhật ảnh thiết kế Zeplin của 1 màn"]
    # Zeplin's version id joins the signature: a redesign that keeps the size and every text is a change, but a file
    # saved before versions were recorded does not read as changed just for gaining one
    v1 = u.design_of({"https://zpl.io/a": {**a["https://zpl.io/a"], "ver": "aaa"}})
    v2 = u.design_of({"https://zpl.io/a": {**a["https://zpl.io/a"], "ver": "bbb"}})
    assert v1 == {"https://zpl.io/a": ["375x812", "Gửi", "OTP", "v:aaa"]}
    old.design, new.design = u.design_of(a), v1
    assert fc.changes(old, new) == []
    old.design, new.design = v1, v2
    assert fc.changes(old, new) == ["Cập nhật ảnh thiết kế Zeplin của 1 màn"]
    assert u.Shot(src="data:image/png;base64,AA==", w=1, h=1, ver="69f17a677c732cfb92df1508").ver


def test_merge_ai_repairs_a_link_whose_src_is_a_bare_button_id():  # VA-12584: 18 of 41 links lost, every button tap
    skel = {"screens": [{"id": "a", "title": "A", "items": []}, {"id": "b", "title": "B", "items": []}], "links": []}
    raw = {"adapter": 1, "screens": [{"id": "a", "items": [{"id": "go", "label": "Go"}, {"id": "dup", "label": "D"}]},
                                     {"id": "b", "items": [{"id": "dup", "label": "D"}]}],
           "links": [{"src": "go", "to": "b"}, {"src": "dup", "to": "a"}, {"src": "b", "to": "a", "act": "back"}]}
    f = flow_merge.merge_ai(raw, skel, "VA-1")
    assert [(x.src, x.to) for x in f.links] == [("a.go", "b"), ("b", "a")]  # "dup": two owners, not guessed


def test_zeplin_hits_ignore_a_group_frame_that_does_not_hold_its_text():  # VA-12584 44 B: five rows, one frame
    from telegram_dashboard import zeplin
    rows = [_layer("group", "Row", 19, 721, 336, 60, layers=[_layer("text", "t", 79, y, 249, 60, label)])
            for y, label in ((112, "Vị trí dự án"), (172, "Vị trí thửa đất"))]
    got = zeplin.hits([_layer("group", "Screen", 0, 0, 375, 814, layers=rows)], 375)
    assert got[:2] == [["Vị trí dự án", 79, 112, 249, 60], ["Vị trí thửa đất", 79, 172, 249, 60]]


def test_buttons_with_no_zeplin_layer_are_the_ones_the_ai_locates():  # VA-12584 screen 44: a flattened list
    from telegram_dashboard.youtrack import flow_locate

    sentence = "Bạn có muốn quét để tự động lấy thông tin tài sản, giảm thời gian"
    hits = [["Khảo sát tài sản", 20, 52, 335, 40], [sentence, 60, 556, 245, 60]]
    flow = u.clean({"screens": [{"id": "a", "title": "44", "zeplin": "https://zpl.io/a", "items": [
        {"id": "b1", "label": "Khảo sát tài sản"}, {"id": "b2", "label": "Thông tin tài sản"},
        {"id": "b3", "label": "Pháp lý", "rect": {"x": 0, "y": 0, "w": 0.5, "h": 0.1}},
        {"id": "b4", "label": "Hình ảnh"},
    ]}], "links": []}, "VA-1")
    todo = flow_locate.missing(flow, {"https://zpl.io/a": {"src": "https://img.zeplin.io/a.png", "hits": hits}})
    assert [[i.id for i in items] for _, items in todo] == [["b2", "b4"]]  # a sentence naming the label is no match
    files = {"screen-1.png": todo[0][1]}
    answer = {"/tmp/x/screen-1.png": {"b2": [29, 227, 941, 74], "b4": [900, 950, 300, 100], "b1": [0, 0, 10, 10]}}
    assert flow_locate.apply(answer, files) == 2
    b2, b4 = todo[0][1]
    assert (b2.rect.x, b2.rect.y, b2.rect.w, b2.rect.h) == (0.029, 0.227, 0.941, 0.074)
    assert b4.rect.x + b4.rect.w <= 1 and b4.rect.y + b4.rect.h <= 1  # clipped to the image
    assert flow.screens[0].items[0].rect is None  # not asked for: not touched
    assert flow_locate.apply({"screen-1.png": {"b2": "x"}}, files) == 0 and flow_locate.apply(None, files) == 0


def test_merge_ai_joins_the_skeletons_link_with_the_models_copy_of_it():  # VA-12584: Prototype asked "which case?"
    skel = {"screens": [{"id": "a", "title": "A", "items": [{"id": "x", "label": "X"}]}, {"id": "b", "title": "B"}],
            "links": [{"src": "a.x", "to": "b", "act": "navigate", "when": "", "ac": ""}]}
    raw = {"adapter": 1, "screens": [], "links": [
        {"src": "a.x", "to": "b", "when": "Bấm X", "ac": "AC1"},  # the same link, with its condition
        {"src": "a.x", "to": "b", "when": "Bấm X", "ac": "AC1"},
        {"src": "a.x", "to": "b", "when": "Giữ X", "ac": "AC2"},  # another case to the same screen: its own link
    ]}
    f = flow_merge.merge_ai(raw, skel, "VA-1")
    got = [(k.src, k.to, k.when, k.ac) for k in f.links]
    assert got == [("a.x", "b", "Bấm X", "AC1"), ("a.x", "b", "Giữ X", "AC2")]


def test_outline_for_the_ai():
    flow = u.clean({"v": 2, "start": "a", "screens": [
        {"id": "a", "title": "Đăng nhập", "ac": "AC1.1", "zeplin": "https://zpl.io/abc", "note": "chờ\nBE",
         "items": [{"id": "go", "label": "Gửi OTP"}, {"id": "help", "label": "Trợ giúp"}]},
        {"id": "b", "title": "OTP", "kind": "popup", "parent": "a", "items": []}],
        "links": [{"src": "a.go", "to": "b", "act": "open", "when": "SĐT hợp lệ", "ac": "AC1.2"},
                  {"src": "b", "to": "a", "act": "close"}]}, "VA-1")
    text = u.outline(flow)
    assert "uiflow-VA-1.html" in text and "- Đăng nhập [AC1.1] ← màn bắt đầu https://zpl.io/abc" in text
    assert '  - "Gửi OTP" → OTP (khi: SĐT hợp lệ) [AC1.2]' in text and '  - chưa nối: "Trợ giúp"' in text
    assert "- OTP (popup trên Đăng nhập)" in text and "  - close → Đăng nhập" in text and "ghi chú: chờ BE" in text


def test_a_web_flow_keeps_its_frame_and_is_laid_out_anew_when_the_frame_changes():
    raw = {"v": 2, "device": "web", "screens": [{"id": "a", "title": "A", "x": 10, "y": 20, "items": []}], "links": []}
    web = u.clean(raw, "VA-1")
    assert web.device == "web" and u.extract(u.build_html(web, "/*engine*/")).device == "web"
    assert u.clean({**raw, "device": "tablet"}, "VA-1").device == "mobile"  # unknown: a phone, never a broken file
    phone = u.clean({**raw, "device": "mobile"}, "VA-1")
    assert "(rev 0, web)" in u.outline(web)
    assert fc.changes(phone, web) == ["Đổi khung màn sang web"]
    fresh = web.model_copy(deep=True)
    fresh.screens[0].x = fresh.screens[0].y = None
    assert fc.keep_manual(web, fresh)[1]["positions"] == 1  # same frame: where the user put it
    assert fc.keep_manual(phone, fresh)[1]["positions"] == 0 and fc.keep_manual(phone, fresh)[0].screens[0].x is None


def test_fold_is_kept_valid_listed_and_survives_a_render():
    raw = {"screens": [{"id": "a", "title": "Danh sách", "fold": 0.25, "items": []},
                       {"id": "b", "title": "B", "fold": 1.5, "items": []}, {"id": "c", "title": "C", "fold": True,
                                                                              "items": []}], "links": []}
    f = u.clean(raw, "VA-1")
    assert [s.fold for s in f.screens] == [0.25, None, None]  # only a part (0..1) of the design is a fold
    new = f.model_copy(deep=True)
    new.screens[0].fold = None
    assert fc.changes(f, new) == ['Mở rộng màn "Danh sách"']
    again = u.clean({"screens": [{"id": "a", "title": "Danh sách", "items": []}], "links": []}, "VA-1")
    kept, _ = fc.keep_manual(f, again)
    assert kept.screens[0].fold == 0.25  # a re-render keeps how the user folded it
    # the render folds a long list by itself: a screen the person has whole stays whole, a new one keeps that fold
    listed = u.clean({"screens": [{"id": "b", "title": "B", "fold": 0.3, "items": []},
                                  {"id": "z", "title": "Mới", "fold": 0.3, "items": []}], "links": []}, "VA-1")
    assert [s.fold for s in fc.keep_manual(f, listed)[0].screens] == [None, 0.3]


def test_a_long_list_folds_after_the_items_that_fit_one_screenful():
    from telegram_dashboard import zeplin

    def card(i, y, texts=3):
        return _layer("group", f"Card 1 Copy {i}", 10, y, 355, 180, layers=[
            _layer("text", "t", 20, y + 10 + 20 * k, 100, 16, f"Mã {i}.{k}") for k in range(texts)])

    def screen(ys, **kw):
        head = _layer("group", "Header", 0, 0, 375, 100, layers=[_layer("text", "t", 20, 50, 100, 20, "Tài sản")])
        cards = [card(i, y, **kw) for i, y in enumerate(ys)]
        return [_layer("group", "Screen", 0, 0, 375, 2200, layers=[head, *cards])]

    ten = screen([120 + 200 * i for i in range(10)])  # 180 high, 20 apart; a phone's screenful of 375 is 812
    assert zeplin.column(ten, 375) == [(120 + 200 * i, 180) for i in range(10)]
    items = zeplin.column(ten, 375)
    assert zeplin.fold_at(items, 375, 2200, True) == round(710 / 2200, 4)  # 3 fit (the 4th ends at 900): cut at 710
    listed = zeplin.shot({"width": 375, "height": 2200, "layers": ten})
    assert (listed["cut"], listed["list"]) == (round(710 / 2200, 4), 10)
    assert zeplin.fold_at(items, 375, 1100, True) == 0  # 390 hidden: less than half a screenful is not worth a fold
    assert zeplin.fold_at(zeplin.column(screen([120, 320, 520]), 375), 375, 812, True) == 0  # the whole list fits
    assert zeplin.column(screen([120, 320, 570, 770, 1020]), 375) == []  # unevenly spaced: sections, not a list
    mixed = screen([120, 320, 520])
    mixed[0]["layers"][2] = card(1, 320, texts=9)  # one built another way
    assert zeplin.column(mixed, 375) == []
    flat = [_layer("text", "t", 20, 120 + 60 * i, 300, 20, f"Dòng {i}") for i in range(20)]
    assert zeplin.column(flat, 375) == [] and zeplin.shot({"width": 375, "height": 2200, "layers": flat})["cut"] == 0


def test_notes_on_the_map_are_cleaned_listed_kept_through_a_render_and_told_to_the_ai():
    base = {"screens": [{"id": "a", "title": "Đăng nhập", "items": []}], "links": []}
    raw = {**base, "memos": [{"id": "m1", "x": 10, "y": 20, "text": "Cần loading"}, {"id": "m1", "x": 0, "y": 0},
                             {"id": "m2", "x": "a", "y": 0}, {"id": "bad id", "x": 0, "y": 0}, "rác"]}
    f = u.clean(raw, "VA-1")
    assert [(m.id, m.text) for m in f.memos] == [("m1", "Cần loading")]  # a broken note goes, the flow stays
    more = u.clean({**raw, "memos": [{"id": "m1", "x": 10, "y": 20, "text": "Cần loading + lỗi mạng"},
                                     {"id": "m3", "x": 5, "y": 5, "text": ""}]}, "VA-1")
    assert fc.changes(f, more) == ["Thêm 1 ghi chú trên sơ đồ", "Sửa 1 ghi chú trên sơ đồ"]
    moved = f.model_copy(deep=True)
    moved.memos[0].x = 99
    assert fc.changes(f, moved) == ["Sắp xếp lại vị trí màn"]
    assert fc.changes(f, u.clean(base, "VA-1")) == ["Xoá 1 ghi chú trên sơ đồ"]
    # a render never writes a note: the old file's stay, whatever the new flow had
    sized = u.clean({**base, "memos": [{"id": "m1", "x": 10, "y": 20, "w": 9999, "h": "cao", "text": "Cần loading",
                                        "fold": True}]}, "VA-1")
    assert (sized.memos[0].w, sized.memos[0].h, sized.memos[0].fold) == (1600, 160, True)  # kept in range, not refused
    assert fc.changes(f, sized) == ["Thu gọn 1 ghi chú trên sơ đồ"]  # its size alone would read as a move
    rendered = u.clean({**base, "memos": [{"id": "x", "x": 0, "y": 0, "text": "AI tự thêm"}]}, "VA-1")
    assert [m.text for m in fc.keep_manual(f, rendered)[0].memos] == ["Cần loading"]
    assert "Ghi chú trên sơ đồ: Cần loading" in u.outline(f) and "Ghi chú trên sơ đồ" not in u.outline(more).split(
        "Cần loading + lỗi mạng")[1]  # an empty note says nothing


def test_flow_title_is_a_persons_name_kept_through_file_rerender_and_change_list():
    f = u.clean({**RAW, "title": "  Đăng nhập\n OTP  " + "x" * 200}, "VA-1")
    assert f.title.startswith("Đăng nhập OTP x") and len(f.title) == u.MAX_TITLE  # one line, cut, not refused
    named = u.clean({**RAW, "title": "Luồng <OTP>"}, "VA-1")
    html = u.build_html(named, "")
    assert "<title>Luồng &lt;OTP&gt;</title>" in html and u.extract(html).title == "Luồng <OTP>"
    assert "<title>UI flow · VA-1</title>" in u.build_html(u.clean(RAW, "VA-1"), "")  # no name: the ticket's
    drawn = u.clean(RAW, "VA-1")  # a re-render names nothing: the file's name stays
    assert fc.keep_manual(named, drawn)[0].title == "Luồng <OTP>"
    assert fc.changes(drawn, named) == ['Đổi tên UI flow thành "Luồng <OTP>"']
    assert fc.changes(named, drawn) == ["Bỏ tên riêng của UI flow"]
