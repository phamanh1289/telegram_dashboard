from telegram_dashboard.youtrack import flow as u
from telegram_dashboard.youtrack import flow_md

FLOW = u.clean({"title": "Đăng nhập OTP", "start": "login", "screens": [
    {"id": "login", "title": "Đăng nhập", "zeplin": "https://zpl.io/abc123", "ac": "AC-1",
     "items": [{"id": "otp", "label": "Gửi OTP"}, {"id": "help", "label": "Trợ giúp"}]},
    {"id": "code", "title": "Nhập OTP", "ac": "AC-2", "note": "Đếm ngược 60s",
     "items": [{"id": "ok", "label": "Xác nhận"}]},
    {"id": "err", "title": "Sai mã", "kind": "popup", "parent": "code", "items": []},
    {"id": "lone", "title": "Màn lạc", "items": []},
], "links": [
    {"src": "login.otp", "to": "code", "ac": "AC-1"},
    {"src": "code.ok", "to": "err", "act": "open", "when": "Mã sai"},
    {"src": "code", "to": "login", "act": "back"},
], "memos": [{"id": "m1", "x": 0, "y": 0, "text": "Hỏi PO về giới hạn gửi lại"}]}, "VA-1")
TICKET = {"id": "VA-1", "summary": "Login bằng OTP", "comments": [{"text": "AC-2: mã hết hạn sau 5 phút"}],
          "description": "## Yêu cầu\n**AC-1**: Nhập số điện thoại\n- 10 số\n\nAC 2: Nhập mã OTP 6 số\n"
                         "AC-03: Khoá sau 5 lần sai\n## Khác\nbỏ qua ``` dòng này"}
SHOT = {"w": 375, "h": 812, "dp": 375, "platform": "iOS", "texts": ["Đăng nhập", "Gửi OTP", "0912 345 678"]}


def test_markdown_holds_every_screen_its_design_texts_quoted_acs_ways_and_gaps():
    md = flow_md.build(FLOW, [TICKET], {"https://zpl.io/abc123": SHOT},
                       flow_md.Options(note="Làm bằng Compose", data=True))
    assert md.startswith("# Đăng nhập OTP\n") and "## Yêu cầu của người giao việc\n\nLàm bằng Compose" in md
    assert "flowchart LR" in md and "-.->" in md  # the map, back links dashed
    # screens as met from the start; the design's texts; a button found on it, one not, one not linked
    assert md.index("### 1. Đăng nhập") < md.index("### 2. Nhập OTP") < md.index("### 4. Màn lạc")
    # the design's texts in one line, a button's own label left to the table
    assert "nhãn nút ở bảng dưới): Đăng nhập · 0912 345 678\n" in md
    assert "| “Gửi OTP” | đi tới “Nhập OTP” (`code`) |  | AC-1 | theo chữ trên thiết kế |" in md
    assert "| “Trợ giúp” | **chưa nối** |" in md and "không thấy chữ này trên thiết kế" in md
    # AC quoted from the ticket under its screen, cut at the next AC / heading; a comment that adds to it follows
    assert "**AC-1**: Nhập số điện thoại\n- 10 số" in md
    assert md.count("Nhập số điện thoại") == 2  # once under its screen, once in the source quoted whole
    assert "AC 2: Nhập mã OTP 6 số\n\nAC-2: mã hết hạn sau 5 phút" in md
    assert "Đếm ngược 60s" in md and "Hỏi PO về giới hạn gửi lại" in md
    assert "1. “Đăng nhập” → bấm “Gửi OTP” → “Nhập OTP” → bấm “Xác nhận” (khi Mã sai) → “Sai mã”" in md
    gaps = md.split("## Còn thiếu / cần hỏi lại")[1].split("##")[0]
    for want in ("Màn chưa có thiết kế Zeplin: “Nhập OTP”", "“Trợ giúp” trên “Đăng nhập”", "“Màn lạc”",
                 "chưa gắn vào màn / nút nào (có thể thiếu màn): AC-3"):
        assert want in gaps
    assert "````text" in md  # a source with ``` inside gets a longer fence: it cannot close the quote
    data = md.split("## Dữ liệu sơ đồ")[1]
    assert '"title":"Đăng nhập OTP"' in data and '"x"' not in data and '{\n' not in data  # compact: one line


def test_options_leave_out_sources_paths_and_data_and_say_what_could_not_be_read():
    o = flow_md.Options(sources=False, paths=False, data=False, lost=["VA-9"], zeplin_error="Chưa cấu hình Zeplin")
    md = flow_md.build(FLOW, [TICKET], {}, o)
    assert "## Nguồn yêu cầu" not in md and "## Đường đi" not in md and "## Dữ liệu sơ đồ" not in md
    assert "Không đọc được Zeplin (Chưa cấu hình Zeplin)" in md and "`VA-9`" in md
    # the AC no screen carries are still quoted once (AC-3); the ones under a screen are not repeated here
    rest = md.split("## AC không gắn vào màn nào")[1]
    assert "AC-03: Khoá sau 5 lần sai" in rest and "Nhập số điện thoại" not in rest
    assert "## Dữ liệu sơ đồ" not in flow_md.build(FLOW, [TICKET], {})  # the JSON only when asked


def test_ac_codes_and_blocks():
    assert flow_md.ac_codes("AC-1, ac 02 và AC_3") == ["AC-1", "AC-2", "AC-3"]
    assert flow_md.ac_blocks(["| AC-4 | bảng\n# H\nAC-4 lần hai"]) == {"AC-4": "| AC-4 | bảng\n\nAC-4 lần hai"}
    one_line = flow_md.ac_blocks(["AC-1: gửi OTP. AC-2: sai mã báo lỗi; AC-3: về trang chủ."])
    assert one_line == {"AC-1": "AC-1: gửi OTP.", "AC-2": "AC-2: sai mã báo lỗi;", "AC-3": "AC-3: về trang chủ."}
