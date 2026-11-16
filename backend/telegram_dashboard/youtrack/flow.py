"""UI flow của ticket: schema, ghép / rút HTML tự chứa, danh sách thay đổi. Thuần, không I/O."""

import json
import re
from html import escape
from typing import Annotated, Literal

from pydantic import BaseModel, Field, field_validator, model_validator

from ..providers import ZEPLIN
from ..zeplin import MAX_HITS

NAME = "uiflow-{issue}.html"  # = flowName() in web/src/components/yt/sheet.tsx
MAX_SCREENS, MAX_ITEMS, MAX_LINKS = 200, 40, 1000
VERSION, MAX_NOTE = 2, 4000  # = VERSION / CAP_NOTE in web/src/features/youtrack/flow-engine/constants.js
ID = r"^[A-Za-z0-9_-]{1,40}$"
SRC = r"^[A-Za-z0-9_-]{1,40}(\.[A-Za-z0-9_-]{1,40})?$"


class TooNew(ValueError):
    """The file was written by a newer dashboard: never edited (nor re-rendered over) by this one."""


class Rect(BaseModel):
    """A hand-drawn tap area on the screen's whole image, each value a fraction of its width / height."""

    x: float = Field(ge=0, le=1)
    y: float = Field(ge=0, le=1)
    w: float = Field(gt=0, le=1)
    h: float = Field(gt=0, le=1)

    @model_validator(mode="after")
    def _inside(self) -> Rect:
        if self.x + self.w > 1 + 1e-9 or self.y + self.h > 1 + 1e-9:
            raise ValueError("rect ngoài ảnh")
        return self


class Item(BaseModel):
    id: str = Field(pattern=ID)
    label: str = Field(min_length=1, max_length=80)
    rect: Rect | None = None

    @field_validator("rect", mode="before")
    @classmethod
    def _rect(cls, v: object) -> object:
        """An invalid rect is dropped (the item falls back to text matching), as the JS sanitizer does."""
        try:
            return Rect.model_validate(v) if v is not None else None
        except ValueError:
            return None


class Screen(BaseModel):
    id: str = Field(pattern=ID)
    title: str = Field(min_length=1, max_length=80)
    kind: Literal["screen", "popup", "sheet", "toast"] = "screen"
    parent: str | None = None
    x: float | None = None
    y: float | None = None
    zeplin: str = ""
    ac: str = Field("", max_length=40)
    note: str = Field("", max_length=MAX_NOTE)
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


class Pending(BaseModel):
    """A step the ticket describes that has no design to draw yet (a screen / popup with no Zeplin link). Listed in
    the flow check until the user adds its screen from Zeplin or dismisses it; never drawn, never a link's end."""

    title: str = Field(min_length=1, max_length=80)
    kind: Literal["screen", "popup", "sheet", "toast"] = "screen"
    ac: str = Field("", max_length=40)
    src: str = ""  # "<screen>" | "<screen>.<item>": where it is reached from, when the ticket says so
    when: str = Field("", max_length=80)

    @field_validator("src")
    @classmethod
    def _src(cls, v: str) -> str:
        return v if re.fullmatch(SRC, v) else ""


class Flow(BaseModel):
    v: Literal[2] = VERSION  # v1 files are read as v2 (same fields, without rect / note), see clean()
    ticket: str
    rev: int = 0
    device: Literal["mobile"] = "mobile"
    start: str | None = None  # the screen the prototype and the test paths start from; None: the first one
    screens: list[Screen] = Field(max_length=MAX_SCREENS)
    links: list[Link] = Field(max_length=MAX_LINKS)
    # Zeplin URL -> "<w>x<h>" + the texts on the design, as it was at the last save: opening the flow later tells
    # which screens were redesigned since (design_of on the live shots). Written by the save, never by the engine
    design: dict[str, list[str]] = Field(default_factory=dict)
    pending: list[Pending] = Field(default_factory=list)  # steps left out for want of a design, see Pending

    @field_validator("pending", mode="before")
    @classmethod
    def _pending(cls, v: object) -> list:
        """One per title, the unreadable ones dropped: a bad entry never costs the whole file."""
        out: dict[str, Pending] = {}
        for raw in v if isinstance(v, list) else []:
            try:
                p = (
                    raw
                    if isinstance(raw, Pending)
                    else Pending.model_validate(_cut(_loose(raw), title=80, ac=40, when=80))
                )
            except ValueError, TypeError:
                continue
            out.setdefault(_norm(p.title), p)
        return list(out.values())[:MAX_SCREENS]


Label = Annotated[str, Field(max_length=80)]
MAX_SHOT = 1_500_000  # one screen image as a data URI (the page sends WebP ≤ 780 px wide: ~100-300 KB)
MAX_SHOTS = 20_000_000  # every image of a file together, under the attachment size the dashboard proxies


class Shot(BaseModel):
    """A Zeplin screen as the exported file draws it: the image (compressed by the page), design size, hits."""

    src: str = Field(pattern=r"^data:image/(webp|jpeg|png);base64,[A-Za-z0-9+/=]+$", max_length=MAX_SHOT)
    w: float = Field(gt=0, le=5000)
    h: float = Field(gt=0, le=50000)
    hits: list[tuple[Label, float, float, float, float]] = Field(default_factory=list, max_length=MAX_HITS)


def design_of(shots: dict) -> dict[str, list[str]]:
    """Each screen's design signature: size and the set of texts on it (order-free). = designOf in flow.tsx"""
    out = {}
    for url, s in shots.items():
        w, h, hits = (s.w, s.h, s.hits) if isinstance(s, Shot) else (s["w"], s["h"], s["hits"])
        out[url] = [f"{round(w)}x{round(h)}", *sorted({str(x[0]) for x in hits})]
    return out


def _norm(title: str) -> str:
    return " ".join(title.casefold().split())


def _items_by_screen(flow: Flow) -> dict[str, dict[str, str]]:
    return {s.id: {i.id: i.label for i in s.items} for s in flow.screens}


def _cut(d: dict, **limits: int) -> dict:
    return {k: v[: limits[k]] if k in limits and isinstance(v, str) else v for k, v in d.items()}


KINDS = ("screen", "popup", "sheet", "toast")


def _loose(d: dict) -> dict:
    """AI hay ghi "ac" thành mảng mã (["AC1.2"]) và "kind" ngoài danh sách ("web", "map"): sửa, không từ chối"""
    d = dict(d)
    if isinstance(d.get("ac"), list):
        d["ac"] = ", ".join(str(a) for a in d["ac"])
    if "kind" in d and d["kind"] not in KINDS:
        d["kind"] = "screen"
    return d


def _trim(raw: dict) -> dict:
    """Cắt chuỗi / danh sách quá dài thay vì từ chối cả flow AI trả về."""
    screens = [
        _cut(_loose(s), title=80, ac=40, note=MAX_NOTE)
        | {"items": [_cut(i, label=80) for i in s.get("items") or []][:MAX_ITEMS]}
        for s in raw.get("screens") or []
    ]
    links = [_cut(_loose(k), when=80, ac=40) for k in (raw.get("links") or [])[:MAX_LINKS]]
    return {**raw, "screens": screens, "links": links}


def clean(raw: dict, ticket: str) -> Flow:
    """Kiểm schema, bỏ phần hỏng (nút trùng, link mất nguồn / đích, parent lạ); ValueError nếu không dùng được."""
    v = raw.get("v", 1) if isinstance(raw, dict) else None
    if isinstance(v, int) and not isinstance(v, bool) and v > VERSION:
        raise TooNew(f"UI flow phiên bản {v} mới hơn bản dashboard này hỗ trợ ({VERSION}) — cập nhật app để mở")
    if v not in (1, VERSION):
        raise ValueError("UI flow sai phiên bản")
    try:
        trimmed = _trim(raw)
    except (AttributeError, TypeError, KeyError) as e:  # hình dạng sai (màn không phải object, links không phải list…)
        raise ValueError("UI flow sai định dạng") from e
    flow = Flow.model_validate({**trimmed, "ticket": ticket, "v": VERSION})  # v1 → v2 in memory
    ids = [s.id for s in flow.screens]
    if not ids or len(set(ids)) != len(ids):
        raise ValueError("UI flow cần ≥1 màn, id màn không trùng")
    for s in flow.screens:
        first: dict[str, Item] = {}
        for i in s.items:
            first.setdefault(i.id, i)  # trùng id: giữ cái đầu
        s.items = list(first.values())
        s.parent = s.parent if s.parent in ids and s.parent != s.id else None
    flow.start = flow.start if flow.start in ids else None
    items = _items_by_screen(flow)

    def ok(link: Link) -> bool:
        screen, _, item = link.src.partition(".")
        return screen in items and (not item or item in items[screen]) and link.to in items

    flow.links = [link for link in flow.links if ok(link)]
    # a pending step whose screen is on the map now (added from Zeplin under the same name) is no longer pending
    drawn = {_norm(s.title) for s in flow.screens}
    flow.pending = [p for p in flow.pending if _norm(p.title) not in drawn]
    for p in flow.pending:
        screen, _, item = p.src.partition(".")
        if screen not in items or (item and item not in items[screen]):
            p.src = ""
    return flow


SHELL = (
    '<!doctype html><meta charset="utf-8">'
    '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">'
    '<title>UI flow · {ticket}</title><div id="uiflow"></div>'
    '<script type="application/json" id="uiflow-data">{data}</script>'
    '<script type="application/json" id="uiflow-shots">{shots}</script><script>{engine}</script>'
)
DATA = re.compile(r"""<script\b[^>]*\bid=["']uiflow-data["'][^>]*>(.*?)</script>""", re.S | re.I)


def _json(v: str) -> str:
    return v.replace("<", "\\u003c")


def build_html(flow: Flow, engine: str, shots: dict[str, Shot] | None = None) -> str:
    """The self-contained file: the flow, the images of the Zeplin screens it links (only those), the engine."""
    if "</script" in engine.lower():
        raise ValueError("engine chứa </script")
    used = {s.zeplin for s in flow.screens}
    pics = {u: s.model_dump() for u, s in (shots or {}).items() if u in used}
    if sum(len(p["src"]) for p in pics.values()) > MAX_SHOTS:
        raise ValueError("Ảnh Zeplin quá lớn")
    return SHELL.format(ticket=escape(flow.ticket), data=_json(flow.model_dump_json()),
                        shots=_json(json.dumps(pics, ensure_ascii=False)), engine=engine)  # fmt: skip


def extract(html: str) -> Flow | None:
    """The file's flow; None when it is not ours / broken. TooNew propagates: a newer file is not "broken"."""
    m = DATA.search(html)
    try:
        raw = json.loads(m[1]) if m else None
        return clean(raw, raw["ticket"]) if raw else None
    except TooNew:
        raise
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


def _match(old_keys: dict[str, str], new_keys: dict[str, str]) -> dict[str, str]:
    """new id → old id: cùng id trước, rồi cùng nhãn đúng từng chữ (cái chưa dùng đầu tiên)."""
    out = {n: n for n in new_keys if n in old_keys}
    used = set(out.values())
    for n, label in new_keys.items():
        if n in out:
            continue
        o = next((o for o, t in old_keys.items() if t == label and o not in used), None)
        if o is not None:
            out[n] = o
            used.add(o)
    return out


def _align(old: Flow, new: Flow) -> tuple[Flow, int]:
    """Bản sao `new` mà id màn / nút đã đổi về id cũ tương ứng (AI dựng lại thường đổi id); kèm số màn khớp."""
    flow = new.model_copy(deep=True)
    olds = {s.id: s for s in old.screens}
    smap = _match({i: s.title for i, s in olds.items()}, {s.id: s.title for s in flow.screens})
    imaps: dict[str, dict[str, str]] = {}
    for s in flow.screens:
        if s.id in smap:
            imaps[s.id] = _match({i.id: i.label for i in olds[smap[s.id]].items}, {i.id: i.label for i in s.items})
            for i in s.items:
                i.id = imaps[s.id].get(i.id, i.id)
    for k in flow.links:
        screen, _, item = k.src.partition(".")
        k.src = smap.get(screen, screen) + (f".{imaps.get(screen, {}).get(item, item)}" if item else "")
        k.to = smap.get(k.to, k.to)
    for s in flow.screens:
        s.parent = smap.get(s.parent, s.parent) if s.parent else None
        s.id = smap.get(s.id, s.id)
    flow.start = smap.get(flow.start, flow.start) if flow.start else None
    return flow, len(smap)


def changes(old: Flow | None, new: Flow) -> list[str]:
    if old is None:
        return [f"Tạo UI flow: {len(new.screens)} màn, {len(new.links)} liên kết"]
    raw = new
    new, matched = _align(old, raw)
    if matched * 2 < len(old.screens):
        n0, m0 = len(old.screens), len(old.links)
        return [f"Render lại: {len(raw.screens)} màn, {len(raw.links)} liên kết (trước: {n0} màn, {m0} liên kết)"]
    out = _renames("màn", {s.id: s.title for s in old.screens}, {s.id: s.title for s in new.screens})
    out += _item_changes(old, new) + _link_changes(old, new) + _manual_changes(old, new)
    was, now = {_norm(p.title): p.title for p in old.pending}, {_norm(p.title): p.title for p in raw.pending}
    out += [f'Chờ bổ sung: thêm "{t}"' for k, t in now.items() if k not in was]
    out += [f'Chờ bổ sung: bỏ "{t}"' for k, t in was.items() if k not in now]
    if out:
        return out
    if _props(old) != _props(new):
        return ["Sửa thuộc tính màn / liên kết"]
    moved = [(s.x, s.y) for s in old.screens] != [(s.x, s.y) for s in new.screens]
    if moved:
        return ["Sắp xếp lại vị trí màn"]
    redrawn = [u for u, d in raw.design.items() if old.design.get(u) not in (None, d)]
    return [f"Cập nhật ảnh thiết kế Zeplin của {len(redrawn)} màn"] if redrawn else []


def _manual_changes(old: Flow, new: Flow) -> list[str]:
    """Ghi chú, vùng bấm vẽ tay, màn bắt đầu: what the editor changes that the AI never writes."""
    olds = {s.id: s for s in old.screens}
    out = []
    for s in new.screens:
        o = olds.get(s.id)
        if o is None:
            continue
        if o.note != s.note:
            verb = "Thêm" if not o.note else "Xoá" if not s.note else "Sửa"
            out.append(f'{verb} ghi chú màn "{s.title}"')
        orects = {i.id: i.rect for i in o.items}
        for i in s.items:
            if i.id in orects and orects[i.id] != i.rect:
                verb = "Vẽ" if orects[i.id] is None else "Bỏ" if i.rect is None else "Chỉnh"
                out.append(f'{verb} vùng bấm "{i.label}" ({s.title})')
    if (old.start or None) != (new.start or None):
        title = next((s.title for s in new.screens if s.id == new.start), None)
        out.append(f'Đặt màn bắt đầu "{title}"' if title else "Bỏ màn bắt đầu riêng (dùng màn đầu tiên)")
    return out


def keep_manual(old: Flow, new: Flow) -> tuple[Flow, dict[str, int]]:
    """A re-render keeps what only a person writes: notes, hand-drawn tap areas, the start screen, and the screens'
    positions when every new screen matches an old one (else a fresh layout, so new screens never overlap kept ones).
    Screens / buttons are matched like the change list does (same id, else same title / label)."""
    flow, _ = _align(old, new)
    olds = {s.id: s for s in old.screens}
    kept = {"positions": 0, "notes": 0, "rects": 0, "start": 0}
    every = all(s.id in olds for s in flow.screens)
    for s in flow.screens:
        o = olds.get(s.id)
        if o is None:
            continue
        if every and o.x is not None and o.y is not None:
            s.x, s.y = o.x, o.y
            kept["positions"] += 1
        if o.note and not s.note:
            s.note = o.note
            kept["notes"] += 1
        rects = {i.id: i.rect for i in o.items if i.rect}
        for i in s.items:
            if i.id in rects and i.rect is None:
                i.rect = rects[i.id]
                kept["rects"] += 1
    if old.start and flow.start is None and any(s.id == old.start for s in flow.screens):
        flow.start = old.start
        kept["start"] = 1
    return flow, kept


def _props(flow: Flow) -> dict:
    return flow.model_dump(exclude={"rev": True, "design": True, "screens": {"__all__": {"x", "y"}}})


_STR = r'"((?:[^"\\]|\\.)*)"'  # a JSON string written to its closing quote
TITLE = re.compile(rf'"title"\s*:\s*{_STR}')
LABEL = re.compile(r'"label"\s*:')
LINK = re.compile(rf'"src"\s*:\s*{_STR}\s*,\s*"to"\s*:\s*{_STR}')
LINKS = re.compile(r'"links"\s*:')  # the key, not a "links" id or label


def _str(s: str) -> str:
    try:
        return json.loads(f'"{s}"')
    except ValueError:
        return s


class Progress:
    """The flow JSON as the AI writes it, told once per new screen / link: the dialog's live progress. Each delta is
    scanned from where the last one stopped (a full-size flow is ~150 KB, written a few characters at a time)."""

    def __init__(self) -> None:
        self.text, self.screens, self.links, self.items = "", 0, 0, 0
        self.cut = -1  # where "links" starts: the screens part ends there
        self._title = self._label = self._link = 0  # where each scan resumes
        self.names: dict[str, tuple[str, dict[str, str]]] | None = None

    def feed(self, delta: str) -> list[dict]:
        self.text += delta
        if self.cut < 0 and (m := LINKS.search(self.text, max(0, len(self.text) - len(delta) - 16))):
            self.cut = m.start()
        end = len(self.text) if self.cut < 0 else self.cut
        for m in LABEL.finditer(self.text, self._label, end):
            self.items, self._label = self.items + 1, m.end()
        out = []  # one per screen / link, even when a delta closes several (the dialog lists each one)
        for m in TITLE.finditer(self.text, self._title, end):
            self.screens, self._title = self.screens + 1, m.end()
            out.append({"stage": "draw", "n": self.screens, "title": _str(m[1]), "items": self.items})
        if self.cut >= 0:
            for m in LINK.finditer(self.text, max(self._link, self.cut)):
                self.links, self._link = self.links + 1, m.end()
                out.append({"stage": "link", "n": self.links, "items": self.items, **self._names(m[1], m[2])})
        return out

    def _names(self, src: str, to: str) -> dict:
        """A link in the screens' own words: button "label" on screen "title" → screen "title"."""
        if self.names is None:  # the screens part is complete once "links" starts: read it once
            head = self.text[: self.cut]
            try:
                raw = json.loads(head[head.index("{") :].rstrip().rstrip(",") + "}")
                self.names = {
                    s["id"]: (
                        s.get("title") or s["id"],
                        {i["id"]: i.get("label") or i["id"] for i in s.get("items") or []},
                    )
                    for s in raw["screens"]
                }
            except ValueError, KeyError, TypeError, AttributeError:
                self.names = {}
        screen, _, item = _str(src).partition(".")
        title, labels = self.names.get(screen, (screen, {}))
        to = _str(to)
        return {"from": title, "item": labels.get(item, item), "to": self.names[to][0] if to in self.names else to}


AI_FLOW = """\
Từ ticket và story (mô tả, AC, link / tên màn Zeplin) dựng UI flow của app mobile.
CHỈ trả MỘT JSON, không chữ nào ngoài JSON: {"screens": [...], "links": [...]}.
screens[]: {"id", "title", "kind", "parent", "zeplin", "ac", "items": [{"id", "label"}]}
links[]: {"src", "to", "act", "when", "ac"}

Nguồn:
- `<story>`: story cha của ticket. Ticket thường là sub-task một nền tảng, chỉ nói phần cần vẽ (nền tảng,
  khoảng AC); AC, cây "Luồng màn", link Zeplin nằm trong story. Chỉ vẽ phần ticket nói, lấy chi tiết từ story.
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
- `<zeplin>`: chữ hiện trên từng màn Zeplin đã link (đọc sẵn từ thiết kế, trên xuống dưới), theo URL màn.
  label của nút = đúng chữ hiện trên nút trong đó (vd. "Tìm căn hộ"), không dùng tên lớp kiểu "Button/Primary":
  app đặt vùng bấm lên ảnh màn Zeplin bằng cách khớp chữ này. Ticket chưa nêu nút của màn thì lấy nút từ đây
  (bỏ chữ trang trí: giờ, nhãn trường, giá trị mẫu). Không có màn trong `<zeplin>` thì chỉ dựa vào ticket.

Link:
- Mỗi hành động của người dùng là một item của màn + một link: src = "idMàn.idNút", to = id màn đích,
  act = "navigate" | "open" (mở popup / sheet) | "close".
- Quay lại: act = "back", src = id màn (không có nút), to = màn đích khi back. Màn mở được từ nhiều màn
  (A → C, B → C): một link back về MỖI màn đó (C → A, C → B); bấm back về đúng màn đã mở nó.
- Điều kiện rẽ nhánh ghi vào "when" (≤ 80 ký tự).
Không có x / y, không có rev.
"""
