"use client";

import { ArrowLeft, ExternalLink, FolderOpen } from "lucide-react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { AiFetching, useAiWait } from "@/shared/components/ai/fetching";
import { Markdown, TicketRef } from "@/shared/components/markdown";
import { Button, buttonVariants } from "@/shared/components/ui/button";
import { Hint } from "@/shared/components/ui/hint";
import { errorText } from "@/shared/lib/api";
import { fmtDay, fmtNum, useT } from "@/shared/lib/i18n";
import { toast } from "@/shared/lib/notifications";
import { cn } from "@/shared/lib/utils";
import { TicketChip } from "@/features/telegram/components/message/rich-text";
import { type DocDetail, type DocPart, docDetailQuery, docErrors, docs, findTerms } from "@/features/docs/lib/docs";
import { headingText, SourceIcon } from "./results";

// Right column of Tài liệu: one document, part by part. Parts off screen stay placeholders of about their height until
// they come near (one IntersectionObserver), so a ~100KB document scrolls smoothly; the words searched are lit with the
// CSS Custom Highlight API (no change to the Markdown), and ticket IDs are Telegram's ticket chips.

const chip = (id: string) => <TicketChip id={id} />;
const HIGHLIGHT = "doc-hit"; // ::highlight(doc-hit) in globals.css

export function Reader({ id, part, q, onPart, onTicket, onBack }: {
  id: number; part: number | null; q: string; onPart: (part: number) => void; onTicket: (id: string) => void; onBack: () => void;
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
  return <Body data={d.data} part={part} q={q} onPart={onPart} onTicket={onTicket} onBack={onBack} />;
}

function Body({ data, part, q, onPart, onTicket, onBack }: {
  data: DocDetail; part: number | null; q: string; onPart: (part: number) => void; onTicket: (id: string) => void; onBack: () => void;
}) {
  const t = useT();
  const { doc, parts } = data;
  const box = useRef<HTMLDivElement>(null);
  const [seen, setSeen] = useState<ReadonlySet<number>>(() => new Set(parts.slice(0, 3).map((p) => p.part)));
  const shown = (n: number) => seen.has(n) || n === part;

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

  useEffect(() => {
    if (part != null) box.current?.querySelector(`[data-part="${part}"]`)?.scrollIntoView({ block: "start" });
  }, [part]);

  // light the searched words in what is rendered
  useEffect(() => {
    const root = box.current;
    if (!root || typeof CSS === "undefined" || !("highlights" in CSS)) return;
    const ranges: Range[] = [];
    const walk = document.createTreeWalker(root.querySelector("[data-doc-text]") ?? root, NodeFilter.SHOW_TEXT);
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      for (const [a, b] of findTerms(n.textContent ?? "", q)) {
        const r = new Range();
        r.setStart(n, a);
        r.setEnd(n, b);
        ranges.push(r);
      }
    }
    CSS.highlights.set(HIGHLIGHT, new Highlight(...ranges));
    return () => { CSS.highlights.delete(HIGHLIGHT); };
  }, [q, seen, parts]);

  const toc = parts.filter((p, i) => p.heading && p.heading !== parts[i - 1]?.heading);
  return (
    <article className="@container flex min-h-0 flex-col">
      <header className="grid gap-1.5 border-b px-5 py-3">
        <div className="flex min-w-0 items-start gap-2">
          <Button size="icon-sm" variant="ghost" className="-ml-2 hidden @max-3xl/docs:inline-flex" aria-label={t("Quay lại danh sách")} onClick={onBack}><ArrowLeft /></Button>
          <h1 className="flex min-w-0 flex-1 items-center gap-2 text-lg font-bold text-ink"><SourceIcon doc={doc} /><span className="truncate">{doc.title || doc.ref}</span></h1>
          <Original doc={doc} />
        </div>
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-3">
          <span>{doc.ref}</span>
          {doc.updated_at && <span>{t("cập nhật {d}", { d: fmtDay(doc.updated_at) })}</span>}
          <span>{t("{n} ký tự", { n: fmtNum(doc.chars) })}</span>
          {doc.tickets.map((tk) => (
            <Hint key={tk} side="bottom" text={t("Chỉ hiện tài liệu nhắc {id}", { id: tk })}>
              <button type="button" onClick={() => onTicket(tk)} className="rounded-sm bg-paper-3 px-1.5 font-mono text-2xs text-ink-2 hover:bg-hl-wash hover:text-hl-2">{tk}</button>
            </Hint>
          ))}
        </p>
      </header>
      <div ref={box} className="min-h-0 flex-1 overflow-y-auto">
        <div className="grid grid-cols-[12rem_minmax(0,1fr)] gap-6 px-5 py-4 @max-4xl:grid-cols-1">
          {toc.length > 1 && (
            <nav aria-label={t("Mục lục")} className="sticky top-0 grid max-h-[calc(100dvh-12rem)] content-start gap-0.5 self-start overflow-y-auto @max-4xl:hidden">
              <span className="pb-1 text-xs font-medium text-ink-3">{t("Mục lục")}</span>
              {toc.map((p) => (
                <button key={p.part} type="button" onClick={() => onPart(p.part)}
                  className={cn("truncate rounded-sm py-0.5 text-left text-xs text-ink-2 hover:text-ink", depth(p.heading) > 2 && "pl-3", depth(p.heading) > 3 && "pl-6")}>
                  {headingText(p.heading)}
                </button>
              ))}
            </nav>
          )}
          <TicketRef value={chip}>
            <div data-doc-text className={cn("grid max-w-[70ch] content-start gap-0", toc.length <= 1 && "col-span-full")}>
              {parts.map((p, i) => <Part key={p.part} p={p} head={p.heading !== parts[i - 1]?.heading} shown={shown(p.part)} on={p.part === part} />)}
            </div>
          </TicketRef>
        </div>
      </div>
    </article>
  );
}

const depth = (h: string) => /^#+/.exec(h)?.[0].length ?? 1;

/** A part: its heading on the first block of a section; a placeholder of about its height until it comes near. */
function Part({ p, head, shown, on }: { p: DocPart; head: boolean; shown: boolean; on: boolean }) {
  const text = head && p.heading ? `${p.heading}\n\n${p.body}` : p.body;
  const lines = text.split("\n").length + text.length / 75;
  return (
    <section data-part={p.part} className={cn("scroll-mt-3 rounded-md", on && "-mx-3 bg-hl-wash/50 px-3")}
      style={shown ? undefined : { height: `${Math.ceil(lines) * 1.55}rem` }}>
      {shown && <Markdown text={text} className="py-1 text-md leading-[1.55]" />}
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
