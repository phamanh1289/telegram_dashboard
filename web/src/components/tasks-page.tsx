"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Check, CheckCheck, CheckCircle2, ChevronDown, Ellipsis, ExternalLink, Loader2, type LucideIcon, MessageSquare, RotateCcw, RotateCw, Search, Send, Square, Trash2, Users } from "lucide-react";
import { createContext, type ReactNode, use, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Menu } from "@base-ui/react/menu";
import { AiBot, AiThinking, useFollow } from "@/components/ai/chat";
import { ASK_BTN, AskPost, AskTag, Markdown } from "@/components/markdown";
import { EventItem, groupEvents, OpenAttached, type TaskEvent, type TaskLog, ToolGroup } from "@/components/tasks-feed";
import { SEND_ERRORS } from "@/components/composer";
import { TaskComposer } from "@/components/task-composer";
import { Button } from "@/components/ui/button";
import { Hint } from "@/components/ui/hint";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { Skeleton } from "@/components/ui/skeleton";
import { api, ApiError, errorText, type Message, type Outbox, type Task } from "@/lib/api";
import type { View } from "@/hooks/use-chat-messages";
import { ALL, copyText, sessionId, sessionMatches, toast, useNow, useTaskList } from "@/lib/inbox";
import { ago, timeLabel } from "@/lib/time";
import { cn } from "@/lib/utils";

// The AI Agent page: session list and the selected session (its log in tasks-feed.tsx, its input in task-composer.tsx).

type Filter = "all" | "doing" | "done";
const FILTERS: [Filter, string][] = [["all", "Tất cả"], ["doing", "Doing"], ["done", "Done"]];
type Kind = "task" | "deep";
const KINDS: [Kind, string][] = [["task", "Giao AI Agent"], ["deep", "Đối chiếu BE"]];
const KIND_LABEL = Object.fromEntries(KINDS) as Record<Kind, string>;

/** The tagged message as the reply panel needs it (the task row only keeps a snapshot). */
function asMessage(t: Task): Message {
  return {
    chat_id: t.chat_id!, message_id: t.message_id!, sender_id: null, sender_name: t.sender_name ?? null, text: t.message_text ?? "", date: t.created_at,
    edit_date: null, reply_to_id: null, topic_id: null, outgoing: false, media_kind: null, deleted: false,
    handled: t.handled ?? false, handled_by: "", pinned: false, links: [], kept: true,
  };
}

type Status = "running" | "stopped" | "done";
const statusOf = (t: Task): Status =>
  t.running ? "running" : !t.result && t.mode !== "terminal" ? "stopped" : "done";
/** Done = the tagged message was ticked done (handled); everything else is Doing. */
const isDone = (t: Task) => !!t.handled;
const STATUS_LABEL: Record<Status, string> = { running: "Đang chạy", stopped: "Đã dừng", done: "Đã xong" };

function StatusIcon({ s, className }: { s: Status; className?: string }) {
  if (s === "running") return <Loader2 className={cn("animate-spin text-hl-2", className)} aria-hidden />;
  if (s === "stopped") return <Square className={cn("fill-current text-warn", className)} aria-hidden />;
  return <CheckCircle2 className={cn("text-ok", className)} aria-hidden />;
}

function HandledBadge() {
  return (
    <span className="inline-flex shrink-0 items-center gap-0.5 font-medium text-ok">
      <CheckCheck className="size-3" aria-hidden /> Đã xử lý
    </span>
  );
}

/**
 * Scrolling body plus a footer pinned under it (the input). Follows new output only while
 * the user sits at the bottom, and only inside this box so the page never jumps.
 */
function Feed({ follow, children, footer }: { follow: unknown; children: ReactNode; footer?: ReactNode }) {
  const { ref, onScroll } = useFollow(follow);
  return (
    <>
      <div ref={ref} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6">
        <div className="mx-auto grid max-w-3xl grid-cols-[minmax(0,1fr)] gap-4">{children}</div>
      </div>
      {footer && <div className="shrink-0 px-4 pt-2 pb-4 sm:px-6"><div className="mx-auto grid max-w-3xl gap-1.5">{footer}</div></div>}
    </>
  );
}

/** Headless session: conversation log with the follow-up composer pinned below it. */
function ChatPanel({ t, head }: { t: Task; head: ReactNode }) {
  const { id } = t;
  const running = !!t.running;
  const qc = useQueryClient();
  // The log grows in the cache (each poll appends the new lines), so coming back to a session shows it at once.
  const q = useQuery({
    queryKey: ["task-events", id],
    queryFn: async ({ signal }): Promise<TaskLog> => {
      const prev = qc.getQueryData<TaskLog>(["task-events", id]);
      const read = (after: number) =>
        api<{ items: TaskEvent[]; next: number; total: number; running: boolean }>(`/tasks/${id}/events?after=${after}`, { signal });
      let after = prev?.next ?? 0;
      let r = await read(after);
      if (r.total < after) r = await read((after = 0)); // the task was re-run: start over
      return { items: after ? [...prev!.items, ...r.items] : r.items, next: r.items.length ? r.next : after, running: r.running };
    },
    // Until the log itself says the run ended: the list can flip `running` off before the last poll caught the
    // result (the server reads the log before checking `running`, so that last poll has every line).
    // A finished turn only changes after a send, which refetches.
    refetchInterval: (query) => (running || query.state.data?.running ? 1500 : false),
  });
  const items = q.data?.items;
  const blocks = useMemo(() => groupEvents(items ?? []), [items]);

  return (
    <Feed follow={(items?.length ?? 0) + (running ? 0.5 : 0)} footer={<TaskComposer t={t} />}>
      {head}
      <ul aria-label="Hội thoại với AI" className="grid grid-cols-[minmax(0,1fr)] gap-3">
        {blocks.map((b, i) => b.kind === "tools"
          ? <li key={i} className="animate-in fade-in-0 duration-(--dur-short)"><ToolGroup steps={b.steps} live={running && i === blocks.length - 1} /></li>
          : <EventItem key={i} ev={b.ev} took={b.took} tools={b.tools} />)}
        {q.isPending && <li><Skeleton className="h-8 w-2/3" /></li>}
        {q.isError && (
          <li role="alert" className="flex items-center gap-2 px-1 text-xs text-error">
            Không đọc được hội thoại.
            <Button size="xs" variant="outline" disabled={q.isFetching} onClick={() => void q.refetch()}><RotateCw /> Thử lại</Button>
          </li>
        )}
        {running && blocks.at(-1)?.kind !== "tools" && (
          <li><AiThinking /></li>
        )}
      </ul>
    </Feed>
  );
}

/** One card in the session list: status, what it is about, group and age. */
function TaskRow({ t, now, active, mixed, onSelect }: { t: Task; now: number; active: boolean; mixed: boolean; onSelect: () => void }) {
  const s = statusOf(t);
  return (
    <li>
      <button type="button" aria-current={active || undefined} onClick={onSelect}
        className={cn("grid w-full grid-cols-[auto_minmax(0,1fr)] gap-x-2.5 gap-y-1 rounded-lg px-2.5 py-2 text-left transition-[background-color,box-shadow] duration-(--dur-micro)",
          active ? "bg-hl-wash shadow-[inset_0_0_0_1px_color-mix(in_oklch,var(--color-hl)_35%,transparent)]" : "hover:bg-paper-2")}>
        <span className="relative row-span-2 mt-0.5 grid size-4 place-items-center">
          {s === "running" && <span className="absolute inset-0 animate-ping rounded-full bg-hl/30" aria-hidden />}
          <StatusIcon s={s} className="size-4" /><span className="sr-only">{STATUS_LABEL[s]}</span>
        </span>
        <span className={cn("line-clamp-2 text-[0.8125rem] font-medium leading-snug", t.handled ? "text-ink-3" : "text-ink")}>{t.title || t.message_text || t.prompt}</span>
        <span className="flex min-w-0 flex-wrap gap-x-2.5 text-xs text-ink-3">
          <span className="shrink-0 font-mono tabular-nums">{sessionId(t)}</span>
          {mixed && <span className="shrink-0">{KIND_LABEL[t.kind]}</span>}
          {t.handled && <HandledBadge />}
          <span className="truncate">{t.chat_title || t.project.split("/").pop()}</span>
          <time className="shrink-0" dateTime={t.created_at} title={timeLabel(t.created_at, true)}>{ago(t.created_at, now)}</time>
        </span>
      </button>
    </li>
  );
}

/** One action in the session menu: icon, label, and what it does underneath. */
function MenuRow({ icon: Icon, label, hint, tone, disabled, onClick }: {
  icon: LucideIcon; label: string; hint: string; tone?: "ok" | "error"; disabled?: boolean; onClick: () => void;
}) {
  return (
    <Menu.Item disabled={disabled} onClick={onClick}
      className={cn("group grid cursor-default grid-cols-[1rem_minmax(0,1fr)] items-start gap-x-2.5 rounded-md px-2.5 py-1.5 outline-none select-none data-disabled:opacity-50",
        tone === "error" ? "data-highlighted:bg-error-wash" : tone === "ok" ? "data-highlighted:bg-ok-wash" : "data-highlighted:bg-paper-2")}>
      <Icon className={cn("mt-0.5 size-4 transition-transform duration-(--dur-micro) group-data-highlighted:scale-110",
        tone === "error" ? "text-error" : tone === "ok" ? "text-ok" : "text-ink-3")} aria-hidden />
      <span className="grid">
        <span className={cn("text-sm font-medium", tone === "error" ? "text-error" : "text-ink")}>{label}</span>
        <span className="text-xs text-ink-3">{hint}</span>
      </span>
    </Menu.Item>
  );
}

/** Where an ask goes: a new message in the session's group (the tagged message's topic). */
const AskTarget = createContext<{ taskId: string; chatId: string; messageId: string } | null>(null);

/** The same ask in the same session always gets the same request ID: the outbox then says, on any later visit,
 *  whether it went out, and a second click can't post it twice. */
async function askRequestId(taskId: string, text: string) {
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${taskId}\n${text}`))).slice(0, 16);
  h[6] = (h[6] & 0x0f) | 0x80; // UUID v8 (custom), RFC variant
  h[8] = (h[8] & 0x3f) | 0x80;
  const x = [...h].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}

/** Send button of one ask: posts it to the group; remembers (via the outbox) that it was sent. */
function PostAsk({ text }: { text: string }) {
  const at = use(AskTarget)!;
  const qc = useQueryClient();
  const rid = useQuery({ queryKey: ["ask-id", at.taskId, text], queryFn: () => askRequestId(at.taskId, text), staleTime: Infinity });
  const key = ["outbox", rid.data];
  const rec = useQuery({
    queryKey: key, enabled: !!rid.data, staleTime: Infinity, retry: false,
    queryFn: ({ signal }) => api<Outbox>(`/outbox/${rid.data}`, { signal })
      .catch((e) => { if (e instanceof ApiError && e.status === 404) return null; throw e; }), // never sent
  });
  const status = rec.data?.status;
  const send = useMutation({
    mutationFn: () => api<Outbox>("/messages/reply", { method: "POST", json: {
      request_id: rid.data!, chat_id: at.chatId, reply_to_message_id: at.messageId, text,
      retry_unknown: status === "unknown", // the user saw "không rõ" and chose to send again
      quote: false, // a new message in the tag's group / topic, not a reply
    } }),
    onSuccess: (r) => {
      qc.setQueryData(key, r);
      toast({ text: r.status === "sent" ? "Đã gửi vào nhóm" : "Đang gửi vào nhóm…" });
    },
    onError: (e) => {
      void qc.invalidateQueries({ queryKey: key });
      toast({ text: errorText(e, SEND_ERRORS, "Gửi thất bại.") });
    },
  });
  const sent = status === "sent";
  const busy = send.isPending || status === "pending" || status === "sending";
  const hint = sent ? "Đã gửi vào nhóm" : busy ? "Đang gửi…" : status === "unknown" ? "Không rõ đã gửi chưa: xem nhóm trước, bấm để gửi lại"
    : "Gửi ngay ý này thành tin mới trong nhóm";
  return (
    <Hint text={hint}>
      <button type="button" aria-label={sent ? "Đã gửi vào nhóm" : "Gửi ý này vào nhóm"} aria-busy={busy} disabled={sent || busy || !rid.data}
        onClick={() => send.mutate()} className={cn(ASK_BTN, sent && "text-ok", status === "unknown" && "text-warn")}>
        {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : sent ? <CheckCheck className="size-3.5" aria-hidden /> : <Send className="size-3.5" aria-hidden />}
      </button>
    </Hint>
  );
}

const postAsk = (text: string) => <PostAsk text={text} />;

/** The selected session: a slim title bar with one action menu, the scrolling conversation, the composer pinned at the bottom. */
function TaskDetail({ t, now, onBack, onOpenGroup, onUseText }: {
  t: Task; now: number; onBack: () => void; onOpenGroup: (chatId: string, messageId?: string, view?: View) => void; onUseText: (m: Message, text: string) => void;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const refresh = () => qc.invalidateQueries({ queryKey: ["tasks"] });
  const remove = useMutation({ mutationFn: () => api<void>(`/tasks/${t.id}`, { method: "DELETE" }), onSettled: refresh });
  // Done: on the tagged message, or on the session itself when its message is not a kept tag (Đối chiếu BE on any
  // reply); the session moves to the Done tab.
  const tag = t.chat_id && t.message_id ? asMessage(t) : null;
  const put = (handled: boolean, react = true) =>
    api<void>(`/tasks/${t.id}/handled`, { method: "PUT", json: { handled, react } }).finally(refresh);
  const mark = useMutation({
    mutationFn: ({ handled, react }: { handled: boolean; react: boolean }) => put(handled, react),
    onSuccess: (_, { handled }) => { if (handled) toast({ text: "Đã đánh dấu xong", undo: () => put(false) }); },
    onError: () => toast({ text: "Không cập nhật được, thử lại sau" }),
  });

  // Đối chiếu BE sits on a BE reply, not a kept tag: only Cả nhóm has it.
  const tagView: View = t.kind === "deep" || isDone(t) ? "live" : "pending";
  const openTag = () => onOpenGroup(t.chat_id!, t.message_id ?? undefined, tagView);

  const openAttached = useMemo(() => ({
    home: t.chat_id, open: (chatId: string, messageId: string) => onOpenGroup(chatId, messageId, "live"),
  }), [t.chat_id, onOpenGroup]);
  // Stable per session row, so the memoised answers don't re-render on every poll.
  const { id, chat_id, message_id } = t;
  const target = useMemo(() => (chat_id && message_id ? { taskId: id, chatId: chat_id, messageId: message_id } : null), [id, chat_id, message_id]);

  const head = <>
    {(t.title || t.message_text || t.chat_title) && (
      <div className="rounded-xl border-l-2 border-hl bg-paper-2 px-3.5 py-2.5 animate-in fade-in-0 slide-in-from-top-1 duration-(--dur-short)">
        <p className="mb-1 flex flex-wrap items-center gap-x-2.5 text-xs text-ink-3">
          {t.sender_name && <span className="font-medium text-ink-2">{t.sender_name}</span>}
          {t.chat_title && <span className="inline-flex items-center gap-1"><Users className="size-3" aria-hidden /> {t.chat_title}</span>}
          {tag && (
            <Hint side="bottom" text="Mở tin này trong nhóm Telegram">
              <button type="button" aria-label="Mở tin trong nhóm" onClick={openTag}
                className="-my-1 ml-auto grid size-6 place-items-center rounded-md text-ink-3 transition-colors duration-(--dur-micro) hover:bg-paper-3 hover:text-ink">
                <ExternalLink className="size-3.5" aria-hidden />
              </button>
            </Hint>
          )}
        </p>
        <p className="line-clamp-3 max-w-[70ch] whitespace-pre-wrap break-words text-[0.9375rem] leading-[1.55] text-ink">{t.title || t.message_text}</p>
      </div>
    )}
    <section aria-label="Yêu cầu giao cho AI" className="grid gap-1.5">
      <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)}
        className="flex w-fit items-center gap-1 rounded-sm text-left text-xs font-medium text-ink-3 transition-colors duration-(--dur-micro) hover:text-ink">
        <ChevronDown className={cn("size-3.5 transition-transform duration-(--dur-short)", !open && "-rotate-90")} aria-hidden /> Yêu cầu đã giao
      </button>
      {open && <p className="max-h-60 overflow-y-auto whitespace-pre-wrap break-words rounded-md bg-paper-2 p-3 text-sm leading-relaxed text-ink-2 animate-in fade-in-0 duration-(--dur-short)">{t.prompt}</p>}
    </section>
  </>;

  return (
    <div className="flex min-h-0 flex-1 flex-col animate-in fade-in-0 duration-(--dur-short)">
      <div className="flex shrink-0 items-center gap-2 border-b px-3 py-2 sm:px-4">
        <Button size="icon-sm" variant="ghost" className="-ml-1 md:hidden" onClick={onBack} aria-label="Về danh sách phiên"><ArrowLeft /></Button>
        <p className="min-w-0 flex-1 truncate text-sm font-medium text-ink" title={t.title || t.message_text || t.prompt}>{t.title || t.message_text || t.prompt}</p>
        {t.handled && <span className="text-xs"><HandledBadge /></span>}
        <Hint side="bottom" title={sessionId(t)} text="ID phiên. Bấm để chép; gõ hoặc dán vào ô tìm phiên để mở lại nhanh.">
          <button type="button" aria-label={`Chép ID phiên ${sessionId(t)}`}
            onClick={() => void copyText(sessionId(t), `Đã chép ${sessionId(t)}`)}
            className="shrink-0 rounded-sm px-1 font-mono text-xs text-ink-3 tabular-nums transition-colors duration-(--dur-micro) hover:bg-paper-3 hover:text-ink">
            {sessionId(t)}
          </button>
        </Hint>
        <time className="shrink-0 text-xs text-ink-3" dateTime={t.created_at} title={timeLabel(t.created_at, true)}>{ago(t.created_at, now)}</time>
        <Menu.Root>
          <Menu.Trigger openOnHover delay={120} aria-label="Thao tác phiên"
            className="grid size-[30px] shrink-0 place-items-center rounded-md text-ink-2 transition-colors duration-(--dur-micro) hover:bg-paper-3 hover:text-ink data-popup-open:bg-paper-3 data-popup-open:text-ink">
            {mark.isPending || remove.isPending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Ellipsis className="size-4" aria-hidden />}
          </Menu.Trigger>
          <Menu.Portal>
            <Menu.Positioner sideOffset={6} align="end" className="z-50 outline-none">
              <Menu.Popup className="grid w-64 origin-(--transform-origin) gap-0.5 rounded-lg bg-cotton p-1 shadow-pop outline-none transition-[transform,opacity] duration-(--dur-short) ease-(--ease-out) data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0">
                {tag && (t.handled ? (
                  <MenuRow icon={RotateCcw} label="Mở lại" hint="Tin tag chưa xử lý, phiên về Doing" disabled={mark.isPending}
                    onClick={() => mark.mutate({ handled: false, react: true })} />
                ) : <>
                  <MenuRow icon={CheckCheck} tone="ok" label="Done" hint="Tin tag và tin đính kèm đã xử lý, thả reaction" disabled={mark.isPending}
                    onClick={() => mark.mutate({ handled: true, react: true })} />
                  <MenuRow icon={Check} tone="ok" label="Done không reaction" hint="Tin tag và tin đính kèm đã xử lý, không reaction" disabled={mark.isPending}
                    onClick={() => mark.mutate({ handled: true, react: false })} />
                </>)}
                {tag && <Menu.Separator className="mx-1 my-0.5 h-px bg-rule" />}
                {t.result && tag && <MenuRow icon={MessageSquare} label="Dùng làm nháp trả lời" hint="Kết quả thành nháp trả lời tin tag" onClick={() => onUseText(tag, t.result!)} />}
                {t.chat_id && <MenuRow icon={Users} label="Mở nhóm" hint={tagView === "live" ? "Cả nhóm, cuộn tới tin đã giao AI Agent" : "Chưa xử lý, cuộn tới tin đã giao AI Agent"} onClick={openTag} />}
                {(t.chat_id || (t.result && tag)) && <Menu.Separator className="mx-1 my-0.5 h-px bg-rule" />}
                <MenuRow icon={Trash2} tone="error" label="Xóa phiên" hint="Hỏi xác nhận trước khi xóa" disabled={remove.isPending}
                  onClick={() => confirm("Xóa phiên này khỏi danh sách?") && remove.mutate()} />
              </Menu.Popup>
            </Menu.Positioner>
          </Menu.Portal>
        </Menu.Root>
      </div>
      {remove.isError && <p role="alert" className="border-b px-4 py-1.5 text-xs text-error">Xóa thất bại, thử lại.</p>}

      <AskTag value={sessionId(t)}>
      <AskTarget value={target}>
      <AskPost value={target && postAsk}>
      <OpenAttached value={openAttached}>
      {t.mode !== "terminal" ? <ChatPanel t={t} head={head} /> : ( // old Terminal tasks: prompt and result only
        <Feed follow={t.result}>
          {head}
          <section aria-label="Kết quả" className="grid gap-1.5">
            <h3 className="text-xs font-medium text-ink-3">Kết quả từ AI</h3>
            {t.result ? <Markdown asks text={t.result} className="rounded-md bg-ok-wash p-3 text-[0.9375rem] leading-[1.55] text-ink" />
              : <p className="rounded-md bg-paper-2 p-3 text-sm leading-relaxed text-ink-3">Phiên Terminal cũ chưa có kết quả.</p>}
          </section>
        </Feed>
      )}
      </OpenAttached>
      </AskPost>
      </AskTarget>
      </AskTag>
    </div>
  );
}

/** Every task handed to the AI: session tabs up in the page header, the list on the left, the selected session on the right. */
export function TasksPage({ focus, headSlot, onOpenGroup, onUseText }: {
  focus?: string | null; // task to select on open ("Mở phiên" from a tagged message)
  headSlot: HTMLElement | null; // the page header, where the session tabs go
  onOpenGroup: (chatId: string, messageId?: string, view?: View) => void; onUseText: (m: Message, text: string) => void;
}) {
  const q = useTaskList();
  const now = useNow();
  const [picked, setFilter] = useState<Filter | null>(focus ? null : "doing");
  const [pickedKind, setKind] = useState<Kind | null>(null);
  const [sel, setSel] = useState<string | null>(focus ?? null); // null on phones = show the list
  const [find, setFind] = useState(""); // ID or text: searches every session, whatever the tabs say
  const every = q.data ?? [];
  // "Mở phiên": open the tabs matching the session (its kind; Done → done, else doing) until the user picks one.
  const focused = focus ? every.find((t) => t.id === focus) : undefined;
  const kind: Kind = pickedKind ?? focused?.kind ?? "task";
  const all = every.filter((t) => t.kind === kind);
  const filter: Filter = picked ?? (focused ? (isDone(focused) ? "done" : "doing") : "all");
  const running = every.filter((t) => t.running).length;
  const done = all.filter(isDone).length;
  const count: Record<Filter, number> = { all: all.length, doing: all.length - done, done };
  const searching = !!find.trim();
  const rows = searching ? every.filter((t) => sessionMatches(t, find)) : all.filter((t) => filter === "all" || (filter === "done") === isDone(t));
  // "Mở phiên" on a session that is gone: say so rather than open another one.
  const gone = !!focus && sel === focus && q.isSuccess && !every.some((t) => t.id === focus);
  const cur = gone ? undefined : (rows.find((t) => t.id === sel) ?? rows[0]);

  return (
    <section aria-label="AI Agent" className="flex min-h-0 flex-col">
      {headSlot && createPortal(
        <div className="flex min-w-0 items-center gap-3">
          <Segmented id="agent-kind" label="Loại phiên" value={kind} onChange={(k) => { setKind(k); setSel(null); }}
            items={KINDS.map(([id, label]) => ({ value: id, label: <>{label} <span className="font-mono tabular-nums opacity-70">{every.filter((t) => t.kind === id).length}</span></> }))} />
          {running > 0 && (
            <span className="inline-flex shrink-0 items-center gap-1.5 text-xs font-medium text-hl-2 animate-in fade-in-0 zoom-in-95">
              <span className="relative flex size-2" aria-hidden><span className="absolute inset-0 animate-ping rounded-full bg-hl/60" /><span className="relative size-2 rounded-full bg-hl" /></span>
              <span className="font-mono tabular-nums">{running}</span> đang chạy
            </span>
          )}
        </div>,
        headSlot,
      )}

      {q.isPending && (
        <div aria-label="Đang tải…" className="flex min-h-0 flex-1">
          <ul className="grid w-full content-start gap-3 p-3 md:w-72 md:border-r">
            {[0, 1, 2].map((i) => (
              <li key={i} className="flex gap-2.5"><Skeleton className="size-4 rounded-full" /><div className="grid flex-1 gap-1.5"><Skeleton className="h-4 w-3/4" /><Skeleton className="h-3 w-1/2" /></div></li>
            ))}
          </ul>
          <div className="hidden flex-1 gap-3 p-5 md:grid md:content-start"><Skeleton className="h-6 w-1/3" /><Skeleton className="h-24 w-full" /></div>
        </div>
      )}
      {q.isError && (
        <div role="alert" className="grid justify-items-start gap-2 p-5 text-sm">
          <p className="text-error">Không tải được danh sách phiên.</p>
          <Button size="sm" variant="outline" aria-busy={q.isFetching} disabled={q.isFetching} onClick={() => void q.refetch()}>
            <RotateCw /> Thử lại
          </Button>
        </div>
      )}
      {q.isSuccess && all.length === 0 && (
        <div className="grid justify-items-center gap-3 py-20 text-center text-sm text-ink-2 animate-in fade-in-0">
          <AiBot className="size-10" />
          <p>{kind === "deep" ? "Chưa có phiên Đối chiếu BE. Bấm nút bộ não trên tin BE trả lời, hoặc “Đối chiếu code” ở mục Đã chốt trong Briefing."
            : "Chưa giao việc nào cho AI Agent. Mở một tin, bấm “Giao AI Agent”, chọn dự án."}</p>
          {kind === "task" && <Button size="sm" variant="outline" onClick={() => onOpenGroup(ALL)}>Mở Việc cần xử lý</Button>}
        </div>
      )}
      {q.isSuccess && all.length > 0 && (
        <div className="flex min-h-0 flex-1">
          <aside aria-label="Phiên" className={cn("flex min-h-0 w-full flex-col md:w-72 md:shrink-0 md:border-r", sel && "max-md:hidden")}>
            <div className="grid shrink-0 gap-2 p-2">
              <span className="relative">
                <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-ink-3" aria-hidden />
                <Input type="search" value={find} onChange={(e) => setFind(e.target.value)} aria-label="Tìm phiên"
                  placeholder="Tìm theo ID (REF-…) hoặc nội dung" className="h-8 pl-8 text-xs md:text-xs" />
              </span>
              {!searching && <Segmented id="agent-filter" label="Lọc phiên" value={filter} onChange={setFilter} className="w-full [&>button]:flex-1"
                items={FILTERS.map(([id, label]) => ({ value: id, label: <>{label} <span className="font-mono tabular-nums opacity-70">{count[id]}</span></> }))} />}
            </div>
            <ul aria-label="Danh sách phiên" className="grid min-h-0 flex-1 content-start gap-0.5 overflow-y-auto px-2 pb-2">
              {rows.map((t) => <TaskRow key={t.id} t={t} now={now} active={t.id === cur?.id} mixed={searching} onSelect={() => setSel(t.id)} />)}
              {rows.length === 0 && <li className="px-2 py-6 text-center text-xs text-ink-3">{searching ? "Không có phiên nào khớp." : "Không có phiên nào khớp bộ lọc."}</li>}
            </ul>
          </aside>
          <div className={cn("min-h-0 min-w-0 flex-1 flex-col", sel ? "flex" : "hidden md:flex")}>
            {cur ? <TaskDetail key={cur.id} t={cur} now={now} onBack={() => setSel(null)} onOpenGroup={onOpenGroup} onUseText={onUseText} />
              : gone ? (
                <div role="status" className="grid justify-items-start gap-2 p-5 text-sm text-ink-2">
                  <p>Phiên này không còn (có thể đã bị xóa).</p>
                  <Button size="sm" variant="outline" onClick={() => setSel(null)}>Xem danh sách phiên</Button>
                </div>
              ) : <div className="grid flex-1 place-items-center text-sm text-ink-3"><AiBot className="size-10 opacity-60" /></div>}
          </div>
        </div>
      )}
    </section>
  );
}
