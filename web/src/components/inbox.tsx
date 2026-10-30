"use client";

import { useQuery } from "@tanstack/react-query";
import { ChevronsLeft, ChevronsRight, MessageSquare, Moon, RotateCw, Search, Sun, Wifi, WifiOff, X } from "lucide-react";
import { useEffect, useState } from "react";
import { ChatList, useChats } from "@/components/chat-list";
import { Composer, type DraftInjection } from "@/components/composer";
import { MessageList } from "@/components/message-list";
import { TasksPage } from "@/components/tasks-page";
import { PendingInbox } from "@/components/pending-inbox";
import { DateRangePicker, type DayRange, rangeQuery } from "@/components/date-range";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { type StreamState, useSync } from "@/hooks/use-events";
import { api, type Message, type Status } from "@/lib/api";
import { ALL, PINNED, TASKS, useTaskList } from "@/lib/inbox";
import { cn } from "@/lib/utils";

const STATE_LABEL: Record<Status["state"], string> = {
  setup_required: "Chưa cấu hình Telegram (TELEGRAM_API_ID/HASH)",
  login_required: "Cần đăng nhập: uv run python -m telegram_dashboard login",
  connecting: "Đang kết nối Telegram…",
  connected: "Đã kết nối Telegram",
  degraded: "Mất kết nối, đang thử lại",
  stopped: "Đã dừng",
};

const STREAM_LABEL: Record<StreamState, string> = {
  open: "Cập nhật trực tiếp",
  connecting: "Đang nối lại luồng cập nhật…",
  closed: "Luồng cập nhật tạm dừng",
};

export function App() {
  const status = useQuery({
    queryKey: ["status"],
    queryFn: ({ signal }) => api<Status>("/status", { signal }),
    retry: 1,
  });

  if (status.isPending) {
    return (
      <main aria-busy className="grid h-dvh grid-rows-[3.5rem_1fr]">
        <span className="sr-only">Đang tải…</span>
        <div className="flex items-center gap-4 border-b px-4">
          <Skeleton className="h-8 w-44 rounded-md" />
          <Skeleton className="ml-auto h-9 w-full max-w-sm rounded-md" />
        </div>
        <div className="grid min-h-0 md:grid-cols-[18rem_minmax(0,1fr)]">
          <div className="hidden gap-3 border-r bg-paper-2 p-5 md:grid md:content-start">
            {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-4" style={{ width: `${80 - i * 12}%` }} />)}
          </div>
          <div className="grid content-start gap-5 p-6">
            {[0, 1, 2].map((i) => (
              <div key={i} className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-4">
                <Skeleton className="h-4 w-16" />
                <div className="grid gap-2"><Skeleton className="h-3.5 w-40" /><Skeleton className="h-3.5 w-full max-w-xl" /></div>
              </div>
            ))}
          </div>
        </div>
      </main>
    );
  }
  if (!status.data) {
    return (
      <main className="grid min-h-dvh place-items-center p-4">
        <div role="alert" className="grid max-w-sm justify-items-start gap-3">
          <h1 className="text-base">Không liên lạc được backend</h1>
          <p className="text-sm leading-relaxed text-ink-2">Không liên lạc được backend local (127.0.0.1:8765).</p>
          <Button size="sm" variant="outline" aria-busy={status.isFetching} disabled={status.isFetching} onClick={() => void status.refetch()}>
            <RotateCw /> Thử lại
          </Button>
        </div>
      </main>
    );
  }
  return <Inbox status={status.data} />;
}

function Inbox({ status }: { status: Status }) {
  const stream = useSync(status.cursor);
  const runningTasks = (useTaskList().data ?? []).filter((t) => t.running).length;
  const [chatId, setChatId] = useState<string | null>(null);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [selected, setSelected] = useState<Map<string, Message>>(new Map());
  const [draft, setDraft] = useState<DraftInjection | null>(null);
  // "Từ lúc" filter: datetime-local text (local time) -> ISO instant for the API.
  const [days, setDays] = useState<DayRange>({ from: "", to: "" });
  const range = rangeQuery(days);
  const pendingTotal = (useChats(range).data?.items ?? []).reduce((n, c) => n + c.pending_count, 0);
  const [search, setSearch] = useState("");
  function onSearch(q: string) {
    setSearch(q);
    if (q.trim() && chatId !== ALL && chatId !== PINNED) selectChat(ALL); // results live in the cross-group list
  }
  const [dark, setDark] = useState(true);
  // Sidebar: pinned open or a hover-to-open rail (remembered per browser).
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- restore after mount
    try { setCollapsed(localStorage.getItem("sidebarCollapsed") === "1"); } catch {}
  }, []);
  function toggleCollapsed() {
    setCollapsed((v) => {
      try { localStorage.setItem("sidebarCollapsed", v ? "0" : "1"); } catch {}
      return !v;
    });
  }
  const [flash, setFlash] = useState<string | null>(null);
  function flashMessage(text: string) {
    setFlash(text);
    setTimeout(() => setFlash(null), 3000);
  }
  const rightPanel = !!replyTo;

  function useText(m: Message, text: string) {
    setReplyTo(m);
    setDraft({ result: { text, options: [], source_message_ids: [m.message_id], context_revision: "" }, chatId: m.chat_id, nonce: Date.now() });
  }
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- read theme set by the layout script
    setDark(document.documentElement.classList.contains("dark"));
  }, []);
  function toggleTheme() {
    const next = !dark;
    setDark(next);
    const root = document.documentElement;
    root.classList.toggle("dark", next);
    root.dataset.theme = next ? "dark" : "light"; // the YouTrack module reads the same key and attribute
    try { localStorage.theme = next ? "dark" : "light"; } catch {}
  }

  // Selected chat lives in the query string (static export: no dynamic routes).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- read URL once after mount
    setChatId(new URLSearchParams(location.search).get("chat") ?? ALL); // default: cross-group to-do list
  }, []);

  // Esc: leave reply mode and clear every selection (dialogs close themselves first).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || document.querySelector("[role=dialog]")) return;
      setReplyTo(null);
      setSelected(new Map());
      setDraft(null);
      setSearch("");
      (document.activeElement as HTMLElement | null)?.blur();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  function selectChat(id: string | null) {
    setChatId(id);
    setReplyTo(null);
    setSelected(new Map());
    setDraft(null);
    const url = new URL(location.href);
    if (id) url.searchParams.set("chat", id);
    else url.searchParams.delete("chat");
    history.replaceState(null, "", url);
  }

  const connected = status.state === "connected";

  const tabs = [
    [ALL, "Việc cần xử lý", pendingTotal],
    [PINNED, "Tag đã ghim", 0],
    [TASKS, "Phiên AI", runningTasks],
  ] as const;

  return (
    <div className="grid h-dvh grid-rows-[auto_1fr] bg-paper">
      <header className="flex h-14 items-center gap-3 border-b bg-paper px-3 sm:px-4">
        <h1 className="sr-only">Telegram Dashboard</h1>
        <nav aria-label="Chuyển module" className="flex shrink-0 rounded-md bg-paper-2 p-0.5 shadow-groove">
          <span aria-current="page" className="inline-flex h-[30px] items-center rounded-[5px] bg-cotton px-3 text-[0.8125rem] font-medium text-ink shadow-edge">
            Telegram
          </span>
          <a href="/yt/" title="Chuyển sang YouTrack Dashboard"
            className="inline-flex h-[30px] items-center rounded-[5px] px-3 text-[0.8125rem] text-ink-3 no-underline transition-colors duration-(--dur-micro) hover:text-ink">
            YouTrack
          </a>
        </nav>
        <span
          data-testid="tg-state"
          title={STATE_LABEL[status.state]}
          className={cn("flex min-w-0 items-center gap-1.5 text-xs", connected ? "text-ink-3" : "text-warn")}
        >
          {connected ? <Wifi className="size-3.5 shrink-0" aria-hidden /> : <WifiOff className="size-3.5 shrink-0" aria-hidden />}
          <span className="hidden truncate lg:inline">{connected ? "Đã kết nối" : STATE_LABEL[status.state]}</span>
        </span>
        <span data-testid="stream-state" className={cn("hidden whitespace-nowrap text-xs xl:inline", stream === "open" ? "text-ink-3" : "text-warn")}>
          {STREAM_LABEL[stream]}
        </span>
        <label className="relative ml-auto hidden w-full max-w-sm sm:block">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-3" aria-hidden />
          <input
            type="search"
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            placeholder="Tìm người gửi, nhóm, tin nhắn…"
            aria-label="Tìm kiếm tất cả"
            className="h-9 w-full rounded-md border border-rule-2 bg-cotton pl-9 pr-9 text-sm text-ink transition-[border-color] duration-(--dur-micro) placeholder:text-ink-3 hover:border-ink-3 focus-visible:-outline-offset-1 [&::-webkit-search-cancel-button]:hidden"
          />
          {search && (
            <button type="button" aria-label="Xóa tìm kiếm" onClick={() => onSearch("")}
              className="absolute right-1.5 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-sm text-ink-3 hover:bg-paper-3 hover:text-ink">
              <X className="size-3.5" aria-hidden />
            </button>
          )}
        </label>
        <div className="ml-auto flex shrink-0 items-center gap-1 sm:ml-0">
          <DateRangePicker value={days} onChange={setDays} />
          <Button size="icon-sm" variant="ghost" onClick={toggleTheme} aria-label="Đổi giao diện sáng/tối" title="Đổi giao diện sáng/tối">
            {dark ? <Sun /> : <Moon />}
          </Button>
        </div>
      </header>
      <div className={cn(
        "grid min-h-0 grid-cols-1 grid-rows-[minmax(0,1fr)]",
        collapsed ? "md:grid-cols-[4rem_minmax(0,1fr)]" : "md:grid-cols-[18rem_minmax(0,1fr)]",
        rightPanel && (collapsed ? "xl:grid-cols-[4rem_minmax(0,1fr)_30rem]" : "xl:grid-cols-[18rem_minmax(0,1fr)_30rem]"),
      )}>
        <div className={cn("relative min-h-0 border-r bg-paper-2", chatId && "hidden md:block")}>
          {/* Collapsed: a 4rem rail; the full list opens over the content on hover/focus by clip-path, never by width. */}
          <div className={cn(
            "group/side h-full bg-paper-2",
            collapsed && "md:absolute md:inset-y-0 md:left-0 md:z-20 md:w-72 md:[clip-path:inset(0_calc(14rem+1px)_0_0)] md:transition-[clip-path,box-shadow] md:duration-(--dur-short) md:ease-out md:hover:shadow-pop md:hover:[clip-path:inset(0_-3rem_0_0)] md:focus-within:shadow-pop md:focus-within:[clip-path:inset(0_-3rem_0_0)]",
          )}>
            <div className="h-full md:w-72">
              <ChatList selected={chatId} onSelect={selectChat} range={range} search={search} collapsed={collapsed} />
            </div>
          </div>
          <Button size="icon-xs" variant="outline" onClick={(e) => { e.currentTarget.blur(); toggleCollapsed(); }}
            className="absolute -right-3 top-2.5 z-40 hidden size-6 rounded-full md:inline-flex"
            aria-label={collapsed ? "Ghim mở rộng thanh bên" : "Thu gọn thanh bên"}
            title={collapsed ? "Ghim mở rộng (đang thu gọn, rê chuột vào thanh bên để xem)" : "Thu gọn thanh bên"}>
            {collapsed ? <ChevronsRight /> : <ChevronsLeft />}
          </Button>
        </div>
        <div className={cn("min-h-0 grid-rows-[auto_minmax(0,1fr)] bg-paper", chatId ? "grid" : "hidden md:grid")}>
        <div role="tablist" aria-label="Danh sách tag" className="no-scrollbar flex h-11 items-stretch gap-6 overflow-x-auto border-b px-4 md:px-6">
          {tabs.map(([id, label, count]) => (
            <button key={id} type="button" role="tab" aria-selected={chatId === id} onClick={() => selectChat(id)}
              className={cn(
                "relative flex shrink-0 items-center gap-2 whitespace-nowrap text-sm transition-colors duration-(--dur-micro) after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:origin-left after:scale-x-0 after:bg-ink after:transition-transform after:duration-(--dur-short) after:ease-out hover:text-ink",
                chatId === id ? "font-medium text-ink after:scale-x-100" : "text-ink-3",
              )}>
              {label}
              {count > 0 && (
                <span className="rounded-full bg-paper-3 px-1.5 font-mono text-xs font-normal leading-5 text-ink-2 tabular-nums">
                  <span className="sr-only">(</span>{count}<span className="sr-only">{id === TASKS ? " đang chạy)" : ")"}</span>
                </span>
              )}
            </button>
          ))}
        </div>
        {chatId ? (
          <div key={chatId} className="grid min-h-0 grid-cols-[minmax(0,1fr)] animate-in fade-in-0 duration-(--dur-short)">
            {chatId === TASKS ? (
              <TasksPage onBack={() => selectChat(null)} onOpenGroup={selectChat} onUseText={useText} />
            ) : chatId === ALL || chatId === PINNED ? (
              <PendingInbox pinned={chatId === PINNED} range={range} search={search} replyTo={replyTo?.message_id ?? null} onReply={setReplyTo}
                onBack={() => selectChat(null)} onUseText={useText} />
            ) : (
            <MessageList
              onUseText={useText}
              chatId={chatId}
              range={range}
              onBack={() => selectChat(null)}
              replyTo={replyTo?.message_id ?? null}
              onReply={setReplyTo}
              selectMode={false}
              selected={selected}
              onToggle={(m) =>
                setSelected((prev) => {
                  const next = new Map(prev);
                  if (next.has(m.message_id)) next.delete(m.message_id);
                  else next.set(m.message_id, m);
                  return next;
                })
              }
            />
            )}
          </div>
        ) : (
          <div className="grid place-items-center p-6">
            <div className="grid max-w-xs justify-items-center gap-3 text-center">
              <MessageSquare className="size-6 text-ink-3" aria-hidden />
              <p className="text-sm text-ink-2">Chọn một nhóm để xem tin bạn được tag</p>
              <Button size="sm" variant="outline" onClick={() => selectChat(ALL)}>Việc cần xử lý</Button>
            </div>
          </div>
        )}
        </div>
        {replyTo ? (
          <div key={`${replyTo.chat_id}:${replyTo.message_id}`}
            className="fixed inset-y-0 right-0 z-30 flex w-full max-w-[30rem] flex-col border-l bg-cotton shadow-pop animate-in fade-in-0 slide-in-from-right-8 duration-(--dur-short) xl:static xl:max-w-none xl:shadow-none">
            <Composer chatId={replyTo.chat_id} youtrackConfigured={status.youtrack_configured ?? false} replyTo={replyTo}
              onClearReply={() => setReplyTo(null)} onSent={() => flashMessage("Đã gửi trả lời ✓")} onTaskCreated={() => flashMessage("Đã giao việc cho AI. Theo dõi ở tab “Phiên AI”")} draft={draft}
              aiConfigured={status.ai_configured} />
          </div>
        ) : null}
      </div>
      {flash && (
        <div role="status" className="fixed bottom-[calc(1rem+env(safe-area-inset-bottom,0px))] left-1/2 z-50 max-w-[calc(100%-2rem)] -translate-x-1/2 rounded-md bg-board px-4 py-2.5 text-sm font-medium text-board-type shadow-pop animate-in fade-in-0 slide-in-from-bottom-2 duration-(--dur-short)">
          {flash}
        </div>
      )}
    </div>
  );
}
