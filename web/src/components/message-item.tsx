"use client";

import { type QueryClient, queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlarmClock, Bot, Check, CheckCheck, ClipboardList, CornerDownRight, ExternalLink, FolderGit2, Globe, Hash, Loader2, MessageCircleQuestion, MessageSquarePlus, MessagesSquare, MoreHorizontal, Paperclip, PenLine, Pin, RotateCcw, Star, UserX, Users } from "lucide-react";
import { memo, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Menu } from "@base-ui/react/menu";
import { Avatar, hueOf } from "@/components/chat-list";
import { CommentDialog } from "@/components/composer-dialogs";
import { DeepBadge, DeepPick, useDeepTask } from "@/components/deep-think";
import { Markdown } from "@/components/markdown";
import { RemindSubmenu } from "@/components/remind";
import { Button } from "@/components/ui/button";
import { Hint } from "@/components/ui/hint";
import { Kbd } from "@/components/ui/kbd";
import { Skeleton } from "@/components/ui/skeleton";
import { api, errorText, type Message, statusQuery, type Task } from "@/lib/api";
import { attach, messageQuery, sameRef } from "@/lib/attach";
import { answerQa, QaCodes, copyText, dbId, ignoreSender, msgKey, prioritizeSender, openInTelegram, openQa, openTask, PartialError, pin, QA_CODE, sessionId, SESSION_CODE, setHandled, smooth, snooze, EVENT_SNOOZE_MS, taskListQuery, telegramLink, toast, useHasDraft, waitLabel } from "@/lib/inbox";
import { ago, clockLabel, fromVnInput, snoozeChoices, timeLabel, vnInput } from "@/lib/time";
import { readOverdueHours, useRole } from "@/lib/prefs";
import { useRetest, yt, ytDetailQuery, ytProjectsQuery } from "@/lib/yt";
import { cn } from "@/lib/utils";

const MEDIA: Record<string, string> = {
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
const TICKET_IDS = /(?<![\w-])[A-Z][A-Z0-9]{1,9}-\d{1,6}(?!\w)/g;
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

/** VA-123 of a known YouTrack project: a chip that opens the ticket sheet. Hover / focus shows a peek card (summary,
 *  state, priority, assignee, last update) with links to the YouTrack module and to YouTrack itself, so a reply needn't
 *  leave Telegram to check a ticket. */
export function TicketChip({ id }: { id: string }) {
  const [hover, setHover] = useState(false);
  const projects = useQuery(ytProjectsQuery);
  const d = useQuery({ ...ytDetailQuery(id), retry: false, enabled: hover });
  const base = useQuery({ queryKey: ["yt", "config"], queryFn: yt.config, staleTime: Infinity, enabled: hover }).data?.base;
  if (!projects.data?.some((p) => p.shortName === id.split("-")[0])) return id;
  const t = d.data;
  return (
    <span className="relative" onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)} onFocus={() => setHover(true)} onBlur={() => setHover(false)}
      onKeyDown={(e) => { if (e.key === "Escape" && hover) { e.stopPropagation(); setHover(false); } }}>
      <a href={`/youtrack/?ticket=${id}`} aria-describedby={hover ? `peek-${id}` : undefined}
        className={cn(codeCls, "font-semibold no-underline hover:bg-hl-wash hover:text-hl-2 hover:ring-hl/30", t?.resolved && "line-through")}>{id}</a>
      {hover && (
        // pt, not mt: the pointer crosses into the card without leaving the chip's box.
        <span className="absolute top-full left-0 z-30 pt-1">
          <span id={`peek-${id}`} className="grid w-80 gap-2 rounded-md bg-cotton p-3 text-xs leading-snug whitespace-normal text-ink-2 shadow-pop animate-in fade-in-0 duration-(--dur-micro)">
            {t ? (
              <>
                <span className="line-clamp-3 text-sm font-medium text-ink">{t.summary || id}</span>
                <span className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5">
                  <span className="text-ink-3">Trạng thái</span><span className={cn("truncate", t.resolved && "text-ok")}>{t.state || "—"}</span>
                  <span className="text-ink-3">Ưu tiên</span><span className="truncate">{t.priority || "—"}</span>
                  <span className="text-ink-3">Người làm</span><span className="truncate">{t.assignee || "Chưa assign"}</span>
                  {t.qc && <><span className="text-ink-3">QC</span><span className="truncate">{t.qc}</span></>}
                  <span className="text-ink-3">Cập nhật</span><span className="font-mono tabular-nums">{ago(t.updated)}</span>
                </span>
                <span className="flex flex-wrap gap-x-3 border-t border-rule pt-1.5">
                  <a href={`/youtrack/?ticket=${id}`} className={linkCls}>Mở ở trang YouTrack</a>
                  {base && <a href={`${base.replace(/\/$/, "")}/issue/${id}`} target="_blank" rel="noreferrer" className={cn(linkCls, "inline-flex items-center gap-1")}>
                    Mở trong YouTrack<ExternalLink className="size-3" aria-hidden /></a>}
                </span>
              </>
            ) : d.isError ? d.error.message || "Không tải được ticket" : "Đang tải…"}
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
  bold: "font-semibold", italic: "italic", underline: "underline underline-offset-2", strike: "line-through",
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

export type MessageItemProps = {
  m: Message;
  head: boolean;
  clock?: boolean; // a day separator above already says the day: show just "16:12"
  now: number;
  focused?: boolean;
  groupTitle?: string; // shown in the cross-group inbox
  isReplyTarget: boolean;
  tasks?: Task[];
  onReply: (m: Message) => void;
  onUseText: (m: Message, text: string) => void; // put a task result into the composer
  live?: boolean; // read live from Telegram, not stored: no tag actions, no reply panel
  liveReply?: boolean; // live, yet a click still picks it to reply to (Q&A threads)
  fresh?: boolean; // arrived since you last looked (Q&A threads): a "Mới" pill
  bare?: boolean; // Q&A thread: no ID, "trả lời #…" or #QA badge (the order is the chain, the thread names its code)
  extra?: React.ReactNode; // a page's own control before the row actions (Q&A: "Chốt" this answer)
  picked?: boolean; // in the to-do list's multi-selection
  onPick?: (m: Message) => void; // Shift+click: add to / drop from the selection
};

/** Memoised: lists re-render on every count / SSE change, a row only when its own props change. */
export const MessageItem = memo(function MessageItem(props: MessageItemProps) {
  const { m } = props;
  if (m.deleted) {
    return (
      <li data-testid="message" data-id={m.message_id} data-key={msgKey(m)} className="py-2 pr-4 pl-[calc(1rem+2.75rem)] text-xs text-ink-3 @xl:pl-[calc(1.25rem+2.75rem)]">
        Tin #{m.message_id} đã bị xóa.
      </li>
    );
  }
  return <MessageRow {...props} />;
});

function MessageRow({
  m, head, clock, now, focused, groupTitle, isReplyTarget, tasks, onReply, onUseText, live, liveReply, fresh, bare, extra, picked, onPick,
}: MessageItemProps) {
  const hasDraft = useHasDraft(m);
  const [showContext, setShowContext] = useState(false);
  const [photoFailed, setPhotoFailed] = useState(false);
  const name = m.outgoing ? "Bạn" : (m.sender_name ?? "Không rõ");
  const done = m.handled;
  const snoozed = !done && m.snoozed_until && new Date(m.snoozed_until).getTime() > now;
  const wait = !live && !m.outgoing && !done && !snoozed ? waitLabel(m.date, now, !!m.priority) : null;
  const photo =`/api/chats/${encodeURIComponent(m.chat_id)}/messages/${m.message_id}/photo`;

  const retest = useRetest(m.text, useRole() === "qa" && !m.outgoing && !done);
  const selected = !!focused || isReplyTarget;
  const quiet = !m.outgoing && (done || snoozed);
  const priority = !!m.priority && !m.outgoing && !done; // a sender you put first (Cài đặt › Telegram)
  const opens = !live || !!liveReply; // a click / Enter opens the reply panel
  // The j/k cursor is real focus (screen readers follow it), unless you are typing or in a menu / dialog.
  const row = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (focused && opens && !document.activeElement?.closest("input, textarea, select, [contenteditable], [role=dialog], [role=menu]")) row.current?.focus({ preventScroll: true });
  }, [focused, opens]);

  return (
    <li
      ref={row}
      data-testid="message"
      data-id={m.message_id}
      data-key={msgKey(m)}
      data-selected={selected}
      tabIndex={opens ? 0 : undefined}
      aria-current={isReplyTarget ? "true" : undefined}
      className={cn(
        "group/row relative grid grid-cols-[2rem_minmax(0,1fr)] gap-x-3 px-4 py-3 animate-in fade-in-0 transition-colors duration-(--dur-short) hover:bg-paper-2 focus-visible:-outline-offset-2 @xl:px-5",
        selected && "bg-linear-to-r from-hl-wash to-hl-wash/35 before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:bg-hl",
        picked && "bg-hl-wash/60 ring-2 ring-inset ring-hl",
        !head && !groupTitle && "pt-1.5",
        opens && "cursor-pointer",
      )}
      onKeyDown={(e) => {
        // Enter on the row itself (Tab or j/k focus); preventDefault keeps the list's own Enter from replying twice.
        if (e.key !== "Enter" || e.target !== e.currentTarget || !opens) return;
        e.preventDefault();
        onReply(m);
      }}
      onClick={(e) => {
        // Click anywhere on the row opens the reply panel (not on links/buttons or while selecting text).
        if ((e.target as HTMLElement).closest("a,button,select,input,label")) return; // a control's own click
        const sel = window.getSelection();
        if (e.shiftKey && onPick) {
          sel?.removeAllRanges(); // Shift+click also extends a text selection
          return onPick(m);
        }
        const selecting = !!sel?.toString() && !!sel.anchorNode && e.currentTarget.contains(sel.anchorNode);
        if (!opens || selecting) return;
        onReply(m);
      }}
    >
      {/* Gutter: the sender's avatar opens a run of their messages. */}
      <div className="pt-0.5">
        {picked ? <span className="grid size-8 place-items-center rounded-full bg-hl text-hl-ink"><Check className="size-4" role="img" aria-label="Đã chọn" /></span>
          : (head || groupTitle) && <Avatar name={name} className="size-8 text-xs" />}
      </div>

      <div className="min-w-0">
        {/* Header, beside the avatar. Line 1: who, in which group, the tag's state. Line 2: when, and the message it
            answers. How long it has waited sits right after the group; the right strip holds the hover actions. Badges
            (retest, draft, sessions, #QA) sit in one quiet row under the text; the ID lives in the ⋯ menu. */}
        {/* Wraps: on a narrow row (phone, Q&A card, the split list) the strip drops below the header instead of squeezing the name. */}
        <div className="mb-1 flex flex-wrap items-start gap-x-3 gap-y-1.5">
          <div className="grid min-w-0 flex-1 basis-44 gap-0.5">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 empty:hidden">
            {(head || groupTitle) && (
              <span className={cn("min-w-0 truncate text-sm font-semibold", m.outgoing && "text-ink-2")}
                style={m.outgoing ? undefined : { color: nameColor(name) }}>{name}</span>
            )}
            {fresh && <span className={cn(PILL, "bg-hl text-hl-ink")}>Mới</span>}
            {priority && (
              <Hint side="bottom" text="Người gửi bạn đặt ưu tiên: tag của họ lên đầu danh sách và quá hạn sớm hơn.">
                <span className={cn(PILL, "bg-signal-wash text-signal-2")}><Star className="size-3 fill-current" aria-hidden />Ưu tiên</span>
              </Hint>
            )}
            {m.pinned && (head || groupTitle) && <Pin className="size-3.5 shrink-0 fill-current text-ink-2" role="img" aria-label="Đã ghim" />}
            {groupTitle && (
              <span className="inline-flex min-w-0 max-w-full items-center gap-1 text-xs text-ink-3">
                <Users className="size-3 shrink-0" aria-hidden /><span className="truncate">{groupTitle}</span>
              </span>
            )}
            {wait && (
              // Beside the group: how long it has waited; overdue reads as a signal pill (shape + colour, not colour alone).
              <Hint side="bottom" text={wait.overdue ? `Quá hạn: đã chờ hơn ${readOverdueHours()} giờ, chưa xử lý` : `Đã chờ ${wait.n} ${wait.unit}, chưa xử lý`}>
                <span className={cn("inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-1.5 text-xs", wait.overdue ? "bg-signal-wash font-medium text-signal-2" : "text-ink-3")}>
                  <span className="sr-only">{wait.overdue ? "Quá hạn, đã chờ" : "Đã chờ"} </span>
                  <span className="font-mono tabular-nums">{wait.n}</span>{wait.unit}
                </span>
              </Hint>
            )}
            {!m.outgoing && (done ? (
              <Hint side="bottom" title={m.handled_at ? `Xong lúc ${timeLabel(m.handled_at, true)}` : "Đã xử lý"} text={DONE_BY[m.handled_by]}>
                <span className={cn(PILL, "bg-ok-wash text-ok")}><CheckCheck className="size-3" aria-hidden />Đã xử lý</span>
              </Hint>
            ) : snoozed && (
              <Hint side="bottom" text={`Đang hoãn: nhắc lại lúc ${timeLabel(m.snoozed_until!, true)}`}>
                <span className={cn(PILL, "bg-info-wash text-info")}>
                  <AlarmClock className="size-3" aria-hidden />Nhắc <span className="font-mono tabular-nums">{timeLabel(m.snoozed_until!)}</span>
                </span>
              </Hint>
            ))}
          </div>
            <span className="flex min-w-0 flex-wrap items-center gap-x-2 text-xs leading-5 text-ink-3">
              <time dateTime={m.date} title={timeLabel(m.date, true)} className="whitespace-nowrap font-mono tabular-nums">
                {clock ? clockLabel(m.date) : timeLabel(m.date)}
              </time>
              {m.edit_date && <span>đã sửa</span>}
              {m.reply_to_id && !bare && (
                <Hint side="bottom" text="Tới tin gốc trong danh sách">
                  <button type="button" aria-label={`Tới tin gốc #${m.reply_to_id}`} onClick={(e) => jumpTo(e.currentTarget, m.reply_to_id!)}
                    className="inline-flex items-center gap-1 rounded-sm hover:text-hl-2">
                    <CornerDownRight className="size-3" aria-hidden />tin gốc
                  </button>
                </Hint>
              )}
            </span>
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-1.5 text-xs leading-5">
            {extra}
            <RowActions m={m} tag={!m.outgoing && !live} showContext={showContext} onToggleContext={() => setShowContext((v) => !v)} />
          </div>
        </div>
        {m.media_kind === "photo" && !photoFailed ? (
          <a href={photo} target="_blank" rel="noreferrer" className="my-1.5 block w-fit">
            {/* eslint-disable-next-line @next/next/no-img-element -- local API image, static export */}
            <img src={photo} alt="Ảnh trong tin" loading="lazy" onError={() => setPhotoFailed(true)}
              className="max-h-64 rounded-md border border-rule object-contain" />
          </a>
        ) : (
          m.media_kind && <p className="text-xs text-ink-3">[{MEDIA[m.media_kind] ?? "Tệp đính kèm"}, chưa tải]</p>
        )}
        {m.text && <MessageText m={m} dim={quiet || m.outgoing} />}
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 empty:hidden">
          {retest.length > 0 && (
            <Hint side="bottom" text={`Bạn là QC của ${retest.join(", ")} và tin này báo đã fix / có build: cần test lại`}>
              <span className={cn(PILL, "bg-warn-wash text-warn")}><RotateCcw className="size-3" aria-hidden />Cần retest</span>
            </Hint>
          )}
          {hasDraft && !live && (
            <Hint side="bottom" text="Có nháp trả lời chưa gửi (lưu trên máy này)">
              <span className={cn(PILL, "bg-hl-wash text-hl-2")}><PenLine className="size-3" aria-hidden />Nháp</span>
            </Hint>
          )}
          <DeepBadge m={m} />
          <AnswersFor m={m} qa={!bare} />
        </div>
        {tasks?.map((t) => (
          <div key={t.id} className="mt-2 rounded-md bg-paper-3/60 px-3 py-2 text-xs">
            <p className="flex flex-wrap items-center gap-x-3 gap-y-0.5 font-medium text-ink-2">
              <span className="inline-flex items-center gap-1">
                {t.result ? <ClipboardList className="size-3.5" aria-hidden /> : <Loader2 className="size-3.5 animate-spin" aria-hidden />}
                Task {t.result ? "đã có kết quả" : "đang làm…"}
              </span>
              <span className="inline-flex items-center gap-1 font-normal text-ink-3"><FolderGit2 className="size-3" aria-hidden /> {t.project.split("/").pop()}</span>
              <Hint side="bottom" text="Mã phiên AI Agent. Bấm để chép, dán vào tin nhóm để tin sau tự đính kèm đúng phiên.">
                <button type="button" onClick={() => void copyText(`#${sessionId(t)}`, `Đã chép mã phiên #${sessionId(t)}`)}
                  className="inline-flex items-center gap-1 rounded-sm font-mono font-normal text-ink-3 transition-colors duration-(--dur-micro) hover:text-ink">
                  <Hash className="size-3" aria-hidden />{sessionId(t)}
                </button>
              </Hint>
              <Hint side="bottom" text="Mở lại phiên AI này ở trang AI Agent">
                <button type="button" onClick={() => openTask(t.id)}
                  className="ml-auto inline-flex items-center gap-1 rounded-sm font-normal text-ink-3 transition-colors duration-(--dur-micro) hover:text-ink">
                  <Bot className="size-3.5" aria-hidden /> Mở phiên
                </button>
              </Hint>
            </p>
            {t.result && (
              <>
                <Markdown text={t.result} className="mt-1 line-clamp-4 text-[length:inherit] text-ink-2" />
                <Button size="xs" variant="link" className="mt-0.5 h-auto px-0" onClick={() => onUseText(m, t.result!)}>
                  Dùng kết quả làm nháp trả lời
                </Button>
              </>
            )}
          </div>
        ))}
        {showContext && <ContextPanel m={m} reveal />}
      </div>
    </li>
  );
}

/** Why a tag is done (the "Đã xử lý" pill's hint); only "me" left a reaction on Telegram. */
const DONE_BY: Record<Message["handled_by"], string> = {
  me: "Bạn bấm Xong, đã thả reaction trên Telegram.",
  quiet: "Bạn bấm Xong không thả reaction (Shift+Xong / Shift+x).",
  reply: "Bạn đã trả lời tin này trên Telegram (từ máy nào cũng tính): tự xong, không thả reaction.",
  dashboard: "Bạn gửi trả lời từ dashboard: tự xong, không thả reaction.",
  all: "Đánh dấu bằng \"Xong tất cả\" của nhóm: không thả reaction để tránh spam Telegram.",
  rule: "Rule tự bỏ qua (người gửi / từ khoá trong Cài đặt Telegram): không thả reaction.",
  "": "Đánh dấu trước khi app bắt đầu ghi lại cách xong.",
};

/** Status / badge pill in the row header. */
const PILL = "inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 text-xs leading-5 font-medium";

/** Thin rule between action groups in the hover strip. */
const Sep = () => <span aria-hidden className="mx-1 h-4 w-px shrink-0 bg-rule-2" />;

/** Hover strip, laid out right to left: the first child (Xong; Đối chiếu BE on your own / live messages) sits at the
 *  edge and the rest tuck behind it until the row is hovered or selected (globals.css; always shown per Settings and on
 *  touch screens); always in the tab order. Groups: Xong | Hoãn, Ngữ cảnh | AI | ⋯ (rarer actions, spelled out with
 *  their keys). Replying is a click on the row (or Enter / r). Negative margin so the 30px targets don't make the line taller. */
function RowActions({ m, tag, showContext, onToggleContext }: { m: Message; tag: boolean; showContext: boolean; onToggleContext: () => void }) {
  const { done, pinned, mark, togglePin } = useTagMark(m);
  const [comment, setComment] = useState(false);
  const yt = useQuery({ ...statusQuery, staleTime: Infinity }).data?.youtrack_configured; // the shell keeps it fresh
  const link = telegramLink(m);
  return (
    <div role="toolbar" aria-label={`Thao tác tin #${m.message_id}`} className="row-actions flex flex-row-reverse items-center gap-0.5 -my-1.5">
      {tag && (
        <>
          <Hint side="bottom" title={done ? "Mở lại (x)" : "Xong (x)"}
            text={done ? "Đánh dấu chưa xử lý." : "Không cần trả lời / đã xử lý nơi khác; thả reaction trên Telegram. Không thả reaction: Shift+bấm (Shift+x) hoặc menu ⋯."}>
            <Button type="button" size="xs" variant="ghost" aria-busy={mark.isPending} disabled={mark.isPending} aria-label={done ? "Mở lại" : "Xong"}
              className={cn("font-medium", !done && "text-ok hover:bg-ok-wash hover:text-ok")}
              onClick={(e) => mark.mutate({ handled: !done, react: !e.shiftKey })}>
              {done ? <RotateCcw /> : <CheckCheck />}<span className="row-label">{done ? "Mở lại" : "Xong"}</span>
            </Button>
          </Hint>
          <Sep />
          {!done && <SnoozeMenu ms={[m]} />}
          <Hint side="bottom" title="Ngữ cảnh" text="Xem các tin trước / sau trong nhóm.">
            <Button type="button" size="icon-xs" variant="ghost" className={cn(showContext && "bg-paper-3 text-ink")}
              aria-label="Ngữ cảnh" aria-expanded={showContext} onClick={onToggleContext}>
              <MessagesSquare />
            </Button>
          </Hint>
          <Sep />
        </>
      )}
      <DeepPick m={m} className="hover:bg-hl-wash hover:text-hl-2" />
      <AttachPick m={m} />
      <Sep />
      <Menu.Root>
        {/* Opens on hover (no Hint: the menu itself spells every action out); click / Enter still work. */}
        <Menu.Trigger aria-label="Thêm thao tác" openOnHover delay={150} closeDelay={200} onClick={(e) => e.stopPropagation()}
          render={<Button type="button" size="icon-xs" variant="ghost" className="data-popup-open:bg-paper-3 data-popup-open:text-ink" />}>
          <MoreHorizontal />
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Positioner sideOffset={6} align="end" className="z-50 outline-none">
            {/* Portalled, but React events still bubble to the row: a click here must not open the reply panel. */}
            <Menu.Popup onClick={(e) => e.stopPropagation()} className={cn(MENU_POPUP, "w-72 text-sm")}>
              {tag && !done && (
                <MoreItem icon={<Check />} keys="⇧ X" disabled={mark.isPending} onClick={() => mark.mutate({ handled: true, react: false })}>Xong, không thả reaction</MoreItem>
              )}
              {tag && (
                <MoreItem icon={<Pin className={cn(pinned && "fill-current")} />} keys="P" disabled={togglePin.isPending} onClick={() => togglePin.mutate()}>
                  {pinned ? "Bỏ ghim" : "Ghim lên đầu"}
                </MoreItem>
              )}
              {tag && yt && <MoreItem icon={<MessageSquarePlus />} onClick={() => setComment(true)}>Comment vào ticket YouTrack</MoreItem>}
              {tag && done && <RemindSubmenu m={m} />}
              {tag && <Menu.Separator className="my-0.5 h-px bg-rule" />}
              {!m.outgoing && <MoreItem icon={<MessageCircleQuestion />} onClick={() => answerQa(m)}>Trả lời bằng Q&A</MoreItem>}
              <MoreItem icon={<ExternalLink />} keys="O" onClick={() => openInTelegram(m)}>{link.exact ? "Mở trong Telegram" : "Mở nhóm trên Telegram Web"}</MoreItem>
              {link.exact && <MoreItem icon={<Globe />} onClick={() => window.open(link.web, "_blank", "noreferrer")}>Mở bằng Telegram Web</MoreItem>}
              <MoreItem icon={<Hash />} onClick={() => void copyText(dbId(m), `Đã chép ID ${dbId(m)}, dán vào phiên AI để đính kèm`)}>Chép ID tin</MoreItem>
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>
      {comment && (
        <span className="contents" onClick={(e) => e.stopPropagation()}>
          <CommentDialog m={m} open onOpenChange={setComment} onDone={() => setComment(false)} />
        </span>
      )}
    </div>
  );
}

function MoreItem({ icon, keys, children, ...rest }: { icon: React.ReactNode; keys?: string; children: React.ReactNode; disabled?: boolean; onClick: () => void }) {
  return (
    <Menu.Item {...rest} className={cn("flex items-center gap-2.5 text-ink-2 data-highlighted:text-ink data-disabled:opacity-50 [&_svg]:size-3.5 [&_svg]:shrink-0 [&_svg]:text-ink-3", MENU_ITEM)}>
      {icon}<span className="min-w-0 flex-1 truncate">{children}</span>{keys && <Kbd>{keys}</Kbd>}
    </Menu.Item>
  );
}

/** Row button: attach this message to the next prompt of a Doing AI Agent session, Giao AI Agent or Đối chiếu BE
 *  (this group's first). Always shown, so the feature is found; with no Doing session the menu says so. The session
 *  list lives in the popup, so rows don't each watch the task list. */
/** Session id tails named in a text ("#REF-97c501", or the old "#AI-…"), lowercase. */
const sessionTails = (text?: string | null) => [...(text ?? "").matchAll(SESSION_CODE)].map((x) => x[1].toLowerCase());
const qaIds = (text?: string | null) => [...(text ?? "").matchAll(QA_CODE)].map((x) => x[1]);

const CHAIN_MAX = 12; // ponytail: ancestors read one by one (cached per message); a deeper thread stops here

/** The session (#REF-…) and Q&A (#QA…) a message answers: the nearest one named by it or any message up its reply chain
 *  (a BE answer often replies to a reply to the copied ask). `at`: the message naming the session. Read on hover only. */
const chainQuery = (qc: QueryClient, m: Message) => queryOptions({
  queryKey: ["reply-chain", m.chat_id, m.message_id],
  queryFn: async () => {
    let tails: string[] = [], qas: string[] = [], at = "";
    let cur: Message | null = m;
    for (let i = 0; cur; i++) {
      if (!tails.length && (tails = sessionTails(cur.text)).length) at = cur.message_id;
      if (!qas.length) qas = qaIds(cur.text);
      if ((tails.length && qas.length) || !cur.reply_to_id || i >= CHAIN_MAX) break;
      const up: string = cur.reply_to_id;
      cur = await qc.fetchQuery(messageQuery({ chat_id: m.chat_id, message_id: up })).catch((e) => {
        if (!tails.length && !qas.length) throw e; // nothing found yet: an unread chain is an error, not "no session"
        return null; // a deleted ancestor ends the walk with what was found below it
      });
    }
    return { tails, qas, at };
  },
  staleTime: 60_000,
  retry: false,
});

/** The open session a message's reply chain names, if any. */
const findSession = (ts: Task[] | undefined, tails: string[]) =>
  ts?.filter((t) => t.mode !== "terminal").findLast((t) => tails.includes(t.id.slice(-6).toLowerCase()));

/** Badges for what this message answers: the AI Agent session and the Q&A questions it names, from its own text (no
 *  reads), plus the Q&A thread it sits in when the groups asked lately were read (`QaCodes`). A session badge opens the session, its clip attaches the message; a Q&A badge opens the question. A code
 *  only in the replied-to message is read when the row's clip (AttachPick) is hovered, never on render. */
function AnswersFor({ m, qa }: { m: Message; qa: boolean }) {
  const qc = useQueryClient();
  const own = useMemo(() => sessionTails(m.text), [m.text]);
  const inThread = useContext(QaCodes).get(msgKey(m))?.slice(3); // a reply in a thread, code or not
  const chained = useQuery({ ...chainQuery(qc, m), enabled: false }).data?.qas; // filled once the clip was hovered
  const qas = useMemo(() => qa ? [...new Set(qaIds(m.text).concat(inThread ?? [], chained ?? []))] : [], [m.text, inThread, chained, qa]);
  return <>
    {own.length > 0 && <SessionBadge m={m} tails={own} />}
    {qas.map((id) => (
      <Hint key={id} side="bottom" text={`Tin này thuộc Q&A #QA${id}. Bấm để mở cả chuỗi ở trang Q&A.`}>
        <button type="button" onClick={() => openQa(m.chat_id, `#QA${id}`)}
          className={cn(PILL, "bg-info-wash text-info transition-colors duration-(--dur-micro) hover:bg-info hover:text-cotton")}>
          <MessageCircleQuestion className="size-3" aria-hidden /><span className="font-mono">#QA{id}</span>
        </button>
      </Hint>
    ))}
  </>;
}

function SessionBadge({ m, tails }: { m: Message; tails: string[] }) {
  const t = findSession(useQuery(taskListQuery).data, tails);
  if (!t) return null;
  const name = sessionId(t);
  return (
    <span className={cn(PILL, "gap-0 overflow-hidden bg-hl-wash p-0 text-hl-2 ring-1 ring-inset ring-hl/30")}>
      <Hint side="bottom" title={name} text={`Tin này có mã phiên AI Agent ${name}${t.title ? ` (${t.title})` : ""}. Bấm để mở phiên.`}>
        <button type="button" onClick={() => openTask(t.id)} className="inline-flex items-center gap-1 py-px pr-1.5 pl-2 transition-colors duration-(--dur-micro) hover:bg-hl hover:text-hl-ink">
          <Bot className="size-3" aria-hidden /><span className="font-mono">{name}</span>
        </button>
      </Hint>
      <Hint side="bottom" text={`Đính kèm tin này vào lượt nhắn tiếp của phiên ${name}`}>
        <button type="button" aria-label={`Đính kèm vào phiên ${name}`} onClick={() => attachTo(t, m)}
          className="grid place-items-center self-stretch border-l border-hl/30 px-1.5 transition-colors duration-(--dur-micro) hover:bg-hl hover:text-hl-ink">
          <Paperclip className="size-3" aria-hidden />
        </button>
      </Hint>
    </span>
  );
}

function attachTo(t: Task, m: Message) {
  const name = sessionId(t);
  const ok = attach(t.id, [{ chat_id: m.chat_id, message_id: m.message_id }]).some((r) => sameRef(r, m));
  toast({ text: ok ? `Đã đính kèm #${m.message_id} vào phiên ${name}` : `Phiên ${name} đã đủ tin đính kèm cho lượt tới` });
  openTask(t.id);
}

/** A message naming a session (#REF-…) attaches to it at once; otherwise the menu of open sessions. */
function AttachPick({ m }: { m: Message }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  // Hovering (or focusing) the clip walks the reply chain once for a session / Q&A code (cached, shared with AnswersFor).
  const [peek, setPeek] = useState(false);
  const own = useMemo(() => sessionTails(m.text), [m.text]);
  const parent = useQuery({ ...chainQuery(qc, m), enabled: peek && !!m.reply_to_id });
  const tails = own.length ? own : parent.data?.tails ?? [];
  const named = useQuery({ ...taskListQuery, enabled: peek && tails.length > 0, select: (ts) => findSession(ts, tails) }).data;
  const name = named && sessionId(named);
  const where = own.length || parent.data?.at === m.message_id ? "tin này"
    : parent.data?.at === m.reply_to_id ? "tin gốc nó trả lời" : `tin #${parent.data?.at} trong chuỗi trả lời`;
  const toggle = (next: boolean) => {
    if (!next) return setOpen(false);
    if (named) return attachTo(named, m);
    void Promise.all([qc.fetchQuery(chainQuery(qc, m)), qc.ensureQueryData(taskListQuery)]).catch(() => undefined)
      .then((r) => { const t = r && findSession(r[1], r[0].tails); return t ? attachTo(t, m) : setOpen(true); });
  };
  return (
    <Menu.Root open={open} onOpenChange={toggle}>
      <Hint side="bottom" title={name || undefined} text={named
        ? `Bấm để đính kèm tin này vào phiên ${name}${named.title ? ` (${named.title})` : ""}: ${where} có mã phiên đó.`
        : parent.isFetching ? "Đang đọc chuỗi trả lời tìm mã phiên #REF-… / #QA…"
        : parent.isError ? errorText(parent.error, { not_connected: "Chưa kết nối Telegram", message_not_found: "Không tìm thấy tin gốc" }, "Không đọc được chuỗi trả lời").trim()
        : "Đính kèm tin này vào lượt nhắn tiếp của một phiên AI Agent. Tin (hoặc tin nào trong chuỗi trả lời) có mã #REF-… thì tự vào đúng phiên đó."}>
        <Menu.Trigger aria-label={name ? `Đính kèm vào phiên ${name}` : "Đính kèm vào phiên AI"} aria-busy={parent.isFetching}
          onClick={(e) => e.stopPropagation()} onPointerEnter={() => setPeek(true)} onFocus={() => setPeek(true)}
          className={cn("relative inline-flex h-[30px] min-w-[30px] items-center justify-center gap-1 rounded-md text-ink-2 transition-colors duration-(--dur-micro) pointer-coarse:after:absolute pointer-coarse:after:-inset-1.5 hover:bg-hl-wash hover:text-hl-2 data-popup-open:bg-hl-wash data-popup-open:text-hl-2",
            named && "bg-hl-wash px-2 text-hl-2")}>
          {parent.isFetching ? <Loader2 className="size-3.5 animate-spin" aria-hidden />
            : named ? <><Bot className="size-3.5" aria-hidden /><span className="font-mono text-[0.6875rem]">{name}</span></>
            : <Paperclip className="size-3.5" aria-hidden />}
        </Menu.Trigger>
      </Hint>
      <Menu.Portal>
        <Menu.Positioner sideOffset={6} align="end" className="z-50 outline-none">
          {/* Portalled, but React events still bubble to the row: a click here must not open the reply panel. */}
          <Menu.Popup onClick={(e) => e.stopPropagation()} className={MENU_POPUP}>
            <AttachList m={m} />
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

const MENU_POPUP = "grid origin-(--transform-origin) gap-0.5 rounded-lg bg-cotton p-1 shadow-pop outline-none transition-[transform,opacity] duration-(--dur-short) ease-(--ease-out) data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0";
const MENU_ITEM = "cursor-default rounded-md px-2.5 py-1.5 outline-none select-none data-highlighted:bg-paper-2";

function AttachList({ m }: { m: Message }) {
  const open = (useQuery(taskListQuery).data ?? []).filter((t) => t.mode !== "terminal" && !t.handled)
    .sort((a, b) => Number(b.chat_id === m.chat_id) - Number(a.chat_id === m.chat_id)) // stable: newest first within
    .slice(0, 8);
  return (
    <div className="grid w-72 gap-0.5">
            <p className="px-2.5 pt-1 pb-0.5 text-xs text-ink-3">Đính kèm #{m.message_id} vào phiên</p>
            {!open.length && (
              <p className="px-2.5 pb-1.5 text-xs leading-relaxed text-ink-2">
                Chưa có phiên nào đang làm (Doing). Với phiên đã Done: chép ID tin (menu ⋯ › Chép ID tin) rồi dán vào ô nhắn của phiên đó.
              </p>
            )}
            {open.map((t) => (
              <Menu.Item key={t.id} onClick={() => attachTo(t, m)} className={cn("grid gap-0.5", MENU_ITEM)}>
                <span className="truncate text-sm font-medium text-ink">{t.title || t.message_text || t.prompt}</span>
                <span className="flex min-w-0 items-center gap-2 text-xs text-ink-3">
                  {t.running && <Loader2 className="-mr-1 size-3 shrink-0 animate-spin text-hl-2" aria-label="Đang chạy" />}
                  <span className="shrink-0 font-mono tabular-nums">{sessionId(t)}</span>
                  <span className="shrink-0">{t.kind === "deep" ? "Đối chiếu BE" : "Giao AI Agent"}</span>
                  <span className="truncate">{t.chat_title || t.project.split("/").pop()}</span>
                  {t.chat_id === m.chat_id && <span className="shrink-0 rounded-full bg-paper-3 px-1.5 leading-4">nhóm này</span>}
                </span>
              </Menu.Item>
            ))}
    </div>
  );
}

/** Like Telegram's reply header: scroll to the quoted message when it is in this list and flash it. */
function jumpTo(from: Element, id: string) {
  if (!revealMessage(from.closest("ol"), id)) toast({ text: `Tin #${id} không có trong danh sách (chỉ lưu tin tag/reply bạn)` });
}

/** Center message `id` under `root` (a long one from its top) and flash it; false when it is not rendered there. */
export function revealMessage(root: ParentNode | null | undefined, id: string) {
  const el = root?.querySelector<HTMLElement>(`[data-testid="message"][data-id="${CSS.escape(id)}"]`);
  if (!el) return false;
  el.scrollIntoView({ block: el.offsetHeight > innerHeight / 2 ? "start" : "center", behavior: smooth() });
  el.animate([{ backgroundColor: "var(--color-hl-wash)" }, { backgroundColor: "transparent" }], { duration: 1600, easing: "ease-out" });
  return true;
}

function MessageText({ m, dim }: { m: Message; dim: boolean }) {
  const body = useMemo(() => richText(m), [m]);
  return (
    <p className={cn("whitespace-pre-wrap break-words text-[0.9375rem] leading-[1.55]", dim ? "text-ink-2" : "text-ink")}>
      {body}
    </p>
  );
}

/** Xong / pin state and mutations of one tag, for the hover strip and the reply panel header. */
function useTagMark(m: Message, onDone?: () => void) {
  // Local overrides keep the buttons right when `m` is a stale snapshot (reply panel). The handled override
  // only holds while m.handled is still what it was when we clicked, so an undo from the toast shows through.
  const [over, setOver] = useState<{ handled?: boolean; from?: boolean; pinned?: boolean }>({});
  // The server copy moved (SSE refresh, an undo): it wins over what we last clicked.
  const [seen, setSeen] = useState([m.handled, m.pinned]);
  if (seen[0] !== m.handled || seen[1] !== m.pinned) {
    setSeen([m.handled, m.pinned]);
    setOver({});
  }
  const done = over.handled !== undefined && over.from === m.handled ? over.handled : m.handled;
  const pinned = over.pinned ?? m.pinned;
  // Other changes come back through SSE, which refreshes lists and counts.
  const mark = useMutation({
    mutationFn: ({ handled, react = true }: { handled: boolean; react?: boolean }) => setHandled([m], handled, react),
    onSuccess: (_, { handled }) => {
      setOver((o) => ({ ...o, handled, from: m.handled }));
      if (handled) onDone?.();
    },
  });
  const togglePin = useMutation({
    mutationFn: () => pin(m, !pinned),
    onSuccess: () => setOver((o) => ({ ...o, pinned: !pinned })),
    onError: (e) => toast({ text: errorText(e, {}, pinned ? "Không bỏ ghim được, thử lại" : "Không ghim được, thử lại") }),
  });
  return { done, pinned, mark, togglePin };
}

/** Xong / hoãn / ghim / ngữ cảnh as spelled-out buttons, in the reply panel header. */
export function MessageActions({
  m, showContext, onToggleContext, onDone,
}: {
  m: Message;
  showContext: boolean;
  onToggleContext: () => void;
  onDone?: () => void;
}) {
  const { done, pinned, mark, togglePin } = useTagMark(m, onDone);
  return (
    <>
      <Hint side="bottom" title={done ? "Mở lại (x)" : "Xong (x)"}
        text={done ? "Đánh dấu chưa xử lý." : "Không cần trả lời / đã xử lý nơi khác; thả reaction trên Telegram. Không muốn thả reaction: Shift+bấm (Shift+x)."}>
        <Button type="button" size="xs" variant="ghost" className={cn(!done && "text-ok hover:bg-ok-wash hover:text-ok")} aria-busy={mark.isPending} disabled={mark.isPending}
          aria-label={done ? "Mở lại" : "Xong"}
          onClick={(e) => mark.mutate({ handled: !done, react: !e.shiftKey })}>
          {done ? <RotateCcw /> : <CheckCheck />}{done ? "Mở lại" : "Xong"}
        </Button>
      </Hint>
      {!done && <SnoozeMenu ms={[m]} label />}
      {(!done || pinned) && (
        <Hint side="bottom" title={pinned ? "Bỏ ghim (p)" : "Ghim (p)"} text={pinned ? "Bỏ ghim tin này." : "Ghim lên đầu danh sách; giữ ở Tag đã ghim kể cả khi đã xử lý."}>
          <Button type="button" size="xs" variant="ghost" className={cn(pinned && "text-ink")}
            disabled={togglePin.isPending} aria-label={pinned ? "Bỏ ghim" : "Ghim"} aria-pressed={pinned} onClick={() => togglePin.mutate()}>
            <Pin className={cn(pinned && "fill-current")} />{pinned ? "Bỏ ghim" : "Ghim"}
          </Button>
        </Hint>
      )}
      <Hint side="bottom" title="Ngữ cảnh" text="Xem các tin trước / sau trong nhóm.">
        <Button type="button" size="xs" variant="ghost" className={cn(showContext && "bg-paper-3 text-ink")}
          aria-label="Ngữ cảnh" aria-expanded={showContext} onClick={onToggleContext}>
          <MessagesSquare />Ngữ cảnh
        </Button>
      </Hint>
      <Hint side="bottom" title="Trả lời bằng Q&A" text="Trả lời ở trang Q&A: câu trả lời kèm mã #QA…, tin này đứng đầu một chuỗi Q&A để xem lại cả hỏi lẫn đáp. Tin đã nằm trong một chuỗi thì trả lời vào chuỗi đó, không thêm mã.">
        <Button type="button" size="xs" variant="ghost" onClick={() => answerQa(m)}><MessageCircleQuestion />Q&A</Button>
      </Hint>
    </>
  );
}

/** Hoãn: the tags leave the to-do list and come back on their own (pending lists refetch every minute). Presets in
 *  Vietnam time, a picked time, and (one tag) "Luôn bỏ qua {sender}". Also the multi-selection's Hoãn. */
export function SnoozeMenu({ ms, label, onDone }: { ms: Message[]; label?: boolean; onDone?: (failed: Message[]) => void }) {
  const [now, setNow] = useState(() => Date.now()); // read when the menu opens: no per-row clock on long lists
  const one = ms.length === 1 ? ms[0] : null;
  const snoozed = !!one?.snoozed_until && new Date(one.snoozed_until).getTime() > now;
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState("");
  // Tickets the tag names (known projects only), each a "until it is done" choice.
  const known = useQuery({ ...ytProjectsQuery, enabled: open }).data;
  const tickets = one && known ? [...new Set(one.text.match(TICKET_IDS) ?? [])].filter((id) => known.some((p) => p.shortName === id.split("-")[0])).slice(0, 3) : [];
  const run = useMutation({
    mutationFn: (v: Date | null | { on: string }) => v instanceof Date || v === null ? snooze(ms, v) : snooze(ms, new Date(Date.now() + EVENT_SNOOZE_MS), v.on),
    onSuccess: () => { setOpen(false); onDone?.([]); },
    onError: (e) => {
      if (e instanceof PartialError) { setOpen(false); onDone?.(e.failed); return; } // its toast said x/y
      toast({ text: errorText(e, {}, "Không hoãn được, thử lại") });
    },
  });
  const rule = useMutation({ mutationFn: (m: Message) => ignoreSender(m), onError: (e) => toast({ text: errorText(e, {}, "Không thêm được quy tắc, thử lại") }) });
  const prio = useMutation({ mutationFn: (m: Message) => prioritizeSender(m), onError: (e) => toast({ text: errorText(e, {}, "Không thêm được quy tắc, thử lại") }) });
  const pickCustom = () => {
    const at = custom && fromVnInput(custom);
    if (!at || at.getTime() <= Date.now()) return toast({ text: "Chọn một lúc trong tương lai" });
    run.mutate(at);
  };
  return (
    <Menu.Root open={open} onOpenChange={(o) => { setOpen(o); if (o) setNow(Date.now()); }}>
      <Hint side="bottom" title="Hoãn (s: 1 giờ)" text={snoozed ? (one!.snooze_on === "reply" ? "Đang hoãn tới khi có người trả lời." : one!.snooze_on ? `Đang hoãn tới khi ${one!.snooze_on.slice(7)} xong.` : `Đang hoãn tới ${timeLabel(one!.snoozed_until!, true)}.`) : "Ẩn khỏi Việc cần xử lý, tự hiện lại sau; hoặc luôn bỏ qua người gửi."}>
        <Menu.Trigger aria-label="Hoãn" onClick={(e) => e.stopPropagation()}
          render={<Button type="button" size={label ? "xs" : "icon-xs"} variant="ghost" className={cn(snoozed && "text-info", "hover:bg-info-wash hover:text-info data-popup-open:bg-info-wash data-popup-open:text-info")} />}>
          <AlarmClock />{label && "Hoãn"}
        </Menu.Trigger>
      </Hint>
      <Menu.Portal>
        <Menu.Positioner sideOffset={6} align={label ? "start" : "end"} className="z-50 outline-none">
          <Menu.Popup aria-label="Hoãn tới" onClick={(e) => e.stopPropagation()} className={cn(MENU_POPUP, "w-56 text-xs")}>
            {snoozeChoices(now).map(({ label: text, at, clock }) => (
              <Menu.Item key={text} disabled={run.isPending} onClick={() => run.mutate(at)} className={cn("flex text-ink-2 data-highlighted:text-ink", MENU_ITEM)}>
                {text}<span className="ml-auto pl-2 font-mono text-ink-3 tabular-nums">{clock && clockLabel(at.toISOString())}</span>
              </Menu.Item>
            ))}
            <Menu.Item disabled={run.isPending} onClick={() => run.mutate({ on: "reply" })} className={cn("flex border-t text-ink-2 data-highlighted:text-ink", MENU_ITEM)}>
              Tới khi có người trả lời
            </Menu.Item>
            {tickets.map((id) => (
              <Menu.Item key={id} disabled={run.isPending} onClick={() => run.mutate({ on: `ticket:${id}` })} className={cn("flex text-ink-2 data-highlighted:text-ink", MENU_ITEM)}>
                Tới khi {id} xong
              </Menu.Item>
            ))}
            {/* Not a <form>: React submits bubble through the portal to the reply form around the header. */}
            <div className="grid gap-1 border-t px-2.5 pt-1.5 pb-1" onKeyDown={(e) => {
              if (e.key === "Escape" || e.key === "Tab") return; // still the menu's: close / move on
              e.stopPropagation(); // the menu's own typeahead / arrow keys stay out of the field
              if (e.key === "Enter") { e.preventDefault(); pickCustom(); }
            }}>
              <span className="text-ink-3">Chọn giờ (giờ Việt Nam)</span>
              <span className="flex gap-1">
                <input type="datetime-local" aria-label="Hoãn tới lúc" value={custom} min={vnInput(new Date(now))} onChange={(e) => setCustom(e.target.value)}
                  className="h-7 min-w-0 flex-1 rounded-[var(--radius-input)] border border-rule-2 bg-cotton px-1.5 text-xs text-ink" />
                <Button type="button" size="xs" variant="outline" disabled={!custom || run.isPending} onClick={pickCustom}>Hoãn</Button>
              </span>
            </div>
            {snoozed && (
              <Menu.Item disabled={run.isPending} onClick={() => run.mutate(null)} className={cn("border-t text-ink-3 data-highlighted:text-ink", MENU_ITEM)}>
                Bỏ hoãn
              </Menu.Item>
            )}
            {one?.sender_id && !one.outgoing && (
              <Menu.Item disabled={rule.isPending} onClick={() => rule.mutate(one)} className={cn("flex items-center gap-1.5 border-t text-ink-2 data-highlighted:text-ink", MENU_ITEM)}>
                <UserX className="size-3.5 shrink-0" aria-hidden /> <span className="truncate">Luôn bỏ qua {one.sender_name ?? "người này"}</span>
              </Menu.Item>
            )}
            {one?.sender_id && !one.outgoing && !one.priority && (
              <Menu.Item disabled={prio.isPending} onClick={() => prio.mutate(one)} className={cn("flex items-center gap-1.5 text-ink-2 data-highlighted:text-ink", MENU_ITEM)}>
                <Star className="size-3.5 shrink-0" aria-hidden /> <span className="truncate">Luôn ưu tiên {one.sender_name ?? "người này"}</span>
              </Menu.Item>
            )}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

/** Messages around a tag, read live from Telegram (not stored). `focus`: drawn in place of the tag's own line (always shown, even when the rest can't load).
 *  `reveal`: opened under a list row, where a long message leaves it off-screen: scroll it into view, again once loaded (it grows). */
export function ContextPanel({ m, className, focus, reveal }: { m: Message; className?: string; focus?: React.ReactNode; reveal?: boolean }) {
  const q = useQuery({
    queryKey: ["context", m.chat_id, m.message_id],
    queryFn: ({ signal }) =>
      api<Message[]>(`/chats/${encodeURIComponent(m.chat_id)}/messages/${m.message_id}/context`, { signal }),
    staleTime: 60_000,
  });
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => { if (reveal) box.current?.scrollIntoView({ block: "nearest", behavior: smooth() }); }, [reveal, q.isPending]);
  const inList = !!q.data?.some((c) => c.message_id === m.message_id);
  return (
    <div ref={box} aria-label="Ngữ cảnh" className={cn("mt-2 grid max-h-72 gap-1.5 overflow-y-auto rounded-md bg-paper-3/60 p-3 text-[0.8125rem] leading-relaxed", className)}>
      {q.isPending && (
        <div className="grid gap-2" aria-label="Đang lấy tin xung quanh từ Telegram…">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-3" style={{ width: `${90 - i * 20}%` }} />)}
        </div>
      )}
      {q.isError && <p className="text-error">{errorText(q.error, {}, "Không lấy được (cần đang kết nối Telegram).")}</p>}
      {focus && !inList && focus}
      {q.data?.map((c) => focus && c.message_id === m.message_id ? <div key={c.message_id} className="contents">{focus}</div> : (
        <ContextLine key={c.message_id} c={c} focused={c.message_id === m.message_id} />
      ))}
    </div>
  );
}

/** One message of the thread; a tag marked done or one checked with Đối chiếu BE gets a green edge and its mark.
 *  Memoised: the reply panel re-renders on every streamed AI chunk, the thread lines don't need to. */
const ContextLine = memo(function ContextLine({ c, focused }: { c: Message; focused: boolean }) {
  const deep = !!useDeepTask(c);
  return (
    <p className={cn("whitespace-pre-wrap break-words", focused ? "-mx-1.5 rounded-sm bg-hl-wash px-1.5 text-ink"
      : deep || c.handled ? "-mx-1.5 rounded-sm border-l-2 border-ok bg-ok-wash/60 pr-1.5 pl-1 text-ink" : "text-ink-2")}>
      <DeepPick m={c} className="float-right -my-1 ml-1" />
      <span className="font-semibold" style={c.outgoing ? undefined : { color: nameColor(c.sender_name ?? "?") }}>
        {c.outgoing ? "Bạn" : (c.sender_name ?? "?")}:
      </span>{" "}
      {c.handled && (
        <span className="mr-1 inline-flex items-center gap-1 rounded-full bg-ok-wash px-1.5 align-[1px] text-xs leading-5 font-medium text-ok">
          <CheckCheck className="size-3" aria-hidden /> Đã xử lý
        </span>
      )}
      <DeepBadge m={c} className="mr-1 align-[1px]" />
      {c.text ? richText(c) : (c.media_kind ? `[${MEDIA[c.media_kind] ?? "tệp"}]` : "")}
    </p>
  );
});
