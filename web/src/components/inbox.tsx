"use client";

import { useQuery } from "@tanstack/react-query";
import { Bot, Inbox as InboxIcon, ListChecks, Menu, MessageSquare, Newspaper, Pin, RotateCw, Search, Send, Settings, Wifi, WifiOff, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ChatList, useChats } from "@/components/chat-list";
import { Composer, type DraftInjection } from "@/components/composer";
import { BriefingPage } from "@/components/briefing-page";
import { DigestPage } from "@/components/digest-page";
import { MessageList } from "@/components/message-list";
import { TasksPage } from "@/components/tasks-page";
import { Kbd, PendingInbox } from "@/components/pending-inbox";
import { SettingsDialog, ShortcutsDialog } from "@/components/settings";
import { DateRangePicker, type DayRange, rangeQuery } from "@/components/date-range";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { type StreamState, useSync } from "@/hooks/use-events";
import { api, type Message, type Status } from "@/lib/api";
import { ALL, BRIEFING, PINNED, TASKS, toast, type ToastMsg, useTaskList } from "@/lib/inbox";
import { applyTheme, readTheme } from "@/lib/prefs";
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
  const [digest, setDigest] = useState(false); // the Digest view replaces the group's tag list
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
  // Settings remount on each open (key) so they read fresh values.
  const [settings, setSettings] = useState({ open: false, key: 0 });
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
  // One toast at a time (lib/inbox `toast`); one with an undo stays longer and answers z.
  const [flash, setFlash] = useState<(ToastMsg & { id: number }) | null>(null);
  useEffect(() => {
    const onToast = (e: Event) => setFlash({ ...(e as CustomEvent<ToastMsg>).detail, id: Date.now() });
    addEventListener("toast", onToast);
    return () => removeEventListener("toast", onToast);
  }, []);
  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), flash.undo ? 6000 : 3000);
    return () => clearTimeout(t);
  }, [flash]);
  const flashMessage = (text: string) => toast({ text });
  function undo() {
    const run = flash?.undo;
    if (!run) return;
    setFlash(null);
    Promise.resolve(run()).then(() => toast({ text: "Đã hoàn tác" }), () => toast({ text: "Không hoàn tác được" }));
  }
  const [shortcuts, setShortcuts] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  // Global keys outside text fields: ? shortcuts, / search, z undo.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (e.metaKey || e.ctrlKey || e.altKey || el?.closest("input, textarea, select, [contenteditable], [role=dialog]")) return;
      if (e.key === "?") setShortcuts(true);
      else if (e.key === "/") searchRef.current?.focus();
      else if (e.key === "z" && flash?.undo) undo();
      else return;
      e.preventDefault();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });
  const rightPanel = !!replyTo;

  // After a tag is answered or marked done, open the next open one below it (or above, at the end of the list).
  const listItems = useRef<Message[]>([]);
  function advance() {
    const all = listItems.current;
    const i = all.findIndex((m) => m.chat_id === replyTo?.chat_id && m.message_id === replyTo?.message_id);
    const open = (m: Message, j: number) => j !== i && !m.outgoing && !m.deleted && !m.handled;
    const next = all.find((m, j) => j > i && open(m, j)) ?? all.findLast((m, j) => open(m, j)) ?? null;
    setReplyTo(next);
    setDraft(null);
    if (next) {
      requestAnimationFrame(() =>
        document.querySelector(`[data-id="${next.message_id}"]`)?.scrollIntoView({ block: "nearest", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" }),
      );
    }
  }

  function useText(m: Message, text: string) {
    setReplyTo(m);
    setDraft({ result: { text, options: [], analysis: "", source_message_ids: [m.message_id], context_revision: "" }, chatId: m.chat_id, nonce: Date.now() });
  }
  // "Theo hệ thống": follow the OS when it flips while the page is open.
  useEffect(() => {
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => { if (readTheme() === "system") applyTheme("system", false); };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

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
      setDraft(null);
      setSearch("");
      (document.activeElement as HTMLElement | null)?.blur();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  function selectChat(id: string | null) {
    setChatId(id);
    setDigest(false);
    setReplyTo(null);
    setDraft(null);
    const url = new URL(location.href);
    if (id) url.searchParams.set("chat", id);
    else url.searchParams.delete("chat");
    history.replaceState(null, "", url);
  }

  const connected = status.state === "connected";
  const chatsData = useChats(range).data?.items ?? [];
  // Phones: the sidebar is an off-canvas sheet; desktop: pinned open or a 64px rail that opens on hover/focus.
  const [menuOpen, setMenuOpen] = useState(false);
  function toggleMenu() {
    if (matchMedia("(min-width: 48rem)").matches) toggleCollapsed();
    else setMenuOpen((v) => !v);
  }
  function go(id: string | null) {
    selectChat(id);
    setMenuOpen(false);
  }

  const views = [
    [ALL, "Việc cần xử lý", pendingTotal, InboxIcon],
    [PINNED, "Tag đã ghim", 0, Pin],
    [TASKS, "AI Agent", runningTasks, Bot],
    ...(status.ai_configured ? [[BRIEFING, "Briefing", 0, Newspaper] as const] : []),
  ] as const;
  const title = views.find(([id]) => id === chatId)?.[1] ?? chatsData.find((c) => c.chat_id === chatId)?.title ?? "Telegram";
  // Rail: labels wait for the rail to open (hover or focus); phones always show them.
  const t = cn("transition-opacity duration-(--dur-micro)", collapsed && "md:opacity-0 md:group-hover/side:opacity-100 md:group-focus-within/side:opacity-100");

  return (
    <div className={cn("grid h-dvh transition-[grid-template-columns] duration-(--dur-short) ease-(--ease-out)", collapsed ? "md:grid-cols-[4rem_minmax(0,1fr)]" : "md:grid-cols-[15.5rem_minmax(0,1fr)]")}>
      {menuOpen && <div aria-hidden className="fixed inset-0 z-40 bg-(--scrim) md:hidden animate-in fade-in-0 duration-(--dur-short)" onClick={() => setMenuOpen(false)} />}
      {/* Sidebar, the YouTrack recipe: module switch, brand, views, groups, footer. */}
      <aside className={cn(
        "group/side fixed inset-y-0 left-0 z-50 flex w-[15.5rem] flex-col gap-1 border-r bg-paper-2 p-3 transition-[translate,clip-path,box-shadow] duration-(--dur-short) ease-out",
        menuOpen ? "translate-x-0 shadow-pop" : "-translate-x-full",
        "md:translate-x-0 md:shadow-none",
        collapsed && "md:[clip-path:inset(0_calc(100%-4rem)_0_0)] md:hover:[clip-path:inset(0_-3rem_0_0)] md:hover:shadow-pop md:focus-within:[clip-path:inset(0_-3rem_0_0)] md:focus-within:shadow-pop",
      )}>
        <h1 className="sr-only">Telegram Dashboard</h1>
        <nav aria-label="Chuyển module" className={cn("mb-2 flex gap-0.5 rounded-[var(--radius-card)] bg-paper-3 p-0.5 shadow-groove", collapsed && "md:flex-col md:group-hover/side:flex-row md:group-focus-within/side:flex-row")}>
          <span aria-current="page" className="flex min-h-8 flex-1 items-center gap-2 rounded-[var(--radius-input)] bg-hl px-2 text-sm font-medium text-hl-ink">
            <Send className="size-5 shrink-0" aria-hidden /><span className={cn("whitespace-nowrap", t)}>Telegram</span>
          </span>
          <a href="/yt/" title="Chuyển sang YouTrack Dashboard"
            className="flex min-h-8 flex-1 items-center gap-2 rounded-[var(--radius-input)] px-2 text-sm font-medium text-ink-3 no-underline transition-colors duration-(--dur-micro) hover:text-ink">
            <ListChecks className="size-5 shrink-0" aria-hidden /><span className={cn("whitespace-nowrap", t)}>YouTrack</span>
          </a>
        </nav>
        <div className="mb-2 flex min-h-10 items-center gap-3 px-1.5">
          <span className="grid size-7 shrink-0 place-items-center rounded-[var(--radius-input)] bg-board text-board-type"><Send className="size-4" aria-hidden /></span>
          <span className={cn("grid whitespace-nowrap leading-tight", t)}>
            <span className="text-sm font-semibold">Telegram</span><span className="text-xs text-ink-3">Inbox</span>
          </span>
        </div>
        <nav aria-label="Trang" className="grid gap-1">
          {views.map(([id, label, count, Icon]) => (
            <button key={id} type="button" aria-current={chatId === id ? "page" : undefined} onClick={() => go(id)} title={label}
              className={cn(
                "flex min-h-9 w-full items-center gap-3 rounded-[var(--radius-input)] px-2.5 text-left text-sm font-medium transition-[background-color,color] duration-(--dur-micro)",
                chatId === id ? "bg-hl-wash font-semibold text-hl-2" : "text-ink-3 hover:bg-paper-3 hover:text-ink",
              )}>
              <Icon className="size-5 shrink-0" aria-hidden />
              <span className={cn("flex-1 whitespace-nowrap", t)}>{label}</span>
              {count > 0 && (
                <span className={cn("rounded-full px-1.5 font-mono text-xs font-normal leading-5 tabular-nums", t, chatId === id ? "bg-hl text-hl-ink" : "bg-paper-3 text-ink-2")}>
                  <span className="sr-only">(</span>{count}<span className="sr-only">{id === TASKS ? " đang chạy)" : ")"}</span>
                </span>
              )}
            </button>
          ))}
        </nav>
        <div className="-mx-3 mt-2 min-h-0 flex-1 border-t pt-1">
          <ChatList selected={chatId} onSelect={go} range={range} collapsed={collapsed} />
        </div>
        <div className="-mx-3 grid gap-1 border-t px-3 pt-2">
          <button type="button" onClick={() => setSettings((s) => ({ open: true, key: s.key + 1 }))} title="Cài đặt"
            className="flex min-h-9 w-full items-center gap-3 rounded-[var(--radius-input)] px-2.5 text-left text-sm font-medium text-ink-3 transition-[background-color,color] duration-(--dur-micro) hover:bg-paper-3 hover:text-ink">
            <Settings className="size-5 shrink-0" aria-hidden />
            <span className={cn("whitespace-nowrap", t)}>Cài đặt</span>
          </button>
          <div className="flex min-h-10 items-center gap-3 px-2.5 text-xs">
            <span data-testid="tg-state" title={STATE_LABEL[status.state]} className={cn("shrink-0", connected ? "text-ok" : "text-warn")}>
              {connected ? <Wifi className="size-5" aria-hidden /> : <WifiOff className="size-5" aria-hidden />}
              <span className="sr-only">{connected ? "Đã kết nối" : STATE_LABEL[status.state]}</span>
            </span>
            <span className={cn("grid min-w-0 leading-tight", t)}>
              <span className={cn("truncate font-medium", connected ? "text-ink-2" : "text-warn")}>{connected ? "Đã kết nối" : STATE_LABEL[status.state]}</span>
              <span data-testid="stream-state" className={cn("truncate", stream === "open" ? "text-ink-3" : "text-warn")}>{STREAM_LABEL[stream]}</span>
            </span>
          </div>
        </div>
      </aside>
      <div className="hidden md:block" aria-hidden />

      <div className={cn("grid min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)]", rightPanel && "xl:grid-cols-[minmax(0,1fr)_30rem]")}>
        <header className={cn("flex min-h-14 flex-wrap items-center gap-x-4 gap-y-2 border-b px-3 py-2 sm:px-6", rightPanel && "xl:col-span-2")}>
          <Button size="icon-sm" variant="ghost" onClick={(e) => { e.currentTarget.blur(); toggleMenu(); }}
            aria-label="Thu gọn / mở rộng menu" title="Thu gọn / mở rộng menu" aria-expanded={menuOpen}>
            <Menu />
          </Button>
          <h2 className="min-w-0 flex-1 truncate text-lg font-semibold tracking-[-0.01em] sm:flex-none">{title}</h2>
          <div className="ml-auto flex min-w-0 flex-1 items-center justify-end gap-2">
            <label className="relative hidden w-full min-w-40 max-w-80 sm:block">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-3" aria-hidden />
              <input
                ref={searchRef}
                type="search"
                value={search}
                onChange={(e) => onSearch(e.target.value)}
                placeholder="Tìm nội dung tin tag…"
                aria-label="Tìm nội dung tin tag"
                className="h-9 w-full rounded-[var(--radius-input)] border border-rule-2 bg-cotton pl-9 pr-9 text-sm text-ink transition-[border-color] duration-(--dur-micro) placeholder:text-ink-3 hover:border-ink-3 focus-visible:-outline-offset-1 [&::-webkit-search-cancel-button]:hidden"
              />
              {!search && <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2" aria-hidden><Kbd>/</Kbd></span>}
              {search && (
                <button type="button" aria-label="Xóa tìm kiếm" onClick={() => onSearch("")}
                  className="absolute right-1.5 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-sm text-ink-3 hover:bg-paper-3 hover:text-ink">
                  <X className="size-3.5" aria-hidden />
                </button>
              )}
            </label>
            <DateRangePicker value={days} onChange={setDays} />
          </div>
        </header>
        {/* The page sits in one card, like the YouTrack ledger. */}
        <div className="min-h-0 min-w-0 p-2 sm:p-4 lg:p-5">
          <div className="grid h-full min-h-0 grid-cols-[minmax(0,1fr)] overflow-hidden rounded-[var(--radius-card)] bg-cotton shadow-stock">
            {chatId ? (
              <div key={chatId} className="grid min-h-0 grid-cols-[minmax(0,1fr)] animate-in fade-in-0 slide-in-from-bottom-1 duration-(--dur-short) ease-(--ease-out)">
                {chatId === BRIEFING ? (
                  <BriefingPage onBack={() => go(ALL)} onOpenDigest={(id) => { go(id); setDigest(true); }} />
                ) : chatId === TASKS ? (
                  <TasksPage onBack={() => go(ALL)} onOpenGroup={go} onUseText={useText} />
                ) : chatId === ALL || chatId === PINNED ? (
                  <PendingInbox pinned={chatId === PINNED} range={range} search={search} replyTo={replyTo?.message_id ?? null} onReply={setReplyTo}
                    onBack={() => setMenuOpen(true)} onUseText={useText} itemsRef={listItems} />
                ) : digest ? (
                  <DigestPage chatId={chatId} title={title} onBack={() => setDigest(false)} />
                ) : (
                <MessageList
                  onDigest={status.ai_configured ? () => { setReplyTo(null); setDigest(true); } : undefined}
                  onUseText={useText}
                  chatId={chatId}
                  range={range}
                  onBack={() => go(ALL)}
                  replyTo={replyTo?.message_id ?? null}
                  onReply={setReplyTo}
                  itemsRef={listItems}
                />
                )}
              </div>
            ) : (
              <div className="grid place-items-center p-6">
                <div className="grid max-w-xs justify-items-center gap-3 text-center">
                  <MessageSquare className="size-6 text-ink-3" aria-hidden />
                  <p className="text-sm text-ink-2">Chọn một nhóm để xem tin bạn được tag</p>
                  <Button size="sm" variant="outline" onClick={() => go(ALL)}>Việc cần xử lý</Button>
                </div>
              </div>
            )}
          </div>
        </div>
        {replyTo ? (
          <div key={`${replyTo.chat_id}:${replyTo.message_id}`}
            className="fixed inset-y-0 right-0 z-30 flex w-full max-w-[30rem] flex-col border-l bg-cotton shadow-pop animate-in fade-in-0 slide-in-from-right-8 duration-(--dur-short) xl:static xl:row-start-2 xl:col-start-2 xl:max-w-none xl:shadow-none">
            <Composer chatId={replyTo.chat_id} youtrackConfigured={status.youtrack_configured ?? false} replyTo={replyTo}
              onClearReply={() => setReplyTo(null)} onSent={() => { flashMessage("Đã gửi trả lời ✓"); advance(); }} onDone={advance} onTaskCreated={() => flashMessage("Đã giao việc cho AI. Theo dõi ở tab “AI Agent”")} draft={draft}
              aiConfigured={status.ai_configured} />
          </div>
        ) : null}
      </div>
      <SettingsDialog key={settings.key} open={settings.open} onOpenChange={(open) => setSettings((s) => ({ ...s, open }))} status={status} stream={stream} />
      <ShortcutsDialog open={shortcuts} onOpenChange={setShortcuts} />
      {flash && (
        <div key={flash.id} role="status" className="fixed bottom-[calc(1rem+env(safe-area-inset-bottom,0px))] left-1/2 z-50 flex max-w-[calc(100%-2rem)] -translate-x-1/2 items-center gap-3 rounded-md bg-board py-1.5 pr-1.5 pl-4 text-sm font-medium text-board-type shadow-pop animate-in fade-in-0 slide-in-from-bottom-2 duration-(--dur-short) ease-(--ease-out)">
          <span className="py-1">{flash.text}</span>
          {flash.undo && (
            <button type="button" onClick={undo} title="Hoàn tác (z)"
              className="rounded-[var(--radius-input)] px-2.5 py-1 font-semibold underline decoration-board-type/40 underline-offset-4 transition-colors duration-(--dur-micro) hover:bg-board-type/15 hover:decoration-board-type">
              Hoàn tác
            </button>
          )}
        </div>
      )}
    </div>
  );
}
