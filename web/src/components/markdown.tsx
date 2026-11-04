"use client";

import type { ReactNode } from "react";
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
 */
export function Markdown({ text, className, onTicket }: { text: string | null | undefined; className?: string; onTicket?: (id: string) => void }) {
  let src = text ?? "";
  if (onTicket) src = src.split(SKIP).map((part, i) => (i % 2 ? part : part.replace(TICKET, "[$1](#ticket:$1)"))).join("");
  const components: Components = {
    a: onTicket
      ? ({ href, children }) => (href?.startsWith("#ticket:") ? <button type="button" onClick={() => onTicket(href.slice(8))}>{children}</button> : <Link href={href}>{children}</Link>)
      : Link,
  };
  return (
    <div className={cn("md text-sm leading-relaxed", className)}>
      <ReactMarkdown remarkPlugins={PLUGINS} components={components}>{src}</ReactMarkdown>
    </div>
  );
}
