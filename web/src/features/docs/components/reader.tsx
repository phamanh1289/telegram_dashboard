"use client";

import { ArrowLeft, ChevronDown, ChevronUp, ExternalLink, FolderOpen, Search } from "lucide-react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { AiFetching, useAiWait } from "@/shared/components/ai/fetching";
import { Markdown, TicketRef } from "@/shared/components/markdown";
import { Button, buttonVariants } from "@/shared/components/ui/button";
import { Hint } from "@/shared/components/ui/hint";
import { Pill } from "@/shared/components/ui/segmented";
import { errorText } from "@/shared/lib/api";
import { fmtNum, useT } from "@/shared/lib/i18n";
import { toast } from "@/shared/lib/notifications";
import { cn, fold } from "@/shared/lib/utils";
import { linkCls, TicketChip } from "@/features/telegram/components/message/rich-text";
import { AiAsk } from "@/features/youtrack/components/bits";
import { type DocDetail, type DocPart, docDetailQuery, docErrors, docs, findTerms } from "@/features/docs/lib/docs";
import { headingText, SourceIcon } from "./results";
import { docLinks, useDocAnchor } from "./doc-links";
import { FavStar } from "./fav-star";
import { Updated } from "./revs";
import { UseDoc } from "./use-doc";
import { KbAdd } from "./kb-add";
import { ZeplinSheet } from "./zeplin-sheet";

// Right column of Tài liệu: one document, part by part. Parts off screen stay placeholders of about their height until
// they come near (one IntersectionObserver), so a ~100KB document scrolls smoothly; the words searched are lit with the
// CSS Custom Highlight API (no change to the Markdown), and ticket IDs are Telegram's ticket chips.

const chip = (id: string) => <TicketChip id={id} />;
const HIGHLIGHT = "doc-hit"; // ::highlight(doc-hit) in globals.css

export function Reader({ id, part, q, onPart, onTicket, onBack, onAi, onDoc }: {
  id: number; part: number | null; q: string; onPart: (part: number) => void; onTicket: (id: string) => void; onBack: () => void;
  onAi: () => void; // opens the AI panel on this document
  onDoc: (id: number) => void; // a Knowledge Base article named in the text, opened here
}) {
  const t = useT();
  const d = useQuery(docDetailQuery(id));
  const wait = useAiWait(d.isPending);
  if (wait) return <AiFetching kind="docs" />;
  if (d.isError) return (
    <div role="alert" className="grid content-start justify-items-start gap-3 p-6 text-sm text-error">
      {errorText(d.error, docErrors())}
      <Button size="sm" variant="outline" onClick={() => void d.refetch()}>{t("Thử lại")}</Button>
    </div>
  );
  if (!d.data) return null;
  return <Body data={d.data} part={part} q={q} onPart={onPart} onTicket={onTicket} onBack={onBack} onAi={onAi} onDoc={onDoc} />;
}

function Body({ data, part, q, onPart, onTicket, onBack, onAi, onDoc }: {
  data: DocDetail; part: number | null; q: string; onPart: (part: number) => void; onTicket: (id: string) => void; onBack: () => void;
  onAi: () => void; onDoc: (id: number) => void;
}) {
  const t = useT();
  const { doc, parts } = data;
  const [zeplin, setZeplin] = useState<string | null>(null); // a Zeplin screen name clicked in the text
  const [missing, setMissing] = useState<string | null>(null); // an article ID the library does not hold, clicked
  const anchor = useDocAnchor(onDoc, setZeplin, setMissing);
  const box = useRef<HTMLDivElement>(null);
  const [seen, setSeen] = useState<ReadonlySet<number>>(() => new Set(parts.slice(0, 3).map((p) => p.part)));
  const shown = (n: number) => seen.has(n) || n === part;
  // Tìm trong tài liệu này: over the parts' text, so it finds what is not rendered yet (the browser's find cannot);
  // ↑ ↓ / Enter move between the parts that match, which opens and scrolls to each one
  const [find, setFind] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const hits = useMemo(() => matching(parts, find), [find, parts]);
  const at = part == null ? -1 : hits.indexOf(part);
  const go = (d: 1 | -1) => {
    if (hits.length) onPart(hits[at < 0 ? (d > 0 ? 0 : hits.length - 1) : (at + d + hits.length) % hits.length]);
  };
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.key.toLowerCase() !== "f") return;
      e.preventDefault(); // the page's own find would miss the parts not rendered yet
      input.current?.select();
    };
    addEventListener("keydown", on);
    return () => removeEventListener("keydown", on);
  }, []);
  const term = find.trim() ? find : q;

  // placeholders become parts as they come within ~2 screens
  useEffect(() => {
    const root = box.current;
    if (!root) return;
    const io = new IntersectionObserver((es) => {
      const hit = es.filter((e) => e.isIntersecting).map((e) => Number((e.target as HTMLElement).dataset.part));
      if (hit.length) setSeen((s) => (hit.every((n) => s.has(n)) ? s : new Set([...s, ...hit])));
    }, { root, rootMargin: "1500px 0px" });
    // every part, not only placeholders: the `?part=` one renders at once and must still land in `seen`, or it turns
    // back into an unwatched placeholder when `part` moves on
    root.querySelectorAll("[data-part]").forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [parts]);

  // To the part: at once when the document opens, smoothly after; with a search, to its first searched word, centred
  // (a long part, a big table, would leave it off screen at the part's top). The placeholders the smooth scroll passes
  // render on the way and change height, which moves the target: once it settles, it is set straight (twice at most).
  // On open the parts around it render just after the jump: it stays pinned until they settle or the reader scrolls.
  const first = useRef(true);
  const was = useRef(part);
  useEffect(() => {
    const root = box.current;
    const moved = was.current !== part;
    was.current = part;
    // the same part with the find box cleared: stay where the reader is
    if (part == null || !root || (!first.current && !moved && !find.trim())) return;
    const goal = () => spot(root, part, term);
    if (first.current) {
      first.current = false;
      const pin = () => { const g = goal(); if (g != null) root.scrollTop = g; };
      pin();
      const ro = new ResizeObserver(pin);
      const text = root.querySelector("[data-doc-text]");
      if (text) ro.observe(text);
      const stop = () => ro.disconnect();
      const id = setTimeout(stop, 1500);
      const opts = { once: true, passive: true } as const;
      root.addEventListener("wheel", stop, opts);
      root.addEventListener("pointerdown", stop, opts);
      root.addEventListener("keydown", stop, opts);
      return () => { stop(); clearTimeout(id); root.removeEventListener("wheel", stop); root.removeEventListener("pointerdown", stop); root.removeEventListener("keydown", stop); };
    }
    let tries = 0;
    const settle = () => {
      const g = goal();
      if (g == null || tries++ >= 2) return;
      if (Math.abs(g - root.scrollTop) > 4) root.scrollTo({ top: g, behavior: "smooth" });
    };
    root.addEventListener("scrollend", settle);
    const g = goal();
    if (g != null) root.scrollTo({ top: g, behavior: "smooth" });
    return () => root.removeEventListener("scrollend", settle);
  }, [part, term]); // eslint-disable-line react-hooks/exhaustive-deps -- find: read only to skip a cleared box

  // light the searched words in what is rendered
  useEffect(() => {
    const root = box.current;
    if (!root || typeof CSS === "undefined" || !("highlights" in CSS)) return;
    const ranges: Range[] = [];
    const walk = document.createTreeWalker(root.querySelector("[data-doc-text]") ?? root, NodeFilter.SHOW_TEXT);
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      for (const [a, b] of findTerms(n.textContent ?? "", term)) {
        const r = new Range();
        r.setStart(n, a);
        r.setEnd(n, b);
        ranges.push(r);
      }
    }
    CSS.highlights.set(HIGHLIGHT, new Highlight(...ranges));
    return () => { CSS.highlights.delete(HIGHLIGHT); };
  }, [term, seen, parts]);

  const toc = useMemo(() => {
    const all = parts.filter((p, i) => p.heading && p.heading !== parts[i - 1]?.heading);
    // the one top heading leading the document is its title (shown in the header): not a section of the Mục lục
    const top = Math.min(...all.map((p) => depth(p.heading)));
    return all[0] && all.filter((p) => depth(p.heading) === top).length === 1 && depth(all[0].heading) === top ? all.slice(1) : all;
  }, [parts]);
  const active = useSpy(box, toc);
  return (
    <article className="@container flex min-h-0 flex-1 flex-col">
      {/* wraps: the tools drop under the title rather than squeeze it when the find box opens in a narrow reader */}
      <header className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 border-b px-5 py-2.5">
        <Button size="icon-sm" variant="ghost" className="-ml-2 hidden @max-3xl/docs:inline-flex" aria-label={t("Quay lại danh sách")} onClick={onBack}><ArrowLeft /></Button>
        <div className="grid min-w-0 flex-[1_1_18rem] gap-0.5">
          <h1 className="flex min-w-0 items-center gap-2 text-base font-bold text-ink"><SourceIcon doc={doc} /><span className="line-clamp-2 break-words">{doc.title || doc.ref}</span><FavStar doc={doc} /></h1>
          <p className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-ink-3">
            {/* a file's ref is its full path: "Mở file" shows it, the line keeps the short facts */}
            {doc.source === "youtrack" && <span className="font-mono">{doc.ref}</span>}
            {doc.updated_at && <Updated at={doc.updated_at} revs={data.revs ?? []} />}
            <span>{t("{n} ký tự", { n: fmtNum(doc.chars) })}</span>
            {doc.tickets.length > 0 && <Tickets ids={doc.tickets} onTicket={onTicket} />}
          </p>
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          <FindBox input={input} value={find} hits={hits.length} at={at} onGo={go}
            onChange={(v) => {
              setFind(v);
              const h = matching(parts, v); // to the first match as it is typed, unless the open part matches
              if (h.length && (part == null || !h.includes(part))) onPart(h[0]);
            }} />
          <AiAsk label={t("Hỏi AI về tài liệu này")} hint={t("Hỏi mình về tài liệu này nhé!")} onClick={onAi} />
          <UseDoc doc={doc} />
          <Original doc={doc} />
        </div>
      </header>
      <div ref={box} className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
        {/* the text takes all the width the Mục lục (on the right edge) leaves */}
        <div className="flex gap-10 py-6 pr-4 pl-6 @max-xl:px-4">
          <TicketRef value={chip}>
            <div data-doc-text className="grid min-w-0 flex-1 content-start gap-0">
              {parts.map((p, i) => <Part key={p.part} p={p} head={p.heading !== parts[i - 1]?.heading} shown={shown(p.part)} on={p.part === part} self={doc.ref} anchor={anchor} />)}
            </div>
          </TicketRef>
          {toc.length > 1 && <Toc toc={toc} active={active} onGo={onPart} />}
        </div>
      </div>
      <ZeplinSheet name={zeplin} onClose={() => setZeplin(null)} />
      <KbAdd ref_={missing} onClose={() => setMissing(null)} onOpen={onDoc} />
    </article>
  );
}

const SCROLL_MARGIN = 16; // scroll-mt-4 on a part

/** The scrollTop that brings `part` into view: where it holds the most words of `term` (the whole phrase over one stray
 *  word, the first such place on a tie) in the middle of the box; else the part's top. */
function spot(root: HTMLElement, part: number, term: string): number | null {
  const sec = root.querySelector<HTMLElement>(`[data-part="${part}"]`);
  if (!sec) return null;
  const top = root.getBoundingClientRect().top;
  let y = sec.getBoundingClientRect().top - top - SCROLL_MARGIN;
  if (term.trim()) {
    let best: Range | null = null, most = 0;
    const walk = document.createTreeWalker(sec, NodeFilter.SHOW_TEXT);
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      const text = n.textContent ?? "", hits = findTerms(text, term);
      const words = new Set(hits.map(([a, b]) => fold(text.slice(a, b)))).size;
      if (words <= most) continue;
      most = words;
      const [a, b] = hits.reduce((x, h) => (h[0] < x[0] ? h : x));
      best = new Range();
      best.setStart(n, a);
      best.setEnd(n, b);
    }
    if (best) {
      const at = best.getBoundingClientRect();
      y = at.top - top - (root.clientHeight - at.height) / 2;
    }
  }
  return Math.max(0, Math.min(root.scrollTop + y, root.scrollHeight - root.clientHeight));
}

/** The heading part the reader is in: the last one whose top passed the first quarter of the box. */
function useSpy(box: React.RefObject<HTMLDivElement | null>, toc: DocPart[]) {
  const [active, setActive] = useState<number | null>(toc[0]?.part ?? null);
  useEffect(() => {
    const root = box.current;
    if (!root || toc.length < 2) return;
    let raf = 0;
    const spy = () => {
      raf = 0;
      const line = root.getBoundingClientRect().top + root.clientHeight / 4;
      const end = root.scrollTop + root.clientHeight >= root.scrollHeight - 2; // at the bottom: the last one
      let cur = toc[0].part;
      for (const p of toc) {
        const el = root.querySelector(`[data-part="${p.part}"]`);
        if (!el || (!end && el.getBoundingClientRect().top > line)) break;
        cur = p.part;
      }
      setActive(cur);
    };
    const on = () => { if (!raf) raf = requestAnimationFrame(spy); };
    root.addEventListener("scroll", on, { passive: true });
    spy();
    return () => { root.removeEventListener("scroll", on); cancelAnimationFrame(raf); };
  }, [box, toc]);
  return active;
}

/** Mục lục: a quiet rail beside the text; the section being read is marked by a sliding bar (Pill). */
function Toc({ toc, active, onGo }: { toc: DocPart[]; active: number | null; onGo: (part: number) => void }) {
  const t = useT();
  const top = Math.min(...toc.map((p) => depth(p.heading)));
  return (
    <nav aria-label={t("Mục lục")} className="sticky top-0 max-h-[calc(100dvh-9rem)] w-52 shrink-0 self-start overflow-y-auto @max-4xl:hidden">
      <p className="mb-2 pl-3 text-2xs font-medium tracking-wide text-ink-3 uppercase">{t("Mục lục")}</p>
      <ul className="border-l border-rule">
        {toc.map((p) => {
          const on = p.part === active, level = Math.min(depth(p.heading) - top, 2);
          return (
            <li key={p.part} className="relative">
              {on && <Pill id="doc-toc" className="top-1 bottom-1 -left-px w-0.5 rounded-full bg-hl" />}
              <button type="button" onClick={() => onGo(p.part)} aria-current={on ? "location" : undefined}
                className={cn("block w-full truncate py-1 pr-1 text-left text-xs leading-snug transition-colors duration-(--dur-micro)",
                  ["pl-3", "pl-6", "pl-9"][level], on ? "font-medium text-ink" : "text-ink-3 hover:text-ink")}>
                {headingText(p.heading)}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** Tìm trong tài liệu này: a magnifier that opens into the box on hover (or ⌘F / Ctrl+F); it stays open while focused or
 *  filled, with the match count and ↑ ↓ once something is typed. Esc clears it. */
function FindBox({ input, value, hits, at, onChange, onGo }: {
  input: React.RefObject<HTMLInputElement | null>; value: string; hits: number; at: number; onChange: (v: string) => void; onGo: (d: 1 | -1) => void;
}) {
  const t = useT();
  const [hot, setHot] = useState(false);
  const [focus, setFocus] = useState(false);
  const open = hot || focus || !!value;
  const typed = !!value.trim();
  return (
    <Hint side="bottom" text={t("Tìm trong tài liệu này (⌘F / Ctrl+F)")}>
      <div onMouseEnter={() => setHot(true)} onMouseLeave={() => setHot(false)}
        className={cn("flex h-8 items-center overflow-hidden rounded-md border transition-[width,border-color,background-color] duration-(--dur-short) ease-(--ease-out)",
          open ? "border-rule-2 bg-cotton" : "border-transparent", open ? (typed ? "w-80 @max-2xl:w-56" : "w-56 @max-2xl:w-44") : "w-8")}>
        <button type="button" tabIndex={-1} aria-hidden onClick={() => input.current?.focus()} className="grid size-8 shrink-0 place-items-center text-ink-3 hover:text-ink">
          <Search className="size-4" />
        </button>
        <input ref={input} type="search" value={value} aria-label={t("Tìm trong tài liệu này")} placeholder={t("Tìm trong tài liệu này…")}
          onFocus={() => setFocus(true)} onBlur={() => setFocus(false)} onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); onGo(e.shiftKey ? -1 : 1); }
            if (e.key === "Escape") { e.preventDefault(); onChange(""); e.currentTarget.blur(); }
          }}
          className={cn("min-w-0 flex-1 bg-transparent pr-1 text-sm text-ink outline-none placeholder:text-ink-3 [&::-webkit-search-cancel-button]:hidden", !open && "pointer-events-none")} />
        {typed && <>
          <span role="status" className="shrink-0 px-1 text-2xs text-ink-3 tabular-nums">
            {hits ? t("{i}/{n} đoạn", { i: at < 0 ? "–" : at + 1, n: hits }) : t("Không thấy")}
          </span>
          <Button size="icon-xs" variant="ghost" aria-label={t("Đoạn khớp trước (Shift+Enter)")} disabled={!hits} onClick={() => onGo(-1)}><ChevronUp /></Button>
          <Button size="icon-xs" variant="ghost" className="mr-0.5" aria-label={t("Đoạn khớp sau (Enter)")} disabled={!hits} onClick={() => onGo(1)}><ChevronDown /></Button>
        </>}
      </div>
    </Hint>
  );
}

/** The tickets the document names: three chips (hover: the ticket in short, as in the AI sessions; with "Tài liệu nhắc
 *  ticket này" to filter the list), then "+N" whose hover lists the rest beside it. */
function Tickets({ ids, onTicket }: { ids: string[]; onTicket: (id: string) => void }) {
  const t = useT();
  const [more, setMore] = useState(false);
  const chipOf = (id: string) => (
    <TicketChip key={id} id={id} more={<button type="button" onClick={() => onTicket(id)} className={linkCls}>{t("Tài liệu nhắc ticket này")}</button>} />
  );
  const rest = ids.slice(3);
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      {ids.slice(0, 3).map(chipOf)}
      {rest.length > 0 && (
        <span className="relative" onMouseEnter={() => setMore(true)} onMouseLeave={() => setMore(false)} onFocus={() => setMore(true)} onBlur={() => setMore(false)}>
          <button type="button" aria-expanded={more} aria-label={t("{n} ticket khác", { n: rest.length })}
            className="rounded-sm bg-paper-3 px-1.5 font-mono text-2xs text-ink-2 hover:bg-hl-wash hover:text-hl-2">+{rest.length}</button>
          {more && (
            // pt / pl: the pointer crosses into the card without leaving the "+N" box
            <span className="absolute top-full left-0 z-30 pt-1">
              <span className="grid w-72 gap-2 rounded-md bg-cotton p-3 shadow-pop animate-in fade-in-0 duration-(--dur-micro)">
                <span className="text-2xs font-medium text-ink-3">{t("{n} ticket khác", { n: rest.length })}</span>
                <span className="flex flex-wrap gap-1.5">{rest.map(chipOf)}</span>
              </span>
            </span>
          )}
        </span>
      )}
    </span>
  );
}

/** The parts whose heading or text holds the words of `s` (accent-less), in order. */
const matching = (parts: DocPart[], s: string) =>
  s.trim() ? parts.filter((p) => findTerms(`${p.heading}\n${p.body}`, s).length).map((p) => p.part) : [];

const depth = (h: string) => /^#+/.exec(h)?.[0].length ?? 1;

/** A part: its heading on the first block of a section; a placeholder of about its height until it comes near. Article
 *  IDs in it (not the document's own, `self`) and Zeplin screen names link (doc-links.tsx). */
function Part({ p, head, shown, on, self, anchor }: {
  p: DocPart; head: boolean; shown: boolean; on: boolean; self: string; anchor: (hash: string) => React.ReactNode;
}) {
  const text = head && p.heading ? `${p.heading}\n\n${p.body}` : p.body;
  const lines = text.split("\n").length + text.length / 75;
  return (
    // on: the part opened / jumped to flashes once (key: again on the next jump), no lasting tint
    <section data-part={p.part} className={cn("-mx-3 scroll-mt-4 rounded-md px-3", on && "doc-flash")}
      style={shown ? undefined : { height: `${Math.ceil(lines) * 1.55}rem` }}>
      {shown && <Markdown text={docLinks(text, self)} anchor={anchor} className="md-wrap py-1 text-md leading-[1.6]" />}
    </section>
  );
}

/** The original: the YouTrack article, or the file shown in Finder / Explorer. */
function Original({ doc }: { doc: DocDetail["doc"] }) {
  const t = useT();
  const reveal = useMutation({
    mutationFn: () => docs.reveal(doc.id),
    onError: (e) => toast({ text: errorText(e, docErrors()) }),
  });
  if (doc.url) return (
    <Hint side="bottom" text={t("Mở bài gốc trên YouTrack.")}>
      <a href={doc.url} target="_blank" rel="noopener noreferrer" className={buttonVariants({ size: "sm", variant: "outline", className: "no-underline" })}>
        <ExternalLink /><span className="@max-xl:sr-only">{t("Bản gốc")}</span>
      </a>
    </Hint>
  );
  if (doc.source !== "file") return null;
  return (
    <Hint side="bottom" text={t("Hiện file trong Finder / Explorer.")}>
      <Button size="sm" variant="outline" aria-busy={reveal.isPending} disabled={reveal.isPending} onClick={() => reveal.mutate()}>
        <FolderOpen /><span className="@max-xl:sr-only">{t("Mở file")}</span>
      </Button>
    </Hint>
  );
}
