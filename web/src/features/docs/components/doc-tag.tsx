"use client";

import { useQuery } from "@tanstack/react-query";
import { type Picker, PickPopup, SHOWN, useCaretPick } from "@/shared/components/mention";
import { errorText } from "@/shared/lib/api";
import { useT } from "@/shared/lib/i18n";
import { fold } from "@/shared/lib/utils";
import { type Doc, docErrors, docListQuery, docName, docRef, findTerms } from "@/features/docs/lib/docs";
import { Marked, SourceIcon } from "./results";

// "#" in a box: pick a document of the library (Tài liệu) by name, as "@" picks a member. What goes in the box, as typed
// text (no hidden map: a reopened draft keeps it): an AI session gets "#DOC12 (name)" / the KB link (links.py reads it
// for the AI, the line Dùng tài liệu writes); Telegram "name: url" (no Markdown links there); YouTrack "[name](url)".
// Telegram / YouTrack list only documents with a link the team can open (KB articles), not files on this machine.

// "#" at a line start or after a space, a word right after it (not "# " Markdown heading), a name may have spaces
const QUERY = /(?:^|\s)#((?:[^\s#]{1,40}(?: [^\s#]{0,40}){0,5})?)$/;
const ALL = docListQuery({ source: "all", ticket: null, doc: null }); // the Tài liệu list's cache: one request, newest first
export type DocTarget = "ai" | "telegram" | "youtrack";

/** Documents matching `q`, best first: 0 name starts with it, 1 a word of the name does, 2 name has it, 3 path / ticket. */
function rank(list: Doc[], q: string): Doc[] {
  const k = fold(q).trim();
  if (!k) return list.slice(0, SHOWN);
  const score = (d: Doc) => {
    const name = fold(docName(d));
    return name.startsWith(k) ? 0 : name.split(/[\s\-_/.]+/).some((w) => w.startsWith(k)) ? 1 : name.includes(k) ? 2
      : fold(`${d.rel ?? d.ref} ${d.tickets.join(" ")}`).includes(k) ? 3 : -1;
  };
  return list.map((d) => [score(d), d] as const).filter(([s]) => s >= 0)
    .sort((a, b) => a[0] - b[0]).slice(0, SHOWN).map(([, d]) => d); // stable: ties stay newest first
}

const text = (d: Doc, to: DocTarget) => {
  const name = docName(d).replace(/\n/g, " ");
  return to === "ai" ? `${docRef(d)} (${name})` : to === "telegram" ? `${name}: ${d.url}` : `[${name.replace(/[[\]]/g, "")}](${d.url})`;
};
/** Non-overlapping, in order: what Marked draws. */
const marks = (s: string, q: string) => findTerms(s, q).sort((a, b) => a[0] - b[0])
  .reduce<[number, number][]>((out, m) => (out.length && m[0] < out[out.length - 1][1] ? out : [...out, m]), []);

/** "#" on a textarea (see Picker); join with "@" by useJoin. */
export function useDocTag(to: DocTarget, value: string, setValue: (s: string) => void): Picker {
  const t = useT();
  const c = useCaretPick(QUERY, value, setValue);
  const list = useQuery({ ...ALL, enabled: c.asking, staleTime: 60_000, retry: false });
  const all = c.asking ? rank(list.data ?? [], c.q) : [];
  const shown = to === "ai" ? all : all.filter((d) => d.url);
  const filesOnly = !shown.length && all.length > 0; // matches, but only files on this machine: no link to post
  // Nothing matches: plain typing (a "#QA_PO_…" code, a hashtag); a load or its failure still shows.
  const open = c.asking && (list.isPending || list.isError || shown.length > 0 || filesOnly);
  const pick = (i: number) => c.put(text(shown[i], to));
  const status = list.isPending ? t("Đang tải tài liệu…") : list.isError ? errorText(list.error, docErrors(), t("Không tải được danh sách tài liệu"))
    : filesOnly ? t("File trên máy không có link cho team mở: chỉ dùng trong phiên AI.") : "";
  const popup = (
    <PickPopup open={open} label={t("Chọn tài liệu")} status={status} error={list.isError} className="w-96"
      cur={Math.min(c.at, Math.max(shown.length - 1, 0))} onPick={pick} onHover={c.setAt}
      rows={shown.map((d) => ({ key: String(d.id), body: <>
        <SourceIcon doc={d} />
        <span className="grid min-w-0 flex-1">
          <span className="truncate text-ink"><Marked text={docName(d)} marks={marks(docName(d), c.q)} /></span>
          <span className="truncate text-2xs text-ink-3">{d.source === "youtrack" ? d.ref : d.rel ?? d.ref}</span>
        </span>
      </> }))} />
  );
  return { attach: c.attach, track: c.track, onKeyDown: (e) => c.keys(e, open, shown.length, pick), wire: (s) => s, popup, open };
}
