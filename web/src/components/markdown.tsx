"use client";

import { Copy, ExternalLink, X } from "lucide-react";
import { createContext, memo, type ReactNode, use, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import { Hint } from "@/components/ui/hint";
import { useT } from "@/lib/i18n";
import { copyText } from "@/lib/inbox";
import { cn } from "@/lib/utils";

const PLUGINS = [remarkGfm, remarkBreaks];
const TICKET = /\b([A-Z][A-Z0-9]+-\d+)\b/g;
const SKIP = /(```[\s\S]*?```|`[^`\n]*`|\[[^\]]*\]\([^)]*\))/; // code and links keep their ticket IDs as text

// Sections whose items the user forwards as is: questions to ask, things to confirm (the AI may answer in English).
const ASK = /hỏi|confirm|xác nhận|làm rõ|\bask|clarif/i;
// Who a section's asks go to, from its label ("**BE:**", "Tin gửi QC"): exactly one role named, else none.
const ROLE = /\b(BE|PO|PM|QC|QA)\b/g;
const ROLE_OF: Record<string, AskRole> = { BE: "BE", PO: "PO", PM: "PO", QC: "QC", QA: "QC" };
export type AskRole = "BE" | "PO" | "QC";
const roleIn = (t: string) => {
  const r = new Set([...t.matchAll(ROLE)].map((m) => ROLE_OF[m[1]]));
  return r.size === 1 ? [...r][0] : null;
};
type Pos = { start: { offset?: number }; end: { offset?: number } };
type MdNode = { type: string; value?: string; position?: Pos; children?: MdNode[]; data?: { hProperties?: Record<string, unknown> } };
const plain = (n: MdNode): string => n.value ?? (n.children ?? []).map(plain).join("");
/** A section label: a heading, or a paragraph opening in bold ("**Cần hỏi lại**", "**BE:** x": its bold part). */
const labelOf = (n: MdNode) => n.type === "heading" ? n : n.type === "paragraph" && n.children?.[0]?.type === "strong" ? n.children[0] : null;
// A message to one person: "1. (BE) x / 2. (BE) y" → "1. x / 2. y" (the @mention already says who); mixed roles stay.
const ITEM = /^(\s*(?:[-*+]|\d+[.)])\s+)(\([^)\n]{1,12}\)\s+)?/gm;
const dropRole = (t: string) => {
  const roles = [...t.matchAll(ITEM)].map((m) => m[2]?.trim());
  return roles.length && roles.every((r) => r && r === roles[0]) ? t.replace(ITEM, "$1") : t;
};
const MAX_POINTS = 3; // points per message to a teammate: one copy / send click posts at most this many (ASK_MSG in ai.py)
const BULLET = /^\s*(?:[-*+]|\d+[.)])\s+/;
// Who a message goes to: "@be_bot", or a tag by name ([Name](tg://user?id=N), lib/inbox nameTag).
const TAG_AT = String.raw`(?:@\w+|\[[^\]]+\]\(tg://user\?id=\d+\))`;
const TAGS = new RegExp(`^${TAG_AT}(?:\\s+${TAG_AT})*$`); // a line of tags only
/** A message to "@be" quoted with more than MAX_POINTS points (numbered / bulleted items, else one point per line) →
 *  several quotes of MAX_POINTS, each to the same @tag, numbered from 1: each gets its own copy / send button. A single
 *  point left over joins the message before it (4 → 4, 7 → 3 + 4, 10 → 3 + 3 + 4).
 *  The AI is told to split already; this keeps one click to MAX_POINTS (+1) when it doesn't. */
export function splitAsks(md: string): string {
  const lines = md.split("\n");
  const out: string[] = [];
  for (let i = 0; i < lines.length; ) {
    if (!/^\s*>/.test(lines[i])) { out.push(lines[i++]); continue; }
    const start = i;
    while (i < lines.length && /^\s*>/.test(lines[i])) i++;
    const body = lines.slice(start, i).map((l) => l.replace(/^\s*>\s?/, ""));
    const before = out.findLast((l) => l.trim()) ?? "";
    const head = body.findIndex((l) => l.trim() && !TAGS.test(l.trim())); // @tag lines inside the quote come first
    const tags = body.slice(0, Math.max(head, 0)).filter((l) => l.trim());
    const rest = head < 0 ? [] : body.slice(head);
    const bulleted = rest.some((l) => BULLET.test(l));
    const points: string[][] = [];
    for (const l of rest) {
      if (bulleted ? BULLET.test(l) || !points.length : l.trim()) points.push([l]);
      else points.at(-1)?.push(l);
    }
    const groups: string[][][] = [];
    for (let c = 0; c < points.length; c += MAX_POINTS) groups.push(points.slice(c, c + MAX_POINTS));
    if (groups.length > 1 && groups.at(-1)?.length === 1) groups.at(-2)?.push(...(groups.pop() ?? [])); // 7 → 3 + 4, not 3 + 3 + 1
    if (groups.length < 2 || !(tags.length || TAGS.test(before.trim()))) { out.push(...lines.slice(start, i)); continue; }
    groups.forEach((g, c) => {
      const chunk = g.flatMap((p, k) => [p[0].replace(/^(\s*)\d+([.)])/, `$1${k + 1}$2`), ...p.slice(1)]);
      while (chunk.length && !chunk.at(-1)?.trim()) chunk.pop();
      if (c) out.push("", ...(tags.length ? [] : [before.trim()])); // the @tag line above the quote, again
      out.push(...[...tags, ...chunk].map((l) => `> ${l}`));
    });
  }
  return out.join("\n");
}
/** remark plugin: under a heading or a bold label line naming an ask section, each item gets `data-copy`: its markdown
 *  as the AI wrote it (Telegram keeps **bold** / `code`), without the quote / list markers. */
function remarkAsks(this: { parse: (md: string) => MdNode }) {
  const parse = (md: string) => this.parse(md); // the processor's parser, GFM included
  return (root: MdNode, file: { value: unknown }) => {
    const src = String(file.value);
    const raw = (from?: number, to?: number, quote = false) => { // quote: a whole message, its "1." stays like its "2."
      const t = src.slice(from, to).split("\n").map((l) => l.replace(/^(\s*>\s?)+/, "")).join("\n"); // quote markers, every line
      return (quote ? t : t.replace(/^\s*([-*+]|\d+[.)])\s+/, "")).trim(); // a list item's own bullet / number
    };
    const mark = (n: MdNode, text = raw(n.position?.start.offset, n.position?.end.offset)) => {
      text = text && dropRole(text);
      if (text && !/^\(.*\)$/.test(text)) n.data = { ...n.data, hProperties: { ...n.data?.hProperties, dataCopy: text } }; // "(gửi thẳng vào nhóm)" is a note
    };
    const sections: MdNode[][] = []; // the blocks after each ask label, up to the next label
    let cur: MdNode[] | null = null;
    let byHeading = false;
    for (const n of root.children ?? []) {
      const label = labelOf(n);
      // in an ask section, a bold role line ("**BE:**", "**Tin gửi QC:**") is a sub-label: the section goes on, the
      // asks below it are that role's (dataRole); "**BE:** x" carries its own ask
      if (label && cur && n.type !== "heading" && roleIn(plain(label)) && !ASK.test(plain(label))) {
        mark(n, raw(label.position?.end.offset, n.position?.end.offset).replace(/^\**\s*:\s*/, ""));
        continue;
      }
      // under an ask heading, a bold line ("**Tin gửi BE:**") is a sub-label: only the next heading ends the section
      if (label && !(cur && byHeading && n.type !== "heading")) {
        cur = ASK.test(plain(label)) ? [] : null;
        byHeading = n.type === "heading";
        if (cur) sections.push(cur);
        if (cur && label !== n) mark(n, raw(label.position?.end.offset, n.position?.end.offset).replace(/^\**\s*:\s*/, "")); // "**Cần hỏi**: x" → x
      } else cur?.push(n);
    }
    for (const sec of sections) {
      // messages written as quotes / code blocks: only those, the prose around them is commentary
      const msgs = sec.filter((n) => n.type === "blockquote" || n.type === "code");
      // "@be_bot" on its own line above the quote: who the message goes to, copied with it
      const to = (n: MdNode) => {
        const p = sec[sec.indexOf(n) - 1];
        const t = p?.type === "paragraph" ? raw(p.position?.start.offset, p.position?.end.offset) : "";
        return TAGS.test(t) ? `${t}\n` : "";
      };
      for (const n of msgs.length ? msgs : sec) {
        if (n.type === "list") n.children?.forEach((li) => mark(li));
        else if (n.type === "code") { // a message fenced as code reads like a quoted one: its markdown rendered, in a quote
          mark(n, n.value?.trim() && to(n) + n.value.trim());
          Object.assign(n, { type: "blockquote", children: parse(n.value ?? "").children, value: undefined });
        }
        else if (n.type === "blockquote") mark(n, to(n) + raw(n.position?.start.offset, n.position?.end.offset, true));
        else if (n.type === "paragraph") mark(n);
      }
    }
    // a quote opening with "@be_bot": a message to send, wherever it sits (e.g. after "Tin gửi BE:" in prose, no ask label)
    for (const n of root.children ?? []) {
      if (n.type !== "blockquote" || n.data?.hProperties?.dataCopy != null) continue;
      const text = raw(n.position?.start.offset, n.position?.end.offset, true);
      if (new RegExp(`^${TAG_AT}`).test(text)) mark(n, text);
    }
    // each ask's role (`dataRole`): the nearest label above (heading / bold line) naming one; a label naming none ends
    // it. Prose naming a role in passing never sets it.
    let role: AskRole | null = null;
    const tagRole = (n: MdNode) => {
      if (role && n.data?.hProperties?.dataCopy != null) n.data.hProperties.dataRole = role;
    };
    for (const n of root.children ?? []) {
      const label = labelOf(n);
      if (label) role = roleIn(plain(label));
      tagRole(n);
      if (n.type === "list") n.children?.forEach(tagRole);
    }
  };
}
const ASK_PLUGINS = [remarkGfm, remarkAsks, remarkBreaks]; // breaks after asks: they reach a fenced message turned quote
/** The AI Agent session's ID ("REF-97c501"): copied asks end with "#REF-97c501", so the tagged reply finds its session. */
export const AskTag = createContext("");
/** The send button next to each ask's copy button (AI Agent: post it to the session's group); null: none. */
export const AskPost = createContext<((text: string, role: AskRole | null) => ReactNode) | null>(null);
/** Ticket IDs drawn by the caller instead of `onTicket` buttons (AI Agent sessions: Telegram's ticket chip). */
export const TicketRef = createContext<((id: string) => ReactNode) | null>(null);
const TICKET_LINK = /\[([^\]]+)\]\(#ticket:[^)]*\)/g; // the links Markdown adds for ticket IDs: a copied ask keeps the bare ID
export const ASK_BTN = "ml-1 inline-grid size-5 place-items-center rounded-sm align-[-0.2em] text-ink-3 transition-colors duration-(--dur-micro) hover:bg-paper-3 hover:text-ink";
function CopyAsk({ text, role }: { text: unknown; role?: unknown }) {
  const tag = use(AskTag);
  const post = use(AskPost);
  const t = useT();
  if (typeof text !== "string") return null;
  const ask = text.replace(TICKET_LINK, "$1");
  const full = tag ? `${ask}\n\n#${tag}` : ask;
  return <>
    <Hint text={t("Copy ý này để hỏi / confirm")}>
      <button type="button" aria-label={t("Copy ý này")} onClick={() => void copyText(full.replace(/\[([^\]]+)\]\(tg:\/\/user\?id=\d+\)/g, "@$1"))} className={ASK_BTN}><Copy className="size-3.5" aria-hidden /></button>
    </Hint>
    {post?.(full, typeof role === "string" ? role as AskRole : null)}
  </>;
}

const Link = ({ href, children }: { href?: string; children?: ReactNode }) => <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>;

/**
 * GFM markdown (lists, tables, code, single newlines kept) for AI answers and YouTrack text.
 * Raw HTML stays text. `onTicket`: ticket IDs become buttons that open the ticket.
 * `asks`: items under a "cần hỏi / confirm" section get a copy button (AI answers).
 * Memoised: a long AI Agent log re-renders on every poll, but its old answers keep the same text.
 */
export const Markdown = memo(function Markdown({ text, className, onTicket, asks, anchor }: {
  text: string | null | undefined; className?: string; onTicket?: (id: string) => void; asks?: boolean;
  anchor?: (hash: string) => ReactNode; // an in-page "[x](#…)" link drawn by the caller (Briefing answers' sources)
}) {
  const t = useT(); // memo: re-renders on a language change through this subscription
  const pad = use(AskPost) ? "relative pr-13" : "relative pr-7"; // room for the ask buttons top-right
  let src = asks ? splitAsks(text ?? "") : text ?? "";
  const chip = use(TicketRef);
  if (onTicket || chip) src = src.split(SKIP).map((part, i) => (i % 2 ? part : part.replace(TICKET, "[$1](#ticket:$1)"))).join("");
  const components: Components = {
    // only this app's own files load inline: a remote image would fetch on sight (tracking pixel, or a
    // prompt-injected AI answer leaking data in its URL), so it stays a link the user chooses to open
    img: ({ src, alt }) => (typeof src !== "string" || !src ? null
      : src.startsWith("/api/") ? <ImageView src={src} alt={alt} /> : <Link href={src}>[{alt ? t("ảnh: {alt}", { alt }) : t("ảnh")}]</Link>),
    a: ({ href, children }) => onTicket && href?.startsWith("#ticket:") ? <button type="button" onClick={() => onTicket(href.slice(8))}>{children}</button>
      : chip && href?.startsWith("#ticket:") ? chip(href.slice(8))
      : anchor && href?.startsWith("#") ? anchor(href.slice(1)) : <Link href={href}>{children}</Link>,
    ...(asks && {
      li: ({ node, children, ...p }) => <li {...p}>{children}<CopyAsk text={node?.properties.dataCopy} role={node?.properties.dataRole} /></li>,
      p: ({ node, children, ...p }) => <p {...p}>{children}<CopyAsk text={node?.properties.dataCopy} role={node?.properties.dataRole} /></p>,
      // a message to send as is: the button sits top-right of the quote / code block
      blockquote: ({ node, children, ...p }) => <blockquote {...p} className={cn(node?.properties.dataCopy != null && pad)}>{children}{node?.properties.dataCopy != null && <span className="absolute top-0 right-0 flex"><CopyAsk text={node.properties.dataCopy} role={node.properties.dataRole} /></span>}</blockquote>,
      pre: ({ node, children, ...p }) => <pre {...p} className={cn(node?.properties.dataCopy != null && pad)}>{children}{node?.properties.dataCopy != null && <span className="absolute top-1 right-1 flex"><CopyAsk text={node.properties.dataCopy} role={node.properties.dataRole} /></span>}</pre>,
    }),
  };
  return (
    <div className={cn("md text-sm leading-relaxed", className)}>
      <ReactMarkdown remarkPlugins={asks ? ASK_PLUGINS : PLUGINS} components={components}>{src}</ReactMarkdown>
    </div>
  );
});

/**
 * An image that opens in a popup over the page (native modal <dialog>): fitted to the screen, click it for 100% (scroll to pan).
 * Esc / ✕ / a click beside it closes only the popup. A broken image shows its alt text.
 */
export function ImageView({ src, alt, className, boxClass }: { src: string; alt?: string; className?: string; boxClass?: string }) {
  const t = useT();
  const box = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false), [full, setFull] = useState(false);
  useEffect(() => { if (open) box.current?.showModal(); }, [open]);
  const close = () => box.current?.close();
  const beside = (e: React.MouseEvent) => { if (e.target === e.currentTarget) close(); };
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-label={alt ? t("Xem ảnh {alt}", { alt }) : t("Xem ảnh")} className={cn("my-1 inline-block max-w-full cursor-zoom-in align-top", boxClass)}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={alt ?? ""} loading="lazy" className={className ?? "max-h-[28rem] max-w-full rounded-md border border-rule bg-paper-2"} />
      </button>
      {open && createPortal( // in <body>: a <dialog> may not sit inside the markdown's <p>
        <dialog ref={box} aria-label={alt || t("Ảnh")} onClose={() => { setOpen(false); setFull(false); }} onClick={beside}
          onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); } }} // not the sheet's Esc too
          className="m-0 h-dvh max-h-none w-dvw max-w-none bg-black/85 p-0 text-white backdrop:bg-transparent">
          <div onClick={beside} className={cn("grid size-full overflow-auto", !full && "place-items-center p-6 sm:p-10")}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={src} alt={alt ?? ""} onClick={() => setFull(!full)}
              className={full ? "max-w-none cursor-zoom-out" : "max-h-full max-w-full cursor-zoom-in rounded-md object-contain shadow-pop"} />
          </div>
          <div className="fixed top-3 right-3 flex gap-2">
            <a href={src} target="_blank" rel="noopener noreferrer" aria-label={t("Mở ảnh ở tab mới")} className="grid size-9 place-items-center rounded-full bg-black/60 text-white hover:bg-black/80"><ExternalLink className="size-4" /></a>
            <button type="button" autoFocus onClick={close} aria-label={t("Đóng (Esc)")} className="grid size-9 place-items-center rounded-full bg-black/60 text-white hover:bg-black/80"><X className="size-5" /></button>
          </div>
        </dialog>, document.body)}
    </>
  );
}
