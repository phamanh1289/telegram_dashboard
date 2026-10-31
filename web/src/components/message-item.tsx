"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { AlarmClock, CheckCheck, ClipboardList, CornerDownRight, ExternalLink, FolderGit2, Loader2, MessagesSquare, Pin, RotateCcw, Users } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import { hueOf } from "@/components/chat-list";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { api, type Message, type Task } from "@/lib/api";
import { dbId, pin, setHandled, telegramLink, timeLabel, toast, waitLabel } from "@/lib/inbox";
import { readOverdueHours } from "@/lib/prefs";
import { cn } from "@/lib/utils";

const MEDIA: Record<string, string> = {
  photo: "Ảnh", video: "Video", voice: "Tin thoại", audio: "Âm thanh", sticker: "Sticker",
  gif: "GIF", video_note: "Video tròn", document: "Tệp",
};

const linkCls = "text-hl-2 underline decoration-hl/50 underline-offset-2 transition-[text-decoration-color] duration-(--dur-micro) hover:decoration-hl";
const mentionCls = "rounded-sm bg-hl-wash px-1 font-medium text-hl-2 no-underline";
const codeCls = "rounded-sm bg-paper-3 px-1 py-px font-mono text-[0.875em] text-ink";

// Bare URLs, @username mentions (not inside e-mails) and `code` the sender typed literally.
const INLINE = /(https?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]])|(?<![\w.@])(@[A-Za-z][A-Za-z0-9_]{3,31})|`([^`\n]+)`/g;

function inline(text: string, key: number) {
  const out: React.ReactNode[] = [];
  let at = 0;
  for (const x of text.matchAll(INLINE)) {
    out.push(text.slice(at, x.index));
    const k = `${key}-${x.index}`;
    if (x[1]) out.push(<a key={k} href={x[1]} target="_blank" rel="noreferrer" className={cn(linkCls, "break-all")}>{x[1]}</a>);
    else if (x[2]) out.push(<a key={k} href={`https://t.me/${x[2].slice(1)}`} target="_blank" rel="noreferrer" className={mentionCls}>{x[2]}</a>);
    else out.push(<code key={k} className={codeCls}>{x[3]}</code>);
    at = x.index + x[0].length;
  }
  out.push(text.slice(at));
  return out;
}

type Span = Message["links"][number];

// Spans, not divs, so formatted text can sit inside <p>.
const STYLE: Partial<Record<Span["kind"], string>> = {
  bold: "font-semibold", italic: "italic", underline: "underline underline-offset-2", strike: "line-through",
  spoiler: "rounded-sm bg-ink-3 text-transparent transition-colors duration-(--dur-micro) hover:bg-transparent hover:text-inherit",
  blockquote: "my-1 block rounded-r-sm border-l-[3px] border-hl bg-hl-wash/60 py-1 pr-2 pl-2.5",
  pre: "my-1 block overflow-x-auto rounded-sm bg-paper-3 px-2 py-1.5 font-mono text-[0.875em]",
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
          ? <a key={k} href={l.url} target="_blank" rel="noreferrer" className={l.kind === "mention" ? mentionCls : linkCls}>{kids}</a>
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
  now: number;
  focused?: boolean;
  groupTitle?: string; // shown in the cross-group inbox
  isReplyTarget: boolean;
  checked?: boolean;
  selectMode?: boolean;
  canCheck?: boolean;
  tasks?: Task[];
  onReply: (m: Message) => void;
  onToggle?: (m: Message) => void;
  onUseText: (m: Message, text: string) => void; // put a task result into the composer
};

export function MessageItem(props: MessageItemProps) {
  const { m } = props;
  if (m.deleted) {
    return (
      <li data-testid="message" data-id={m.message_id} className="px-4 py-2 text-xs text-ink-3 @xl:pl-[calc(6.5rem+2.25rem)]">
        Tin #{m.message_id} đã bị xóa.
      </li>
    );
  }
  return <MessageRow {...props} />;
}

function MessageRow({
  m, head, now, focused, groupTitle, isReplyTarget, checked, selectMode, canCheck = true, tasks, onReply, onToggle, onUseText,
}: MessageItemProps) {
  const [showContext, setShowContext] = useState(false);
  const [photoFailed, setPhotoFailed] = useState(false);
  const name = m.outgoing ? "Bạn" : (m.sender_name ?? "Không rõ");
  const done = m.handled;
  const snoozed = !done && m.snoozed_until && new Date(m.snoozed_until).getTime() > now;
  const wait = !m.outgoing && !done && !snoozed ? waitLabel(m.date, now) : null;
  const link = telegramLink(m);
  const photo = `/api/chats/${encodeURIComponent(m.chat_id)}/messages/${m.message_id}/photo`;

  const selected = !!focused || isReplyTarget;
  const quiet = !m.outgoing && (done || snoozed);

  return (
    <li
      data-testid="message"
      data-id={m.message_id}
      data-selected={selected}
      className={cn(
        "group/row relative grid grid-cols-[minmax(0,1fr)] gap-x-4 px-4 py-3 transition-colors duration-(--dur-micro) animate-in fade-in-0 duration-(--dur-short) hover:bg-paper-2 @xl:grid-cols-[6.5rem_minmax(0,1fr)] @xl:px-5 @3xl:grid-cols-[6.5rem_minmax(0,1fr)_auto]",
        selected && "bg-linear-to-r from-hl-wash to-hl-wash/35 before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:bg-hl",
        selectMode && checked && "bg-hl-wash/60",
        !head && !groupTitle && "pt-0.5",
        "cursor-pointer",
      )}
      onClick={(e) => {
        // Click anywhere on the row opens the reply panel (not on links/buttons or while selecting text).
        const sel = window.getSelection();
        const selecting = !!sel?.toString() && !!sel.anchorNode && e.currentTarget.contains(sel.anchorNode);
        if (selecting || (e.target as HTMLElement).closest("a,button,select,input,label")) return;
        if (selectMode) onToggle?.(m); // selecting: the whole row toggles the checkbox
        else onReply(m);
      }}
    >
      {/* Wait first: how long this has been waiting, set in mono; coral only past the overdue line. */}
      <div className="mb-1 flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-xs leading-5 @xl:mb-0 @xl:grid @xl:content-start @xl:justify-items-start @xl:pt-0.5">
        {selectMode && onToggle && (
          <Checkbox
            aria-label={`Chọn tin #${m.message_id}`}
            checked={!!checked}
            disabled={!checked && !canCheck}
            onCheckedChange={() => onToggle(m)}
            className="mb-1"
          />
        )}
        {!m.outgoing && (done ? (
          <span className="inline-flex items-center gap-1 font-medium text-ok"><CheckCheck className="size-3.5" aria-hidden /> Đã xử lý</span>
        ) : snoozed ? (
          <span className="inline-flex items-center gap-1 text-info" title={`Nhắc lại lúc ${timeLabel(m.snoozed_until!, true)}`}>
            <AlarmClock className="size-3.5 shrink-0" aria-hidden /> nhắc <span className="font-mono tabular-nums">{timeLabel(m.snoozed_until!)}</span>
          </span>
        ) : wait && (
          <span className={cn("whitespace-nowrap text-[0.8125rem]", wait.overdue ? "font-semibold text-signal-2" : "text-ink-2")}
            title={wait.overdue ? `Chưa xử lý, đã chờ quá ${readOverdueHours()} giờ` : "Chưa xử lý"}>
            chờ <span className="font-mono tabular-nums">{wait.n}</span> {wait.unit}
            {wait.overdue && <span className="sr-only"> (quá hạn)</span>}
          </span>
        ))}
        <time dateTime={m.date} title={timeLabel(m.date, true)} className="whitespace-nowrap text-ink-3 tabular-nums">{timeLabel(m.date)}</time>
        {m.edit_date && <span className="text-ink-3">đã sửa</span>}
        <button type="button" title="ID trong database local (bấm để chép, dùng khi báo lỗi)"
          onClick={() => navigator.clipboard.writeText(dbId(m)).then(() => toast({ text: `Đã chép ID ${dbId(m)}` }), () => toast({ text: "Không chép được ID" }))}
          className="whitespace-nowrap rounded-sm font-mono text-[0.6875rem] text-ink-3 tabular-nums hover:bg-paper-3 hover:text-ink">
          {dbId(m)}
        </button>
      </div>

      <div className="min-w-0">
        {(head || groupTitle) && (
          <p className="mb-1 flex flex-wrap items-center gap-x-2.5 gap-y-0.5">
            <span className={cn("min-w-0 truncate text-sm font-semibold", m.outgoing && "text-ink-2")}
              style={m.outgoing ? undefined : { color: `var(--cat-${hueOf(name)})` }}>{name}</span>
            {m.pinned && <Pin className="size-3.5 fill-current text-ink-2" aria-label="Đã ghim" />}
            {groupTitle && (
              <span className="inline-flex min-w-0 items-center gap-1 text-xs text-ink-3">
                <Users className="size-3 shrink-0" aria-hidden /> <span className="truncate">{groupTitle}</span>
              </span>
            )}
          </p>
        )}
        {m.reply_to_id && (
          <p className="mb-0.5 inline-flex items-center gap-1 text-xs text-ink-3">
            <CornerDownRight className="size-3" aria-hidden /> trả lời <span className="font-mono">#{m.reply_to_id}</span>
          </p>
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
            </p>
            {t.result && (
              <>
                <p className="mt-1 line-clamp-4 whitespace-pre-wrap text-ink-2">{t.result}</p>
                <Button size="xs" variant="link" className="mt-0.5 h-auto px-0" onClick={() => onUseText(m, t.result!)}>
                  Dùng kết quả làm nháp trả lời
                </Button>
              </>
            )}
          </div>
        ))}
        {showContext && <ContextPanel m={m} />}
      </div>

      {/* Actions: quiet until the row is hovered, focused or selected; always in the tab order. Replying is a click
          on the row. */}
      <div className="row-actions mt-1.5 flex flex-wrap items-center gap-0.5 @xl:col-start-2 @3xl:col-start-3 @3xl:row-start-1 @3xl:mt-0 @3xl:flex-nowrap @3xl:self-start">
        {!m.outgoing && <MessageActions m={m} showContext={showContext} onToggleContext={() => setShowContext((v) => !v)} />}
        <a href={link.app} {...(!link.exact && { target: "_blank", rel: "noreferrer" })}
          title={link.exact ? "Mở tin này trong app Telegram (Alt+bấm: mở bản web)" : "Mở nhóm trên Telegram Web (nhóm thường không có link tới từng tin)"}
          onClick={(e) => {
            if (e.altKey && link.exact) {
              e.preventDefault();
              window.open(link.web, "_blank", "noreferrer");
            }
          }}
          className="relative inline-flex size-[30px] items-center pointer-coarse:after:absolute pointer-coarse:after:-inset-1.5 justify-center rounded-md text-ink-2 no-underline transition-colors duration-(--dur-micro) hover:bg-paper-3 hover:text-ink">
          <ExternalLink className="size-3.5" aria-hidden /><span className="sr-only">Mở Telegram</span>
        </a>
      </div>
    </li>
  );
}

/** Message body; in the cross-group queue it is cut to 10 lines so the list stays scannable (the reply panel shows it
 *  all). "Xem thêm" only appears when the text actually overflows. */
function MessageText({ m, clamp, dim }: { m: Message; clamp: boolean; dim: boolean }) {
  const [open, setOpen] = useState(false);
  const [long, setLong] = useState(false);
  const ref = useRef<HTMLParagraphElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (clamp && el && !open) setLong(el.scrollHeight > el.clientHeight + 1);
  }, [clamp, open, m.text]);
  return (
    <>
      <p ref={ref} className={cn("whitespace-pre-wrap break-words text-[0.9375rem] leading-[1.55]", dim ? "text-ink-2" : "text-ink", clamp && !open && "line-clamp-10")}>
        {richText(m)}
      </p>
      {clamp && (long || open) && (
        <Button type="button" size="xs" variant="link" className="h-7 px-0 text-ink-2" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          {open ? "Thu gọn" : "Xem thêm"}
        </Button>
      )}
    </>
  );
}

/** Xong / ghim / ngữ cảnh, on the hover row and in the reply panel header. */
export function MessageActions({
  m, showContext, onToggleContext, onDone,
}: {
  m: Message;
  showContext: boolean;
  onToggleContext: () => void;
  onDone?: () => void;
}) {
  // Local overrides keep the buttons right when `m` is a stale snapshot (reply panel). The handled override
  // only holds while m.handled is still what it was when we clicked, so an undo from the toast shows through.
  const [over, setOver] = useState<{ handled?: boolean; from?: boolean; pinned?: boolean }>({});
  const done = over.handled !== undefined && over.from === m.handled ? over.handled : m.handled;
  const pinned = over.pinned ?? m.pinned;
  // Other changes come back through SSE, which refreshes lists and counts.
  const mark = useMutation({
    mutationFn: (handled: boolean) => setHandled([m], handled),
    onSuccess: (_, handled) => {
      setOver((o) => ({ ...o, handled, from: m.handled }));
      if (handled) onDone?.();
    },
  });
  const togglePin = useMutation({
    mutationFn: () => pin(m, !pinned),
    onSuccess: () => setOver((o) => ({ ...o, pinned: !pinned })),
  });
  return (
    <>
      <Button type="button" size="icon-xs" variant="ghost" className={cn(!done && "hover:bg-ok-wash hover:text-ok")} aria-busy={mark.isPending} disabled={mark.isPending}
        aria-label={done ? "Mở lại" : "Xong"}
        title={done ? "Mở lại: đánh dấu chưa xử lý (x)" : "Xong: không cần trả lời / đã xử lý nơi khác (x)"}
        onClick={() => mark.mutate(!done)}>
        {done ? <RotateCcw /> : <CheckCheck />}
      </Button>
      {(!done || pinned) && (
        <Button type="button" size="icon-xs" variant="ghost" className={cn(pinned && "text-ink")}
          disabled={togglePin.isPending} aria-label={pinned ? "Bỏ ghim" : "Ghim"} aria-pressed={pinned}
          title={pinned ? "Bỏ ghim" : "Ghim lên đầu danh sách"} onClick={() => togglePin.mutate()}>
          <Pin className={cn(pinned && "fill-current")} />
        </Button>
      )}
      <Button type="button" size="icon-xs" variant="ghost" className={cn(showContext && "bg-paper-3 text-ink")}
        aria-label="Ngữ cảnh" aria-expanded={showContext} title="Xem các tin trước/sau trong nhóm" onClick={onToggleContext}>
        <MessagesSquare />
      </Button>
    </>
  );
}

/** Messages around a tag, read live from Telegram (not stored). */
export function ContextPanel({ m }: { m: Message }) {
  const q = useQuery({
    queryKey: ["context", m.chat_id, m.message_id],
    queryFn: ({ signal }) =>
      api<Message[]>(`/chats/${encodeURIComponent(m.chat_id)}/messages/${m.message_id}/context`, { signal }),
    staleTime: 60_000,
  });
  return (
    <div aria-label="Ngữ cảnh" className="mt-2 grid max-h-72 gap-1.5 overflow-y-auto rounded-md bg-paper-3/60 p-3 text-[0.8125rem] leading-relaxed">
      {q.isPending && (
        <div className="grid gap-2" aria-label="Đang lấy tin xung quanh từ Telegram…">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-3" style={{ width: `${90 - i * 20}%` }} />)}
        </div>
      )}
      {q.isError && <p className="text-error">Không lấy được (cần đang kết nối Telegram).</p>}
      {q.data?.map((c) => (
        <p key={c.message_id} className={cn("whitespace-pre-wrap break-words", c.message_id === m.message_id ? "-mx-1.5 rounded-sm bg-hl-wash px-1.5 text-ink" : "text-ink-2")}>
          <span className="font-semibold" style={c.outgoing ? undefined : { color: `var(--cat-${hueOf(c.sender_name ?? "?")})` }}>
            {c.outgoing ? "Bạn" : (c.sender_name ?? "?")}:
          </span>{" "}
          {c.text ? richText(c) : (c.media_kind ? `[${MEDIA[c.media_kind] ?? "tệp"}]` : "")}
        </p>
      ))}
    </div>
  );
}
