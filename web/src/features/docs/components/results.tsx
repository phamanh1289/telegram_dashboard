"use client";

import { FileText, MessageCircle, SearchX } from "lucide-react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Fragment, type ReactNode } from "react";
import { AiFetching, useAiWait } from "@/shared/components/ai/fetching";
import { Empty } from "@/shared/components/ui/empty";
import { YtLogo } from "@/shared/components/yt-logo";
import { errorText } from "@/shared/lib/api";
import { fmtDay, useT } from "@/shared/lib/i18n";
import { cn } from "@/shared/lib/utils";
import { type Doc, type DocFilter, type DocHit, docErrors, docListQuery, docSearchQuery, type DocMsgHit } from "@/features/docs/lib/docs";

// Left column of Tài liệu: the documents (nothing typed) or the matching parts grouped by document, then the
// tracked-chat messages. A click opens the document at the part; a message opens in its Telegram group.

// group/row: the open row is hl-wash, so its marks turn hl (Marked) to stay visible
const ROW = "group/row grid w-full gap-0.5 px-4 py-2.5 text-left transition-colors duration-(--dur-micro) hover:bg-paper-2";

/** `text` with the server's `marks` ([start, end) in code points) highlighted. */
export function Marked({ text, marks }: { text: string; marks: [number, number][] }) {
  const cp = Array.from(text);
  const out: ReactNode[] = [];
  let at = 0;
  marks.forEach(([a, b], k) => {
    out.push(cp.slice(at, a).join(""), <mark key={k} className="rounded-sm bg-hl-wash px-0.5 text-ink group-aria-[current=true]/row:bg-hl group-aria-[current=true]/row:text-hl-ink">{cp.slice(a, b).join("")}</mark>);
    at = b;
  });
  out.push(cp.slice(at).join(""));
  return <>{out}</>;
}

export const SourceIcon = ({ doc }: { doc: Doc }) =>
  doc.source === "youtrack" ? <YtLogo className="size-4 shrink-0" /> : <FileText aria-hidden className="size-4 shrink-0 text-ink-3" />;

/** "#### Phần 2" → "Phần 2". */
export const headingText = (h: string) => h.replace(/^#+\s*/, "");

export function Results({ q, f, part, syncing, onOpen }: {
  q: string; f: DocFilter; part: number | null; syncing: boolean; onOpen: (doc: number, part: number | null) => void;
}) {
  const t = useT();
  const scope = { ...f, doc: null }; // the list spans every document; the open one is only highlighted
  const list = useQuery({ ...docListQuery(scope), enabled: !q });
  const found = useQuery({ ...docSearchQuery(q, scope), enabled: !!q });
  const cur = q ? found : list;
  const empty = q ? !found.data?.hits.length && !found.data?.messages.length : !list.data?.length;
  // the first sync of an empty store: the scene, not "no documents", until it lands
  const wait = useAiWait(cur.isPending || (syncing && empty));

  let body: ReactNode;
  if (cur.isError) body = <p role="alert" className="px-4 py-6 text-sm text-error">{errorText(cur.error, docErrors())}</p>;
  else if (!cur.data || wait) body = null;
  else if (!q && f.source === "telegram") body = <Empty icon={<MessageCircle />} title={t("Gõ từ khóa để tìm trong tin Telegram")}>{t("Tin của các nhóm đang theo dõi chỉ hiện khi tìm.")}</Empty>;
  else if (empty) body = q
    ? <Empty icon={<SearchX />} title={t("Không thấy đoạn nào khớp")}>{t("Thử từ khác, bỏ bộ lọc, hoặc thêm nguồn ở \"Nguồn\".")}</Empty>
    : <Empty icon={<FileText />} title={t("Chưa có tài liệu")}>{t("Chọn project Knowledge Base hoặc thư mục ở \"Nguồn\".")}</Empty>;
  else body = q ? <Hits hits={found.data?.hits ?? []} messages={found.data?.messages ?? []} cur={[f.doc, part]} onOpen={onOpen} />
    : <ul>{(list.data ?? []).map((d) => <li key={d.id}><DocRow doc={d} on={d.id === f.doc} onOpen={() => onOpen(d.id, null)} /></li>)}</ul>;

  return (
    <section aria-label={t("Kết quả")} className="relative flex min-h-0 flex-1 flex-col">
      {/* the scene covers the visible box from outside the scroll, so it stays centred however far the list scrolled */}
      {wait && <AiFetching kind="docs" cover />}
      <div className={cn("min-h-0 flex-1 overflow-y-auto bg-cotton transition-opacity duration-(--dur-short)", found.isPlaceholderData && "opacity-60")}>{body}</div>
    </section>
  );
}

function DocRow({ doc, on, onOpen }: { doc: Doc; on: boolean; onOpen: () => void }) {
  const t = useT();
  return (
    <button type="button" aria-current={on || undefined} onClick={onOpen} className={cn(ROW, on && "bg-hl-wash hover:bg-hl-wash")}>
      <span className="flex min-w-0 items-center gap-2 text-sm text-ink"><SourceIcon doc={doc} /><span className="truncate">{doc.title || doc.ref}</span></span>
      <span className="truncate pl-6 text-xs text-ink-3">
        {doc.updated_at ? t("cập nhật {d}", { d: fmtDay(doc.updated_at) }) : doc.ref}{doc.tickets.length > 0 && `, ${doc.tickets.slice(0, 3).join(", ")}`}
      </span>
    </button>
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
          <SourceIcon doc={hs[0].doc} /><span className="truncate">{hs[0].doc.title || hs[0].doc.ref}</span>
        </h3>
        <ul>
          {hs.map((h) => {
            const on = cur[0] === h.doc.id && cur[1] === h.part;
            return (
              <li key={h.part}>
                <button type="button" aria-current={on || undefined} onClick={() => onOpen(h.doc.id, h.part)} className={cn(ROW, on && "bg-hl-wash hover:bg-hl-wash")}>
                  {h.heading && <span className="truncate text-xs text-ink-3">{headingText(h.heading)}</span>}
                  <span className="line-clamp-3 text-sm leading-relaxed text-ink"><Marked text={h.text} marks={h.marks} /></span>
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
              <span className="line-clamp-3 text-sm leading-relaxed"><Marked text={m.text} marks={m.marks} /></span>
            </Link>
          </li>
        ))}
      </ul>
    </>}
  </>;
}
