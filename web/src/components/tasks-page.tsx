"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft, Bot, CheckCheck, CheckCircle2, ChevronDown, CircleAlert, FilePlus, FileText, FolderGit2, FolderSearch, Globe, ListChecks,
  type LucideIcon, Square, Loader2, MessageSquare, Pencil, RotateCcw, RotateCw, Search, SquareTerminal, Trash2, Users, Wrench, X,
} from "lucide-react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { ModelEffortPicker } from "@/components/ai";
import { Markdown } from "@/components/markdown";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { api, ApiError, type Message, type Task } from "@/lib/api";
import { ALL, byUnit, TASK_MODES, timeLabel, useNow, useTaskList } from "@/lib/inbox";
import { cn } from "@/lib/utils";

type TaskEvent = { kind: string; text: string; error?: boolean };
type TaskLog = { items: TaskEvent[]; next: number };
type Filter = "all" | "doing" | "done";
const FILTERS: [Filter, string][] = [["all", "Tất cả"], ["doing", "Doing"], ["done", "Done"]];

function ago(date: string, now: number) {
  const mins = Math.max(0, Math.round((now - new Date(date).getTime()) / 60_000));
  return mins < 1 ? "vừa xong" : `${byUnit(mins).join(" ")} trước`;
}

const atBottom = (el: HTMLElement) => el.scrollHeight - el.scrollTop - el.clientHeight < 40;

/** The tagged message as the reply panel needs it (the task row only keeps a snapshot). */
function asMessage(t: Task): Message {
  return {
    chat_id: t.chat_id!, message_id: t.message_id!, sender_id: null, sender_name: t.sender_name ?? null, text: t.message_text ?? "", date: t.created_at,
    edit_date: null, reply_to_id: null, topic_id: null, outgoing: false, media_kind: null, deleted: false,
    handled: t.handled ?? false, pinned: false, links: [],
  };
}

/** Tool name -> icon and a Vietnamese verb, so a step reads "Đọc SellProgressCard.kt". */
const TOOLS: Record<string, [LucideIcon, string]> = {
  Read: [FileText, "Đọc"], Edit: [Pencil, "Sửa"], MultiEdit: [Pencil, "Sửa"], Write: [FilePlus, "Tạo"],
  Bash: [SquareTerminal, "Chạy"], Grep: [Search, "Tìm"], Glob: [FolderSearch, "Tìm file"],
  WebFetch: [Globe, "Mở web"], WebSearch: [Globe, "Tìm web"], Task: [Bot, "Giao việc"], Agent: [Bot, "Giao việc"],
  TodoWrite: [ListChecks, "Lập kế hoạch"],
};
const toolMeta = (name: string): [LucideIcon, string] => TOOLS[name] ?? [Wrench, name];

type Step = { name: string; arg: string; out?: TaskEvent };
type Block = { kind: "tools"; steps: Step[] } | { kind: "event"; ev: TaskEvent };

/** Folds consecutive tool calls and their outputs into one block; parallel calls get their outputs back in order. */
function groupEvents(items: TaskEvent[]): Block[] {
  const out: Block[] = [];
  let waiting: Step[] = [];
  let shown = new Set<string>(); // assistant texts of the current turn
  for (const ev of items) {
    if (ev.kind === "user") shown = new Set();
    if (ev.kind === "assistant" && ev.text?.trim()) shown.add(ev.text.trim());
    if (ev.kind === "result" && ev.text?.trim()) { // the final answer already streamed as text: show it once, in the result box
      const res = ev.text.trim();
      const n = out.length;
      for (let b = out.at(-1); b?.kind === "event" && b.ev.kind === "assistant" && b.ev.text.trim() && res.includes(b.ev.text.trim()); b = out.at(-1)) out.pop();
      if (out.length === n && shown.has(res)) continue; // a late result (background agents) repeating an earlier text
    }
    if (ev.kind !== "tool" && ev.kind !== "tool_result") { out.push({ kind: "event", ev }); continue; }
    let last = out.at(-1);
    if (last?.kind !== "tools") { last = { kind: "tools", steps: [] }; out.push(last); waiting = []; }
    if (ev.kind === "tool") {
      const [name, ...rest] = ev.text.split("  "); // "<name>  <input>" from the backend
      const step: Step = { name, arg: rest.join("  ") };
      last.steps.push(step);
      waiting.push(step);
    } else {
      const s = waiting.shift();
      if (s) s.out = ev;
    }
  }
  return out;
}

/** A path shows as its file name, the folder muted and the full path on hover. */
function StepArg({ arg }: { arg: string }) {
  if (!arg.startsWith("/")) return <span className="truncate font-mono text-xs text-ink-2" title={arg}>{arg}</span>;
  const cut = arg.lastIndexOf("/");
  return (
    <span className="min-w-0 truncate text-xs" title={arg}>
      <span className="font-medium text-ink">{arg.slice(cut + 1)}</span>
      <span className="ml-1.5 text-ink-3">{arg.slice(0, cut).split("/").slice(-2).join("/")}</span>
    </span>
  );
}

function StepRow({ s, live }: { s: Step; live: boolean }) {
  const [open, setOpen] = useState(false);
  const [Icon, verb] = toolMeta(s.name);
  const err = s.out?.error;
  return (
    <li>
      <button type="button" disabled={!s.out?.text} aria-expanded={open} onClick={() => setOpen((v) => !v)}
        className="flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1 text-left transition-colors duration-(--dur-micro) enabled:hover:bg-paper-2">
        {live ? <Loader2 className="size-3.5 shrink-0 animate-spin text-info" aria-hidden />
          : <Icon className={cn("size-3.5 shrink-0", err ? "text-error" : "text-ink-3")} aria-hidden />}
        <span className={cn("shrink-0 text-xs", err ? "text-error" : "text-ink-2")}>{verb}</span>
        <StepArg arg={s.arg} />
        {s.out?.text && <ChevronDown className={cn("ml-auto size-3.5 shrink-0 text-ink-3 transition-transform duration-(--dur-short)", !open && "-rotate-90")} aria-hidden />}
      </button>
      {open && s.out && (
        <pre className={cn("mt-1 mb-1.5 ml-7 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-md p-2.5 font-mono text-[0.6875rem] leading-relaxed animate-in fade-in-0 duration-(--dur-short)",
          err ? "bg-error-wash text-error" : "bg-paper-2 text-ink-2")}>{s.out.text}</pre>
      )}
    </li>
  );
}

/** A run of tool steps: one summary line ("Đọc 5 · Tìm 2"), the steps behind it. While live it stays open on the current step. */
function ToolGroup({ steps, live }: { steps: Step[]; live: boolean }) {
  const [toggled, setToggled] = useState<boolean | null>(null);
  const open = toggled ?? live;
  const counts = new Map<string, number>();
  for (const s of steps) { const v = toolMeta(s.name)[1]; counts.set(v, (counts.get(v) ?? 0) + 1); }
  const current = steps.at(-1)!;
  const errors = steps.filter((s) => s.out?.error).length;
  return (
    <div className="rounded-lg border border-rule bg-cotton">
      <button type="button" aria-expanded={open} onClick={() => setToggled(!open)}
        className="flex w-full min-w-0 items-center gap-2 px-3 py-2 text-left text-xs text-ink-2 transition-colors duration-(--dur-micro) hover:text-ink">
        {live ? <Loader2 className="size-3.5 shrink-0 animate-spin text-info" aria-hidden /> : <Wrench className="size-3.5 shrink-0 text-ink-3" aria-hidden />}
        {live ? (
          <span className="flex min-w-0 items-center gap-1.5"><span className="shrink-0 text-info">Đang {toolMeta(current.name)[1].toLowerCase()}</span><StepArg arg={current.arg} /></span>
        ) : (
          <span className="truncate">{[...counts].map(([v, n]) => `${v} ${n}`).join(" · ")}</span>
        )}
        {errors > 0 && <span className="shrink-0 rounded-sm bg-error-wash px-1.5 text-error">{errors} lỗi</span>}
        <span className="ml-auto shrink-0 tabular-nums text-ink-3">{steps.length} bước</span>
        <ChevronDown className={cn("size-3.5 shrink-0 text-ink-3 transition-transform duration-(--dur-short)", !open && "-rotate-90")} aria-hidden />
      </button>
      {open && (
        <ul className="grid grid-cols-[minmax(0,1fr)] border-t border-rule px-1.5 py-1.5 animate-in fade-in-0 duration-(--dur-short)">
          {steps.map((s, i) => <StepRow key={i} s={s} live={live && i === steps.length - 1 && !s.out} />)}
        </ul>
      )}
    </div>
  );
}

const AI_TEXT = "text-[0.9375rem] leading-[1.6]";

function EventItem({ ev }: { ev: TaskEvent }) {
  if (ev.kind === "user") {
    return <li className="flex justify-end"><p className={cn(AI_TEXT, "max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-sm bg-paper-3 px-3.5 py-2 text-ink")}>{ev.text}</p></li>;
  }
  if (ev.kind === "result") {
    return (
      <li className={cn("rounded-lg p-3.5", ev.error ? "bg-error-wash" : "bg-ok-wash")}>
        <p className={cn("mb-1.5 flex items-center gap-1.5 text-xs font-medium", ev.error ? "text-error" : "text-ok")}>
          {ev.error ? <CircleAlert className="size-3.5" aria-hidden /> : <CheckCircle2 className="size-3.5" aria-hidden />}
          {ev.error ? "Có lỗi" : "Kết quả"}
        </p>
        {ev.text && <Markdown text={ev.text} className={AI_TEXT} />}
      </li>
    );
  }
  return <li className={cn("px-0.5", ev.error ? "text-error" : "text-ink")}><Markdown text={ev.text} className={AI_TEXT} /></li>;
}

type Status = "running" | "stopped" | "done";
const statusOf = (t: Task): Status =>
  t.running ? "running" : !t.result && t.mode !== "terminal" ? "stopped" : "done";
/** Done = the tagged message was ticked done (handled); everything else is Doing. */
const isDone = (t: Task) => !!t.handled;
const STATUS_LABEL: Record<Status, string> = { running: "Đang chạy", stopped: "Đã dừng", done: "Đã xong" };

function StatusIcon({ s, className }: { s: Status; className?: string }) {
  if (s === "running") return <Loader2 className={cn("animate-spin text-info", className)} aria-hidden />;
  if (s === "stopped") return <Square className={cn("fill-current text-warn", className)} aria-hidden />;
  return <CheckCircle2 className={cn("text-ok", className)} aria-hidden />;
}

function HandledBadge() {
  return (
    <span className="inline-flex shrink-0 items-center gap-0.5 font-medium text-ok" title="Tin tag đã đánh dấu xử lý">
      <CheckCheck className="size-3" aria-hidden /> Đã xử lý
    </span>
  );
}

function StatusBadge({ s }: { s: Status }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 font-medium",
      { running: "bg-info-wash text-info", stopped: "bg-warn-wash text-warn", done: "bg-ok-wash text-ok" }[s])}>
      <StatusIcon s={s} className="size-3.5" /> {STATUS_LABEL[s]}
    </span>
  );
}

/**
 * Scrolling body plus a footer pinned under it (the input). Follows new output only while
 * the user sits at the bottom, and only inside this box so the page never jumps.
 */
function Feed({ follow, children, footer }: { follow: unknown; children: ReactNode; footer?: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  useEffect(() => {
    const el = box.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [follow]);
  return (
    <>
      <div ref={box} onScroll={(e) => { stick.current = atBottom(e.currentTarget); }} className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5">
        <div className="mx-auto grid max-w-3xl grid-cols-[minmax(0,1fr)] gap-4">{children}</div>
      </div>
      {footer && <div className="shrink-0 border-t bg-cotton px-4 py-3 sm:px-5"><div className="mx-auto grid max-w-3xl gap-1.5">{footer}</div></div>}
    </>
  );
}

// Queued prompts per task, kept outside the panel so switching sessions doesn't drop them.
// ponytail: client-only, drains only while that session is open and lost on reload; move server-side if that matters.
const queues = new Map<string, string[]>();

/** Headless session: conversation log with the follow-up input pinned below it. */
function ChatPanel({ id, running, plan, head }: { id: string; running: boolean; plan: boolean; head: ReactNode }) {
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const [edit, setEdit] = useState(false); // plan task: let the next turns edit files (approve the plan)
  // The log grows in the cache (each poll appends the new lines), so coming back to a session shows it at once.
  const q = useQuery({
    queryKey: ["task-events", id],
    queryFn: async ({ signal }): Promise<TaskLog> => {
      const prev = qc.getQueryData<TaskLog>(["task-events", id]);
      const read = (after: number) =>
        api<{ items: TaskEvent[]; next: number; total: number }>(`/tasks/${id}/events?after=${after}`, { signal });
      let after = prev?.next ?? 0;
      let r = await read(after);
      if (r.total < after) r = await read((after = 0)); // the task was re-run: start over
      return { items: after ? [...prev!.items, ...r.items] : r.items, next: r.items.length ? r.next : after };
    },
    refetchInterval: running ? 1500 : false, // a finished turn only changes after a send, which refetches
  });
  const items = q.data?.items;
  const blocks = useMemo(() => groupEvents(items ?? []), [items]);
  const send = useMutation({
    mutationFn: ({ line }: { line: string; queued?: boolean }) =>
      api<void>(`/tasks/${id}/message`, { method: "POST", json: { text: line, edit: plan && edit } }),
    // Awaited so the mutation stays pending until the task list shows the new turn running: the queue can't fire twice.
    // Here, not per-mutate, so a sent queued prompt leaves the queue even if the panel unmounted meanwhile.
    onSuccess: async (_, { queued }) => {
      if (queued) setQueue((q) => q.slice(1));
      void q.refetch();
      await qc.invalidateQueries({ queryKey: ["tasks"] });
    },
  });
  const submit = () => {
    if (text.trim() && !running && !send.isPending) send.mutate({ line: text.trim() }, { onSuccess: () => setText("") });
  };
  // Cmd/Ctrl+Enter queues the prompt; queued prompts run one per turn, in order, once the AI is idle.
  const [queue, setQueueState] = useState<string[]>(() => queues.get(id) ?? []);
  const setQueue = (f: (q: string[]) => string[]) => {
    const next = f(queues.get(id) ?? []);
    queues.set(id, next);
    setQueueState(next);
  };
  const enqueue = () => { if (text.trim()) { if (send.isError) send.reset(); setQueue((q) => [...q, text.trim()]); setText(""); } }; // reset: a new prompt retries a paused queue
  useEffect(() => {
    // Sent prompts leave the queue on success; a failed send stays first and pauses the queue until the next manual send.
    if (!running && !send.isPending && !send.isError && queue.length) send.mutate({ line: queue[0], queued: true });
  });
  const busy = send.error instanceof ApiError && send.error.code === "task_busy";

  return (
    <Feed follow={(items?.length ?? 0) + (running ? 0.5 : 0)} footer={<>
      <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <textarea
          aria-label="Nhắn tiếp cho AI" rows={2} maxLength={8000} value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              if (e.metaKey || e.ctrlKey) enqueue();
              else submit();
            }
          }}
          placeholder={running ? "AI đang làm: ⌘+Enter để thêm vào hàng đợi" : "Nhắn tiếp cho AI (Enter gửi, ⌘+Enter vào hàng đợi, Shift+Enter xuống dòng)"}
          className="min-h-10 min-w-0 flex-1 resize-none rounded-md border border-rule-2 bg-cotton px-3 py-2 text-sm text-ink placeholder:text-ink-3 hover:border-ink-3 focus-visible:-outline-offset-1 disabled:cursor-not-allowed disabled:opacity-50"
        />
        {running
          ? <Button type="button" variant="outline" disabled={!text.trim()} onClick={enqueue}>Vào hàng đợi</Button>
          : <Button type="submit" aria-busy={send.isPending} disabled={!text.trim() || send.isPending}>Gửi</Button>}
      </form>
      {queue.length > 0 && (
        <ol aria-label="Hàng đợi" className="grid gap-1">
          {queue.map((line, i) => (
            <li key={i} className="flex items-center gap-2 rounded-md bg-paper px-2 py-1 text-xs text-ink-2">
              <span className="shrink-0 font-mono tabular-nums text-ink-3">{i + 1}</span>
              <span className="min-w-0 flex-1 truncate" title={line}>{line}</span>
              <Button size="xs" variant="ghost" aria-label="Bỏ khỏi hàng đợi" disabled={i === 0 && send.isPending} onClick={() => setQueue((q) => q.filter((_, j) => j !== i))}><X /></Button>
            </li>
          ))}
        </ol>
      )}
      {plan && (
        <label className="flex w-fit items-center gap-2 text-xs text-ink-2" title="Phiên đang ở chế độ Chỉ đọc (plan). Bật để lượt nhắn tiếp được sửa file, ví dụ duyệt plan rồi bảo AI làm.">
          <Checkbox checked={edit} onCheckedChange={(v) => setEdit(!!v)} disabled={running} />
          Accept edit: lượt nhắn tiếp được sửa file
        </label>
      )}
      {send.isError && <p role="alert" className="text-xs text-error">{busy ? "AI đang làm lượt trước." : "Gửi thất bại."}</p>}
    </>}>
      {head}
      <ul aria-label="Hội thoại với AI" className="grid grid-cols-[minmax(0,1fr)] gap-3">
        {blocks.map((b, i) => b.kind === "tools"
          ? <li key={i} className="animate-in fade-in-0 duration-(--dur-short)"><ToolGroup steps={b.steps} live={running && i === blocks.length - 1} /></li>
          : <EventItem key={i} ev={b.ev} />)}
        {q.isPending && <li><Skeleton className="h-8 w-2/3" /></li>}
        {q.isError && (
          <li role="alert" className="flex items-center gap-2 px-1 text-xs text-error">
            Không đọc được hội thoại.
            <Button size="xs" variant="outline" disabled={q.isFetching} onClick={() => void q.refetch()}><RotateCw /> Thử lại</Button>
          </li>
        )}
        {running && blocks.at(-1)?.kind !== "tools" && (
          <li className="flex items-center gap-2 px-0.5 text-xs text-ink-3" aria-live="polite">
            <span className="flex gap-1" aria-hidden>{[0, 150, 300].map((d) => <span key={d} className="ai-dot size-1.5 rounded-full bg-info" style={{ animationDelay: `${d}ms` }} />)}</span>
            AI đang suy nghĩ…
          </li>
        )}
      </ul>
    </Feed>
  );
}

/** One line in the session list: status icon, what it is about, project and age. */
function TaskRow({ t, now, active, onSelect }: { t: Task; now: number; active: boolean; onSelect: () => void }) {
  const s = statusOf(t);
  return (
    <li>
      <button type="button" aria-current={active || undefined} onClick={onSelect}
        className={cn("grid w-full grid-cols-[auto_1fr] gap-x-2.5 gap-y-0.5 border-l-2 px-3 py-2.5 text-left transition-colors duration-(--dur-micro)",
          active ? "border-hl bg-hl-wash" : "border-transparent hover:bg-paper-2")}>
        <span className="relative row-span-2 mt-0.5 grid size-4 place-items-center">
          {s === "running" && <span className="absolute inset-0 animate-ping rounded-full bg-info/25" aria-hidden />}
          <StatusIcon s={s} className="size-4" />
        </span>
        <span className={cn("truncate text-sm font-medium", t.handled ? "text-ink-3" : "text-ink")}>{t.message_text || t.prompt}</span>
        <span className="flex min-w-0 gap-1.5 text-xs text-ink-3">
          <span className={cn("shrink-0", s === "running" && "text-info")}>{STATUS_LABEL[s]}</span>·
          {t.handled && <><HandledBadge />·</>}
          <span className="truncate">{t.chat_title || t.project.split("/").pop()}</span>·
          <time className="shrink-0" dateTime={t.created_at} title={timeLabel(t.created_at, true)}>{ago(t.created_at, now)}</time>
        </span>
      </button>
    </li>
  );
}

/** The selected session: status and actions on top, scrolling content, input pinned at the bottom. */
function TaskDetail({ t, now, onBack, onOpenGroup, onUseText }: {
  t: Task; now: number; onBack: () => void; onOpenGroup: (chatId: string, messageId?: string) => void; onUseText: (m: Message, text: string) => void;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const running = !!t.running;
  const headless = t.mode !== "terminal"; // old Terminal tasks: prompt and result only
  const refresh = () => qc.invalidateQueries({ queryKey: ["tasks"] });
  const reopen = useMutation({
    mutationFn: () => api<void>(`/tasks/${t.id}/reopen`, { method: "POST" }),
    onSuccess: () => qc.removeQueries({ queryKey: ["task-events", t.id] }), // the new run's log starts over, not after the old lines
    onSettled: refresh,
  });
  const remove = useMutation({ mutationFn: () => api<void>(`/tasks/${t.id}`, { method: "DELETE" }), onSettled: refresh });
  const stop = useMutation({ mutationFn: () => api<void>(`/tasks/${t.id}/stop`, { method: "POST" }), onSettled: refresh });

  const head = <>
    {(t.message_text || t.chat_title) && (
      <div className="rounded-md bg-paper-2 px-3 py-2.5">
        <p className="mb-1 flex flex-wrap items-center gap-x-2.5 text-xs text-ink-3">
          {t.sender_name && <span className="font-medium text-ink-2">{t.sender_name}</span>}
          {t.chat_title && <span className="inline-flex items-center gap-1"><Users className="size-3" aria-hidden /> {t.chat_title}</span>}
        </p>
        <p className="line-clamp-3 max-w-[70ch] whitespace-pre-wrap break-words text-[0.9375rem] leading-[1.55] text-ink">{t.message_text}</p>
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

  const result = (
    <section aria-label="Kết quả" className="grid gap-1.5">
      <h3 className="text-xs font-medium tracking-normal text-ink-3">Kết quả từ AI</h3>
      {t.result ? (
        <Markdown text={t.result} className="rounded-md bg-ok-wash p-3 text-[0.9375rem] leading-[1.55] text-ink" />
      ) : (
        <p className="rounded-md bg-paper-2 p-3 text-sm leading-relaxed text-ink-3">
          Phiên Terminal cũ chưa có kết quả. Bấm “Chạy lại” để chạy lại.
        </p>
      )}
    </section>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col animate-in fade-in-0 duration-(--dur-short)">
      <div className="grid shrink-0 gap-2.5 border-b px-4 py-3 sm:px-5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs">
          <Button size="icon-sm" variant="ghost" className="-ml-2 md:hidden" onClick={onBack} aria-label="Về danh sách phiên"><ArrowLeft /></Button>
          <StatusBadge s={statusOf(t)} />
          {t.handled && <HandledBadge />}
          <span className="rounded-sm border border-rule px-1.5 py-0.5 text-ink-2">{TASK_MODES[t.mode] ?? t.mode}</span>
          <span className="inline-flex items-center gap-1 text-ink-2" title={t.project}>
            <FolderGit2 className="size-3.5" aria-hidden /> {t.project.split("/").pop()}
          </span>
          <time className="ml-auto text-ink-3" dateTime={t.created_at} title={timeLabel(t.created_at, true)}>
            {ago(t.created_at, now)}
          </time>
        </div>
        <div className="flex flex-wrap gap-2">
          {running && headless && (
            <Button size="sm" variant="outline" className="hover:bg-error-wash hover:text-error" aria-busy={stop.isPending} disabled={stop.isPending}
              title="Dừng AI đang chạy phiên này (giữ hội thoại, có thể nhắn tiếp hoặc chạy lại)" onClick={() => stop.mutate()}>
              {stop.isPending ? <Loader2 className="animate-spin" aria-hidden /> : <Square className="fill-current" aria-hidden />} {stop.isPending ? "Đang dừng…" : "Dừng"}
            </Button>
          )}
          {t.result && t.chat_id && t.message_id && (
            <Button size="sm" onClick={() => onUseText(asMessage(t), t.result!)}>
              <MessageSquare /> Dùng kết quả làm nháp trả lời
            </Button>
          )}
          {t.chat_id && (
            <Button size="sm" variant="outline" title="Mở nhóm và cuộn tới tin đã giao việc" onClick={() => onOpenGroup(t.chat_id!, t.message_id ?? undefined)}>Mở nhóm</Button>
          )}
          <Button size="sm" variant="outline" aria-busy={reopen.isPending} disabled={reopen.isPending}
            title="Chạy lại từ đầu cùng yêu cầu (xóa hội thoại và kết quả cũ)"
            onClick={() => confirm("Chạy lại phiên này từ đầu? Hội thoại và kết quả cũ sẽ bị xóa.") && reopen.mutate()}>
            <RotateCcw /> Chạy lại
          </Button>
          <Button size="sm" variant="destructive" className="ml-auto" aria-busy={remove.isPending} disabled={remove.isPending}
            onClick={() => confirm("Xóa phiên này khỏi danh sách?") && remove.mutate()}>
            <Trash2 /> Xóa
          </Button>
        </div>
        {(reopen.isError || remove.isError || stop.isError) && <p role="alert" className="text-xs text-error">Thao tác thất bại, thử lại.</p>}
      </div>

      {headless ? <ChatPanel id={t.id} running={running} plan={t.mode === "plan"} head={head} />
        : <Feed follow={t.result}>{head}{result}</Feed>}
    </div>
  );
}

/** Every task handed to the AI: the list on the left, the selected session on the right. */
export function TasksPage({ focus, onBack, onOpenGroup, onUseText }: {
  focus?: string | null; // task to select on open ("Mở phiên" from a tagged message)
  onBack: () => void; onOpenGroup: (chatId: string, messageId?: string) => void; onUseText: (m: Message, text: string) => void;
}) {
  const q = useTaskList();
  const now = useNow();
  const [picked, setFilter] = useState<Filter | null>(focus ? null : "doing");
  const [sel, setSel] = useState<string | null>(focus ?? null); // null on phones = show the list
  const all = q.data ?? [];
  // "Mở phiên": open the tab matching the tagged message's status (Done → done, else doing) until the user picks one.
  const focused = focus ? all.find((t) => t.id === focus) : undefined;
  const filter: Filter = picked ?? (focused ? (isDone(focused) ? "done" : "doing") : "all");
  const running = all.filter((t) => t.running).length;
  const done = all.filter(isDone).length;
  const count: Record<Filter, number> = { all: all.length, doing: all.length - done, done };
  const rows = all.filter((t) => filter === "all" || (filter === "done") === isDone(t));
  // "Mở phiên" on a session that is gone: say so rather than open another one.
  const gone = !!focus && sel === focus && q.isSuccess && !all.some((t) => t.id === focus);
  const cur = gone ? undefined : (rows.find((t) => t.id === sel) ?? rows[0]);

  return (
    <section aria-label="AI Agent" className="flex min-h-0 flex-col">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b px-3 md:px-5">
        <Button size="icon-sm" variant="ghost" className="md:hidden" onClick={onBack} aria-label="Quay lại"><ArrowLeft /></Button>
        <p className="min-w-0 truncate text-[0.8125rem] text-ink-2">
          <span className="font-mono text-ink tabular-nums">{all.length}</span> phiên
          {running > 0 && <>, <span className="inline-flex items-center gap-1 text-info"><Loader2 className="size-3 animate-spin" aria-hidden /><span className="font-mono tabular-nums">{running}</span> đang chạy</span></>}
        </p>
        <ModelEffortPicker task className="ml-auto hidden sm:flex" />
        <div className="ml-auto flex gap-1 sm:ml-0" role="group" aria-label="Lọc phiên">
          {FILTERS.map(([id, label]) => (
            <button key={id} type="button" aria-pressed={filter === id} onClick={() => setFilter(id)}
              className={cn("h-7 whitespace-nowrap rounded-md border px-2.5 text-xs transition-[background-color,border-color,color] duration-(--dur-micro)",
                filter === id ? "border-hl bg-hl font-medium text-hl-ink" : "border-rule text-ink-2 hover:border-rule-2 hover:bg-paper-2 hover:text-ink")}>
              {label} <span className="font-mono tabular-nums opacity-70">{count[id]}</span>
            </button>
          ))}
        </div>
      </div>

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
      {q.isSuccess && rows.length === 0 && (
        <div className="grid justify-items-center gap-3 py-20 text-center text-sm text-ink-2">
          <Bot className="size-5 text-ink-3" aria-hidden />
          <p>{all.length === 0 ? "Chưa giao việc nào. Mở một tin → chọn dự án → “Giao việc”." : "Không có phiên nào khớp bộ lọc."}</p>
          {all.length === 0
            ? <Button size="sm" variant="outline" onClick={() => onOpenGroup(ALL)}>Mở Việc cần xử lý</Button>
            : <Button size="sm" variant="outline" onClick={() => setFilter("all")}>Xem tất cả phiên</Button>}
        </div>
      )}
      {(cur || gone) && (
        <div className="flex min-h-0 flex-1">
          <ul aria-label="Danh sách phiên" className={cn("min-h-0 w-full overflow-y-auto md:block md:w-72 md:shrink-0 md:border-r", sel && "hidden")}>
            {rows.map((t) => <TaskRow key={t.id} t={t} now={now} active={t.id === cur?.id} onSelect={() => setSel(t.id)} />)}
          </ul>
          <div className={cn("min-h-0 min-w-0 flex-1 flex-col", sel ? "flex" : "hidden md:flex")}>
            {cur ? <TaskDetail key={cur.id} t={cur} now={now} onBack={() => setSel(null)} onOpenGroup={onOpenGroup} onUseText={onUseText} /> : (
              <div role="status" className="grid justify-items-start gap-2 p-5 text-sm text-ink-2">
                <p>Phiên này không còn (có thể đã bị xóa).</p>
                <Button size="sm" variant="outline" onClick={() => setSel(null)}>Xem danh sách phiên</Button>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
