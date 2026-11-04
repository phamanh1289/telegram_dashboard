"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { AlarmClock, Bot, Check, CheckCheck, ClipboardList, CornerDownRight, ExternalLink, FolderGit2, Loader2, MessagesSquare, Pin, RotateCcw, Users } from "lucide-react";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { Avatar, hueOf } from "@/components/chat-list";
import { Markdown } from "@/components/markdown";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { api, type Message, type Task } from "@/lib/api";
import { clockLabel, dbId, msgKey, openTask, pin, setHandled, smooth, snooze, telegramLink, timeLabel, toast, useNow, waitLabel } from "@/lib/inbox";
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
              <span>{t.state || "—"} · {t.priority || "—"} · {t.assignee || "Chưa assign"}</span>
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
};

export function MessageItem(props: MessageItemProps) {
  const { m } = props;
  if (m.deleted) {
    return (
      <li data-testid="message" data-id={m.message_id} data-key={msgKey(m)} className="py-2 pr-4 pl-[calc(1rem+2.25rem)] text-xs text-ink-3 @xl:pl-[calc(1.25rem+2.25rem)]">
        Tin #{m.message_id} đã bị xóa.
      </li>
    );
  }
  return <MessageRow {...props} />;
}

function MessageRow({
  m, head, clock, now, focused, groupTitle, isReplyTarget, tasks, onReply, onUseText,
}: MessageItemProps) {
  const [showContext, setShowContext] = useState(false);
  const [photoFailed, setPhotoFailed] = useState(false);
  const name = m.outgoing ? "Bạn" : (m.sender_name ?? "Không rõ");
  const done = m.handled;
  const snoozed = !done && m.snoozed_until && new Date(m.snoozed_until).getTime() > now;
  const wait = !m.outgoing && !done && !snoozed ? waitLabel(m.date, now) : null;
  const link = telegramLink(m);
  const photo = `/api/chats/${encodeURIComponent(m.chat_id)}/messages/${m.message_id}/photo`;

  const retest = useRetest(m.text, useRole() === "qa" && !m.outgoing && !done);
  const selected = !!focused || isReplyTarget;
  const quiet = !m.outgoing && (done || snoozed);

  return (
    <li
      data-testid="message"
      data-id={m.message_id}
      data-key={msgKey(m)}
      data-selected={selected}
      className={cn(
        "group/row relative grid grid-cols-[1.5rem_minmax(0,1fr)] gap-x-3 px-4 py-3 transition-colors duration-(--dur-micro) animate-in fade-in-0 duration-(--dur-short) hover:bg-paper-2 @xl:px-5",
        selected && "bg-linear-to-r from-hl-wash to-hl-wash/35 before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:bg-hl",
        !head && !groupTitle && "pt-1.5",
        "cursor-pointer",
      )}
      onClick={(e) => {
        // Click anywhere on the row opens the reply panel (not on links/buttons or while selecting text).
        const sel = window.getSelection();
        const selecting = !!sel?.toString() && !!sel.anchorNode && e.currentTarget.contains(sel.anchorNode);
        if (selecting || (e.target as HTMLElement).closest("a,button,select,input,label")) return;
        onReply(m);
      }}
    >
      {/* Gutter: the sender's avatar opens a run of their messages. */}
      <div className="pt-px">{(head || groupTitle) && <Avatar name={name} />}</div>

      <div className="min-w-0">
        {/* One line: who, where, when and the wait on the left; ID and actions on the right. */}
        <div className="mb-1 flex min-h-6 flex-wrap items-center gap-x-2.5 gap-y-0.5">
          {(head || groupTitle) && (
            <>
              <span className={cn("min-w-0 truncate text-sm font-semibold", m.outgoing && "text-ink-2")}
                style={m.outgoing ? undefined : { color: `var(--cat-${hueOf(name)})` }}>{name}</span>
              {m.pinned && <Pin className="size-3.5 shrink-0 fill-current text-ink-2" aria-label="Đã ghim" />}
              {groupTitle && (
                <span className="inline-flex min-w-0 items-center gap-1 text-xs text-ink-3">
                  <Users className="size-3 shrink-0" aria-hidden /> <span className="truncate">{groupTitle}</span>
                </span>
              )}
            </>
          )}
          <time dateTime={m.date} title={timeLabel(m.date, true)} className="whitespace-nowrap text-xs text-ink-3 tabular-nums">
            {clock ? clockLabel(m.date) : timeLabel(m.date)}{m.edit_date && " (đã sửa)"}
          </time>
          {!m.outgoing && (done ? (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-ok"><CheckCheck className="size-3.5" aria-hidden /> Đã xử lý</span>
          ) : snoozed ? (
            <span className="inline-flex items-center gap-1 text-xs text-info" title={`Nhắc lại lúc ${timeLabel(m.snoozed_until!, true)}`}>
              <AlarmClock className="size-3.5 shrink-0" aria-hidden /> nhắc <span className="font-mono tabular-nums">{timeLabel(m.snoozed_until!)}</span>
            </span>
          ) : wait && (
            <span className={cn("whitespace-nowrap text-xs", wait.overdue ? "font-semibold text-signal-2" : "font-medium text-ink-2")}
              title={wait.overdue ? `Chưa xử lý, đã chờ quá ${readOverdueHours()} giờ` : "Chưa xử lý"}>
              (chờ <span className="font-mono tabular-nums">{wait.n}</span> {wait.unit})
              {wait.overdue && <span className="sr-only"> quá hạn</span>}
            </span>
          ))}
          {retest.length > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-warn-wash px-1.5 text-xs leading-5 font-medium text-warn"
              title={`Bạn là QC của ${retest.join(", ")} và tin này báo đã fix / có build: cần test lại`}>
              <RotateCcw className="size-3" aria-hidden /> Cần retest
            </span>
          )}
          <div className="ml-auto flex flex-wrap items-center gap-x-2.5 text-xs leading-5">
            <button type="button" title={`ID ${dbId(m)} (bấm để chép, dùng khi báo lỗi)`}
              onClick={() => navigator.clipboard.writeText(dbId(m)).then(() => toast({ text: `Đã chép ID ${dbId(m)}` }), () => toast({ text: "Không chép được ID" }))}
              className="whitespace-nowrap rounded-sm px-0.5 font-mono text-[0.6875rem] text-ink-3 tabular-nums hover:bg-paper-3 hover:text-ink">
              #{m.message_id}
            </button>
            {/* Actions, laid out right to left: the first (Xong, or the Telegram link on your own messages) sits at the
                edge and the rest tuck behind it until it is hovered (globals.css, or always shown per Settings); always
                in the tab order. Replying is a click on the row. Wide rows: negative margin so the 30px targets don't
                make the line taller. */}
            <div className="row-actions ml-auto flex flex-row-reverse items-center gap-0.5 @xl:-my-1.5">
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
          </div>
        </div>
        {m.reply_to_id && (
          <button type="button" title="Tới tin gốc" onClick={(e) => jumpTo(e.currentTarget, m.reply_to_id!)}
            className="mb-0.5 inline-flex items-center gap-1 rounded-sm text-xs text-ink-3 hover:text-hl-2">
            <CornerDownRight className="size-3" aria-hidden /> trả lời <span className="font-mono">#{m.reply_to_id}</span>
          </button>
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
              <button type="button" onClick={() => openTask(t.id)} title="Mở lại phiên AI này ở trang AI Agent"
                className="ml-auto inline-flex items-center gap-1 rounded-sm font-normal text-ink-3 transition-colors duration-(--dur-micro) hover:text-ink">
                <Bot className="size-3.5" aria-hidden /> Mở phiên
              </button>
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

/** Message body; in the cross-group queue it is cut to 10 lines so the list stays scannable (the reply panel shows it
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
      <p ref={ref} className={cn("whitespace-pre-wrap break-words text-[0.9375rem] leading-[1.55]", dim ? "text-ink-2" : "text-ink", clamp && !open && "line-clamp-10")}>
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
      <Button type="button" size="icon-xs" variant="ghost" className={cn(!done && "hover:bg-ok-wash hover:text-ok")} aria-busy={mark.isPending} disabled={mark.isPending}
        aria-label={done ? "Mở lại" : "Xong"}
        title={done ? "Mở lại: đánh dấu chưa xử lý (x)" : "Xong: không cần trả lời / đã xử lý nơi khác (x)"}
        onClick={() => mark.mutate({ handled: !done })}>
        {done ? <RotateCcw /> : <CheckCheck />}
      </Button>
      {!done && (
        <Button type="button" size="icon-xs" variant="ghost" className="hover:bg-ok-wash hover:text-ok" aria-busy={mark.isPending} disabled={mark.isPending}
          aria-label="Xong, không thả reaction" title="Xong nhưng không thả reaction trên Telegram"
          onClick={() => mark.mutate({ handled: true, react: false })}>
          <Check />
        </Button>
      )}
      {!done && <SnoozeMenu m={m} />}
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

const SNOOZES: [string, () => Date][] = [
  ["1 giờ", () => new Date(Date.now() + 3600_000)],
  ["3 giờ", () => new Date(Date.now() + 3 * 3600_000)],
  ["Sáng mai 9:00", () => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); return d; }],
];

/** Hoãn: the tag leaves the to-do list and comes back on its own (pending lists refetch every minute). */
function SnoozeMenu({ m }: { m: Message }) {
  const [open, setOpen] = useState(false);
  const now = useNow();
  const snoozed = !!m.snoozed_until && new Date(m.snoozed_until).getTime() > now;
  const run = useMutation({
    mutationFn: (until: Date | null) => snooze(m, until),
    onSettled: () => setOpen(false),
    onError: () => toast({ text: "Không hoãn được, thử lại" }),
  });
  return (
    <div className="relative" onClick={(e) => e.stopPropagation()} onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && setOpen(false)}
      onKeyDown={(e) => e.key === "Escape" && open && (e.stopPropagation(), setOpen(false))}>
      <Button type="button" size="icon-xs" variant="ghost" className={cn(snoozed && "text-info")} aria-haspopup="menu" aria-expanded={open}
        aria-label="Hoãn" title={snoozed ? `Đang hoãn tới ${timeLabel(m.snoozed_until!, true)}` : "Hoãn: ẩn khỏi Việc cần xử lý, tự hiện lại sau"} onClick={() => setOpen((v) => !v)}>
        <AlarmClock />
      </Button>
      {open && (
        // tabIndex: Safari/Firefox don't focus a clicked button, so without a focusable menu the blur closes it before the click lands
        <div role="menu" aria-label="Hoãn tới" tabIndex={-1} className="absolute top-8 right-0 z-30 grid w-40 gap-0.5 rounded-md bg-cotton p-1 text-xs shadow-pop animate-in fade-in-0 zoom-in-[0.98] duration-(--dur-short)">
          {SNOOZES.map(([label, at]) => (
            <button key={label} type="button" role="menuitem" disabled={run.isPending} onClick={() => run.mutate(at())}
              className="flex h-8 items-center gap-2 rounded-sm px-2 text-left text-ink-2 hover:bg-paper-3 hover:text-ink">
              {label}
            </button>
          ))}
          {snoozed && (
            <button type="button" role="menuitem" disabled={run.isPending} onClick={() => run.mutate(null)}
              className="flex h-8 items-center rounded-sm border-t px-2 text-left text-ink-3 hover:bg-paper-3 hover:text-ink">Bỏ hoãn</button>
          )}
        </div>
      )}
    </div>
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
