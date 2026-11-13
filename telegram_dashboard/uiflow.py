"""UI flow của ticket: schema, ghép / rút HTML tự chứa, danh sách thay đổi. Thuần, không I/O."""

import json
import re
from html import escape
from typing import Literal

from pydantic import BaseModel, Field, field_validator

from .providers import ZEPLIN

NAME = "uiflow-{issue}.html"
MAX_SCREENS, MAX_ITEMS, MAX_LINKS = 60, 20, 300
ID = r"^[A-Za-z0-9_-]{1,40}$"
SRC = r"^[A-Za-z0-9_-]{1,40}(\.[A-Za-z0-9_-]{1,40})?$"


class Item(BaseModel):
    id: str = Field(pattern=ID)
    label: str = Field(min_length=1, max_length=80)


class Screen(BaseModel):
    id: str = Field(pattern=ID)
    title: str = Field(min_length=1, max_length=80)
    kind: Literal["screen", "popup", "sheet", "toast"] = "screen"
    parent: str | None = None
    x: float | None = None
    y: float | None = None
    zeplin: str = ""
    ac: str = Field("", max_length=40)
    items: list[Item] = Field(default_factory=list, max_length=MAX_ITEMS)

    @field_validator("zeplin")
    @classmethod
    def _zeplin(cls, v: str) -> str:
        return v if ZEPLIN.fullmatch(v) else ""


class Link(BaseModel):
    src: str = Field(pattern=SRC)
    to: str = Field(pattern=ID)
    act: Literal["navigate", "open", "back", "close"] = "navigate"
    when: str = Field("", max_length=80)
    ac: str = Field("", max_length=40)


class Flow(BaseModel):
    v: Literal[1] = 1
    ticket: str
    rev: int = 0
    device: Literal["mobile"] = "mobile"
    screens: list[Screen] = Field(max_length=MAX_SCREENS)
    links: list[Link] = Field(max_length=MAX_LINKS)


def _items_by_screen(flow: Flow) -> dict[str, dict[str, str]]:
    return {s.id: {i.id: i.label for i in s.items} for s in flow.screens}


def _cut(d: dict, **limits: int) -> dict:
    return {k: v[: limits[k]] if k in limits and isinstance(v, str) else v for k, v in d.items()}


def _trim(raw: dict) -> dict:
    """Cắt chuỗi / danh sách quá dài thay vì từ chối cả flow AI trả về."""
    screens = [
        _cut(s, title=80, ac=40) | {"items": [_cut(i, label=80) for i in s.get("items") or []][:MAX_ITEMS]}
        for s in raw.get("screens") or []
    ]
    links = [_cut(k, when=80, ac=40) for k in (raw.get("links") or [])[:MAX_LINKS]]
    return {**raw, "screens": screens, "links": links}


def clean(raw: dict, ticket: str) -> Flow:
    """Kiểm schema, bỏ phần hỏng (nút trùng, link mất nguồn / đích, parent lạ); ValueError nếu không dùng được."""
    try:
        trimmed = _trim(raw)
    except (AttributeError, TypeError, KeyError) as e:  # hình dạng sai (màn không phải object, links không phải list…)
        raise ValueError("UI flow sai định dạng") from e
    flow = Flow.model_validate({**trimmed, "ticket": ticket})
    ids = [s.id for s in flow.screens]
    if not ids or len(set(ids)) != len(ids):
        raise ValueError("UI flow cần ≥1 màn, id màn không trùng")
    for s in flow.screens:
        first: dict[str, Item] = {}
        for i in s.items:
            first.setdefault(i.id, i)  # trùng id: giữ cái đầu
        s.items = list(first.values())
        s.parent = s.parent if s.parent in ids and s.parent != s.id else None
    items = _items_by_screen(flow)

    def ok(link: Link) -> bool:
        screen, _, item = link.src.partition(".")
        return screen in items and (not item or item in items[screen]) and link.to in items

    flow.links = [link for link in flow.links if ok(link)]
    return flow


SHELL = (
    '<!doctype html><meta charset="utf-8">'
    '<meta name="viewport" content="width=device-width,initial-scale=1">'
    '<title>UI flow · {ticket}</title><div id="uiflow"></div>'
    '<script type="application/json" id="uiflow-data">{data}</script><script>{engine}</script>'
)
DATA = re.compile(r"""<script\b[^>]*\bid=["']uiflow-data["'][^>]*>(.*?)</script>""", re.S | re.I)


def build_html(flow: Flow, engine: str) -> str:
    if "</script" in engine.lower():
        raise ValueError("engine chứa </script")
    data = flow.model_dump_json().replace("<", "\\u003c")
    return SHELL.format(ticket=escape(flow.ticket), data=data, engine=engine)


def extract(html: str) -> Flow | None:
    m = DATA.search(html)
    try:
        raw = json.loads(m[1]) if m else None
        return clean(raw, raw["ticket"]) if raw else None
    except ValueError, KeyError, TypeError:
        return None


def _renames(kind: str, old: dict[str, str], new: dict[str, str], scope: str = "") -> list[str]:
    """Đổi tên / thêm / xoá giữa hai bảng id → nhãn; `scope` là hậu tố ' (Màn)' của nút."""
    out = [f'Đổi tên {kind} "{old[i]}" → "{new[i]}"{scope}' for i in new if i in old and old[i] != new[i]]
    out += [f'Thêm {kind} "{new[i]}"{scope}' for i in new if i not in old]
    return out + [f'Xoá {kind} "{old[i]}"{scope}' for i in old if i not in new]


def _item_changes(old: Flow, new: Flow) -> list[str]:
    oi, ni = _items_by_screen(old), _items_by_screen(new)
    titles = {s.id: s.title for s in new.screens}
    return [line for sid in ni if sid in oi for line in _renames("nút", oi[sid], ni[sid], f" ({titles[sid]})")]


def _label(flow: Flow, link: Link) -> str:
    screen, _, item = link.src.partition(".")
    title = next(s.title for s in flow.screens if s.id == screen)
    return f'"{_items_by_screen(flow)[screen][item]}" ({title})' if item else f'Màn "{title}" ({link.act})'


def _link_changes(old: Flow, new: Flow) -> list[str]:
    def by_key(flow: Flow) -> dict[tuple[str, str], Link]:
        return {(k.src, k.act): k for k in flow.links}

    ol, nl = by_key(old), by_key(new)
    ot = {s.id: s.title for s in old.screens}
    nt = {s.id: s.title for s in new.screens}
    out = [f'{_label(new, nl[k])}: "{ot[ol[k].to]}" → "{nt[nl[k].to]}"' for k in nl if k in ol and ol[k].to != nl[k].to]
    out += [f'Nối {_label(new, nl[k])} → "{nt[nl[k].to]}"' for k in nl if k not in ol]
    return out + [f'Bỏ nối {_label(old, ol[k])} → "{ot[ol[k].to]}"' for k in ol if k not in nl]


def changes(old: Flow | None, new: Flow) -> list[str]:
    if old is None:
        return [f"Tạo UI flow: {len(new.screens)} màn, {len(new.links)} liên kết"]
    out = _renames("màn", {s.id: s.title for s in old.screens}, {s.id: s.title for s in new.screens})
    out += _item_changes(old, new) + _link_changes(old, new)
    if out:
        return out
    if _props(old) != _props(new):
        return ["Sửa thuộc tính màn / liên kết"]
    moved = [(s.x, s.y) for s in old.screens] != [(s.x, s.y) for s in new.screens]
    return ["Sắp xếp lại vị trí màn"] if moved else []


def _props(flow: Flow) -> dict:
    return flow.model_dump(exclude={"rev": True, "screens": {"__all__": {"x", "y"}}})


AI_FLOW = """\
Từ ticket (mô tả, AC, link / tên màn Zeplin) dựng UI flow của app mobile.
CHỈ trả MỘT JSON, không chữ nào ngoài JSON: {"screens": [...], "links": [...]}.
screens[]: {"id", "title", "kind", "parent", "zeplin", "ac", "items": [{"id", "label"}]}
links[]: {"src", "to", "act", "when", "ac"}

Nguồn:
- Ticket có khối chữ "Luồng màn" vẽ dạng cây (`├─ "nút" → Màn`) thì đó là nguồn chính cho màn / nút / link;
  AC chỉ bổ sung.
- Dòng có tiền tố như `[Update 13.11]` thì bản mới hơn thắng. Không bịa màn hay hành động không có trong ticket.
- Mã AC dạng `AC2.3`, quy tắc nghiệp vụ dạng `BR1`: ghi vào "ac" (≤ 40 ký tự) của màn hoặc link do nó sinh ra.

Màn:
- id (màn và nút): chữ / số / "_" / "-", tối đa 40 ký tự, không trùng; title và label ≤ 80 ký tự.
- Mỗi màn trong AC / Zeplin là một screen (kind "screen"). Popup / bottom sheet / toast:
  kind = "popup" | "sheet" | "toast", parent = id màn chứa nó.
- Link Zeplin màn viết inline `([màn](https://app.zeplin.io/project/<pid>/screen/<sid>))` cạnh AC:
  ghi URL đó vào "zeplin" của màn tương ứng.
  Chỉ có tên màn Zeplin thì dùng tên đó làm title.
- Zeplin get_screen trả rất lớn (~100-200 KB, nhiều lớp rác như Mask, Status Bar):
  chỉ gọi khi ticket chưa nêu tên nút của màn,
  ưu tiên targetLayerName, bỏ qua lớp status bar / mask / trang trí;
  chỉ dùng tên lớp để đặt tên items.

Link:
- Mỗi hành động của người dùng là một item của màn + một link: src = "idMàn.idNút", to = id màn đích,
  act = "navigate" | "open" (mở popup / sheet) | "close".
- Quay lại: act = "back", src = id màn (không có nút), to = màn đích khi back.
- Điều kiện rẽ nhánh ghi vào "when" (≤ 80 ký tự).
Không có x / y, không có rev.
"""
