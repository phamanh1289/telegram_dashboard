"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Bot, CheckCircle2, ChevronDown, CornerDownLeft, FolderGit2, Square, Loader2, MessageSquare, RotateCcw, SquareTerminal, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { api, ApiError, type Message, type Task } from "@/lib/api";
import { useNow, useTaskList } from "@/lib/inbox";
import { cn } from "@/lib/utils";

type TaskEvent = { kind: string; text: string; error?: boolean };
type Filter = "all" | "running" | "done";
const FILTERS: [Filter, string][] = [["all", "Tất cả"], ["running", "Đang chạy"], ["done", "Đã xong"]];

function ago(date: string, now: number) {
  const mins = Math.max(0, Math.round((now - new Date(date).getTime()) / 60_000));
  return mins < 1 ? "vừa xong" : mins < 60 ? `${mins} phút trước` : mins < 1440 ? `${Math.floor(mins / 60)} giờ trước` : `${Math.floor(mins / 1440)} ngày trước`;
}

/** The tagged message as the reply panel needs it (the task row only keeps a snapshot). */
function asMessage(t: Task): Message {
  return {
    chat_id: t.chat_id!, message_id: t.message_id!, sender_id: null, sender_name: t.sender_name ?? null,
    text: t.message_text ?? "", date: t.created_at, outgoing: false, deleted: false, handled: false, pinned: false,
  } as unknown as Message;
}

const KIND_STYLE: Record<string, string> = {
  user: "ml-8 border border-primary/30 bg-primary/10",
  assistant: "mr-8 bg-muted/60",
  tool: "border border-dashed bg-transparent font-mono text-xs text-muted-foreground",
  tool_result: "bg-transparent font-mono text-xs text-muted-foreground/80 line-clamp-3",
  result: "border border-emerald-500/30 bg-emerald-500/5",
};

/** Headless session: conversation log, follow-up input and Stop. */
function ChatPanel({ id, running }: { id: string; running: boolean }) {
  const qc = useQueryClient();
  const [items, setItems] = useState<TaskEvent[]>([]);
  const next = useRef(0);
  const [text, setText] = useState("");
  const end = useRef<HTMLDivElement>(null);
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
    mutationFn: (line: string) => api<void>(`/tasks/${id}/message`, { method: "POST", json: { text: line } }),
    onSuccess: () => { setText(""); refresh(); },
  });
  const stop = useMutation({
    mutationFn: () => api<void>(`/tasks/${id}/stop`, { method: "POST" }),
    onSuccess: refresh,
  });
  useEffect(() => {
    end.current?.scrollIntoView({ block: "nearest" });
  }, [items.length]);
  const busy = send.error instanceof ApiError && send.error.code === "task_busy";

  return (
    <div className="grid gap-2 animate-in fade-in-0 duration-200">
      <div className="max-h-96 overflow-y-auto rounded-lg border bg-background p-2" aria-label="Hội thoại với AI">
        <ul className="grid gap-1.5">
          {items.map((it, i) => (
            <li key={i} className={cn("whitespace-pre-wrap break-words rounded-lg px-3 py-1.5 text-sm",
              KIND_STYLE[it.kind], it.error && "border-destructive/40 text-destructive")}>
              {it.kind === "tool" && "🔧 "}{it.text}
            </li>
          ))}
          {running && <li className="flex items-center gap-1.5 px-1 text-xs text-muted-foreground"><Loader2 className="size-3 animate-spin" /> AI đang làm…</li>}
        </ul>
        <div ref={end} />
      </div>
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
          className="min-h-10 min-w-0 flex-1 resize-none rounded-md border bg-background px-3 py-2 text-sm outline-none focus:border-primary disabled:opacity-60"
        />
        {running ? (
          <Button type="button" variant="outline" disabled={stop.isPending} onClick={() => stop.mutate()}>
            <Square /> Dừng
          </Button>
        ) : (
          <Button type="submit" disabled={!text.trim() || send.isPending}>Gửi</Button>
        )}
      </form>
      {(send.isError || stop.isError) && (
        <p role="alert" className="text-xs text-destructive">{busy ? "AI đang làm lượt trước." : "Thao tác thất bại."}</p>
      )}
    </div>
  );
}

/** Live view of the task's Terminal tab plus a line input, so the session can be driven from here. */
function TerminalPanel({ id }: { id: string }) {
  const [text, setText] = useState("");
  const screen = useRef<HTMLPreElement>(null);
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
  useEffect(() => {
    const el = screen.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [q.data?.text]);
  const gone = q.error instanceof ApiError && q.error.code === "terminal_gone";

  return (
    <div className="grid gap-2 animate-in fade-in-0 duration-200">
      <pre ref={screen} aria-label="Màn hình Terminal"
        className="h-64 overflow-y-auto whitespace-pre-wrap break-all rounded-lg bg-black/90 p-3 font-mono text-xs leading-relaxed text-green-100">
        {gone ? "Cửa sổ Terminal của phiên này đã đóng. Bấm “Chạy lại” để mở phiên mới."
          : q.isError ? "Không đọc được Terminal (macOS có thể đang chặn quyền Automation cho Terminal)."
          : (q.data?.text ?? "Đang đọc Terminal…")}
      </pre>
      {!gone && (
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); send.mutate(text); }}>
          <input
            aria-label="Nhập vào Terminal"
            value={text}
            maxLength={2000}
            onChange={(e) => setText(e.target.value)}
            placeholder="Gõ phản hồi cho AI rồi Enter, ví dụ: tiếp tục / làm theo cách 2…"
            className="h-9 min-w-0 flex-1 rounded-md border bg-background px-3 text-sm outline-none focus:border-primary"
          />
          <Button type="submit" size="sm" disabled={!text.trim() || send.isPending}>Gửi</Button>
          <Button type="button" size="sm" variant="outline" disabled={send.isPending}
            title="Gửi phím Enter (đồng ý lựa chọn đang chọn khi AI hỏi duyệt)" onClick={() => send.mutate("")}>
            <CornerDownLeft /> Enter
          </Button>
        </form>
      )}
      {send.isError && <p role="alert" className="text-xs text-destructive">Không gửi được vào Terminal.</p>}
    </div>
  );
}

function TaskCard({ t, now, onOpenGroup, onUseText }: {
  t: Task; now: number; onOpenGroup: (chatId: string) => void; onUseText: (m: Message, text: string) => void;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState(() => !!t.running && (t.mode ?? "terminal") !== "terminal");
  const running = !!t.running;
  const headless = (t.mode ?? "terminal") !== "terminal";
  const refresh = () => qc.invalidateQueries({ queryKey: ["tasks"] });
  const reopen = useMutation({ mutationFn: () => api<void>(`/tasks/${t.id}/reopen`, { method: "POST" }), onSettled: refresh });
  const capture = useMutation({ mutationFn: () => api<void>(`/tasks/${t.id}/capture`, { method: "POST" }), onSettled: refresh });
  const remove = useMutation({ mutationFn: () => api<void>(`/tasks/${t.id}`, { method: "DELETE" }), onSettled: refresh });
  const canReply = !!t.chat_id && !!t.message_id;

  return (
    <li className="grid gap-3 rounded-xl border bg-card p-4 shadow-xs animate-in fade-in-0 slide-in-from-bottom-1 duration-300">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        {running ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-sky-500/15 px-2 py-0.5 font-medium text-sky-600 dark:text-sky-400">
            <Loader2 className="size-3 animate-spin" aria-hidden /> Đang chạy
          </span>
        ) : !t.result && headless ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 font-medium text-amber-600 dark:text-amber-400">
            Đã dừng
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 font-medium text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 className="size-3" aria-hidden /> Đã có kết quả
          </span>
        )}
        <span className="rounded-full border px-2 py-0.5 text-muted-foreground">
          {{ plan: "Chỉ đọc", edit: "Được sửa file", terminal: "Terminal" }[t.mode ?? "terminal"]}
        </span>
        <span className="inline-flex items-center gap-1 text-muted-foreground" title={t.project}>
          <FolderGit2 className="size-3.5" aria-hidden /> {t.project.split("/").pop()}
        </span>
        <time className="ml-auto text-muted-foreground" dateTime={t.created_at} title={new Date(t.created_at).toLocaleString()}>
          {ago(t.created_at, now)}
        </time>
      </div>

      {(t.message_text || t.chat_title) && (
        <div className="rounded-lg border-l-2 border-primary bg-muted/50 px-3 py-2 text-sm">
          <p className="mb-0.5 text-xs font-medium text-muted-foreground">
            {[t.chat_title, t.sender_name].filter(Boolean).join(" · ")}
          </p>
          <p className="line-clamp-3 whitespace-pre-wrap break-words">{t.message_text}</p>
        </div>
      )}

      <section aria-label="Yêu cầu giao cho AI" className="grid gap-1">
        <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-1 text-left text-xs font-medium uppercase text-muted-foreground hover:text-foreground">
          <ChevronDown className={cn("size-3.5 transition-transform", !open && "-rotate-90")} aria-hidden /> Yêu cầu đã giao
        </button>
        {open && <p className="max-h-60 overflow-y-auto whitespace-pre-wrap break-words rounded-lg bg-muted/40 p-3 text-sm animate-in fade-in-0 duration-200">{t.prompt}</p>}
      </section>

      {headless && (
        <section aria-label="Hội thoại với AI" className="grid gap-1">
          <button type="button" aria-expanded={term} onClick={() => setTerm((v) => !v)}
            className="flex items-center gap-1 text-left text-xs font-medium uppercase text-muted-foreground hover:text-foreground">
            <ChevronDown className={cn("size-3.5 transition-transform", !term && "-rotate-90")} aria-hidden />
            <Bot className="size-3.5" aria-hidden /> Hội thoại · nhập tiếp
          </button>
          {term && <ChatPanel id={t.id} running={running} />}
        </section>
      )}

      {t.interactive && (
        <section aria-label="Terminal" className="grid gap-1">
          <button type="button" aria-expanded={term} onClick={() => setTerm((v) => !v)}
            className="flex items-center gap-1 text-left text-xs font-medium uppercase text-muted-foreground hover:text-foreground">
            <ChevronDown className={cn("size-3.5 transition-transform", !term && "-rotate-90")} aria-hidden />
            <SquareTerminal className="size-3.5" aria-hidden /> Terminal · xem &amp; nhập tiếp
          </button>
          {term && <TerminalPanel id={t.id} />}
        </section>
      )}

      <section aria-label="Kết quả" className="grid gap-1">
        <h3 className="text-xs font-medium uppercase text-muted-foreground">Kết quả từ AI</h3>
        {t.result ? (
          <p className="max-h-80 overflow-y-auto whitespace-pre-wrap break-words rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 text-sm">{t.result}</p>
        ) : (
          <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
            {running ? (headless ? "AI đang làm. Theo dõi ở mục Hội thoại; kết quả hiện ở đây khi xong." : "AI đang làm trong Terminal. Khi xong, báo cáo tự hiện ở đây (~10 giây). Nếu AI đã xong mà chưa thấy báo cáo, bấm “Lấy kết quả từ Terminal”.") : "Chưa có kết quả (phiên đã dừng hoặc lỗi). Xem Hội thoại hoặc bấm “Chạy lại”."}
          </p>
        )}
      </section>

      <div className="flex flex-wrap gap-2">
        {!t.result && t.interactive && (
          <Button size="sm" disabled={capture.isPending}
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
        <Button size="sm" variant="outline" disabled={reopen.isPending}
          title="Chạy lại từ đầu cùng yêu cầu (xóa hội thoại và kết quả cũ)"
          onClick={() => confirm("Chạy lại phiên này từ đầu? Hội thoại và kết quả cũ sẽ bị xóa.") && reopen.mutate()}>
          <RotateCcw /> {running && !headless ? "Mở lại Terminal" : "Chạy lại"}
        </Button>
        <Button size="sm" variant="ghost" className="ml-auto text-destructive" disabled={remove.isPending}
          onClick={() => confirm("Xóa phiên này khỏi danh sách?") && remove.mutate()}>
          <Trash2 /> Xóa
        </Button>
      </div>
      {(reopen.isError || remove.isError || capture.isError) && <p role="alert" className="text-xs text-destructive">Thao tác thất bại (không mở được Terminal?).</p>}
    </li>
  );
}

/** Every task handed to the AI: follow progress, read results, re-run or remove them. */
export function TasksPage({ onBack, onOpenGroup, onUseText }: {
  onBack: () => void; onOpenGroup: (chatId: string) => void; onUseText: (m: Message, text: string) => void;
}) {
  const q = useTaskList();
  const now = useNow();
  const [filter, setFilter] = useState<Filter>("all");
  const all = q.data ?? [];
  const running = all.filter((t) => t.running).length;
  const rows = all.filter((t) => filter === "all" || (filter === "running") === !!t.running);

  return (
    <section aria-label="Phiên AI" className="flex min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b bg-card px-3 py-2">
        <Button size="icon-sm" variant="ghost" className="md:hidden" onClick={onBack} aria-label="Quay lại"><ArrowLeft /></Button>
        <Bot className="size-4 text-primary" aria-hidden />
        <span className="truncate text-sm font-medium">
          Phiên AI <span className="font-normal text-muted-foreground">({all.length}{running > 0 && ` · ${running} đang chạy`})</span>
        </span>
        <div className="ml-auto flex gap-1" role="group" aria-label="Lọc phiên">
          {FILTERS.map(([id, label]) => (
            <button key={id} type="button" aria-pressed={filter === id} onClick={() => setFilter(id)}
              className={cn("rounded-full border px-2.5 py-0.5 text-xs transition-colors",
                filter === id ? "border-primary/50 bg-primary/10 font-medium" : "text-muted-foreground hover:bg-muted")}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {q.isPending && <Skeleton className="h-32 w-full" />}
        {q.isError && <p className="text-sm text-destructive">Không tải được danh sách phiên.</p>}
        {q.isSuccess && rows.length === 0 && (
          <p className="grid place-items-center py-16 text-center text-sm text-muted-foreground">
            {all.length === 0 ? "Chưa giao việc nào. Mở một tin → chọn dự án → “Giao việc”." : "Không có phiên nào khớp bộ lọc."}
          </p>
        )}
        <ul className="mx-auto grid max-w-3xl gap-3">
          {rows.map((t) => <TaskCard key={t.id} t={t} now={now} onOpenGroup={onOpenGroup} onUseText={onUseText} />)}
        </ul>
      </div>
    </section>
  );
}
