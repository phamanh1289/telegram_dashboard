"use client";

import { X } from "lucide-react";
import { type RefObject, useLayoutEffect, useRef } from "react";
import { Button } from "@/shared/components/ui/button";
import { fmtClock, fmtDay, useT } from "@/shared/lib/i18n";
import type { DocDetail, DocPart } from "@/features/docs/lib/docs";
import { DiffRows } from "./diff-rows";

// A changed line clicked in Lịch sử thay đổi, shown in the document as a code diff: the block's added lines still in
// the text are lit green (CSS Custom Highlight, no change to the Markdown) and a card with the lines that are not
// (− removed, + added then changed again) opens in the text right above where they sat. The place comes from the
// block's `at` (backend docs/parts.changes: an index into the same non-blank line list as docLines below); updates
// recorded before it are placed under their section's heading.

type Rev = DocDetail["revs"][number];
type Block = Rev["blocks"][number];
type Ln = { text: string; part: number };
export type Mark = {
  doc: number; key: number; rev: Rev;
  part: number; // the part the card sits in
  anchor: string; after: boolean; // the line the card opens above (below when the change was at the very end)
  lit: Ln[]; // added lines found in the text
  minus: string[]; plus: string[]; // the card's lines
  focus: string | null; // the line clicked, scrolled to
};

const CUT = 300; // REV_LINE_CHARS: a stored line is cut there
const HIGHLIGHT = "doc-add"; // ::highlight(doc-add) in globals.css

/** The document's non-blank lines and their part, a heading once where its section starts (backend parts._lines). */
export function docLines(parts: DocPart[]): Ln[] {
  const out: Ln[] = [];
  let last: string | null = null;
  for (const p of parts) {
    if (p.heading && p.heading !== last) out.push({ text: p.heading, part: p.part });
    last = p.heading;
    for (const l of p.body.split("\n")) if (l.trim()) out.push({ text: l.trimEnd(), part: p.part });
  }
  return out;
}

/** Where a block of an update sits in the document now. `line`: the line clicked (null: the section's name). */
export function locate(lines: Ln[], b: Block, line: string | null): Omit<Mark, "doc" | "key" | "rev"> | null {
  if (!lines.length) return null;
  const head = b.heading ? Math.max(0, lines.findIndex((l) => l.text === b.heading)) : 0;
  const at = Math.min(b.at ?? head + (b.heading ? 1 : 0), lines.length);
  const near = (text: string) => { // the copy closest to `at`: a line can repeat ("- Có", a table border)
    let best = -1;
    lines.forEach((l, i) => { if (l.text.slice(0, CUT) === text && (best < 0 || Math.abs(i - at) < Math.abs(best - at))) best = i; });
    return best;
  };
  const found = b.added.map(near);
  const lit = found.filter((i) => i >= 0).map((i) => lines[i]);
  const first = found.find((i) => i >= 0);
  const after = first == null && at >= lines.length;
  const anchor = lines[first ?? Math.min(at, lines.length - 1)];
  return {
    part: anchor.part, anchor: anchor.text, after, lit,
    minus: b.removed, plus: b.added.filter((_, k) => found[k] < 0),
    focus: line && b.added.includes(line) && found[b.added.indexOf(line)] >= 0 ? line : null,
  };
}

// Markdown text as rendered: list / heading / quote marks, emphasis, table pipes, link targets and spaces dropped on
// both sides, so a source line can be found in the rendered text of its part.
const SKIP = /[\s|*_~`#>\\]/;
const squash = (s: string) => s.replace(/!\[[^\]]*\]\([^)]*\)/g, "").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/<[^>]+>/g, "")
  .replace(/^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/, "").split("").filter((c) => !SKIP.test(c)).join("").toLowerCase();

function findLine(sec: HTMLElement, text: string): Range | null {
  const map: [Node, number][] = [];
  let flat = "";
  const walk = document.createTreeWalker(sec, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (n.parentElement?.closest("[data-diff-card]") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT) });
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    const s = n.textContent ?? "";
    for (let i = 0; i < s.length; i++) if (!SKIP.test(s[i])) { flat += s[i].toLowerCase(); map.push([n, i]); }
  }
  const want = squash(text);
  if (!want) return null;
  let i = flat.indexOf(want), len = want.length;
  if (i < 0 && want.length > 30) { i = flat.indexOf(want.slice(0, 30)); len = 30; } // a part of the line rendered otherwise
  if (i < 0) return null;
  const r = new Range();
  r.setStart(map[i][0], map[i][1]);
  r.setEnd(map[i + len - 1][0], map[i + len - 1][1] + 1);
  return r;
}

const BLOCK = "li, p, h1, h2, h3, h4, h5, h6, blockquote, pre, table";

/** In the part `mark.part`: lights the added lines, opens the card in the text and tells the reader where to scroll. */
export function DiffMark({ mark, aimRef, onClose }: {
  mark: Mark; onClose: () => void;
  aimRef: RefObject<((root: HTMLElement) => number | null) | null>; // the reader's scroll goal while the mark is open
}) {
  const t = useT();
  const card = useRef<HTMLDivElement>(null);
  const empty = !mark.minus.length && !mark.plus.length;
  useLayoutEffect(() => {
    const box = card.current, sec = box?.closest<HTMLElement>("[data-part]");
    if (!box || !sec) return;
    const ranges = mark.lit.flatMap((l) => {
      const s = sec.parentElement?.querySelector<HTMLElement>(`[data-part="${l.part}"]`);
      const r = s && findLine(s, l.text);
      return r ? [[l.text, r] as const] : [];
    });
    if (typeof CSS !== "undefined" && "highlights" in CSS) CSS.highlights.set(HIGHLIGHT, new Highlight(...ranges.map(([, r]) => r)));
    const at = findLine(sec, mark.anchor);
    const el = (at?.startContainer.parentElement?.closest<HTMLElement>(BLOCK) ?? sec.querySelector<HTMLElement>(BLOCK)) || null;
    const prop = mark.after ? "marginBottom" : "marginTop";
    const place = () => {
      if (!el || empty) return;
      el.style[prop] = `${box.offsetHeight + 12}px`;
      const top = el.getBoundingClientRect()[mark.after ? "bottom" : "top"] - sec.getBoundingClientRect().top;
      box.style.top = `${mark.after ? top + 6 : top - box.offsetHeight - 6}px`;
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(box);
    const focus = ranges.find(([text]) => text === mark.focus)?.[1];
    aimRef.current = (root) => { // the card and the line clicked centred together; too tall: the card's top first
      const rs = [empty ? null : box, focus ?? (empty ? at : null)].flatMap((x) => (x ? [x.getBoundingClientRect()] : []));
      if (!rs.length) return null;
      const a = Math.min(...rs.map((r) => r.top)), h = Math.max(...rs.map((r) => r.bottom)) - a;
      const top = root.getBoundingClientRect().top;
      const y = root.scrollTop + a - top - Math.max(16, (root.clientHeight - h) / 2);
      return Math.max(0, Math.min(y, root.scrollHeight - root.clientHeight));
    };
    return () => {
      ro.disconnect();
      if (el) el.style[prop] = "";
      if (typeof CSS !== "undefined" && "highlights" in CSS) CSS.highlights.delete(HIGHLIGHT);
      aimRef.current = null;
    };
  }, [mark, aimRef, empty]);
  return (
    <div ref={card} data-diff-card role="note" aria-label={t("Thay đổi lúc {d}", { d: `${fmtDay(mark.rev.at)} ${fmtClock(mark.rev.at)}` })}
      className={empty ? "hidden" : "absolute inset-x-3 z-10 grid gap-1 rounded-md border border-rule bg-cotton p-2 font-mono text-xs shadow-pop animate-in fade-in-0 zoom-in-95 duration-(--dur-short)"}>
      <div className="flex items-center gap-2 font-sans text-2xs text-ink-3">
        <span className="min-w-0 flex-1 truncate">{t("Thay đổi lúc {d}", { d: `${fmtDay(mark.rev.at)} ${fmtClock(mark.rev.at)}` })}{mark.rev.by && ` · ${mark.rev.by}`}</span>
        <Button size="icon-xs" variant="ghost" aria-label={t("Đóng")} onClick={onClose}><X /></Button>
      </div>
      <DiffRows removed={mark.minus} added={mark.plus} />
    </div>
  );
}
