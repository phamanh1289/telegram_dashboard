"use client";

import { useQuery } from "@tanstack/react-query";
import { ChevronsLeft, ChevronsRight, MessageSquare, Moon, Bot, Pin, Search, Send, Sun, X, Inbox as InboxIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { ChatList } from "@/components/chat-list";
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
      <main className="grid min-h-dvh place-items-center p-4">
        <Skeleton className="h-10 w-64" />
      </main>
    );
  }
  if (!status.data) {
    return (
      <main className="grid min-h-dvh place-items-center gap-2 p-4 text-sm">
        <p>Không liên lạc được backend local (127.0.0.1:8765).</p>
        <Button size="sm" onClick={() => void status.refetch()}>Thử lại</Button>
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
    document.documentElement.classList.toggle("dark", next);
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

  return (
    <div className="grid h-dvh grid-rows-[auto_1fr]">
      <header className="flex items-center gap-3 border-b bg-card px-4 py-2.5">
        <h1 className="flex items-center gap-2 text-sm font-semibold">
          <Send className="size-4 text-primary" aria-hidden /> Telegram Dashboard
        </h1>
        <span
          data-testid="tg-state"
          title={STATE_LABEL[status.state]}
          className="flex items-center gap-1.5 text-xs text-muted-foreground"
        >
          <span className={cn("size-2 rounded-full", connected ? "bg-emerald-500" : "bg-amber-500")} />
          <span className="hidden sm:inline">{connected ? "Đã kết nối" : STATE_LABEL[status.state]}</span>
        </span>
        <span data-testid="stream-state" className="hidden text-xs text-muted-foreground md:inline">
          {STREAM_LABEL[stream]}
        </span>
        <label className="relative ml-auto hidden w-full max-w-sm sm:block">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            placeholder="Tìm người gửi, nhóm, tin nhắn…"
            aria-label="Tìm kiếm tất cả"
            className="h-8 w-full rounded-md border bg-background pl-8 pr-7 text-xs outline-none placeholder:text-muted-foreground focus:border-primary [&::-webkit-search-cancel-button]:hidden"
          />
          {search && (
            <button type="button" aria-label="Xóa tìm kiếm" onClick={() => onSearch("")}
              className="absolute right-1.5 top-1/2 grid size-5 -translate-y-1/2 place-items-center rounded text-muted-foreground hover:text-foreground">
              <X className="size-3.5" />
            </button>
          )}
        </label>
        <DateRangePicker value={days} onChange={setDays} />
        <Button size="icon-sm" variant="ghost" onClick={toggleTheme} aria-label="Đổi giao diện sáng/tối" title="Đổi giao diện sáng/tối">
          {dark ? <Sun /> : <Moon />}
        </Button>
      </header>
      <div className={cn(
        "grid min-h-0 grid-cols-1",
        collapsed ? "md:grid-cols-[4rem_minmax(0,1fr)]" : "md:grid-cols-[18rem_minmax(0,1fr)]",
        rightPanel && (collapsed ? "xl:grid-cols-[4rem_minmax(0,1fr)_30rem]" : "xl:grid-cols-[18rem_minmax(0,1fr)_30rem]"),
      )}>
        <div className={cn("relative min-h-0", chatId && "hidden md:block")}>
          {/* Collapsed: a 4rem rail that slides open over the content on hover/focus. */}
          <div className={cn(
            "group/side h-full overflow-clip border-r bg-card transition-[width,box-shadow] duration-200",
            collapsed && "md:absolute md:inset-y-0 md:left-0 md:z-20 md:w-16 md:hover:w-72 md:hover:shadow-2xl md:focus-within:w-72",
          )}>
            <div className="h-full md:w-72">
              <ChatList selected={chatId} onSelect={selectChat} range={range} search={search} collapsed={collapsed} />
            </div>
          </div>
          <Button size="icon-xs" variant="outline" onClick={(e) => { e.currentTarget.blur(); toggleCollapsed(); }}
            className="absolute -right-3 top-3 z-40 hidden rounded-full bg-card shadow-sm md:inline-flex"
            aria-label={collapsed ? "Ghim mở rộng thanh bên" : "Thu gọn thanh bên"}
            title={collapsed ? "Ghim mở rộng (đang thu gọn, rê chuột vào thanh bên để xem)" : "Thu gọn thanh bên"}>
            {collapsed ? <ChevronsRight /> : <ChevronsLeft />}
          </Button>
        </div>
        <div className={cn("min-h-0 grid-rows-[auto_minmax(0,1fr)] bg-background", chatId ? "grid" : "hidden md:grid")}>
        <div role="tablist" aria-label="Danh sách tag" className="flex gap-1 border-b bg-card px-3 pt-2">
          {([[ALL, "Việc cần xử lý", InboxIcon], [PINNED, "Tag đã ghim", Pin], [TASKS, "Phiên AI", Bot]] as const).map(([id, label, Icon]) => (
            <button key={id} type="button" role="tab" aria-selected={chatId === id} onClick={() => selectChat(id)}
              className={cn(
                "-mb-px flex items-center gap-1.5 rounded-t-md border-b-2 px-3 py-2 text-sm transition-colors hover:bg-primary/10",
                chatId === id ? "border-primary font-medium text-foreground" : "border-transparent text-muted-foreground",
              )}>
              <Icon className="size-4" aria-hidden /> {label}
              {id === TASKS && runningTasks > 0 && (
                <span className="rounded-full bg-sky-500 px-1.5 text-xs font-semibold text-white tabular-nums">{runningTasks}</span>
              )}
            </button>
          ))}
        </div>
        {chatId ? (
          <div key={chatId} className="grid min-h-0 grid-cols-[minmax(0,1fr)] animate-in fade-in-0 duration-300">
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
          <div className="grid place-items-center">
            <div className="grid justify-items-center gap-2 text-center text-muted-foreground">
              <MessageSquare className="size-10 opacity-40" aria-hidden />
              <p className="text-sm">Chọn một nhóm để xem tin bạn được tag</p>
            </div>
          </div>
        )}
        </div>
        {replyTo ? (
          <div key={`${replyTo.chat_id}:${replyTo.message_id}`}
            className="fixed inset-y-0 right-0 z-30 flex w-full max-w-[30rem] flex-col border-l bg-card shadow-2xl animate-in fade-in-0 slide-in-from-right-12 duration-300 xl:static xl:max-w-none xl:shadow-none">
            <Composer chatId={replyTo.chat_id} youtrackConfigured={status.youtrack_configured ?? false} replyTo={replyTo}
              onClearReply={() => setReplyTo(null)} onSent={() => flashMessage("Đã gửi trả lời ✓")} onTaskCreated={() => flashMessage("Đã giao việc cho AI — theo dõi ở tab “Phiên AI”")} draft={draft}
              aiConfigured={status.ai_configured} />
          </div>
        ) : null}
      </div>
      {flash && (
        <div role="status" className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-full bg-emerald-600 px-4 py-2 text-sm font-medium text-white shadow-lg animate-in fade-in-0 slide-in-from-bottom-4">
          {flash}
        </div>
      )}
    </div>
  );
}
