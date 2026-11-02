"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Bot, CheckCircle2, ChevronDown, CornerDownLeft, FolderGit2, Square, Loader2, MessageSquare, RotateCcw, RotateCw, SquareTerminal, Trash2, Users, Wrench } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { ModelEffortPicker } from "@/components/settings";
import { api, ApiError, type Message, type Task } from "@/lib/api";
import { ALL, timeLabel, useNow, useTaskList } from "@/lib/inbox";
import { cn } from "@/lib/utils";

type TaskEvent = { kind: string; text: string; error?: boolean };
type Filter = "all" | "running" | "done";
const FILTERS: [Filter, string][] = [["all", "Tất cả"], ["running", "Đang chạy"], ["done", "Đã xong"]];

function ago(date: string, now: number) {
  const mins = Math.max(0, Math.round((now - new Date(date).getTime()) / 60_000));
  return mins < 1 ? "vừa xong" : mins < 60 ? `${mins} phút trước` : mins < 1440 ? `${Math.floor(mins / 60)} giờ trước` : `${Math.floor(mins / 1440)} ngày trước`;
}

const atBottom = (el: HTMLElement) => el.scrollHeight - el.scrollTop - el.clientHeight < 40;

/** The tagged message as the reply panel needs it (the task row only keeps a snapshot). */
function asMessage(t: Task): Message {
  return {
    chat_id: t.chat_id!, message_id: t.message_id!, sender_id: null, sender_name: t.sender_name ?? null,
    text: t.message_text ?? "", date: t.created_at, outgoing: false, deleted: false, handled: false, pinned: false,
  } as unknown as Message;
}

const KIND_STYLE: Record<string, string> = {
  user: "ml-8 bg-paper-3 text-ink",
  assistant: "mr-8 bg-cotton text-ink",
  tool: "font-mono text-xs text-ink-3",
  tool_result: "font-mono text-xs text-ink-3 line-clamp-3",
  result: "bg-ok-wash text-ink",
};

type Status = "running" | "stopped" | "done";
const statusOf = (t: Task): Status =>
  t.running ? "running" : !t.result && (t.mode ?? "terminal") !== "terminal" ? "stopped" : "done";
const STATUS_LABEL: Record<Status, string> = { running: "Đang chạy", stopped: "Đã dừng", done: "Đã xong" };

function StatusIcon({ s, className }: { s: Status; className?: string }) {
  if (s === "running") return <Loader2 className={cn("animate-spin text-info", className)} aria-hidden />;
  if (s === "stopped") return <Square className={cn("fill-current text-warn", className)} aria-hidden />;
  return <CheckCircle2 className={cn("text-ok", className)} aria-hidden />;
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

/** Headless session: conversation log with the follow-up input pinned below it. */
function ChatPanel({ id, running, plan, head }: { id: string; running: boolean; plan: boolean; head: ReactNode }) {
  const qc = useQueryClient();
  const [items, setItems] = useState<TaskEvent[]>([]);
  const next = useRef(0);
  const [text, setText] = useState("");
  const [edit, setEdit] = useState(false); // plan task: let the next turns edit files (approve the plan)
  const q = useQuery({
    queryKey: ["task-events", id],
    queryFn: async ({ signal }) => {
      const r = await api<{ items: TaskEvent[]; next: number; total: number; running: boolean }>(`/tasks/${id}/events?after=${next.current}`, { signal });
      if (r.total < next.current) { // the task was re-run: start over
        next.current = 0;
        setItems([]);
      } else if (r.items.length) {
        next.current = r.next;
        setItems((prev) => [...prev, ...r.items]);
      }
      return r;
    },
    refetchInterval: running ? 1500 : 6000,
  });
  const refresh = () => {
    void q.refetch();
    void qc.invalidateQueries({ queryKey: ["tasks"] });
  };
  const send = useMutation({
    mutationFn: (line: string) => api<void>(`/tasks/${id}/message`, { method: "POST", json: { text: line, edit: plan && edit } }),
    onSuccess: () => { setText(""); refresh(); },
  });
  const busy = send.error instanceof ApiError && send.error.code === "task_busy";

  return (
    <Feed follow={items.length + (running ? 0.5 : 0)} footer={<>
      <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); if (text.trim()) send.mutate(text.trim()); }}>
        <textarea
          aria-label="Nhắn tiếp cho AI" rows={2} maxLength={8000} value={text} disabled={running}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              if (text.trim() && !running) send.mutate(text.trim());
            }
          }}
          placeholder={running ? "AI đang làm, đợi xong lượt này hoặc bấm Dừng…" : "Nhắn tiếp cho AI (Enter gửi, Shift+Enter xuống dòng)"}
          className="min-h-10 min-w-0 flex-1 resize-none rounded-md border border-rule-2 bg-cotton px-3 py-2 text-sm text-ink placeholder:text-ink-3 hover:border-ink-3 focus-visible:-outline-offset-1 disabled:cursor-not-allowed disabled:opacity-50"
        />
        <Button type="submit" aria-busy={send.isPending} disabled={running || !text.trim() || send.isPending}>Gửi</Button>
      </form>
      {plan && (
        <label className="flex w-fit items-center gap-2 text-xs text-ink-2" title="Phiên đang ở chế độ Chỉ đọc (plan). Bật để lượt nhắn tiếp được sửa file, ví dụ duyệt plan rồi bảo AI làm.">
          <Checkbox checked={edit} onCheckedChange={(v) => setEdit(!!v)} disabled={running} />
          Accept edit: lượt nhắn tiếp được sửa file
        </label>
      )}
      {send.isError && <p role="alert" className="text-xs text-error">{busy ? "AI đang làm lượt trước." : "Gửi thất bại."}</p>}
    </>}>
      {head}
      <ul aria-label="Hội thoại với AI" className="grid grid-cols-[minmax(0,1fr)] gap-1.5">
        {items.map((it, i) => (
          <li key={i} className={cn("whitespace-pre-wrap break-words rounded-md px-3 py-1.5 text-sm leading-relaxed animate-in fade-in-0 duration-(--dur-short)",
            KIND_STYLE[it.kind], it.error && "bg-error-wash text-error")}>
            {it.kind === "tool" && <Wrench className="mr-1.5 inline size-3 align-[-1px]" aria-hidden />}{it.text}
          </li>
        ))}
        {q.isPending && <li><Skeleton className="h-8 w-2/3" /></li>}
        {running && <li className="flex items-center gap-1.5 px-1 text-xs text-ink-3"><Loader2 className="size-3 animate-spin" aria-hidden /> AI đang làm…</li>}
      </ul>
    </Feed>
  );
}

/** Live view of the task's Terminal tab with a line input pinned below, so the session can be driven from here. */
function TerminalPanel({ id, head, tail }: { id: string; head: ReactNode; tail: ReactNode }) {
  const [text, setText] = useState("");
  const q = useQuery({
    queryKey: ["task-terminal", id],
    queryFn: ({ signal }) => api<{ text: string }>(`/tasks/${id}/terminal`, { signal }),
    refetchInterval: 3000,
    retry: false,
  });
  const send = useMutation({
    mutationFn: (line: string) => api<void>(`/tasks/${id}/input`, { method: "POST", json: { text: line } }),
    onSuccess: () => {
      setText("");
      setTimeout(() => void q.refetch(), 700); // let the agent react before re-reading
    },
  });
  const gone = q.error instanceof ApiError && q.error.code === "terminal_gone";

  return (
    <Feed follow={q.data?.text} footer={!gone && <>
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); send.mutate(text); }}>
        <input
          aria-label="Nhập vào Terminal"
          value={text}
          maxLength={2000}
          onChange={(e) => setText(e.target.value)}
          placeholder="Gõ phản hồi cho AI rồi Enter, ví dụ: tiếp tục / làm theo cách 2…"
          className="h-[30px] min-w-0 flex-1 rounded-md border border-rule-2 bg-cotton px-3 text-sm text-ink placeholder:text-ink-3 hover:border-ink-3 focus-visible:-outline-offset-1"
        />
        <Button type="submit" size="sm" disabled={!text.trim() || send.isPending}>Gửi</Button>
        <Button type="button" size="sm" variant="outline" disabled={send.isPending}
          title="Gửi phím Enter (đồng ý lựa chọn đang chọn khi AI hỏi duyệt)" onClick={() => send.mutate("")}>
          <CornerDownLeft /> Enter
        </Button>
      </form>
      {send.isError && <p role="alert" className="text-xs text-error">Không gửi được vào Terminal.</p>}
    </>}>
      {head}
      <pre aria-label="Màn hình Terminal"
        className="whitespace-pre-wrap break-all rounded-md bg-board p-3 font-mono text-xs leading-relaxed text-board-type">
        {gone ? "Cửa sổ Terminal của phiên này đã đóng. Bấm “Chạy lại” để mở phiên mới."
          : q.isError ? "Không đọc được Terminal (macOS có thể đang chặn quyền Automation cho Terminal)."
          : (q.data?.text ?? "Đang đọc Terminal…")}
      </pre>
      {tail}
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
        <span className="truncate text-sm font-medium text-ink">{t.message_text || t.prompt}</span>
        <span className="flex min-w-0 gap-1.5 text-xs text-ink-3">
          <span className={cn("shrink-0", s === "running" && "text-info")}>{STATUS_LABEL[s]}</span>·
          <span className="truncate">{t.chat_title || t.project.split("/").pop()}</span>·
          <time className="shrink-0" dateTime={t.created_at} title={timeLabel(t.created_at, true)}>{ago(t.created_at, now)}</time>
        </span>
      </button>
    </li>
  );
}

/** The selected session: status and actions on top, scrolling content, input pinned at the bottom. */
function TaskDetail({ t, now, onBack, onOpenGroup, onUseText }: {
  t: Task; now: number; onBack: () => void; onOpenGroup: (chatId: string) => void; onUseText: (m: Message, text: string) => void;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const running = !!t.running;
  const headless = (t.mode ?? "terminal") !== "terminal";
  const refresh = () => qc.invalidateQueries({ queryKey: ["tasks"] });
  const reopen = useMutation({ mutationFn: () => api<void>(`/tasks/${t.id}/reopen`, { method: "POST" }), onSettled: refresh });
  const capture = useMutation({ mutationFn: () => api<void>(`/tasks/${t.id}/capture`, { method: "POST" }), onSettled: refresh });
  const remove = useMutation({ mutationFn: () => api<void>(`/tasks/${t.id}`, { method: "DELETE" }), onSettled: refresh });
  const stop = useMutation({ mutationFn: () => api<void>(`/tasks/${t.id}/stop`, { method: "POST" }), onSettled: refresh });
  const canReply = !!t.chat_id && !!t.message_id;

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
        <p className="whitespace-pre-wrap break-words rounded-md bg-ok-wash p-3 text-[0.9375rem] leading-[1.55] text-ink">{t.result}</p>
      ) : (
        <p className="rounded-md bg-paper-2 p-3 text-sm leading-relaxed text-ink-3">
          {running ? "AI đang làm trong Terminal. Khi xong, báo cáo tự hiện ở đây (~10 giây). Nếu AI đã xong mà chưa thấy báo cáo, bấm “Lấy kết quả từ Terminal”." : "Chưa có kết quả (phiên đã dừng hoặc lỗi). Bấm “Chạy lại”."}
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
          <span className="rounded-sm border border-rule px-1.5 py-0.5 text-ink-2">
            {{ plan: "Chỉ đọc", edit: "Được sửa file", terminal: "Terminal" }[t.mode ?? "terminal"]}
          </span>
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
          {!t.result && t.interactive && (
            <Button size="sm" aria-busy={capture.isPending} disabled={capture.isPending}
              title="AI không ghi báo cáo? Lấy phần chữ cuối trong Terminal làm kết quả"
              onClick={() => capture.mutate()}>
              <SquareTerminal /> Lấy kết quả từ Terminal
            </Button>
          )}
          {t.result && canReply && (
            <Button size="sm" onClick={() => onUseText(asMessage(t), t.result!)}>
              <MessageSquare /> Dùng kết quả làm nháp trả lời
            </Button>
          )}
          {t.chat_id && (
            <Button size="sm" variant="outline" onClick={() => onOpenGroup(t.chat_id!)}>Mở nhóm</Button>
          )}
          <Button size="sm" variant="outline" aria-busy={reopen.isPending} disabled={reopen.isPending}
            title="Chạy lại từ đầu cùng yêu cầu (xóa hội thoại và kết quả cũ)"
            onClick={() => confirm("Chạy lại phiên này từ đầu? Hội thoại và kết quả cũ sẽ bị xóa.") && reopen.mutate()}>
            <RotateCcw /> {running && !headless ? "Mở lại Terminal" : "Chạy lại"}
          </Button>
          <Button size="sm" variant="destructive" className="ml-auto" aria-busy={remove.isPending} disabled={remove.isPending}
            onClick={() => confirm("Xóa phiên này khỏi danh sách?") && remove.mutate()}>
            <Trash2 /> Xóa
          </Button>
        </div>
        {(reopen.isError || remove.isError || capture.isError || stop.isError) && <p role="alert" className="text-xs text-error">Thao tác thất bại (không mở được Terminal?).</p>}
      </div>

      {headless ? <ChatPanel id={t.id} running={running} plan={t.mode === "plan"} head={head} />
        : t.interactive ? <TerminalPanel id={t.id} head={head} tail={result} />
        : <Feed follow={t.result}>{head}{result}</Feed>}
    </div>
  );
}

/** Every task handed to the AI: the list on the left, the selected session on the right. */
export function TasksPage({ onBack, onOpenGroup, onUseText }: {
  onBack: () => void; onOpenGroup: (chatId: string) => void; onUseText: (m: Message, text: string) => void;
}) {
  const q = useTaskList();
  const now = useNow();
  const [filter, setFilter] = useState<Filter>("all");
  const [sel, setSel] = useState<string | null>(null); // null on phones = show the list
  const all = q.data ?? [];
  const running = all.filter((t) => t.running).length;
  const rows = all.filter((t) => filter === "all" || (filter === "running") === !!t.running);
  const cur = rows.find((t) => t.id === sel) ?? rows[0];

  return (
    <section aria-label="AI Agent" className="flex min-h-0 flex-col">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b px-3 md:px-5">
        <Button size="icon-sm" variant="ghost" className="md:hidden" onClick={onBack} aria-label="Quay lại"><ArrowLeft /></Button>
        <p className="min-w-0 truncate text-[0.8125rem] text-ink-2">
          <span className="font-mono text-ink tabular-nums">{all.length}</span> phiên
          {running > 0 && <>, <span className="inline-flex items-center gap-1 text-info"><Loader2 className="size-3 animate-spin" aria-hidden /><span className="font-mono tabular-nums">{running}</span> đang chạy</span></>}
        </p>
        <ModelEffortPicker task className="ml-auto hidden sm:grid" />
        <div className="ml-auto flex gap-1 sm:ml-0" role="group" aria-label="Lọc phiên">
          {FILTERS.map(([id, label]) => (
            <button key={id} type="button" aria-pressed={filter === id} onClick={() => setFilter(id)}
              className={cn("h-7 whitespace-nowrap rounded-md border px-2.5 text-xs transition-[background-color,border-color,color] duration-(--dur-micro)",
                filter === id ? "border-hl bg-hl font-medium text-hl-ink" : "border-rule text-ink-2 hover:border-rule-2 hover:bg-paper-2 hover:text-ink")}>
              {label}
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
      {cur && (
        <div className="flex min-h-0 flex-1">
          <ul aria-label="Danh sách phiên" className={cn("min-h-0 w-full overflow-y-auto md:block md:w-72 md:shrink-0 md:border-r", sel && "hidden")}>
            {rows.map((t) => <TaskRow key={t.id} t={t} now={now} active={t.id === cur.id} onSelect={() => setSel(t.id)} />)}
          </ul>
          <div className={cn("min-h-0 min-w-0 flex-1 flex-col", sel ? "flex" : "hidden md:flex")}>
            <TaskDetail key={cur.id} t={cur} now={now} onBack={() => setSel(null)} onOpenGroup={onOpenGroup} onUseText={onUseText} />
          </div>
        </div>
      )}
    </section>
  );
}
