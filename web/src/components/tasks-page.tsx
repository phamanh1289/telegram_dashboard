"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft, ArrowUp, Bot, Check, CheckCheck, CheckCircle2, ChevronDown, CircleAlert, Ellipsis, FilePlus, FileText, FolderGit2, FolderSearch, Globe, ListChecks,
  ListPlus, type LucideIcon, Square, Loader2, MessageSquare, Pencil, RotateCcw, RotateCw, Search, SquareTerminal, Trash2, Users, Wrench, X,
} from "lucide-react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Menu } from "@base-ui/react/menu";
import { Picks, useAiPrefs } from "@/components/ai";
import { Markdown } from "@/components/markdown";
import { AiBot } from "@/components/yt/bits";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Hint } from "@/components/ui/hint";
import { Segmented } from "@/components/ui/segmented";
import { Skeleton } from "@/components/ui/skeleton";
import { type AiPicks, api, ApiError, type Message, type Task } from "@/lib/api";
import { ALL, byUnit, setHandled, timeLabel, useNow, useTaskList } from "@/lib/inbox";
import { cn } from "@/lib/utils";

type TaskEvent = { kind: string; text: string; error?: boolean; at?: number };
type TaskLog = { items: TaskEvent[]; next: number };
type Filter = "all" | "doing" | "done";
const FILTERS: [Filter, string][] = [["all", "Tất cả"], ["doing", "Doing"], ["done", "Done"]];
type Kind = "task" | "deep";
const KINDS: [Kind, string][] = [["task", "Giao việc"], ["deep", "Đối chiếu BE"]];
type Effort = AiPicks["effort"];

function ago(date: string, now: number) {
  const mins = Math.max(0, Math.round((now - new Date(date).getTime()) / 60_000));
  return mins < 1 ? "vừa xong" : `${byUnit(mins).join(" ")} trước`;
}

/** Seconds as "0.8s", "42s", "3m 05s". */
function dur(s: number) {
  if (s < 10) return `${Math.max(0, s).toFixed(1)}s`;
  if (s < 60) return `${Math.round(s)}s`;
  return `${Math.floor(s / 60)}m ${String(Math.round(s % 60)).padStart(2, "0")}s`;
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

type Step = { name: string; arg: string; at?: number; out?: TaskEvent };
/** took / tools: seconds the turn ran and spent in tools (logs from before timestamps have neither). */
type Block = { kind: "tools"; steps: Step[] } | { kind: "event"; ev: TaskEvent; took?: number; tools?: number };
const stepSecs = (s: Step) => (s.at && s.out?.at ? s.out.at - s.at : undefined);

/** Folds consecutive tool calls and their outputs into one block; parallel calls get their outputs back in order. */
function groupEvents(items: TaskEvent[]): Block[] {
  const out: Block[] = [];
  let waiting: Step[] = [];
  let shown = new Set<string>(); // assistant texts of the current turn
  let start: number | undefined; // when the current turn was sent
  let tools = 0;
  for (const ev of items) {
    if (ev.kind === "user") { shown = new Set(); start = ev.at; tools = 0; }
    if (ev.kind === "assistant" && ev.text?.trim()) shown.add(ev.text.trim());
    if (ev.kind === "result" && ev.text?.trim()) { // the final answer already streamed as text: show it once, in the result box
      const res = ev.text.trim();
      const n = out.length;
      for (let b = out.at(-1); b?.kind === "event" && b.ev.kind === "assistant" && b.ev.text.trim() && res.includes(b.ev.text.trim()); b = out.at(-1)) out.pop();
      if (out.length === n && shown.has(res)) continue; // a late result (background agents) repeating an earlier text
    }
    if (ev.kind === "result") {
      const took = start && ev.at ? ev.at - start : undefined;
      out.push({ kind: "event", ev, took, tools: took === undefined ? undefined : Math.min(tools, took) }); // parallel calls overlap
      continue;
    }
    if (ev.kind !== "tool" && ev.kind !== "tool_result") { out.push({ kind: "event", ev }); continue; }
    let last = out.at(-1);
    if (last?.kind !== "tools") { last = { kind: "tools", steps: [] }; out.push(last); waiting = []; }
    if (ev.kind === "tool") {
      const [name, ...rest] = ev.text.split("  "); // "<name>  <input>" from the backend
      const step: Step = { name, arg: rest.join("  "), at: ev.at };
      last.steps.push(step);
      waiting.push(step);
    } else {
      const s = waiting.shift();
      if (s) { s.out = ev; tools += stepSecs(s) ?? 0; }
    }
  }
  return out;
}

/** A path shows as its file name, the folder muted and the full path on hover. */
function StepArg({ arg }: { arg: string }) {
  if (!arg.startsWith("/")) return <span className="min-w-0 truncate font-mono text-xs text-ink-2" title={arg}>{arg}</span>;
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
  const secs = stepSecs(s);
  return (
    <li className="animate-in fade-in-0 slide-in-from-left-1 duration-(--dur-short)">
      <button type="button" disabled={!s.out?.text} aria-expanded={open} onClick={() => setOpen((v) => !v)}
        className="flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1 text-left transition-colors duration-(--dur-micro) enabled:hover:bg-paper-2">
        {live ? <Loader2 className="size-3.5 shrink-0 animate-spin text-hl-2" aria-hidden />
          : <Icon className={cn("size-3.5 shrink-0", err ? "text-error" : "text-ink-3")} aria-hidden />}
        <span className={cn("w-14 shrink-0 truncate text-xs", err ? "text-error" : "text-ink-2")}>{verb}</span>
        <StepArg arg={s.arg} />
        <span className="ml-auto flex shrink-0 items-center gap-1.5 pl-2">
          <span className="rounded-sm bg-paper-2 px-1 font-mono text-[0.625rem] leading-4 text-ink-3">{s.name}</span>
          {secs !== undefined && <span className="w-11 text-right font-mono text-[0.6875rem] tabular-nums text-ink-3">{dur(secs)}</span>}
          {s.out?.text && <ChevronDown className={cn("size-3.5 text-ink-3 transition-transform duration-(--dur-short)", !open && "-rotate-90")} aria-hidden />}
        </span>
      </button>
      {open && s.out && (
        <pre className={cn("mt-1 mb-1.5 ml-7 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-md p-2.5 font-mono text-[0.6875rem] leading-relaxed animate-in fade-in-0 duration-(--dur-short)",
          err ? "bg-error-wash text-error" : "bg-paper-2 text-ink-2")}>{s.out.text}</pre>
      )}
    </li>
  );
}

/** A run of tool steps: one summary line ("Đọc 5 · Tìm 2 · 1m 12s"), the steps behind it. While live it stays open on the current step. */
function ToolGroup({ steps, live }: { steps: Step[]; live: boolean }) {
  const [toggled, setToggled] = useState<boolean | null>(null);
  const open = toggled ?? live;
  const counts = new Map<string, number>();
  for (const s of steps) { const v = toolMeta(s.name)[1]; counts.set(v, (counts.get(v) ?? 0) + 1); }
  const current = steps.at(-1)!;
  const errors = steps.filter((s) => s.out?.error).length;
  const first = steps[0].at, end = steps.findLast((s) => s.out?.at)?.out?.at;
  return (
    <div className={cn("rounded-xl border border-rule bg-cotton transition-shadow duration-(--dur-short)", live && "ai-ring")}>
      <button type="button" aria-expanded={open} onClick={() => setToggled(!open)}
        className="relative flex w-full min-w-0 items-center gap-2 px-3 py-2 text-left text-xs text-ink-2 transition-colors duration-(--dur-micro) hover:text-ink">
        {live ? <Loader2 className="size-3.5 shrink-0 animate-spin text-hl-2" aria-hidden /> : <Wrench className="size-3.5 shrink-0 text-ink-3" aria-hidden />}
        {live ? (
          <span className="flex min-w-0 items-center gap-1.5"><span className="ai-text shrink-0 font-medium">Đang {toolMeta(current.name)[1].toLowerCase()}</span><StepArg arg={current.arg} /></span>
        ) : (
          <span className="truncate">{[...counts].map(([v, n]) => `${v} ${n}`).join(" · ")}</span>
        )}
        {errors > 0 && <span className="shrink-0 rounded-sm bg-error-wash px-1.5 text-error">{errors} lỗi</span>}
        <span className="ml-auto shrink-0 font-mono tabular-nums text-ink-3">
          {steps.length} bước{!live && first && end ? ` · ${dur(end - first)}` : ""}
        </span>
        <ChevronDown className={cn("size-3.5 shrink-0 text-ink-3 transition-transform duration-(--dur-short)", !open && "-rotate-90")} aria-hidden />
      </button>
      {open && (
        <ul className="relative grid grid-cols-[minmax(0,1fr)] border-t border-rule px-1.5 py-1.5 animate-in fade-in-0 duration-(--dur-short)">
          {steps.map((s, i) => <StepRow key={i} s={s} live={live && i === steps.length - 1 && !s.out} />)}
        </ul>
      )}
    </div>
  );
}

/** Where a turn's time went: tools vs the model thinking/writing, as one bar. */
function TurnTimeline({ took, tools }: { took: number; tools: number }) {
  const pct = took > 0 ? (tools / took) * 100 : 0;
  return (
    <div className="mt-3 grid gap-1.5 border-t border-ok/20 pt-2.5 text-[0.6875rem] text-ink-3">
      <div className="flex h-1.5 overflow-hidden rounded-full bg-paper-3" aria-hidden>
        <span className="h-full origin-left bg-warn/80 animate-in slide-in-from-left-full duration-(--dur-long)" style={{ width: `${pct}%` }} />
        <span className="h-full flex-1 bg-hl/70" />
      </div>
      <p className="flex flex-wrap gap-x-3 font-mono tabular-nums">
        <span>Tổng {dur(took)}</span>
        <span className="inline-flex items-center gap-1"><span className="size-1.5 rounded-full bg-warn/80" aria-hidden />Công cụ {dur(tools)}</span>
        <span className="inline-flex items-center gap-1"><span className="size-1.5 rounded-full bg-hl/70" aria-hidden />Suy nghĩ {dur(took - tools)}</span>
      </p>
    </div>
  );
}

const AI_TEXT = "text-[0.9375rem] leading-[1.6]";

function EventItem({ b }: { b: Extract<Block, { kind: "event" }> }) {
  const { ev } = b;
  if (ev.kind === "user") {
    return (
      <li className="flex justify-end animate-in fade-in-0 slide-in-from-bottom-2 zoom-in-95 duration-(--dur-short)">
        <p className={cn(AI_TEXT, "max-w-[85%] origin-bottom-right whitespace-pre-wrap break-words rounded-2xl rounded-br-sm bg-hl-wash px-3.5 py-2 text-ink")}>{ev.text}</p>
      </li>
    );
  }
  if (ev.kind === "result") {
    return (
      <li className={cn("rounded-xl border p-4 animate-in fade-in-0 slide-in-from-bottom-2 duration-(--dur-long)",
        ev.error ? "border-error/25 bg-error-wash" : "border-ok/25 bg-ok-wash")}>
        <p className={cn("mb-2 flex items-center gap-1.5 text-xs font-semibold", ev.error ? "text-error" : "text-ok")}>
          {ev.error ? <CircleAlert className="size-4" aria-hidden /> : <CheckCircle2 className="size-4 animate-in zoom-in-50 spin-in-45 duration-(--dur-long)" aria-hidden />}
          {ev.error ? "Có lỗi" : "Kết quả"}
        </p>
        {ev.text && <Markdown text={ev.text} className={AI_TEXT} />}
        {b.took !== undefined && <TurnTimeline took={b.took} tools={b.tools ?? 0} />}
      </li>
    );
  }
  return <li className={cn("px-0.5 animate-in fade-in-0 slide-in-from-bottom-1 duration-(--dur-short)", ev.error ? "text-error" : "text-ink")}><Markdown text={ev.text} className={AI_TEXT} /></li>;
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
    <span className="inline-flex shrink-0 items-center gap-0.5 font-medium text-ok" title="Tin tag đã đánh dấu xử lý">
      <CheckCheck className="size-3" aria-hidden /> Đã xử lý
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
      <div ref={box} onScroll={(e) => { stick.current = atBottom(e.currentTarget); }} className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6">
        <div className="mx-auto grid max-w-3xl grid-cols-[minmax(0,1fr)] gap-4">{children}</div>
      </div>
      {footer && <div className="shrink-0 px-4 pt-2 pb-4 sm:px-6"><div className="mx-auto grid max-w-3xl gap-1.5">{footer}</div></div>}
    </>
  );
}

/** Model + effort for this session's next turns; until picked, the task picks in AI settings. */
function SessionAi({ t, disabled }: { t: Task; disabled: boolean }) {
  const qc = useQueryClient();
  const { info, picks } = useAiPrefs();
  const save = useMutation({
    mutationFn: (ai: { model: string; effort: Effort }) => api<void>(`/tasks/${t.id}/ai`, { method: "PUT", json: ai }),
    onMutate: (ai) => qc.setQueryData<Task[]>(["tasks"], (l) => l?.map((x) => (x.id === t.id ? { ...x, ...ai } : x))),
    onSettled: () => qc.invalidateQueries({ queryKey: ["tasks"] }),
  });
  const c = info(t.provider ?? "claude");
  if (!c) return null;
  const k = picks(t.provider ?? "claude");
  const model = t.model ?? k.task_model;
  const effort = (t.effort ?? k.task_effort) as Effort;
  return (
    <Hint text={`${c.name} cho phiên này, áp dụng từ lượt nhắn tiếp`} side="bottom">
      <span role="group" aria-label={`${c.name}: model và effort cho phiên này`}
        className={cn("flex min-w-0 items-center gap-2", disabled && "pointer-events-none opacity-50", save.isError && "[&_button]:border-error")}>
        <Picks c={c} label="phiên này" model={model} effort={effort} modelClass="w-28"
          effortClass="w-14" onModel={(m) => save.mutate({ model: m, effort })} onEffort={(e) => save.mutate({ model, effort: e })} />
      </span>
    </Hint>
  );
}

// Queued prompts per task, kept outside the panel so switching sessions doesn't drop them.
// ponytail: client-only, drains only while that session is open and lost on reload; move server-side if that matters.
const queues = new Map<string, string[]>();

/** Headless session: conversation log with the follow-up composer pinned below it. */
function ChatPanel({ t, head }: { t: Task; head: ReactNode }) {
  const { id } = t;
  const running = !!t.running;
  const plan = t.mode === "plan";
  const qc = useQueryClient();
  const stop = useMutation({ mutationFn: () => api<void>(`/tasks/${id}/stop`, { method: "POST" }), onSettled: () => qc.invalidateQueries({ queryKey: ["tasks"] }) });
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

  const footer = <>
    {queue.length > 0 && (
      <ol aria-label="Hàng đợi" className="grid gap-1">
        {queue.map((line, i) => (
          <li key={i} className="flex items-center gap-2 rounded-lg bg-paper-2 px-2.5 py-1 text-xs text-ink-2 animate-in fade-in-0 slide-in-from-bottom-1 duration-(--dur-short)">
            <span className="shrink-0 font-mono tabular-nums text-ink-3">{i + 1}</span>
            <span className="min-w-0 flex-1 truncate" title={line}>{line}</span>
            <Button size="icon-xs" variant="ghost" aria-label="Bỏ khỏi hàng đợi" disabled={i === 0 && send.isPending} onClick={() => setQueue((q) => q.filter((_, j) => j !== i))}><X /></Button>
          </li>
        ))}
      </ol>
    )}
    <form onSubmit={(e) => { e.preventDefault(); submit(); }}
      className={cn("rounded-2xl border border-rule-2 bg-cotton shadow-stock transition-[border-color,box-shadow] duration-(--dur-short) focus-within:border-ink-3",
        running && "ai-ring")}>
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
        className="relative block max-h-48 min-h-14 w-full resize-none bg-transparent px-4 pt-3 pb-1 text-sm text-ink outline-none field-sizing-content placeholder:text-ink-3"
      />
      <div className="relative flex flex-wrap items-center gap-x-3 gap-y-2 px-2.5 pb-2.5 text-xs text-ink-2">
        <span className="inline-flex min-w-0 max-w-40 items-center gap-1 rounded-full bg-paper-2 px-2 py-1" title={t.project}>
          <FolderGit2 className="size-3.5 shrink-0 text-ink-3" aria-hidden /><span className="truncate">{t.project.split("/").pop()}</span>
        </span>
        {plan && (
          <Hint text="Phiên đang ở chế độ chỉ đọc (plan). Bật để lượt nhắn tiếp được sửa file, ví dụ duyệt plan rồi bảo AI làm." side="bottom">
            <label className="flex items-center gap-1.5">
              <Checkbox checked={edit} onCheckedChange={(v) => setEdit(!!v)} disabled={running} />
              Cho sửa code
            </label>
          </Hint>
        )}
        <div className="ml-auto flex min-w-0 items-center gap-2">
          <SessionAi t={t} disabled={running} />
          {running && (
            <Hint text="Dừng AI (giữ hội thoại, có thể nhắn tiếp)" side="bottom">
              <button type="button" aria-label="Dừng" aria-busy={stop.isPending} disabled={stop.isPending} onClick={() => stop.mutate()}
                className="relative grid size-8 shrink-0 place-items-center rounded-full bg-error-wash text-error transition-[scale,background-color] duration-(--dur-micro) hover:scale-105 hover:bg-error hover:text-cotton active:scale-95 disabled:opacity-60 animate-in zoom-in-50 fade-in-0 duration-(--dur-short)">
                <span className="absolute inset-0 animate-spin rounded-full border-2 border-error/20 border-t-error motion-reduce:animate-none" aria-hidden />
                {stop.isPending ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Square className="size-3 fill-current" aria-hidden />}
              </button>
            </Hint>
          )}
          {running ? (
            <Hint text="Thêm vào hàng đợi, chạy khi AI xong lượt này (⌘+Enter)" side="bottom">
              <Button type="button" size="icon-sm" variant="outline" className="rounded-full" aria-label="Vào hàng đợi" disabled={!text.trim()} onClick={enqueue}><ListPlus /></Button>
            </Hint>
          ) : (
            <Button type="submit" size="icon-sm" aria-label="Gửi" aria-busy={send.isPending} disabled={!text.trim() || send.isPending}
              className="rounded-full bg-hl text-hl-ink hover:brightness-110">
              {send.isPending ? <Loader2 className="animate-spin" aria-hidden /> : <ArrowUp />}
            </Button>
          )}
        </div>
      </div>
    </form>
    {send.isError && <p role="alert" className="text-xs text-error">{busy ? "AI đang làm lượt trước." : "Gửi thất bại."}</p>}
    {stop.isError && <p role="alert" className="text-xs text-error">Không dừng được, thử lại.</p>}
  </>;

  return (
    <Feed follow={(items?.length ?? 0) + (running ? 0.5 : 0)} footer={footer}>
      {head}
      <ul aria-label="Hội thoại với AI" className="grid grid-cols-[minmax(0,1fr)] gap-3">
        {blocks.map((b, i) => b.kind === "tools"
          ? <li key={i} className="animate-in fade-in-0 duration-(--dur-short)"><ToolGroup steps={b.steps} live={running && i === blocks.length - 1} /></li>
          : <EventItem key={i} b={b} />)}
        {q.isPending && <li><Skeleton className="h-8 w-2/3" /></li>}
        {q.isError && (
          <li role="alert" className="flex items-center gap-2 px-1 text-xs text-error">
            Không đọc được hội thoại.
            <Button size="xs" variant="outline" disabled={q.isFetching} onClick={() => void q.refetch()}><RotateCw /> Thử lại</Button>
          </li>
        )}
        {running && blocks.at(-1)?.kind !== "tools" && (
          <li className="flex items-center gap-2.5 px-0.5 animate-in fade-in-0 slide-in-from-bottom-2 duration-(--dur-short)" aria-live="polite">
            <AiBot className="ai-hop size-7 shrink-0 drop-shadow-sm" />
            <span className="ai-text text-sm font-medium">AI đang suy nghĩ</span>
            <span className="flex gap-1" aria-hidden>{[0, 150, 300].map((d) => <span key={d} className="ai-dot size-1.5 rounded-full bg-hl" style={{ animationDelay: `${d}ms` }} />)}</span>
          </li>
        )}
      </ul>
    </Feed>
  );
}

/** One card in the session list: status, what it is about, group and age. */
function TaskRow({ t, now, active, onSelect }: { t: Task; now: number; active: boolean; onSelect: () => void }) {
  const s = statusOf(t);
  return (
    <li>
      <button type="button" aria-current={active || undefined} onClick={onSelect}
        className={cn("grid w-full grid-cols-[auto_1fr] gap-x-2.5 gap-y-1 rounded-lg px-2.5 py-2 text-left transition-[background-color,box-shadow] duration-(--dur-micro)",
          active ? "bg-hl-wash shadow-[inset_0_0_0_1px_color-mix(in_oklch,var(--color-hl)_35%,transparent)]" : "hover:bg-paper-2")}>
        <span className="relative row-span-2 mt-0.5 grid size-4 place-items-center">
          {s === "running" && <span className="absolute inset-0 animate-ping rounded-full bg-hl/30" aria-hidden />}
          <StatusIcon s={s} className="size-4" /><span className="sr-only">{STATUS_LABEL[s]}</span>
        </span>
        <span className={cn("line-clamp-2 text-[0.8125rem] font-medium leading-snug", t.handled ? "text-ink-3" : "text-ink")}>{t.title || t.message_text || t.prompt}</span>
        <span className="flex min-w-0 gap-1.5 text-xs text-ink-3">
          {t.handled && <><HandledBadge />·</>}
          <span className="truncate">{t.chat_title || t.project.split("/").pop()}</span>·
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

/** The selected session: a slim title bar with one action menu, the scrolling conversation, the composer pinned at the bottom. */
function TaskDetail({ t, now, onBack, onOpenGroup, onUseText }: {
  t: Task; now: number; onBack: () => void; onOpenGroup: (chatId: string, messageId?: string) => void; onUseText: (m: Message, text: string) => void;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const refresh = () => qc.invalidateQueries({ queryKey: ["tasks"] });
  const remove = useMutation({ mutationFn: () => api<void>(`/tasks/${t.id}`, { method: "DELETE" }), onSettled: refresh });
  // Done on the tagged message (setHandled toasts errors and the undo); the session moves to the Done tab.
  const tag = t.chat_id && t.message_id ? asMessage(t) : null;
  const mark = useMutation({
    mutationFn: ({ handled, react }: { handled: boolean; react: boolean }) => setHandled([tag!], handled, react),
    onSettled: refresh,
  });

  const head = <>
    {(t.title || t.message_text || t.chat_title) && (
      <div className="rounded-xl border-l-2 border-hl bg-paper-2 px-3.5 py-2.5 animate-in fade-in-0 slide-in-from-top-1 duration-(--dur-short)">
        <p className="mb-1 flex flex-wrap items-center gap-x-2.5 text-xs text-ink-3">
          {t.sender_name && <span className="font-medium text-ink-2">{t.sender_name}</span>}
          {t.chat_title && <span className="inline-flex items-center gap-1"><Users className="size-3" aria-hidden /> {t.chat_title}</span>}
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
                  <MenuRow icon={CheckCheck} tone="ok" label="Done" hint="Đã xử lý, thả reaction trên Telegram" disabled={mark.isPending}
                    onClick={() => mark.mutate({ handled: true, react: true })} />
                  <MenuRow icon={Check} tone="ok" label="Done không reaction" hint="Đã xử lý, không thả reaction" disabled={mark.isPending}
                    onClick={() => mark.mutate({ handled: true, react: false })} />
                </>)}
                {tag && <Menu.Separator className="mx-1 my-0.5 h-px bg-rule" />}
                {t.result && tag && <MenuRow icon={MessageSquare} label="Dùng làm nháp trả lời" hint="Kết quả thành nháp trả lời tin tag" onClick={() => onUseText(tag, t.result!)} />}
                {t.chat_id && <MenuRow icon={Users} label="Mở nhóm" hint="Cuộn tới tin đã giao việc" onClick={() => onOpenGroup(t.chat_id!, t.message_id ?? undefined)} />}
                {(t.chat_id || (t.result && tag)) && <Menu.Separator className="mx-1 my-0.5 h-px bg-rule" />}
                <MenuRow icon={Trash2} tone="error" label="Xóa phiên" hint="Hỏi xác nhận trước khi xóa" disabled={remove.isPending}
                  onClick={() => confirm("Xóa phiên này khỏi danh sách?") && remove.mutate()} />
              </Menu.Popup>
            </Menu.Positioner>
          </Menu.Portal>
        </Menu.Root>
      </div>
      {remove.isError && <p role="alert" className="border-b px-4 py-1.5 text-xs text-error">Xóa thất bại, thử lại.</p>}

      {t.mode !== "terminal" ? <ChatPanel t={t} head={head} /> : ( // old Terminal tasks: prompt and result only
        <Feed follow={t.result}>
          {head}
          <section aria-label="Kết quả" className="grid gap-1.5">
            <h3 className="text-xs font-medium text-ink-3">Kết quả từ AI</h3>
            {t.result ? <Markdown text={t.result} className="rounded-md bg-ok-wash p-3 text-[0.9375rem] leading-[1.55] text-ink" />
              : <p className="rounded-md bg-paper-2 p-3 text-sm leading-relaxed text-ink-3">Phiên Terminal cũ chưa có kết quả.</p>}
          </section>
        </Feed>
      )}
    </div>
  );
}

/** Every task handed to the AI: session tabs up in the page header, the list on the left, the selected session on the right. */
export function TasksPage({ focus, headSlot, onOpenGroup, onUseText }: {
  focus?: string | null; // task to select on open ("Mở phiên" from a tagged message)
  headSlot: HTMLElement | null; // the page header, where the session tabs go
  onOpenGroup: (chatId: string, messageId?: string) => void; onUseText: (m: Message, text: string) => void;
}) {
  const q = useTaskList();
  const now = useNow();
  const [picked, setFilter] = useState<Filter | null>(focus ? null : "doing");
  const [pickedKind, setKind] = useState<Kind | null>(null);
  const [sel, setSel] = useState<string | null>(focus ?? null); // null on phones = show the list
  const every = q.data ?? [];
  // "Mở phiên": open the tabs matching the session (its kind; Done → done, else doing) until the user picks one.
  const focused = focus ? every.find((t) => t.id === focus) : undefined;
  const kind: Kind = pickedKind ?? focused?.kind ?? "task";
  const all = every.filter((t) => t.kind === kind);
  const filter: Filter = picked ?? (focused ? (isDone(focused) ? "done" : "doing") : "all");
  const running = every.filter((t) => t.running).length;
  const done = all.filter(isDone).length;
  const count: Record<Filter, number> = { all: all.length, doing: all.length - done, done };
  const rows = all.filter((t) => filter === "all" || (filter === "done") === isDone(t));
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
          <p>{kind === "deep" ? "Chưa có phiên Đối chiếu BE. Bấm 🧠 trên tin BE confirm → chọn tin hỏi và dự án → “Phân tích”."
            : "Chưa giao việc nào. Mở một tin → chọn dự án → “Giao việc”."}</p>
          {kind === "task" && <Button size="sm" variant="outline" onClick={() => onOpenGroup(ALL)}>Mở Việc cần xử lý</Button>}
        </div>
      )}
      {q.isSuccess && all.length > 0 && (
        <div className="flex min-h-0 flex-1">
          <aside aria-label="Phiên" className={cn("flex min-h-0 w-full flex-col md:w-72 md:shrink-0 md:border-r", sel && "max-md:hidden")}>
            <div className="shrink-0 p-2">
              <Segmented id="agent-filter" label="Lọc phiên" value={filter} onChange={setFilter} className="w-full [&>button]:flex-1"
                items={FILTERS.map(([id, label]) => ({ value: id, label: <>{label} <span className="font-mono tabular-nums opacity-70">{count[id]}</span></> }))} />
            </div>
            <ul aria-label="Danh sách phiên" className="grid min-h-0 flex-1 content-start gap-0.5 overflow-y-auto px-2 pb-2">
              {rows.map((t) => <TaskRow key={t.id} t={t} now={now} active={t.id === cur?.id} onSelect={() => setSel(t.id)} />)}
              {rows.length === 0 && <li className="px-2 py-6 text-center text-xs text-ink-3">Không có phiên nào khớp bộ lọc.</li>}
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
