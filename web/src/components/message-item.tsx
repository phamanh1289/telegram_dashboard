"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { AlarmClock, Bot, CheckCheck, ClipboardList, CornerDownRight, ExternalLink, FolderGit2, Loader2, MessagesSquare, Paperclip, Pin, RotateCcw, Users } from "lucide-react";
import { memo, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Menu } from "@base-ui/react/menu";
import { Avatar, hueOf } from "@/components/chat-list";
import { DeepBadge, DeepPick, useDeepTask } from "@/components/deep-think";
import { Markdown } from "@/components/markdown";
import { Button } from "@/components/ui/button";
import { Hint } from "@/components/ui/hint";
import { Skeleton } from "@/components/ui/skeleton";
import { api, errorText, type Message, type Task } from "@/lib/api";
import { attach, sameRef } from "@/lib/attach";
import { clockLabel, copyText, dbId, msgKey, openTask, pin, sessionId, setHandled, smooth, snooze, telegramLink, timeLabel, toast, useNow, useTaskList, waitLabel } from "@/lib/inbox";
import { readOverdueHours, useRole } from "@/lib/prefs";
import { useRetest, yt } from "@/lib/yt";
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

/** VA-123 of a known YouTrack project: a chip that opens the ticket sheet; hovering shows its state and assignee. */
export function TicketChip({ id }: { id: string }) {
  const [hover, setHover] = useState(false);
  const projects = useQuery({ queryKey: ["yt", "projects"], queryFn: yt.projects, staleTime: Infinity, retry: false });
  const d = useQuery({ queryKey: ["yt", "detail", id], queryFn: () => yt.detail(id), staleTime: 60_000, retry: false, enabled: hover });
  if (!projects.data?.some((p) => p.shortName === id.split("-")[0])) return id;
  const t = d.data;
  return (
    <span className="relative" onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)} onFocus={() => setHover(true)} onBlur={() => setHover(false)}>
      <a href={`/youtrack/?ticket=${id}`} className={cn(codeCls, "font-semibold no-underline hover:bg-hl-wash hover:text-hl-2 hover:ring-hl/30", t?.resolved && "line-through")}>{id}</a>
      {hover && (
        <span role="tooltip" className="absolute top-full left-0 z-30 mt-1 grid w-72 gap-1 rounded-md bg-cotton p-2.5 text-xs leading-snug whitespace-normal text-ink-2 shadow-pop animate-in fade-in-0 duration-(--dur-micro)">
          {t ? (
            <>
              <span className="font-medium text-ink">{t.summary}</span>
              <span className="flex flex-wrap gap-x-2.5"><span>{t.state || "—"}</span><span>{t.priority || "—"}</span><span>{t.assignee || "Chưa assign"}</span></span>
            </>
          ) : d.isError ? "Không tải được ticket" : "Đang tải…"}
        </span>
      )}
    </span>
  );
}

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
          ? SAFE_URL.test(l.url)
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
};

/** Memoised: lists re-render on every count / SSE change, a row only when its own props change. */
export const MessageItem = memo(function MessageItem(props: MessageItemProps) {
  const { m } = props;
  if (m.deleted) {
    return (
      <li data-testid="message" data-id={m.message_id} data-key={msgKey(m)} className="py-2 pr-4 pl-[calc(1rem+2.25rem)] text-xs text-ink-3 @xl:pl-[calc(1.25rem+2.25rem)]">
        Tin #{m.message_id} đã bị xóa.
      </li>
    );
  }
  return <MessageRow {...props} />;
});

function MessageRow({
  m, head, clock, now, focused, groupTitle, isReplyTarget, tasks, onReply, onUseText, live,
}: MessageItemProps) {
  const [showContext, setShowContext] = useState(false);
  const [photoFailed, setPhotoFailed] = useState(false);
  const name = m.outgoing ? "Bạn" : (m.sender_name ?? "Không rõ");
  const done = m.handled;
  const snoozed = !done && m.snoozed_until && new Date(m.snoozed_until).getTime() > now;
  const wait = !live && !m.outgoing && !done && !snoozed ? waitLabel(m.date, now) : null;
  const photo =`/api/chats/${encodeURIComponent(m.chat_id)}/messages/${m.message_id}/photo`;

  const retest = useRetest(m.text, useRole() === "qa" && !m.outgoing && !done);
  const selected = !!focused || isReplyTarget;
  const quiet = !m.outgoing && (done || snoozed);
  const card = !!groupTitle; // the cross-group to-do list: a card with its actions spelled out underneath

  return (
    <li
      data-testid="message"
      data-id={m.message_id}
      data-key={msgKey(m)}
      data-selected={selected}
      className={cn(
        "group/row relative grid grid-cols-[1.5rem_minmax(0,1fr)] gap-x-3 px-4 py-3 animate-in fade-in-0 duration-(--dur-short) @xl:px-5",
        card
          ? "rounded-[var(--radius-card)] border border-rule bg-cotton shadow-edge transition-[border-color,box-shadow,background-color] duration-(--dur-micro) hover:shadow-stock"
          : "transition-colors duration-(--dur-micro) hover:bg-paper-2",
        card && wait?.overdue && "border-l-[3px] border-l-signal-2",
        selected && (card ? "border-hl/60 bg-hl-wash/40 ring-1 ring-hl/40"
          : "bg-linear-to-r from-hl-wash to-hl-wash/35 before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:bg-hl"),
        !head && !groupTitle && "pt-1.5",
        !live && "cursor-pointer",
      )}
      onClick={(e) => {
        // Click anywhere on the row opens the reply panel (not on links/buttons or while selecting text).
        const sel = window.getSelection();
        const selecting = !!sel?.toString() && !!sel.anchorNode && e.currentTarget.contains(sel.anchorNode);
        if (live || selecting || (e.target as HTMLElement).closest("a,button,select,input,label")) return;
        onReply(m);
      }}
    >
      {/* Gutter: the sender's avatar opens a run of their messages. */}
      <div className="pt-px">{(head || groupTitle) && <Avatar name={name} />}</div>

      <div className="min-w-0">
        {/* One line: who, where, when and the wait on the left; ID and actions on the right. */}
        <div className="mb-1 flex min-h-6 flex-wrap items-center gap-x-2.5 gap-y-0.5">
          {card && (
            <span className="inline-flex min-w-0 max-w-full items-center gap-1 rounded-full bg-paper-2 px-2 text-xs leading-6 font-medium text-ink-2">
              <Users className="size-3 shrink-0" aria-hidden /> <span className="truncate">{groupTitle}</span>
            </span>
          )}
          {(head || card) && (
            <>
              <span className={cn("min-w-0 truncate text-sm font-semibold", m.outgoing && "text-ink-2")}
                style={m.outgoing ? undefined : { color: `var(--cat-${hueOf(name)})` }}>{name}</span>
              {m.pinned && <Pin className="size-3.5 shrink-0 fill-current text-ink-2" aria-label="Đã ghim" />}
            </>
          )}
          <time dateTime={m.date} title={timeLabel(m.date, true)} className="whitespace-nowrap text-xs text-ink-3 tabular-nums">
            {clock ? clockLabel(m.date) : timeLabel(m.date)}{m.edit_date && " (đã sửa)"}
          </time>
          {!m.outgoing && (done ? (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-ok"><CheckCheck className="size-3.5" aria-hidden /> Đã xử lý</span>
          ) : snoozed ? (
            <Hint side="bottom" text={`Đang hoãn: nhắc lại lúc ${timeLabel(m.snoozed_until!, true)}`}>
              <span className="inline-flex items-center gap-1 text-xs text-info">
                <AlarmClock className="size-3.5 shrink-0" aria-hidden /> nhắc <span className="font-mono tabular-nums">{timeLabel(m.snoozed_until!)}</span>
              </span>
            </Hint>
          ) : wait && (
            <Hint side="bottom" text={wait.overdue ? `Chưa xử lý, đã chờ quá ${readOverdueHours()} giờ` : "Chưa xử lý"}>
              <span className={cn("whitespace-nowrap text-xs", wait.overdue ? "font-semibold text-signal-2" : "font-medium text-ink-2",
                card && cn("rounded-full px-2 leading-6", wait.overdue ? "bg-signal-wash" : "bg-paper-2"))}>
                {card ? <>{wait.overdue && "Quá hạn, "}chờ <span className="font-mono tabular-nums">{wait.n}</span> {wait.unit}</>
                  : <>(chờ <span className="font-mono tabular-nums">{wait.n}</span> {wait.unit}){wait.overdue && <span className="sr-only"> quá hạn</span>}</>}
              </span>
            </Hint>
          ))}
          {retest.length > 0 && (
            <Hint side="bottom" text={`Bạn là QC của ${retest.join(", ")} và tin này báo đã fix / có build: cần test lại`}>
              <span className="inline-flex items-center gap-1 rounded-full bg-warn-wash px-1.5 text-xs leading-5 font-medium text-warn">
                <RotateCcw className="size-3" aria-hidden /> Cần retest
              </span>
            </Hint>
          )}
          <DeepBadge m={m} />
          <div className="ml-auto flex flex-wrap items-center gap-x-2.5 text-xs leading-5">
            <Hint side="bottom" title={`ID ${dbId(m)}`} text="Bấm để chép ID. Dán vào ô nhắn của một phiên AI Agent để đính kèm tin này (hoặc gửi kèm khi báo lỗi).">
              <button type="button" aria-label={`Chép ID ${dbId(m)}`}
                onClick={() => void copyText(dbId(m), `Đã chép ID ${dbId(m)}, dán vào phiên AI để đính kèm`)}
                className="whitespace-nowrap rounded-sm px-0.5 font-mono text-[0.6875rem] text-ink-3 tabular-nums hover:bg-paper-3 hover:text-ink">
                #{m.message_id}
              </button>
            </Hint>
            {/* Actions, laid out right to left: the first (Xong, or the Telegram link on your own messages) sits at the
                edge and the rest tuck behind it until the row is hovered or selected (globals.css; always shown per
                Settings and on touch screens); always in the tab order. Replying is a click on the row (or Enter / r).
                Wide rows: negative margin so the 30px targets don't make the line taller. To-do cards use the same
                strip, so a card stays a few lines tall. */}
            <div className="row-actions ml-auto flex flex-row-reverse items-center gap-0.5 @xl:-my-1.5">
              {!m.outgoing && !live && <MessageActions m={m} showContext={showContext} onToggleContext={() => setShowContext((v) => !v)} />}
              <DeepPick m={m} />
              <AttachPick m={m} />
              <TgLink m={m} />
            </div>
          </div>
        </div>
        {m.reply_to_id && (
          <Hint side="bottom" text="Tới tin gốc trong danh sách">
            <button type="button" aria-label={`Tới tin gốc #${m.reply_to_id}`} onClick={(e) => jumpTo(e.currentTarget, m.reply_to_id!)}
              className="mb-0.5 inline-flex items-center gap-1 rounded-sm text-xs text-ink-3 hover:text-hl-2">
              <CornerDownRight className="size-3" aria-hidden /> trả lời <span className="font-mono">#{m.reply_to_id}</span>
            </button>
          </Hint>
        )}
        {m.media_kind === "photo" && !photoFailed ? (
          <a href={photo} target="_blank" rel="noreferrer" className="my-1.5 block w-fit">
            {/* eslint-disable-next-line @next/next/no-img-element -- local API image, static export */}
            <img src={photo} alt="Ảnh trong tin" loading="lazy" onError={() => setPhotoFailed(true)}
              className="max-h-64 rounded-md border border-rule object-contain" />
          </a>
        ) : (
          m.media_kind && <p className="text-xs text-ink-3">[{MEDIA[m.media_kind] ?? "Tệp đính kèm"}, chưa tải]</p>
        )}
        {m.text && <MessageText m={m} clamp={!!groupTitle} dim={quiet || m.outgoing} />}
        {tasks?.map((t) => (
          <div key={t.id} className="mt-2 rounded-md bg-paper-3/60 px-3 py-2 text-xs">
            <p className="flex flex-wrap items-center gap-x-3 gap-y-0.5 font-medium text-ink-2">
              <span className="inline-flex items-center gap-1">
                {t.result ? <ClipboardList className="size-3.5" aria-hidden /> : <Loader2 className="size-3.5 animate-spin" aria-hidden />}
                Task {t.result ? "đã có kết quả" : "đang làm…"}
              </span>
              <span className="inline-flex items-center gap-1 font-normal text-ink-3"><FolderGit2 className="size-3" aria-hidden /> {t.project.split("/").pop()}</span>
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
        {showContext && <ContextPanel m={m} />}
      </div>
    </li>
  );
}

/** Row button: attach this message to the next prompt of a Doing AI Agent session, Giao AI Agent or Đối chiếu BE
 *  (this group's first). Always shown, so the feature is found; with no Doing session the menu says so. The session
 *  list lives in the popup, so rows don't each watch the task list. */
function AttachPick({ m }: { m: Message }) {
  return (
    <Menu.Root>
      <Hint side="bottom" text="Đính kèm tin này vào lượt nhắn tiếp của một phiên AI Agent">
        <Menu.Trigger aria-label="Đính kèm vào phiên AI" onClick={(e) => e.stopPropagation()}
          className="relative inline-flex size-[30px] items-center justify-center rounded-md text-ink-2 transition-colors duration-(--dur-micro) pointer-coarse:after:absolute pointer-coarse:after:-inset-1.5 hover:bg-paper-3 hover:text-ink data-popup-open:bg-paper-3 data-popup-open:text-ink">
          <Paperclip className="size-3.5" aria-hidden />
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
  const open = (useTaskList().data ?? []).filter((t) => t.mode !== "terminal" && !t.handled)
    .sort((a, b) => Number(b.chat_id === m.chat_id) - Number(a.chat_id === m.chat_id)) // stable: newest first within
    .slice(0, 8);
  const add = (t: Task) => {
    const name = sessionId(t);
    const ok = attach(t.id, [{ chat_id: m.chat_id, message_id: m.message_id }]).some((r) => sameRef(r, m));
    toast(ok ? { text: `Đã đính kèm #${m.message_id} vào phiên ${name}`, action: { label: "Mở phiên", run: () => openTask(t.id) } }
      : { text: `Phiên ${name} đã đủ tin đính kèm cho lượt tới` });
  };
  return (
    <div className="grid w-72 gap-0.5">
            <p className="px-2.5 pt-1 pb-0.5 text-xs text-ink-3">Đính kèm #{m.message_id} vào phiên</p>
            {!open.length && (
              <p className="px-2.5 pb-1.5 text-xs leading-relaxed text-ink-2">
                Chưa có phiên nào đang làm (Doing). Với phiên đã Done: chép ID tin (bấm #{m.message_id}) rồi dán vào ô nhắn của phiên đó.
              </p>
            )}
            {open.map((t) => (
              <Menu.Item key={t.id} onClick={() => add(t)} className={cn("grid gap-0.5", MENU_ITEM)}>
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

/** Opens the message in the Telegram app (Alt+click: the web app); basic groups have no message links, so the group. */
function TgLink({ m }: { m: Message }) {
  const link = telegramLink(m);
  return (
    <Hint side="bottom" title="Mở Telegram (o)" text={link.exact ? "Mở tin này trong app Telegram (Alt+bấm: mở bản web)" : "Mở nhóm trên Telegram Web (nhóm thường không có link tới từng tin)"}>
    <a href={link.app} {...(!link.exact && { target: "_blank", rel: "noreferrer" })}
      onClick={(e) => {
        if (e.altKey && link.exact) {
          e.preventDefault();
          window.open(link.web, "_blank", "noreferrer");
        }
      }}
      className="relative inline-flex size-[30px] items-center pointer-coarse:after:absolute pointer-coarse:after:-inset-1.5 justify-center rounded-md text-ink-2 no-underline transition-colors duration-(--dur-micro) hover:bg-paper-3 hover:text-ink">
      <ExternalLink className="size-3.5" aria-hidden /><span className="sr-only">Mở Telegram</span>
    </a>
    </Hint>
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

/** Message body; in the cross-group queue it is cut to 3 lines so the list stays scannable (the reply panel shows it
 *  all). "Xem thêm" only appears when the text actually overflows. */
function MessageText({ m, clamp, dim }: { m: Message; clamp: boolean; dim: boolean }) {
  const [open, setOpen] = useState(false);
  const [long, setLong] = useState(false);
  const ref = useRef<HTMLParagraphElement>(null);
  const body = useMemo(() => richText(m), [m]);
  useLayoutEffect(() => {
    const el = ref.current;
    if (clamp && el && !open) setLong(el.scrollHeight > el.clientHeight + 1);
  }, [clamp, open, m.text]);
  return (
    <>
      <p ref={ref} className={cn("whitespace-pre-wrap break-words text-[0.9375rem] leading-[1.55]", dim ? "text-ink-2" : "text-ink", clamp && !open && "line-clamp-3")}>
        {body}
      </p>
      {clamp && (long || open) && (
        <Button type="button" size="xs" variant="link" className="h-7 px-0 text-ink-2" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          {open ? "Thu gọn" : "Xem thêm"}
        </Button>
      )}
    </>
  );
}

/** Xong / hoãn / ghim / ngữ cảnh, on the hover row and in the reply panel header. */
export function MessageActions({
  m, showContext, onToggleContext, onDone, labels,
}: {
  m: Message;
  showContext: boolean;
  onToggleContext: () => void;
  onDone?: () => void;
  labels?: boolean; // spelled-out buttons (to-do cards) instead of the icon strip
}) {
  const size = labels ? "xs" : "icon-xs";
  // Local overrides keep the buttons right when `m` is a stale snapshot (reply panel). The handled override
  // only holds while m.handled is still what it was when we clicked, so an undo from the toast shows through.
  const [over, setOver] = useState<{ handled?: boolean; from?: boolean; pinned?: boolean }>({});
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
    onError: () => toast({ text: pinned ? "Không bỏ ghim được, thử lại" : "Không ghim được, thử lại" }),
  });
  return (
    <>
      <Hint side="bottom" title={done ? "Mở lại (x)" : "Xong (x)"}
        text={done ? "Đánh dấu chưa xử lý." : "Không cần trả lời / đã xử lý nơi khác; thả reaction trên Telegram. Shift+bấm (Shift+x): xong mà không thả reaction."}>
        <Button type="button" size={size} variant="ghost" className={cn(!done && "hover:bg-ok-wash hover:text-ok", labels && !done && "text-ok")} aria-busy={mark.isPending} disabled={mark.isPending}
          aria-label={done ? "Mở lại" : "Xong"}
          onClick={(e) => mark.mutate({ handled: !done, react: !e.shiftKey })}>
          {done ? <RotateCcw /> : <CheckCheck />}{labels && (done ? "Mở lại" : "Xong")}
        </Button>
      </Hint>
      {!done && <SnoozeMenu m={m} label={labels} />}
      {(!done || pinned) && (
        <Hint side="bottom" title={pinned ? "Bỏ ghim (p)" : "Ghim (p)"} text={pinned ? "Bỏ ghim tin này." : "Ghim lên đầu danh sách; giữ ở Tag đã ghim kể cả khi đã xử lý."}>
          <Button type="button" size={size} variant="ghost" className={cn(pinned && "text-ink")}
            disabled={togglePin.isPending} aria-label={pinned ? "Bỏ ghim" : "Ghim"} aria-pressed={pinned} onClick={() => togglePin.mutate()}>
            <Pin className={cn(pinned && "fill-current")} />{labels && (pinned ? "Bỏ ghim" : "Ghim")}
          </Button>
        </Hint>
      )}
      <Hint side="bottom" title="Ngữ cảnh" text="Xem các tin trước / sau trong nhóm.">
        <Button type="button" size={size} variant="ghost" className={cn(showContext && "bg-paper-3 text-ink")}
          aria-label="Ngữ cảnh" aria-expanded={showContext} onClick={onToggleContext}>
          <MessagesSquare />{labels && "Ngữ cảnh"}
        </Button>
      </Hint>
    </>
  );
}

const SNOOZES: [string, () => Date][] = [
  ["1 giờ", () => new Date(Date.now() + 3600_000)],
  ["3 giờ", () => new Date(Date.now() + 3 * 3600_000)],
  ["Sáng mai 9:00", () => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); return d; }],
];

/** Hoãn: the tag leaves the to-do list and comes back on its own (pending lists refetch every minute). */
function SnoozeMenu({ m, label }: { m: Message; label?: boolean }) {
  const now = useNow();
  const snoozed = !!m.snoozed_until && new Date(m.snoozed_until).getTime() > now;
  const run = useMutation({
    mutationFn: (until: Date | null) => snooze(m, until),
    onError: () => toast({ text: "Không hoãn được, thử lại" }),
  });
  return (
    <Menu.Root>
      <Hint side="bottom" title="Hoãn (s: 1 giờ)" text={snoozed ? `Đang hoãn tới ${timeLabel(m.snoozed_until!, true)}.` : "Ẩn khỏi Việc cần xử lý, tự hiện lại sau."}>
        <Menu.Trigger aria-label="Hoãn" onClick={(e) => e.stopPropagation()}
          render={<Button type="button" size={label ? "xs" : "icon-xs"} variant="ghost" className={cn(snoozed && "text-info", "data-popup-open:bg-paper-3")} />}>
          <AlarmClock />{label && "Hoãn"}
        </Menu.Trigger>
      </Hint>
      <Menu.Portal>
        <Menu.Positioner sideOffset={6} align={label ? "start" : "end"} className="z-50 outline-none">
          <Menu.Popup aria-label="Hoãn tới" onClick={(e) => e.stopPropagation()} className={cn(MENU_POPUP, "w-40 text-xs")}>
            {SNOOZES.map(([text, at]) => (
              <Menu.Item key={text} disabled={run.isPending} onClick={() => run.mutate(at())} className={cn("text-ink-2 data-highlighted:text-ink", MENU_ITEM)}>
                {text}
              </Menu.Item>
            ))}
            {snoozed && (
              <Menu.Item disabled={run.isPending} onClick={() => run.mutate(null)} className={cn("border-t text-ink-3 data-highlighted:text-ink", MENU_ITEM)}>
                Bỏ hoãn
              </Menu.Item>
            )}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

/** Messages around a tag, read live from Telegram (not stored). `focus`: drawn in place of the tag's own line (always shown, even when the rest can't load). */
export function ContextPanel({ m, className, focus }: { m: Message; className?: string; focus?: React.ReactNode }) {
  const q = useQuery({
    queryKey: ["context", m.chat_id, m.message_id],
    queryFn: ({ signal }) =>
      api<Message[]>(`/chats/${encodeURIComponent(m.chat_id)}/messages/${m.message_id}/context`, { signal }),
    staleTime: 60_000,
  });
  const inList = !!q.data?.some((c) => c.message_id === m.message_id);
  return (
    <div aria-label="Ngữ cảnh" className={cn("mt-2 grid max-h-72 gap-1.5 overflow-y-auto rounded-md bg-paper-3/60 p-3 text-[0.8125rem] leading-relaxed", className)}>
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
      <span className="font-semibold" style={c.outgoing ? undefined : { color: `var(--cat-${hueOf(c.sender_name ?? "?")})` }}>
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
