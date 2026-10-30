"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Bot, CheckCircle2, ChevronDown, CornerDownLeft, FolderGit2, Square, Loader2, MessageSquare, RotateCcw, RotateCw, SquareTerminal, Trash2, Users, Wrench } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { api, ApiError, type Message, type Task } from "@/lib/api";
import { ALL, useNow, useTaskList } from "@/lib/inbox";
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
  user: "ml-8 bg-paper-3 text-ink",
  assistant: "mr-8 bg-cotton text-ink",
  tool: "font-mono text-xs text-ink-3",
  tool_result: "font-mono text-xs text-ink-3 line-clamp-3",
  result: "bg-ok-wash text-ink",
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
    <div className="grid gap-2 animate-in fade-in-0 duration-(--dur-short)">
      <div className="max-h-96 overflow-y-auto rounded-md bg-paper-2 p-2" aria-label="Hội thoại với AI">
        <ul className="grid gap-1.5">
          {items.map((it, i) => (
            <li key={i} className={cn("whitespace-pre-wrap break-words rounded-md px-3 py-1.5 text-sm leading-relaxed",
              KIND_STYLE[it.kind], it.error && "bg-error-wash text-error")}>
              {it.kind === "tool" && <Wrench className="mr-1.5 inline size-3 align-[-1px]" aria-hidden />}{it.text}
            </li>
          ))}
          {running && <li className="flex items-center gap-1.5 px-1 text-xs text-ink-3"><Loader2 className="size-3 animate-spin" aria-hidden /> AI đang làm…</li>}
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
          className="min-h-10 min-w-0 flex-1 resize-none rounded-md border border-rule-2 bg-cotton px-3 py-2 text-sm text-ink placeholder:text-ink-3 hover:border-ink-3 focus-visible:-outline-offset-1 disabled:cursor-not-allowed disabled:opacity-50"
        />
        {running ? (
          <Button type="button" variant="outline" aria-busy={stop.isPending} disabled={stop.isPending} onClick={() => stop.mutate()}>
            <Square /> Dừng
          </Button>
        ) : (
          <Button type="submit" aria-busy={send.isPending} disabled={!text.trim() || send.isPending}>Gửi</Button>
        )}
      </form>
      {(send.isError || stop.isError) && (
        <p role="alert" className="text-xs text-error">{busy ? "AI đang làm lượt trước." : "Thao tác thất bại."}</p>
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
    <div className="grid gap-2 animate-in fade-in-0 duration-(--dur-short)">
      <pre ref={screen} aria-label="Màn hình Terminal"
        className="h-64 overflow-y-auto whitespace-pre-wrap break-all rounded-md bg-board p-3 font-mono text-xs leading-relaxed text-board-type">
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
            className="h-[30px] min-w-0 flex-1 rounded-md border border-rule-2 bg-cotton px-3 text-sm text-ink placeholder:text-ink-3 hover:border-ink-3 focus-visible:-outline-offset-1"
          />
          <Button type="submit" size="sm" disabled={!text.trim() || send.isPending}>Gửi</Button>
          <Button type="button" size="sm" variant="outline" disabled={send.isPending}
            title="Gửi phím Enter (đồng ý lựa chọn đang chọn khi AI hỏi duyệt)" onClick={() => send.mutate("")}>
            <CornerDownLeft /> Enter
          </Button>
        </form>
      )}
      {send.isError && <p role="alert" className="text-xs text-error">Không gửi được vào Terminal.</p>}
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

  const toggle = "flex w-fit items-center gap-1 rounded-sm text-left text-xs font-medium text-ink-3 transition-colors duration-(--dur-micro) hover:text-ink";

  return (
    <li className="grid gap-4 rounded-lg bg-cotton p-4 shadow-stock animate-in fade-in-0 duration-(--dur-short) sm:p-5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs">
        {running ? (
          <span className="inline-flex items-center gap-1 font-medium text-info">
            <Loader2 className="size-3.5 animate-spin" aria-hidden /> Đang chạy
          </span>
        ) : !t.result && headless ? (
          <span className="inline-flex items-center gap-1.5 rounded-sm bg-warn-wash px-1.5 py-0.5 font-medium text-warn">
            <Square className="size-3 fill-current" aria-hidden /> Đã dừng
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-sm bg-ok-wash px-1.5 py-0.5 font-medium text-ok">
            <CheckCircle2 className="size-3.5" aria-hidden /> Đã có kết quả
          </span>
        )}
        <span className="rounded-sm border border-rule px-1.5 py-0.5 text-ink-2">
          {{ plan: "Chỉ đọc", edit: "Được sửa file", terminal: "Terminal" }[t.mode ?? "terminal"]}
        </span>
        <span className="inline-flex items-center gap-1 text-ink-2" title={t.project}>
          <FolderGit2 className="size-3.5" aria-hidden /> {t.project.split("/").pop()}
        </span>
        <time className="ml-auto text-ink-3" dateTime={t.created_at} title={new Date(t.created_at).toLocaleString()}>
          {ago(t.created_at, now)}
        </time>
      </div>

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
        <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)} className={toggle}>
          <ChevronDown className={cn("size-3.5 transition-transform duration-(--dur-short)", !open && "-rotate-90")} aria-hidden /> Yêu cầu đã giao
        </button>
        {open && <p className="max-h-60 overflow-y-auto whitespace-pre-wrap break-words rounded-md bg-paper-2 p-3 text-sm leading-relaxed text-ink-2 animate-in fade-in-0 duration-(--dur-short)">{t.prompt}</p>}
      </section>

      {headless && (
        <section aria-label="Hội thoại với AI" className="grid gap-1.5">
          <button type="button" aria-expanded={term} onClick={() => setTerm((v) => !v)} className={toggle}>
            <ChevronDown className={cn("size-3.5 transition-transform duration-(--dur-short)", !term && "-rotate-90")} aria-hidden />
            <Bot className="size-3.5" aria-hidden /> Hội thoại, nhập tiếp
          </button>
          {term && <ChatPanel id={t.id} running={running} />}
        </section>
      )}

      {t.interactive && (
        <section aria-label="Terminal" className="grid gap-1.5">
          <button type="button" aria-expanded={term} onClick={() => setTerm((v) => !v)} className={cn(toggle, "whitespace-nowrap")}>
            <ChevronDown className={cn("size-3.5 transition-transform duration-(--dur-short)", !term && "-rotate-90")} aria-hidden />
            <SquareTerminal className="size-3.5" aria-hidden /> Terminal: xem và nhập tiếp
          </button>
          {term && <TerminalPanel id={t.id} />}
        </section>
      )}

      <section aria-label="Kết quả" className="grid gap-1.5">
        <h3 className="text-xs font-medium tracking-normal text-ink-3">Kết quả từ AI</h3>
        {t.result ? (
          <p className="max-h-80 overflow-y-auto whitespace-pre-wrap break-words rounded-md bg-paper-2 p-3 text-[0.9375rem] leading-[1.55] text-ink">{t.result}</p>
        ) : (
          <p className="rounded-md bg-paper-2 p-3 text-sm leading-relaxed text-ink-3">
            {running ? (headless ? "AI đang làm. Theo dõi ở mục Hội thoại; kết quả hiện ở đây khi xong." : "AI đang làm trong Terminal. Khi xong, báo cáo tự hiện ở đây (~10 giây). Nếu AI đã xong mà chưa thấy báo cáo, bấm “Lấy kết quả từ Terminal”.") : "Chưa có kết quả (phiên đã dừng hoặc lỗi). Xem Hội thoại hoặc bấm “Chạy lại”."}
          </p>
        )}
      </section>

      <div className="flex flex-wrap gap-2 border-t pt-4">
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
      {(reopen.isError || remove.isError || capture.isError) && <p role="alert" className="text-xs text-error">Thao tác thất bại (không mở được Terminal?).</p>}
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
      <div className="flex h-11 shrink-0 items-center gap-2 border-b bg-paper px-3 md:px-5">
        <Button size="icon-sm" variant="ghost" className="md:hidden" onClick={onBack} aria-label="Quay lại"><ArrowLeft /></Button>
        <p className="min-w-0 truncate text-[0.8125rem] text-ink-2">
          <span className="font-mono text-ink tabular-nums">{all.length}</span> phiên
          {running > 0 && <>, <span className="font-mono text-ink tabular-nums">{running}</span> đang chạy</>}
        </p>
        <div className="ml-auto flex gap-1" role="group" aria-label="Lọc phiên">
          {FILTERS.map(([id, label]) => (
            <button key={id} type="button" aria-pressed={filter === id} onClick={() => setFilter(id)}
              className={cn("h-7 whitespace-nowrap rounded-md border px-2.5 text-xs transition-[background-color,border-color,color] duration-(--dur-micro)",
                filter === id ? "border-hl bg-hl font-medium text-hl-ink" : "border-rule text-ink-2 hover:border-rule-2 hover:bg-paper-2 hover:text-ink")}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4 sm:px-5 sm:py-5">
        {q.isPending && (
          <ul aria-label="Đang tải…" className="mx-auto grid max-w-3xl gap-4">
            {[0, 1].map((i) => (
              <li key={i} className="grid gap-3 rounded-lg bg-cotton p-5 shadow-stock">
                <div className="flex gap-3"><Skeleton className="h-4 w-24" /><Skeleton className="h-4 w-20" /><Skeleton className="ml-auto h-4 w-16" /></div>
                <Skeleton className="h-16 w-full" />
                <Skeleton className="h-3 w-32" />
              </li>
            ))}
          </ul>
        )}
        {q.isError && (
          <div role="alert" className="mx-auto grid max-w-3xl justify-items-start gap-2 text-sm">
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
        <ul className="mx-auto grid max-w-3xl gap-4">
          {rows.map((t) => <TaskCard key={t.id} t={t} now={now} onOpenGroup={onOpenGroup} onUseText={onUseText} />)}
        </ul>
      </div>
    </section>
  );
}
