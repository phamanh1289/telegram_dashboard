"use client";

import { FileText, MessageCircle, Plus, SearchX, Star } from "lucide-react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Fragment, type ReactNode, useState } from "react";
import { AiFetching, useAiWait } from "@/shared/components/ai/fetching";
import { AiBot } from "@/shared/components/ai/chat";
import { Button } from "@/shared/components/ui/button";
import { BotStage, Empty } from "@/shared/components/ui/empty";
import { Segmented } from "@/shared/components/ui/segmented";
import { YtLogo } from "@/shared/components/yt-logo";
import { errorText } from "@/shared/lib/api";
import { fmtDay, useT } from "@/shared/lib/i18n";
import { getPref, setPref } from "@/shared/lib/prefs";
import { cn, fold } from "@/shared/lib/utils";
import { DocTree } from "./doc-tree";
import { FavStar } from "./fav-star";
import { type Doc, type DocFilter, type DocHit, docErrors, docListQuery, docSearchQuery, type DocMsgHit, useDocFavs } from "@/features/docs/lib/docs";

// Left column of Tài liệu: the documents (nothing typed) or the matching parts grouped by document, then the
// tracked-chat messages. A click opens the document at the part; a message opens in its Telegram group. Nothing typed:
// the documents as a tree (project / folder) or newest first, as picked (kept per browser).

// group/row: the open row is hl-wash (its marks stay the red hit, readable on it)
const ROW = "group/row grid w-full gap-0.5 px-4 py-2 text-left transition-colors duration-(--dur-micro) hover:bg-paper-2";

/** `text` with the server's `marks` ([start, end) in code points) highlighted. */
export function Marked({ text, marks }: { text: string; marks: [number, number][] }) {
  const cp = Array.from(text);
  const out: ReactNode[] = [];
  let at = 0;
  marks.forEach(([a, b], k) => {
    out.push(cp.slice(at, a).join(""), <mark key={k} className="rounded-sm bg-hit px-0.5 text-hit-ink">{cp.slice(a, b).join("")}</mark>);
    at = b;
  });
  out.push(cp.slice(at).join(""));
  return <>{out}</>;
}

export const SourceIcon = ({ doc }: { doc: Doc }) =>
  doc.source === "youtrack" ? <YtLogo className="size-4 shrink-0" /> : <FileText aria-hidden className="size-4 shrink-0 text-ink-3" />;

/** "#### Phần 2" → "Phần 2". */
export const headingText = (h: string) => h.replace(/^#+\s*/, "");
/** A heading that only repeats the document's name ("# VA-A-1 Quy trình" in "Quy trình", "# Ghi chú" in "ghi-chu.md"). */
const same = (heading: string, title: string) => {
  const h = fold(headingText(heading)).replace(/[^a-z0-9]+/g, ""), d = fold(title.replace(/\.\w+$/, "")).replace(/[^a-z0-9]+/g, "");
  return !!d && (h === d || h.endsWith(d));
};

const VIEW = "docsListView";
type View = "tree" | "recent" | "fav";
const VIEWS: View[] = ["tree", "recent", "fav"];

export function Results({ q, f, part, syncing, onOpen, onAdd }: {
  q: string; f: DocFilter; part: number | null; syncing: boolean; onOpen: (doc: number, part: number | null) => void;
  onAdd: () => void; // opens Thêm (the sources dialog)
}) {
  const t = useT();
  const [view, setView] = useState<View>(() => VIEWS.find((v) => v === getPref(VIEW)) ?? "tree");
  const favs = useDocFavs();
  const scope = { ...f, doc: null }; // the list spans every document; the open one is only highlighted
  const list = useQuery({ ...docListQuery(scope), enabled: !q });
  const found = useQuery({ ...docSearchQuery(q, scope), enabled: !!q });
  const cur = q ? found : list;
  const empty = q ? !found.data?.hits.length && !found.data?.messages.length : !list.data?.length;
  // the first sync of an empty store: the scene, not "no documents", until it lands
  const wait = useAiWait(cur.isPending || (syncing && empty));

  const treeDocs = view === "fav" ? (list.data ?? []).filter(favs.has) : list.data ?? [];
  let body: ReactNode;
  if (cur.isError) body = <p role="alert" className="px-4 py-6 text-sm text-error">{errorText(cur.error, docErrors())}</p>;
  else if (!cur.data || wait) body = null;
  else if (!q && f.source === "telegram") body = <Empty icon={<MessageCircle />} title={t("Gõ từ khóa để tìm trong tin Telegram")}>{t("Tin của các nhóm đang theo dõi chỉ hiện khi tìm.")}</Empty>;
  else if (empty) body = q
    ? <Empty icon={<SearchX />} title={t("Không thấy đoạn nào khớp")}>{t("Thử từ khác, bỏ bộ lọc, hoặc thêm nguồn ở \"Thêm\".")}</Empty>
    : f.source === "kb_cache"
      ? <Empty icon={<FileText />} title={t("Không có bài KB ngoài nguồn")}>{t("Bài Knowledge Base AI Agent mở mà project không có trong \"Nguồn tài liệu\" sẽ nằm ở đây.")}</Empty>
      : <NoDocs onAdd={onAdd} />;
  else body = q ? <Hits hits={found.data?.hits ?? []} messages={found.data?.messages ?? []} cur={[f.doc, part]} onOpen={onOpen} />
    : view === "recent" ? <Rows docs={list.data ?? []} open={f.doc} onOpen={(id) => onOpen(id, null)} />
    // Yêu thích: the starred ones as the same tree (project / folder, child under parent)
    : treeDocs.length ? <DocTree docs={treeDocs} open={f.doc} onOpen={(id) => onOpen(id, null)} />
      : <Empty icon={<Star />} title={t("Chưa có tài liệu yêu thích")}>{t("Bấm ngôi sao cạnh một tài liệu để giữ nó ở đây, mở lại nhanh.")}</Empty>;

  return (
    <section aria-label={t("Kết quả")} className="relative flex min-h-0 flex-1 flex-col">
      {!q && f.source !== "telegram" && (
        <div className="flex h-10 shrink-0 items-center gap-2 border-b px-3">
          <Segmented id="docs-list-view" label={t("Cách xem danh sách tài liệu")} value={view}
            onChange={(v) => { setView(v); setPref(VIEW, v); }}
            items={[{ value: "tree", label: t("Theo thư mục"), title: t("Theo project Knowledge Base / thư mục, bài con nằm dưới bài cha") },
              { value: "recent", label: t("Mới nhất"), title: t("Tài liệu mới cập nhật lên trước") },
              { value: "fav", label: t("Yêu thích"), title: t("Tài liệu đã đánh dấu sao") }]} />
        </div>
      )}
      {/* the scene covers the visible box from outside the scroll, so it stays centred however far the list scrolled */}
      {wait && <AiFetching kind="docs" cover />}
      <div className={cn("min-h-0 flex-1 overflow-y-auto bg-cotton transition-opacity duration-(--dur-short)", q && found.isPlaceholderData && "opacity-60")}>{body}</div>
    </section>
  );
}

/** Nothing in the library yet (nothing is chosen on a first use): the robot on its stage and the way in, Thêm. */
function NoDocs({ onAdd }: { onAdd: () => void }) {
  const t = useT();
  return (
    <div className="grid justify-items-center gap-2.5 px-4 py-8 text-center animate-in fade-in-0 zoom-in-95 duration-(--dur-short)">
      <BotStage className="mb-1 size-36"><AiBot className="ai-float relative size-16 drop-shadow-lg" /></BotStage>
      <p className="text-sm font-bold text-ink">{t("Chưa có tài liệu")}</p>
      <p className="max-w-60 text-xs leading-relaxed text-ink-3">{t("Thêm nhánh Knowledge Base trên YouTrack hoặc thư mục tài liệu trên máy để tìm và hỏi AI.")}</p>
      <Button size="sm" className="mt-1 rounded-full bg-hl text-hl-ink hover:bg-hl" onClick={onAdd}><Plus />{t("Thêm nhánh KB / thư mục")}</Button>
    </div>
  );
}

/** Documents one per row, newest first (Mới nhất). */
function Rows({ docs, open, onOpen }: { docs: Doc[]; open: number | null; onOpen: (id: number) => void }) {
  return <ul className="grid gap-px p-1.5">{docs.map((d) => <li key={d.id}><DocRow doc={d} on={d.id === open} onOpen={() => onOpen(d.id)} /></li>)}</ul>;
}

function DocRow({ doc, on, onOpen }: { doc: Doc; on: boolean; onOpen: () => void }) {
  return (
    // the star beside the open button, not in it (no button in a button); it shows on the row's hover
    <div className={cn(ROW, "flex min-h-8 items-center gap-2 rounded-md py-0.5 pr-0.5 pl-2", on && "bg-hl-wash hover:bg-hl-wash")}>
      <button type="button" aria-current={on || undefined} onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-2 py-0.5 text-left">
        <SourceIcon doc={doc} />
        <span className="line-clamp-2 min-w-0 flex-1 text-sm leading-snug break-words text-ink">{doc.title || doc.ref}</span>
        {doc.updated_at && <span className="shrink-0 text-2xs text-ink-3">{fmtDay(doc.updated_at)}</span>}
      </button>
      <FavStar doc={doc} quiet />
    </div>
  );
}

/** Parts grouped by document in the server's order (best first), then the messages. */
function Hits({ hits, messages, cur, onOpen }: {
  hits: DocHit[]; messages: DocMsgHit[]; cur: [number | null, number | null]; onOpen: (doc: number, part: number | null) => void;
}) {
  const t = useT();
  const groups = new Map<number, DocHit[]>();
  for (const h of hits) groups.set(h.doc.id, [...(groups.get(h.doc.id) ?? []), h]);
  return <>
    {[...groups.values()].map((hs) => (
      <Fragment key={hs[0].doc.id}>
        <h3 className="sticky top-0 z-[1] flex min-w-0 items-center gap-2 border-b border-rule bg-paper-2 px-4 py-1.5 text-sm font-medium text-ink">
          <SourceIcon doc={hs[0].doc} /><span className="min-w-0 flex-1 truncate">{hs[0].doc.title || hs[0].doc.ref}</span>
          <span className="shrink-0 text-2xs font-normal text-ink-3">{t("{n} đoạn", { n: hs.length })}</span>
        </h3>
        <ul>
          {hs.map((h) => {
            const on = cur[0] === h.doc.id && cur[1] === h.part;
            return (
              <li key={h.part}>
                <button type="button" aria-current={on || undefined} onClick={() => onOpen(h.doc.id, h.part)} className={cn(ROW, "pl-10", on && "bg-hl-wash hover:bg-hl-wash")}>
                  <span className="line-clamp-2 text-sm leading-relaxed text-ink">
                    {/* the section, inline: one line less a hit, and none when it only repeats the document's name */}
                    {h.heading && !same(h.heading, h.doc.title) && <span className="text-xs text-ink-3">{headingText(h.heading)} · </span>}
                    <Marked text={h.text} marks={h.marks} />
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </Fragment>
    ))}
    {messages.length > 0 && <>
      <h3 className="sticky top-0 z-[1] flex items-center gap-2 border-b border-rule bg-paper-2 px-4 py-1.5 text-sm font-medium text-ink">
        <MessageCircle aria-hidden className="size-4 text-info" />{t("Tin Telegram")}
      </h3>
      <ul>
        {messages.map((m) => (
          <li key={`${m.chat_id}:${m.message_id}`}>
            <Link href={`/?chat=${encodeURIComponent(m.chat_id)}&msg=${m.message_id}`} className={cn(ROW, "text-ink no-underline")}>
              <span className="truncate text-xs text-ink-3">{[m.chat_title, m.sender_name, fmtDay(m.date)].filter(Boolean).join(", ")}</span>
              <span className="line-clamp-2 text-sm leading-relaxed"><Marked text={m.text} marks={m.marks} /></span>
            </Link>
          </li>
        ))}
      </ul>
    </>}
  </>;
}
