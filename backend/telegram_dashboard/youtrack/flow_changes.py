"""What a UI flow save changes, said as the dialog lists it, and what a re-render keeps of the old flow (only a person
writes it: notes, tap areas, positions, the start screen, folds, notes on the map)."""

from .flow import Flow, Link, _items_by_screen, redesigned


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


KINDS = {"screen": "màn thường", "popup": "popup", "sheet": "sheet", "toast": "toast"}


def _was(old: str, new: str) -> str:
    return f': "{old}" → "{new}"' if old and new else f': "{new}"' if new else f' (bỏ "{old}")'


def _prop_changes(old: Flow, new: Flow) -> list[str]:
    """What a screen / link carries besides its name and target: kind, AC, Zeplin link, parent, a link's condition."""
    olds, titles = {s.id: s for s in old.screens}, {s.id: s.title for s in new.screens}
    out = []
    for s in new.screens:
        if (o := olds.get(s.id)) is None:
            continue
        if o.kind != s.kind:
            out.append(f'Đổi "{s.title}" thành {KINDS[s.kind]}')
        if o.ac != s.ac:
            out.append(f'Sửa AC màn "{s.title}"{_was(o.ac, s.ac)}')
        if o.zeplin != s.zeplin:
            out.append(f'{"Đổi" if s.zeplin else "Bỏ"} link Zeplin màn "{s.title}"')
        if o.parent != s.parent:
            out.append(f'Đặt "{s.title}" nằm trên "{titles[s.parent]}"' if s.parent in titles
                       else f'Bỏ màn nền của "{s.title}"')  # fmt: skip
    ol = {(k.src, k.act): k for k in old.links}
    for k in new.links:
        if (o := ol.get((k.src, k.act))) is None or o.to != k.to:
            continue  # added / retargeted: said by _link_changes
        if o.when != k.when:
            out.append(f"Sửa điều kiện {_label(new, k)}{_was(o.when, k.when)}")
        if o.ac != k.ac:
            out.append(f"Sửa AC liên kết {_label(new, k)}{_was(o.ac, k.ac)}")
    return out


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
    # most of the old map gone AND most of the new one never there: rebuilt (an AI render), one line says it better
    # than a list of every screen; screens only deleted by hand are still listed one by one
    if matched * 2 < len(old.screens) and (len(raw.screens) - matched) * 2 > len(raw.screens):
        n0, m0 = len(old.screens), len(old.links)
        return [f"Dựng lại sơ đồ: {len(raw.screens)} màn, {len(raw.links)} liên kết (trước: {n0} màn, {m0} liên kết)"]
    out = _renames("màn", {s.id: s.title for s in old.screens}, {s.id: s.title for s in new.screens})
    out += _item_changes(old, new) + _link_changes(old, new) + _prop_changes(old, new) + _manual_changes(old, new)
    if old.device != raw.device:
        out.append("Đổi khung màn sang " + ("web" if raw.device == "web" else "điện thoại"))
    if out:
        return out
    if _props(old) != _props(new):
        return ["Sửa thuộc tính màn / liên kết"]
    place = lambda f: [(s.x, s.y) for s in f.screens] + [(m.x, m.y, m.w, m.h) for m in f.memos]  # noqa: E731
    moved = place(old) != place(new)
    if moved:
        return ["Sắp xếp lại vị trí màn"]
    redrawn = [u for u, d in raw.design.items() if redesigned(old.design.get(u), d)]
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
        if o.fold != s.fold:
            out.append(f'{"Mở rộng" if s.fold is None else "Thu gọn"} màn "{s.title}"')
        orects = {i.id: i.rect for i in o.items}
        for i in s.items:
            if i.id in orects and orects[i.id] != i.rect:
                verb = "Vẽ" if orects[i.id] is None else "Bỏ" if i.rect is None else "Chỉnh"
                out.append(f'{verb} vùng bấm "{i.label}" ({s.title})')
    if (old.start or None) != (new.start or None):
        title = next((s.title for s in new.screens if s.id == new.start), None)
        out.append(f'Đặt màn bắt đầu "{title}"' if title else "Bỏ màn bắt đầu riêng (dùng màn đầu tiên)")
    if old.title != new.title:
        out.append(f'Đổi tên UI flow thành "{new.title}"' if new.title else "Bỏ tên riêng của UI flow")
    was, now = {m.id: m.text for m in old.memos}, {m.id: m.text for m in new.memos}
    for verb, n in (("Thêm", len(now.keys() - was.keys())), ("Xoá", len(was.keys() - now.keys())),
                    ("Sửa", sum(1 for k in now.keys() & was.keys() if now[k] != was[k]))):
        if n:
            out.append(f"{verb} {n} ghi chú trên sơ đồ")
    folds = {m.id: m.fold for m in old.memos}
    for verb, on in (("Thu gọn", True), ("Mở rộng", False)):
        if n := sum(1 for m in new.memos if m.id in folds and folds[m.id] != m.fold and m.fold is on):
            out.append(f"{verb} {n} ghi chú trên sơ đồ")
    return out


def keep_manual(old: Flow, new: Flow) -> tuple[Flow, dict[str, int]]:
    """A re-render keeps what only a person writes: the flow's name, notes, hand-drawn tap areas, the start screen,
    and the screens' positions when every new screen matches an old one (else a fresh layout, so new screens never
    overlap kept ones). Screens / buttons are matched like the change list does (same id, else same title / label)."""
    flow, _ = _align(old, new)
    olds = {s.id: s for s in old.screens}
    kept = {"positions": 0, "notes": 0, "rects": 0, "start": 0}  # a fold rides along, not counted
    every = all(s.id in olds for s in flow.screens) and old.device == flow.device  # another frame size: laid out anew
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
        s.fold = o.fold  # as the person left it, folded or whole: only a new screen takes its list's fold (render)
        rects = {i.id: i.rect for i in o.items if i.rect}
        for i in s.items:
            if i.id in rects and i.rect is None:
                i.rect = rects[i.id]
                kept["rects"] += 1
    if old.start and flow.start is None and any(s.id == old.start for s in flow.screens):
        flow.start = old.start
        kept["start"] = 1
    flow.memos = [m.model_copy() for m in old.memos]  # notes on the map: a person's only, never the render's
    flow.title = old.title  # its name: the same
    return flow, kept


def _props(flow: Flow) -> dict:
    return flow.model_dump(exclude={"rev": True, "design": True, "acs": True, "screens": {"__all__": {"x", "y"}},
                                    "memos": {"__all__": {"x", "y", "w", "h"}}})
