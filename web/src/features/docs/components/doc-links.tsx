"use client";

import { Frame } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { type ReactNode, useCallback, useMemo } from "react";
import { MD_SKIP } from "@/shared/components/markdown";
import { Hint } from "@/shared/components/ui/hint";
import { useT } from "@/shared/lib/i18n";
import { cn } from "@/shared/lib/utils";
import { linkCls } from "@/features/telegram/components/message/rich-text";
import { docListQuery } from "@/features/docs/lib/docs";

// Links drawn into the open document's text:
// - Knowledge Base article IDs ("VA-A-172"): to that article in the reader when the library has it, else asking to add
//   it (kb-add.tsx: yes adds and opens it, no opens it on YouTrack);
// - Zeplin screen names: a code span holding a digit on a line that says "Zeplin" (`Banv2-CNY 23 A1`; a range
//   `Banv2-00 → 19` links both ends, "19" read as "Banv2-19"): opens the Zeplin page sliding in (zeplin-sheet.tsx).
// The text is rewritten to "[x](#doc:REF)" / "[x](#zpl:name~label)", which the reader's Markdown draws through `anchor`.

const REF = /\b([A-Z][A-Z0-9]+-A-\d+)\b/g;
const CODE_REF = /^`([A-Z][A-Z0-9]+-A-\d+)`$/;
const ZEPLIN = /zeplin/i;
const SPAN = /`([^`\n]+)`/g;
const RANGE = /\s*(?:→|->)\s*/;

/** A Zeplin link for `label`, looked up as `name`; brackets in it (no Markdown link text) leave it plain. */
const zpl = (name: string, label = name) =>
  /[[\]]/.test(label) ? `\`${label}\`` : `[${label}](#zpl:${encodeURIComponent(name)}~${encodeURIComponent(label)})`;

/** One code span on a Zeplin line: a screen name (it holds a digit), or a range of them; anything else stays code. */
function zeplinSpan(all: string, body: string): string {
  const name = body.trim();
  if (!/\d/.test(name)) return all;
  const [a, b, ...more] = name.split(RANGE);
  if (b === undefined || more.length) return zpl(name);
  const end = /^\d+$/.test(b) ? a.replace(/\d+$/, b) : b; // "Banv2-00 → 19": the end keeps the start's prefix
  return `${zpl(a)} → ${zpl(end, b)}`;
}

/** `text` with its article IDs (not `self`) and, on lines naming Zeplin, its screen names as links; code blocks and
 *  links stay as they are. */
export function docLinks(text: string, self: string): string {
  let fenced = false;
  const zeplined = text.split("\n").map((line) => {
    if (line.trimStart().startsWith("```")) fenced = !fenced;
    return !fenced && ZEPLIN.test(line) ? line.replace(SPAN, zeplinSpan) : line;
  }).join("\n");
  const link = (ref: string, all: string) => (ref === self ? all : `[${ref}](#doc:${ref})`);
  return zeplined.split(MD_SKIP).map((part, i) => {
    if (i % 2 === 0) return part.replace(REF, (all, ref: string) => link(ref, all));
    const code = CODE_REF.exec(part);
    return code ? link(code[1], part) : part;
  }).join("");
}

/** The Markdown `anchor` drawing "#doc:" and "#zpl:" links: an article opens in the library (`onDoc`), one it does not
 *  hold asks to add it (`onMissing`); a screen name opens the Zeplin page (`onZeplin`). All callbacks stable, or every
 *  rendered part redraws. */
export function useDocAnchor(onDoc: (id: number) => void, onZeplin: (name: string) => void, onMissing: (ref: string) => void): (hash: string) => ReactNode {
  const list = useQuery(docListQuery({ source: "all", ticket: null, doc: null }));
  const byRef = useMemo(() => new Map((list.data ?? []).filter((d) => d.source === "youtrack").map((d) => [d.ref, d])), [list.data]);
  return useCallback((hash: string) => {
    if (hash.startsWith("zpl:")) {
      const [name, label] = hash.slice(4).split("~").map(decodeURIComponent);
      return <ZeplinRef name={name} label={label || name} onOpen={() => onZeplin(name)} />;
    }
    if (!hash.startsWith("doc:")) return null;
    const ref = hash.slice(4);
    const d = byRef.get(ref);
    return <KbRef ref_={ref} title={d?.title} have={!!d} onOpen={() => (d ? onDoc(d.id) : onMissing(ref))} />;
  }, [byRef, onDoc, onZeplin, onMissing]);
}

function ZeplinRef({ name, label, onOpen }: { name: string; label: string; onOpen: () => void }) {
  const t = useT();
  return (
    <Hint text={t("Xem màn Zeplin “{name}”", { name })}>
      <button type="button" onClick={onOpen} className={cn(linkCls, "inline-flex items-baseline gap-0.5 font-mono")}>
        <Frame aria-hidden className="size-3 self-center" />{label}
      </button>
    </Hint>
  );
}

/** An article ID: in the library, opens it; not (dashed underline), asks to add it. */
function KbRef({ ref_, title, have, onOpen }: { ref_: string; title?: string; have: boolean; onOpen: () => void }) {
  const t = useT();
  return (
    <Hint text={have ? t("Mở tài liệu {ref}: {title}", { ref: ref_, title: title || ref_ }) : t("{ref} chưa có trong Tài liệu: bấm để thêm vào hoặc mở trên YouTrack", { ref: ref_ })}>
      <button type="button" onClick={onOpen} className={cn(linkCls, "font-mono", !have && "decoration-dashed")}>{ref_}</button>
    </Hint>
  );
}
