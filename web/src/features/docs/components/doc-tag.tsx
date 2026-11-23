"use client";

import { useQuery } from "@tanstack/react-query";
import { X } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import Link from "next/link";
import { Fragment, useState } from "react";
import { type Picker, PickPopup, SHOWN, useCaretPick } from "@/shared/components/mention";
import { Button } from "@/shared/components/ui/button";
import { Fold } from "@/shared/components/ui/fold";
import { Hint } from "@/shared/components/ui/hint";
import { errorText } from "@/shared/lib/api";
import { useT } from "@/shared/lib/i18n";
import { fold } from "@/shared/lib/utils";
import { allDocsQuery, type Doc, docErrors, docName, docRef, findTerms } from "@/features/docs/lib/docs";
import { Marked, SourceIcon } from "./results";

// "#" in a box: pick a document of the library (Tài liệu) by name, as "@" picks a member. An AI session's box gets its
// short ref ("VA-A-176", a file "#DOC12"), which links.py reads for the AI. A box that posts to the team (Telegram,
// YouTrack) shows the title and sends it as the link under it, "[title](url)" (telegram.split_format makes it a link
// entity, YouTrack Markdown draws it);
// those list only documents with a link the team can open (KB articles), not files on this machine. ponytail: the
// title → link map lives in the hook, as "@Name" → id does in useMention: a reopened draft sends the title as plain text.
// What was picked shows as chips over the box (`top`): a click opens it (the library in a new tab, the draft stays; or
// the article on the web), × takes it out of the text. Once sent, DocRefText links a session prompt's refs.

// "#" at a line start or after a space, a word right after it (not "# " Markdown heading), a name may have spaces
const QUERY = /(?:^|\s)#((?:[^\s#]{1,40}(?: [^\s#]{0,40}){0,5})?)$/;
export type DocTarget = "ai" | "telegram" | "youtrack";

/** The row's second line, matched as the name is (a KB article's ID, a file's path under its folder). */
const where = (d: Doc) => (d.source === "youtrack" ? d.ref : d.rel ?? d.ref);

/** Documents matching `q`, best first: 0 name starts with it, 1 a word of the name does, 2 name has it, 3 path / ticket. */
function rank(list: Doc[], q: string): Doc[] {
  const k = fold(q).trim();
  if (!k) return list.slice(0, SHOWN);
  const score = (d: Doc) => {
    const name = fold(docName(d));
    return name.startsWith(k) ? 0 : name.split(/[\s\-_/.]+/).some((w) => w.startsWith(k)) ? 1 : name.includes(k) ? 2
      : fold(`${where(d)} ${d.tickets.join(" ")}`).includes(k) ? 3 : -1;
  };
  return list.map((d) => [score(d), d] as const).filter(([s]) => s >= 0)
    .sort((a, b) => a[0] - b[0]).slice(0, SHOWN).map(([, d]) => d); // stable: ties stay newest first
}

/** The title as the box shows it and the link's text: one line, no brackets (they would end the "[title](url)"). */
const title = (d: Doc) => docName(d).replace(/[[\]\n]/g, " ").replace(/\s+/g, " ").trim().slice(0, 256);
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** What a pick puts in the box, and how the box is searched for it (a ref as a whole word: "VA-A-17" is not "VA-A-176"). */
const token = (d: Doc, to: DocTarget) => (to === "ai" ? docRef(d) : title(d));
const near = (tok: string, to: DocTarget) => (to === "ai" ? new RegExp(`(?<![\\w#-])${esc(tok)}(?![\\w-])`, "g") : new RegExp(esc(tok), "g"));
const docHref = (d: Doc, to: DocTarget) => (to === "ai" ? `/docs/?doc=${d.id}` : d.url ?? "");
/** Non-overlapping, in order: what Marked draws. */
const marks = (s: string, q: string) => findTerms(s, q).sort((a, b) => a[0] - b[0])
  .reduce<[number, number][]>((out, m) => (out.length && m[0] < out[out.length - 1][1] ? out : [...out, m]), []);

/** "#" on a textarea (see Picker); join with "@" by useJoin. */
export function useDocTag(to: DocTarget, value: string, setValue: (s: string) => void): Picker {
  const t = useT();
  const c = useCaretPick(QUERY, value, setValue);
  const list = useQuery({ ...allDocsQuery, enabled: c.asking, staleTime: 60_000, retry: false });
  const all = c.asking ? rank(list.data ?? [], c.q) : [];
  const shown = to === "ai" ? all : all.filter((d) => d.url);
  const filesOnly = !shown.length && all.length > 0; // matches, but only files on this machine: no link to post
  // Nothing matches: plain typing (a "#QA_PO_…" code, a hashtag); a load or its failure still shows.
  const open = c.asking && (list.isPending || list.isError || shown.length > 0 || filesOnly);
  const [picked, setPicked] = useState<Doc[]>([]); // picked here; a chip while its token is still in the text
  const inText = picked.filter((d) => near(token(d, to), to).test(value));
  function pick(i: number) {
    const d = shown[i];
    setPicked((p) => [...p.filter((x) => x.id !== d.id), d]);
    c.put(token(d, to));
  }
  const drop = (d: Doc) => {
    setValue(value.replace(new RegExp(`${near(token(d, to), to).source} ?`, "g"), ""));
    setPicked((p) => p.filter((x) => x.id !== d.id));
  };
  /** The text as sent: to the team, each title picked here becomes "[title](url)", longest first, not one already a link. */
  const wire = (s: string) => to === "ai" ? s : [...picked].sort((a, b) => title(b).length - title(a).length)
    .reduce((s2, d) => s2.replace(new RegExp(`(?<!\\[)${esc(title(d))}(?!\\]\\()`, "g"), () => `[${title(d)}](${d.url})`), s); // a function: no "$&" read in the URL
  const status = list.isPending ? t("Đang tải tài liệu…") : list.isError ? errorText(list.error, docErrors(), t("Không tải được danh sách tài liệu"))
    : filesOnly ? t("File trên máy không có link cho team mở: chỉ dùng trong phiên AI.") : "";
  const popup = (
    <PickPopup open={open} label={t("Chọn tài liệu")} status={status} error={list.isError} className="w-96"
      cur={Math.min(c.at, Math.max(shown.length - 1, 0))} onPick={pick} onHover={c.setAt}
      rows={shown.map((d) => ({ key: String(d.id), body: <>
        <SourceIcon doc={d} />
        <span className="grid min-w-0 flex-1">
          <span className="truncate text-ink"><Marked text={docName(d)} marks={marks(docName(d), c.q)} /></span>
          <span className="truncate text-2xs text-ink-3"><Marked text={where(d)} marks={marks(where(d), c.q)} /></span>
        </span>
      </> }))} />
  );
  const top = picked.length > 0 && <DocChips docs={inText} to={to} onDrop={drop} />;
  return { attach: c.attach, track: c.track, onKeyDown: (e) => c.keys(e, open, shown.length, pick), wire, popup, open, top };
}

/** The documents picked into a box: a click opens one in a new tab (the draft stays), × takes it out of the text. */
function DocChips({ docs, to, onDrop }: { docs: Doc[]; to: DocTarget; onDrop: (d: Doc) => void }) {
  const t = useT();
  const still = useReducedMotion();
  return (
    <Fold open={docs.length > 0}>
      <ul aria-label={t("Tài liệu đã chọn")} className="relative flex flex-wrap gap-1.5 px-3 pt-3 pb-1">
        <AnimatePresence initial={false} mode="popLayout">
          {docs.map((d) => (
            <motion.li key={d.id} layout={!still} initial={{ opacity: 0, scale: still ? 1 : 0.9 }} animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: still ? 1 : 0.9 }} transition={{ duration: 0.16 }}
              className="flex max-w-72 items-center gap-1 rounded-lg border border-rule bg-paper-2 py-0.5 pr-0.5 pl-2 text-xs">
              <Hint side="bottom" text={to === "ai" ? t("Mở tài liệu trong Tài liệu (tab mới); AI đọc nó theo mã {ref}", { ref: docRef(d) }) : t("Mở bài gốc trên YouTrack (tab mới); gửi đi thành link dưới tiêu đề")}>
                <a href={docHref(d, to)} target="_blank" rel="noopener noreferrer" className="flex min-w-0 items-center gap-1.5 text-ink-2 hover:text-ink hover:underline underline-offset-2">
                  <SourceIcon doc={d} /><span className="truncate">{docName(d)}</span>
                </a>
              </Hint>
              <Button type="button" size="icon-xs" variant="ghost" aria-label={t("Bỏ tài liệu {title}", { title: docName(d) })} onClick={() => onDrop(d)}><X /></Button>
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
    </Fold>
  );
}

// The refs links.py reads in a session prompt: a KB article's ID (BARE_ARTICLE) and "#DOC<id>" (DOC).
const REFS = /(?<![\w/-])([A-Z][A-Z0-9]{1,9}-A-\d{1,6})(?!\w)|(?<![\w#])#DOC(\d{1,9})(?!\w)/g;

/** A session prompt with its document refs ("VA-A-176", "#DOC12") as links into the library, for those it holds. */
export function DocRefText({ text }: { text: string }) {
  const t = useT();
  const has = new RegExp(REFS.source).test(text);
  const list = useQuery({ ...allDocsQuery, enabled: has, staleTime: 60_000, retry: false });
  if (!has || !list.data) return text;
  const find = (ref?: string, id?: string) => list.data.find((d) => (ref ? d.source === "youtrack" && d.ref === ref : d.id === Number(id)));
  const out = [];
  let at = 0;
  for (const m of text.matchAll(REFS)) {
    const d = find(m[1], m[2]);
    if (!d) continue;
    out.push(text.slice(at, m.index), (
      <Hint key={m.index} side="bottom" text={t("Mở tài liệu: {title}", { title: docName(d) })}>
        <Link href={`/docs/?doc=${d.id}`} className="font-medium text-hl-2 underline underline-offset-2 hover:text-hl">{m[0]}</Link>
      </Hint>
    ));
    at = m.index + m[0].length;
  }
  out.push(text.slice(at));
  return <>{out.map((x, i) => <Fragment key={i}>{x}</Fragment>)}</>;
}
