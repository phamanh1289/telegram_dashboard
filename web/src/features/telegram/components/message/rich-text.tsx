"use client";

import { useQuery } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import { lazy, Suspense, useEffect, useState } from "react";
import { hueOf } from "@/shared/components/avatar";
import { type Message } from "@/shared/lib/api";
import { ticketClick } from "@/features/telegram/lib/inbox";
import { ago } from "@/shared/lib/time";
import { yt, ytDetailQuery, ytProjectsQuery } from "@/features/youtrack/lib/yt";
import { cn } from "@/shared/lib/utils";
import { type Key, useT } from "@/shared/lib/i18n";

export const MEDIA: Record<string, Key> = {
  photo: "Ảnh", video: "Video", voice: "Tin thoại", audio: "Âm thanh", sticker: "Sticker",
  gif: "GIF", video_note: "Video tròn", document: "Tệp",
};

// Three looks so they never blur: links are underlined copper text, @mentions an outlined copper chip, keys/code a
// slate-blue mono chip (the one cool hue, so it stands off body text and the paper-2 quote well too).
const linkCls = "text-hl-2 underline decoration-hl decoration-1 underline-offset-[3px] transition-[text-decoration-thickness] duration-(--dur-micro) hover:decoration-2";
const mentionCls = "rounded-sm bg-hl-wash px-1 font-medium text-hl-2 no-underline ring-1 ring-inset ring-hl/30";
const codeCls = "rounded-sm bg-code-wash px-1 py-px font-mono text-[0.875em] text-code ring-1 ring-inset ring-code/30";

// Entity links only open these schemes; anything else (file:, data:, app handlers) stays plain text.
const SAFE_URL = /^(https?|tg|mailto):/i;
const WEB_URL = /^(https?|mailto):/i; // a hidden link (label ≠ url) from anyone: no tg:// (proxy, join, login)

// Bare URLs, @username mentions (not inside e-mails), `code` the sender typed literally and YouTrack IDs (VA-123).
const INLINE = /(https?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]])|(?<![\w.@])(@[A-Za-z][A-Za-z0-9_]{3,31})|`([^`\n]+)`|(?<![\w-])([A-Z][A-Z0-9]{1,9}-\d{1,6})(?!\w)/g;

export function inline(text: string, key: number) {
  const out: React.ReactNode[] = [];
  let at = 0;
  for (const x of text.matchAll(INLINE)) {
    out.push(text.slice(at, x.index));
    const k = `${key}-${x.index}`;
    if (x[1]) out.push(<a key={k} href={x[1]} target="_blank" rel="noreferrer" className={cn(linkCls, "break-all")}>{x[1]}</a>);
    else if (x[2]) out.push(<a key={k} href={`https://t.me/${x[2].slice(1)}`} target="_blank" rel="noreferrer" className={mentionCls}>{x[2]}</a>);
    else if (x[3]) out.push(<code key={k} className={codeCls}>{x[3]}</code>);
    else out.push(<TicketChip key={k} id={x[4]} />);
    at = x.index + x[0].length;
  }
  out.push(text.slice(at));
  return out;
}

const TicketSheet = lazy(() => import("@/features/youtrack/components/sheet").then((m) => ({ default: m.TicketSheet }))); // loaded on the first open
/** Where a ticket chip's sheet opens (openTicketHere): once, at the Telegram page's root, a sibling of its layout (the
 *  sheet makes its siblings inert; React events from it don't bubble into the row the chip sits in). */
export function TicketSheetHost() {
  const [id, setId] = useState<string | null>(null);
  useEffect(() => {
    const on = (e: Event) => setId((e as CustomEvent<string>).detail);
    addEventListener("open-ticket", on);
    return () => removeEventListener("open-ticket", on);
  }, []);
  return id && <Suspense fallback={null}><TicketSheet key={id} id={id} onClose={() => setId(null)} /></Suspense>;
}

/** VA-123 of a known YouTrack project: a chip that opens the YouTrack tab's ticket sheet right here (⌘ / middle click:
 *  the YouTrack page). Hover / focus shows a peek card (summary,
 *  state, priority, assignee, last update) with links to the YouTrack module and to YouTrack itself, so a reply needn't
 *  leave Telegram to check a ticket. */
export function TicketChip({ id }: { id: string }) {
  const t = useT();
  const [hover, setHover] = useState(false);
  const projects = useQuery(ytProjectsQuery);
  const d = useQuery({ ...ytDetailQuery(id), retry: false, enabled: hover });
  const base = useQuery({ queryKey: ["yt", "config"], queryFn: yt.config, staleTime: Infinity, enabled: hover }).data?.base;
  if (!projects.data?.some((p) => p.shortName === id.split("-")[0])) return id;
  const tk = d.data;
  return (
    <span className="relative" onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)} onFocus={() => setHover(true)} onBlur={() => setHover(false)}
      onKeyDown={(e) => { if (e.key === "Escape" && hover) { e.stopPropagation(); setHover(false); } }}>
      <a href={`/youtrack/?ticket=${id}`} aria-describedby={hover ? `peek-${id}` : undefined}
        onClick={(e) => { setHover(false); ticketClick(id)(e); }}
        className={cn(codeCls, "font-bold no-underline hover:bg-hl-wash hover:text-hl-2 hover:ring-hl/30", tk?.resolved && "line-through")}>{id}</a>
      {hover && (
        // pt, not mt: the pointer crosses into the card without leaving the chip's box.
        <span className="absolute top-full left-0 z-30 pt-1">
          <span id={`peek-${id}`} className="grid w-80 gap-2 rounded-md bg-cotton p-3 text-xs leading-snug whitespace-normal text-ink-2 shadow-pop animate-in fade-in-0 duration-(--dur-micro)">
            {tk ? (
              <>
                <span className="line-clamp-3 text-sm font-medium text-ink">{tk.summary || id}</span>
                <span className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5">
                  <span className="text-ink-3">{t("Trạng thái")}</span><span className={cn("truncate", tk.resolved && "text-ok")}>{tk.state || "—"}</span>
                  <span className="text-ink-3">{t("Ưu tiên")}</span><span className="truncate">{tk.priority || "—"}</span>
                  <span className="text-ink-3">{t("Người làm")}</span><span className="truncate">{tk.assignee || t("Chưa assign")}</span>
                  {tk.qc && <><span className="text-ink-3">QC</span><span className="truncate">{tk.qc}</span></>}
                  <span className="text-ink-3">{t("Cập nhật|lúc")}</span><span className="font-mono tabular-nums">{ago(tk.updated)}</span>
                </span>
                <span className="flex flex-wrap gap-x-3 border-t border-rule pt-1.5">
                  <a href={`/youtrack/?ticket=${id}`} className={linkCls}>{t("Mở ở trang YouTrack")}</a>
                  {base && <a href={`${base.replace(/\/$/, "")}/issue/${id}`} target="_blank" rel="noreferrer" className={cn(linkCls, "inline-flex items-center gap-1")}>
                    {t("Mở trong YouTrack")}<ExternalLink className="size-3" aria-hidden /></a>}
                </span>
              </>
            ) : d.isError ? d.error.message || t("Không tải được ticket") : t("Đang tải…")}
          </span>
        </span>
      )}
    </span>
  );
}

/** A sender's name colour: their avatar hue pulled toward ink, so the text stays ≥4.5:1 on hover / selected rows. */
export const nameColor = (name: string) => `color-mix(in oklch, var(--cat-${hueOf(name)}) 68%, var(--color-ink))`;

type Span = Message["links"][number];

// Spans, not divs, so formatted text can sit inside <p>.
const STYLE: Partial<Record<Span["kind"], string>> = {
  bold: "font-bold", italic: "italic", underline: "underline underline-offset-2", strike: "line-through",
  spoiler: "rounded-sm bg-ink-3 text-transparent transition-colors duration-(--dur-micro) hover:bg-transparent hover:text-inherit",
  blockquote: "my-1 block rounded-r-sm border-l-[3px] border-rule-2 bg-paper-2 py-1 pr-2 pl-2.5", // neutral: copper stays for links/mentions
  pre: "my-1 block overflow-x-auto rounded-sm bg-paper-3 px-2 py-1.5 font-mono text-[0.875em] ring-1 ring-inset ring-rule-2/40",
};

// Telegram entities nest (bold inside a quote, a link inside bold); offsets are UTF-16, like JS strings. Spans are
// sorted outer-first, so each one's children are among the spans after it. Plain text between them still gets bare
// URLs, @mentions and `code` picked out, except inside links and code.
function render(text: string, spans: Span[], from: number, to: number, plain: boolean): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let at = from;
  spans.forEach((l, i) => {
    const end = l.offset + l.length;
    if (l.offset < at || end > to) return; // a child already rendered, or overlapping its parent
    out.push(...(plain ? inline(text.slice(at, l.offset), at) : [text.slice(at, l.offset)]));
    const kids = render(text, spans.slice(i + 1), l.offset, end, plain && !["code", "pre", "link", "mention"].includes(l.kind));
    const k = `${l.kind}-${l.offset}`;
    out.push(
      l.kind === "code" ? <code key={k} className={codeCls}>{kids}</code>
        : l.kind === "link" || l.kind === "mention"
          ? (l.kind === "mention" ? SAFE_URL : WEB_URL).test(l.url)
            ? <a key={k} href={l.url} target="_blank" rel="noreferrer" title={l.url} className={l.kind === "mention" ? mentionCls : linkCls}>{kids}</a>
            : <span key={k}>{kids}</span>
          : <span key={k} className={STYLE[l.kind]}>{kids}</span>,
    );
    at = end;
    if ((l.kind === "blockquote" || l.kind === "pre") && text[at] === "\n" && at < to) at++; // the block already breaks
  });
  out.push(...(plain ? inline(text.slice(at, to), at) : [text.slice(at, to)]));
  return out;
}

export function richText({ text, links = [] }: Message) {
  const spans = [...links].sort((a, b) => a.offset - b.offset || b.length - a.length);
  return render(text, spans, 0, text.length, true);
}
