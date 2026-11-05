"use client";

import { ExternalLink, X } from "lucide-react";
import { memo, type ReactNode, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

const PLUGINS = [remarkGfm, remarkBreaks];
const TICKET = /\b([A-Z][A-Z0-9]+-\d+)\b/g;
const SKIP = /(```[\s\S]*?```|`[^`\n]*`|\[[^\]]*\]\([^)]*\))/; // code and links keep their ticket IDs as text

const Link = ({ href, children }: { href?: string; children?: ReactNode }) => <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>;

/**
 * GFM markdown (lists, tables, code, single newlines kept) for AI answers and YouTrack text.
 * Raw HTML stays text. `onTicket`: ticket IDs become buttons that open the ticket.
 * Memoised: a long AI Agent log re-renders on every poll, but its old answers keep the same text.
 */
export const Markdown = memo(function Markdown({ text, className, onTicket }: { text: string | null | undefined; className?: string; onTicket?: (id: string) => void }) {
  let src = text ?? "";
  if (onTicket) src = src.split(SKIP).map((part, i) => (i % 2 ? part : part.replace(TICKET, "[$1](#ticket:$1)"))).join("");
  const components: Components = {
    // only this app's own files load inline: a remote image would fetch on sight (tracking pixel, or a
    // prompt-injected AI answer leaking data in its URL), so it stays a link the user chooses to open
    img: ({ src, alt }) => (typeof src !== "string" || !src ? null
      : src.startsWith("/api/") ? <ImageView src={src} alt={alt} /> : <Link href={src}>[ảnh{alt ? `: ${alt}` : ""}]</Link>),
    a: onTicket
      ? ({ href, children }) => (href?.startsWith("#ticket:") ? <button type="button" onClick={() => onTicket(href.slice(8))}>{children}</button> : <Link href={href}>{children}</Link>)
      : Link,
  };
  return (
    <div className={cn("md text-sm leading-relaxed", className)}>
      <ReactMarkdown remarkPlugins={PLUGINS} components={components}>{src}</ReactMarkdown>
    </div>
  );
});

/**
 * An image that opens in a popup over the page (native modal <dialog>): fitted to the screen, click it for 100% (scroll to pan).
 * Esc / ✕ / a click beside it closes only the popup. A broken image shows its alt text.
 */
export function ImageView({ src, alt, className, boxClass }: { src: string; alt?: string; className?: string; boxClass?: string }) {
  const box = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false), [full, setFull] = useState(false);
  useEffect(() => { if (open) box.current?.showModal(); }, [open]);
  const close = () => box.current?.close();
  const beside = (e: React.MouseEvent) => { if (e.target === e.currentTarget) close(); };
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-label={`Xem ảnh${alt ? ` ${alt}` : ""}`} className={cn("my-1 inline-block max-w-full cursor-zoom-in align-top", boxClass)}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={alt ?? ""} loading="lazy" className={className ?? "max-h-[28rem] max-w-full rounded-md border border-rule bg-paper-2"} />
      </button>
      {open && createPortal( // in <body>: a <dialog> may not sit inside the markdown's <p>
        <dialog ref={box} aria-label={alt || "Ảnh"} onClose={() => { setOpen(false); setFull(false); }} onClick={beside}
          onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); } }} // not the sheet's Esc too
          className="m-0 h-dvh max-h-none w-dvw max-w-none bg-black/85 p-0 text-white backdrop:bg-transparent">
          <div onClick={beside} className={cn("grid size-full overflow-auto", !full && "place-items-center p-6 sm:p-10")}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={src} alt={alt ?? ""} onClick={() => setFull(!full)}
              className={full ? "max-w-none cursor-zoom-out" : "max-h-full max-w-full cursor-zoom-in rounded-md object-contain shadow-pop"} />
          </div>
          <div className="fixed top-3 right-3 flex gap-2">
            <a href={src} target="_blank" rel="noopener noreferrer" aria-label="Mở ảnh ở tab mới" className="grid size-9 place-items-center rounded-full bg-black/60 text-white hover:bg-black/80"><ExternalLink className="size-4" /></a>
            <button type="button" autoFocus onClick={close} aria-label="Đóng (Esc)" className="grid size-9 place-items-center rounded-full bg-black/60 text-white hover:bg-black/80"><X className="size-5" /></button>
          </div>
        </dialog>, document.body)}
    </>
  );
}
