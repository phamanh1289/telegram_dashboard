"""Bounded UI-flow input and deterministic design skeleton; no AI or network I/O."""

import hashlib
import json
import math
import re
from dataclasses import dataclass

from .. import zeplin
from ..ai import data_json
from ..providers import ZEPLIN
from . import flow as uiflow

BUDGETS = {False: 12_000, True: 24_000}
CONTEXT_FLOOR, OUTPUT_RESERVE, ENVELOPE_RESERVE = 32_768, 6144, 2048
# Required text (ticket, story, note) is only refused past the assumed context; the Fast/Thorough budget trims
# the optional Zeplin labels. A normal story (VA-11840: ~22K chars of AC) is over Fast's budget alone.
MANDATORY_CEILING = CONTEXT_FLOOR - OUTPUT_RESERVE - ENVELOPE_RESERVE


class BudgetExceeded(ValueError):
    pass


def estimate(text):
    # Conservative UTF-8 heuristic, explicitly not a provider tokenizer measurement.
    return math.ceil(len(text.encode()) / 3)


def source(detail):
    """All requirements/corrections stay whole; scheduling/personnel fields are irrelevant here."""
    return {"id": detail.get("id", ""), "summary": detail.get("summary", ""),
            "description": detail.get("description") or "",
            "comments": [{"text": c.get("text") or ""} for c in detail.get("comments", []) if c.get("text")]}


def sources_from_blocks(ticket, story):
    result, unavailable = [], []
    for text in [ticket, *re.findall(r"<story>(.*?)</story>", story, re.S)]:
        try:
            item = json.loads(text)
        except (ValueError, TypeError):
            unavailable.append(text.strip())
            continue
        if isinstance(item, dict):
            result.append(source(item))
    return result, unavailable


def stable_id(value, prefix="s"):
    return prefix + hashlib.sha256(value.encode()).hexdigest()[:16]


def skeleton(sources, shots):
    """Only explicit markdown screen names/URLs and exact arrow relationships are deterministic."""
    screens, by_title, links = {}, {}, []
    text = "\n".join(part for s in sources for part in
                     [s["description"], *(c["text"] for c in s["comments"])])
    for title, url in re.findall(r"\[([^\]\n]+)\]\((https?://(?:app\.zeplin\.io|zpl\.io)/[^\s)]+)\)", text):
        url = zeplin.canonical(url)
        if url not in screens:
            screens[url] = {"id": stable_id(url), "title": title[:80], "zeplin": url, "items": []}
        screens[url]["title"] = title[:80]  # later source corrections keep the same design identity
        by_title.setdefault(title, set()).add(screens[url]["id"])
    known_urls = list(dict.fromkeys([*(zeplin.canonical(u) for u in ZEPLIN.findall(text)), *shots]))
    for original in known_urls:
        url = zeplin.canonical(original)
        if url in screens and shots.get(original, {}).get("title"):
            screens[url]["title"] = str(shots.get(original, {})["title"])[:80]
        if url not in screens:
            # A URL alone establishes design identity, not a guessed user-facing title.
            screens[url] = {"id": stable_id(url),
                            "title": str(shots.get(original, {}).get("title") or "Màn Zeplin")[:80],
                            "zeplin": url, "items": []}
    ambiguous = []
    for line in text.splitlines():
        # Exact fully named edge: A -- "button" --> B. Tree indentation alone cannot establish navigation.
        match = re.fullmatch(r'\s*(.+?)\s+--\s*["“](.+?)["”]\s*-->\s*(.+?)\s*', line)
        if not match:
            if "→" in line or "├" in line or "└" in line:
                ambiguous.append(line)
            continue
        start, label, end = match.groups()
        if len(by_title.get(start, ())) != 1 or len(by_title.get(end, ())) != 1 or len(label) > 80:
            ambiguous.append(line)
            continue
        src, to = next(iter(by_title[start])), next(iter(by_title[end]))
        item_id = stable_id(label, "b")
        screen = next(s for s in screens.values() if s["id"] == src)
        if not any(i["id"] == item_id for i in screen["items"]):
            screen["items"].append({"id": item_id, "label": label})
        edge = {"src": f"{src}.{item_id}", "to": to}
        if edge not in links:
            links.append(edge)
    # Root screen followed by explicit quoted-button tree edges. Conditions/unknown names stay for AI.
    stack = []
    for line in text.splitlines():
        header = re.fullmatch(r"\s*\[([^]\n]+)\]\(https?://[^)]+\)\s*", line)
        if header and len(by_title.get(header[1], ())) == 1:
            stack = [(-1, next(iter(by_title[header[1]])))]
            continue
        tree = re.fullmatch(r'([ │]*)(?:├|└)─+\s*["“](.+?)["”]\s*→\s*(.+?)\s*', line)
        if not tree or not stack:
            continue
        indent, label, target = tree.groups()
        target_match = re.fullmatch(r"\[([^]]+)\]\(https?://[^)]+\)", target)
        title = target_match[1] if target_match else target
        if len(by_title.get(title, ())) != 1 or len(label) > 80:
            continue
        depth = len(indent)
        while len(stack) > 1 and stack[-1][0] >= depth:
            stack.pop()
        src, to = stack[-1][1], next(iter(by_title[title]))
        item_id = stable_id(label, "b")
        screen = next(s for s in screens.values() if s["id"] == src)
        if not any(item["id"] == item_id for item in screen["items"]):
            screen["items"].append({"id": item_id, "label": label})
        edge = {"src": f"{src}.{item_id}", "to": to}
        if edge not in links:
            links.append(edge)
        stack.append((depth, to))
        if line in ambiguous:
            ambiguous.remove(line)
    if len(screens) > uiflow.MAX_SCREENS:
        raise BudgetExceeded("Nguồn có hơn 60 màn; thu hẹp phạm vi trước khi vẽ")
    if len(links) > uiflow.MAX_LINKS or any(len(s["items"]) > uiflow.MAX_ITEMS for s in screens.values()):
        raise BudgetExceeded("Cây nguồn vượt giới hạn nút/liên kết; thu hẹp phạm vi trước khi vẽ")
    return {"screens": list(screens.values()), "links": links}, ambiguous


@dataclass
class Payload:
    prompt: str
    skeleton: dict
    manifest: dict
    warnings: list


def build(ticket, stories, note, shots, *, deep=False):
    raw, unavailable = sources_from_blocks(ticket, stories)
    used, omitted, seen = [], [], set()
    for item in raw:
        identity = json.dumps(item, sort_keys=True, ensure_ascii=False)
        if identity in seen:
            omitted.append({"source": item["id"], "kind": "duplicate_source", "count": 1})
        else:
            seen.add(identity)
            used.append(item)
    base, ambiguous = skeleton(used, shots)
    budget = min(BUDGETS[deep], CONTEXT_FLOOR - OUTPUT_RESERVE)
    payload_budget = budget - ENVELOPE_RESERVE
    design = {}

    def render():
        own = data_json(used[0]) if used else data_json({})
        other = "".join("\n<story>\n" + data_json(s) + "\n</story>" for s in used[1:])
        other += "".join("\n<story>" + data_json(s) + "</story>" for s in unavailable)
        return (f"{uiflow.AI_FLOW_PATCH}\n<ticket>\n{own}\n</ticket>{other}"
                f"\n<zeplin>{data_json(design)}</zeplin>\n<skeleton>{data_json(base)}</skeleton>"
                f"\n<ask>{data_json(note)}</ask>")

    if estimate(render()) > MANDATORY_CEILING:
        raise BudgetExceeded("Mô tả/AC/quy tắc/ghi chú bắt buộc vượt ngân sách; thu hẹp phạm vi ticket/story. "
                             "Không gọi AI hoặc cắt yêu cầu.")
    for url, shot in shots.items():
        labels = list(dict.fromkeys(str(t) for t in shot.get("texts", []) if t))
        low, high = 0, len(labels)
        while low < high:
            middle = (low + high + 1) // 2
            design[url] = labels[:middle]
            if estimate(render()) <= payload_budget:
                low = middle
            else:
                high = middle - 1
        kept = labels[:low]
        design[url] = kept
        if len(kept) < len(labels):
            omitted.append({"source": zeplin.canonical(url), "kind": "design_labels", "count": len(labels)-len(kept)})
        if not kept:
            design.pop(url, None)
    prompt = render()
    warnings = []
    if ambiguous:
        warnings.append("Một số nhánh chưa đủ rõ; cần kiểm tra quan hệ và điều kiện trên sơ đồ.")
    if unavailable:
        warnings.append("Một số story không đọc được; kiểm tra phần nguồn trước khi cập nhật.")
    if any(o["kind"] == "design_labels" for o in omitted):
        warnings.append("Đã lược bớt chữ thiết kế để giữ ngân sách; "
                        "toàn bộ mô tả, AC, quy tắc và ghi chú vẫn giữ nguyên."
                        + ("" if deep else " Chọn Kỹ để giữ thêm chữ thiết kế."))
    manifest = {"measurement": "estimated", "estimated_input_tokens": estimate(prompt) + ENVELOPE_RESERVE,
                "estimated_payload_tokens": estimate(prompt),
                "budget": budget, "context_floor_assumed": CONTEXT_FLOOR,
                "sources": list(dict.fromkeys(s["id"] for s in used)), "omitted": omitted,
                "warnings": warnings, "ambiguous_lines": len(ambiguous),
                "output_reserve": OUTPUT_RESERVE, "envelope_reserve": ENVELOPE_RESERVE}
    return Payload(prompt, base, manifest, warnings)
