"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, Inbox as InboxIcon, Menu, MessageSquare, Newspaper, Pin, RotateCw, Search, Send, SlidersHorizontal, Wifi, WifiOff, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useEffectEvent, useRef, useState } from "react";
import { ChatList, useChats } from "@/components/chat-list";
import { Composer, type DraftInjection } from "@/components/composer";
import { DeepThinking } from "@/components/deep-think";
import { BriefingPage } from "@/components/briefing-page";
import { DigestPage } from "@/components/digest-page";
import { MessageList } from "@/components/message-list";
import { TasksPage } from "@/components/tasks-page";
import { Kbd, PendingInbox } from "@/components/pending-inbox";
import { ShortcutsDialog } from "@/components/settings";
import { NavPill, Toaster, TopBar } from "@/components/shell";
import { DateRangePicker, type DayRange, rangeLabel, rangeQuery } from "@/components/date-range";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { type StreamState, useSync } from "@/hooks/use-events";
import { api, type Message, type Status } from "@/lib/api";
import { ALL, BRIEFING, goKey, msgKey, openTask, PINNED, scrollToRow, TASKS, toast, typing, useTaskList } from "@/lib/inbox";
import { getPref, setPref, useRole, usesCode } from "@/lib/prefs";
import { cn } from "@/lib/utils";
import { Hint } from "@/components/ui/hint";

const STATE_LABEL: Record<Status["state"], string> = {
  setup_required: "Chưa cấu hình Telegram: mở Cài đặt Telegram",
  login_required: "Cần đăng nhập: mở Cài đặt Telegram",
  connecting: "Đang kết nối Telegram…",
  connected: "Đã kết nối Telegram",
  degraded: "Không kết nối được Telegram (mạng chặn? bật VPN), đang thử lại",
  stopped: "Đã dừng",
};

const STREAM_LABEL: Record<StreamState, string> = {
  open: "Cập nhật trực tiếp",
  connecting: "Đang nối lại luồng cập nhật…",
  closed: "Luồng cập nhật tạm dừng",
};

// Same motion as the YouTrack module (yt/app.tsx): a sliding highlight on the active nav item, a fade-and-rise between pages.
const PAGE_MOTION = { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, y: -4 }, transition: { duration: 0.18 } } as const;

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
          <p className="text-sm leading-relaxed text-ink-2">Server dashboard trên máy này chưa chạy hoặc vừa dừng. Mở lại app (hoặc chạy lại Start Dashboard Telegram), rồi bấm Thử lại.</p>
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
  const taskList = useTaskList().data ?? [];
  const runningTasks = taskList.filter((t) => t.running).length;
  const codeRole = usesCode(useRole()); // QA / PO: no AI Agent unless they already have sessions
  // Selected chat lives in the query string (static export: no dynamic routes). The inbox only mounts in the browser
  // (after /status), so state starts from the URL and prefs directly, with no first paint on defaults.
  const [chatId, setChatId] = useState<string | null>(() => new URLSearchParams(location.search).get("chat") ?? ALL); // default: cross-group to-do list
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [focus, setFocus] = useState<string | null>(null); // item to show in the opened view: a message, or a task on AI Agent
  const [digest, setDigest] = useState(false); // the Digest view replaces the group's tag list
  const [named, setNamed] = useState(""); // title of a group opened from Briefing: untagged ones are not in the chat list
  const [draft, setDraft] = useState<DraftInjection | null>(null);
  // "Từ lúc" filter: datetime-local text (local time) -> ISO instant for the API.
  const [days, setDays] = useState<DayRange>({ from: "", to: "" });
  const range = rangeQuery(days);
  const pendingTotal = (useChats(range).data?.items ?? []).reduce((n, c) => n + c.pending_count, 0);
  // One search box: across groups on Việc cần xử lý / Ghim, within the group when one is open.
  const [search, setSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false); // phones: the box opens from an icon
  // First run: go straight to the Telegram setup (API ID/Hash, then login) on the settings page.
  const router = useRouter();
  const [firstRun] = useState(() => status.state === "setup_required" || status.state === "login_required");
  useEffect(() => { if (firstRun) router.replace("/settings/#telegram"); }, [firstRun, router]);
  // Sidebar: pinned open or a hover-to-open rail (remembered per browser).
  const [collapsed, setCollapsed] = useState(() => getPref("sidebarCollapsed") === "1");
  function toggleCollapsed() {
    setPref("sidebarCollapsed", collapsed ? "0" : "1");
    setCollapsed(!collapsed);
  }
  const qc = useQueryClient();
  const flashMessage = (text: string) => toast({ text });
  const [shortcuts, setShortcuts] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const [headSlot, setHeadSlot] = useState<HTMLDivElement | null>(null);
  // Global keys outside text fields: ? shortcuts, / search, g then i / p / a / b a page (z undo lives in the Toaster).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (typing(e)) return;
      if (goKey.take()) {
        const to = { i: ALL, p: PINNED, a: TASKS, b: BRIEFING }[e.key.toLowerCase()];
        if (to && views.some(([id]) => id === to)) go(to);
        else return;
      } else if (e.key === "g") goKey.arm();
      else if (e.key === "?") setShortcuts(true);
      else if (e.key === "/") {
        setSearchOpen(true);
        requestAnimationFrame(() => searchRef.current?.focus());
      } else return;
      e.preventDefault();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  // After a tag is answered or marked done, open the next open one below it (or above, at the end of the list).
  const listItems = useRef<Message[]>([]);
  // `dir` 0: after a send / done (the next one, else the last before it); 1 / -1: Alt+↓ / Alt+↑ in the reply panel.
  function advance(dir: 0 | 1 | -1 = 0) {
    const all = listItems.current;
    const i = all.findIndex((m) => m.chat_id === replyTo?.chat_id && m.message_id === replyTo?.message_id);
    const open = (m: Message, j: number) => j !== i && !m.outgoing && !m.deleted && !m.handled;
    const next = dir < 0 ? all.findLast((m, j) => j < i && open(m, j))
      : all.find((m, j) => j > i && open(m, j)) ?? (dir ? undefined : all.findLast((m, j) => open(m, j)));
    if (dir && !next) return toast({ text: dir > 0 ? "Không còn tag nào phía dưới" : "Không còn tag nào phía trên" });
    setReplyTo(next ?? null);
    setDraft(null);
    if (next) requestAnimationFrame(() => scrollToRow(msgKey(next)));
  }

  // Stable (setters only): the memoised list rows keep their props.
  const useText = useCallback((m: Message, text: string) => {
    setReplyTo(m);
    setDraft({ result: { text, options: [], analysis: "", source_message_ids: [m.message_id], context_revision: "" }, chatId: m.chat_id, nonce: Date.now() });
  }, []);

  // Esc: leave reply mode and clear every selection (dialogs close themselves first).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || document.querySelector("[role=dialog]")) return;
      setReplyTo(null);
      setDraft(null);
      setSearch("");
      setSearchOpen(false);
      (document.activeElement as HTMLElement | null)?.blur();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  function selectChat(id: string | null) {
    setChatId(id);
    setFocus(null); // one-shot: only `go` with a focus id sets it again
    setDigest(false);
    setReplyTo(null);
    setDraft(null);
    setSearch(""); // a search belongs to the page it was typed on
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
  const [jump, setJump] = useState(0);
  function go(id: string | null, focusId?: string) {
    selectChat(id);
    setFocus(focusId ?? null);
    setJump((n) => n + 1);
    setMenuOpen(false);
  }
  // "Mở phiên" on a tagged message (lib/inbox `openTask`)
  const onOpenTask = useEffectEvent((e: Event) => go(TASKS, (e as CustomEvent<string>).detail));
  useEffect(() => {
    addEventListener("open-task", onOpenTask);
    return () => removeEventListener("open-task", onOpenTask);
  }, []);

  const hints: Record<string, string> = {
    [ALL]: "Mọi tin tag bạn chưa xử lý, gom từ các nhóm, cũ nhất lên trước.",
    [PINNED]: "Tin bạn ghim để giữ lại, kể cả khi đã xử lý.",
    [TASKS]: "Phiên AI đọc / sửa code: Giao AI Agent từ tin tag và Đối chiếu BE.",
    [BRIEFING]: "AI tóm tắt nhanh các nhóm: có gì mới, việc gì cần bạn.",
  };
  const views = [
    [ALL, "Việc cần xử lý", pendingTotal, InboxIcon],
    [PINNED, "Tag đã ghim", 0, Pin],
    ...(codeRole || taskList.length ? [[TASKS, "AI Agent", runningTasks, Bot] as const] : []),
    ...(status.ai_configured ? [[BRIEFING, "Briefing", 0, Newspaper] as const] : []),
  ] as const;
  const offline = status.state !== "connected" || stream !== "open";
  // Shown only once the problem lasts a few seconds: a reconnect blip shouldn't flash a banner.
  const [lasting, setLasting] = useState(false);
  useEffect(() => {
    if (!offline) return;
    const t = setTimeout(() => setLasting(true), 4000);
    return () => { clearTimeout(t); setLasting(false); };
  }, [offline]);
  const banner = offline && lasting;
  const filtering = !!(days.from || days.to);
  // Search and the day range filter tag lists; Briefing, Digest and AI Agent have their own (or none).
  const listPage = !!chatId && chatId !== TASKS && chatId !== BRIEFING && !digest;
  const inGroup = listPage && chatId !== ALL && chatId !== PINNED;
  const title = views.find(([id]) => id === chatId)?.[1] ?? chatsData.find((c) => c.chat_id === chatId)?.title ?? ((digest && named) || "Telegram");
  // Rail: labels wait for the rail to open (hover or focus); phones always show them.
  const t = cn("transition-opacity duration-(--dur-micro)", collapsed && "md:opacity-0 md:group-hover/side:opacity-100 md:group-focus-within/side:opacity-100");

  return (
    <div className={cn("grid h-dvh grid-rows-[2.75rem_minmax(0,1fr)] transition-[grid-template-columns] duration-(--dur-short) ease-(--ease-out)", collapsed ? "md:grid-cols-[4rem_minmax(0,1fr)]" : "md:grid-cols-[15.5rem_minmax(0,1fr)]")}>
      <TopBar module="telegram" />
      {menuOpen && <div aria-hidden className="fixed inset-0 z-40 bg-(--scrim) md:hidden animate-in fade-in-0 duration-(--dur-short)" onClick={() => setMenuOpen(false)} />}
      {/* Sidebar, the YouTrack recipe: brand, views, groups, footer (the module switch lives in the top bar). */}
      <aside className={cn(
        "group/side fixed bottom-0 top-0 left-0 z-50 md:top-11 flex w-[15.5rem] flex-col gap-1 border-r bg-paper-2 p-3 transition-[translate,clip-path,box-shadow] duration-(--dur-short) ease-out",
        menuOpen ? "translate-x-0 shadow-pop" : "-translate-x-full",
        "md:translate-x-0 md:shadow-none",
        collapsed && "md:[clip-path:inset(0_calc(100%-4rem)_0_0)] md:hover:[clip-path:inset(0_-3rem_0_0)] md:hover:shadow-pop md:focus-within:[clip-path:inset(0_-3rem_0_0)] md:focus-within:shadow-pop",
      )}>
        <h1 className="sr-only">Telegram Dashboard</h1>
        <div className="mb-2 flex min-h-10 items-center gap-3 px-1.5">
          <span className="grid size-7 shrink-0 place-items-center rounded-[var(--radius-input)] bg-board text-board-type"><Send className="size-4" aria-hidden /></span>
          <span className={cn("grid whitespace-nowrap leading-tight", t)}>
            <span className="text-sm font-semibold">Telegram</span><span className="text-xs text-ink-3">Inbox</span>
          </span>
        </div>
        <nav aria-label="Trang" className="grid gap-1">
          {views.map(([id, label, count, Icon]) => (
            <Hint key={id} title={label} text={hints[id]}><button type="button" aria-current={chatId === id ? "page" : undefined} onClick={() => go(id)} aria-label={label}
              className={cn(
                "relative flex min-h-9 w-full items-center gap-3 rounded-[var(--radius-input)] px-2.5 text-left text-sm font-medium transition-[background-color,color] duration-(--dur-micro)",
                chatId === id ? "font-semibold text-hl-2" : "text-ink-3 hover:bg-paper-3 hover:text-ink",
              )}>
              {chatId === id && <NavPill />}
              <Icon className="relative size-5 shrink-0" aria-hidden />
              <span className={cn("relative flex-1 whitespace-nowrap", t)}>{label}</span>
              {count > 0 && (
                <span className={cn("relative rounded-full px-1.5 font-mono text-xs font-normal leading-5 tabular-nums", t, chatId === id ? "bg-hl text-hl-ink" : "bg-paper-3 text-ink-2")}>
                  <span className="sr-only">(</span>{count}<span className="sr-only">{id === TASKS ? " đang chạy)" : ")"}</span>
                </span>
              )}
            </button></Hint>
          ))}
        </nav>
        {filtering && (
          // The day range also filters the counts here: say so where the counts are.
          <div className={cn("mt-1 flex items-center gap-1 rounded-full bg-paper-3 py-0.5 pr-0.5 pl-2.5 text-xs text-ink-2", t)}>
            <span className="min-w-0 flex-1 truncate">Đang lọc: <b className="font-medium text-ink">{rangeLabel(days)}</b></span>
            <button type="button" aria-label="Bỏ lọc ngày" onClick={() => setDays({ from: "", to: "" })}
              className="grid size-6 shrink-0 place-items-center rounded-full text-ink-3 hover:bg-cotton hover:text-ink">
              <X className="size-3.5" aria-hidden />
            </button>
          </div>
        )}
        <div className="-mx-3 mt-2 min-h-0 flex-1 border-t pt-1">
          <ChatList selected={chatId} onSelect={go} range={range} collapsed={collapsed} />
        </div>
        <div className="-mx-3 grid gap-1 border-t px-3 pt-2">
          <Hint title="Cài đặt Telegram" text="Tài khoản, hàng chờ, mẫu trả lời, tự đánh dấu đã xử lý.">
            <Link href="/settings/#telegram"
              className="flex min-h-9 w-full items-center gap-3 rounded-[var(--radius-input)] px-2.5 text-left text-sm font-medium text-ink-3 transition-[background-color,color] duration-(--dur-micro) hover:bg-paper-3 hover:text-ink">
              <SlidersHorizontal className="size-5 shrink-0" aria-hidden />
              <span className={cn("whitespace-nowrap", t)}>Cài đặt Telegram</span>
            </Link>
          </Hint>
          <div className="flex min-h-10 items-center gap-3 px-2.5 text-xs">
            <Hint text={`${STATE_LABEL[status.state]}. ${STREAM_LABEL[stream]}.`}>
              <span data-testid="tg-state" className={cn("shrink-0", connected ? "text-ok" : "text-warn")}>
                {connected ? <Wifi className="size-5" aria-hidden /> : <WifiOff className="size-5" aria-hidden />}
                <span className="sr-only">{connected ? "Đã kết nối" : STATE_LABEL[status.state]}</span>
              </span>
            </Hint>
            <span className={cn("grid min-w-0 leading-tight", t)}>
              <span className={cn("truncate font-medium", connected ? "text-ink-2" : "text-warn")}>{connected ? "Đã kết nối" : STATE_LABEL[status.state]}</span>
              <span data-testid="stream-state" className={cn("truncate", stream === "open" ? "text-ink-3" : "text-warn")}>{STREAM_LABEL[stream]}</span>
            </span>
          </div>
        </div>
      </aside>
      <div className="hidden md:block" aria-hidden />

      <div className="grid min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)]">
        <header className="flex min-h-14 flex-wrap items-center gap-x-4 gap-y-2 border-b px-3 py-2 sm:px-6">
          <Hint side="bottom" text="Thu gọn / mở rộng menu">
            <Button size="icon-sm" variant="ghost" onClick={(e) => { e.currentTarget.blur(); toggleMenu(); }}
              aria-label="Thu gọn / mở rộng menu" aria-expanded={menuOpen}>
              <Menu />
            </Button>
          </Hint>
          <h2 className="min-w-0 flex-1 truncate text-lg font-semibold tracking-[-0.01em] sm:flex-none">{title}</h2>
          {/* AI Agent puts its session tabs here (portal) instead of search and range, which it doesn't use. */}
          <div ref={setHeadSlot} className={cn("min-w-0 flex-1", chatId !== TASKS && "hidden")} />
          {listPage && <div className={cn("ml-auto flex min-w-0 flex-1 items-center justify-end gap-2", searchOpen && "max-sm:order-last max-sm:basis-full")}>
            {!searchOpen && (
              <Button size="icon-sm" variant="ghost" className="sm:hidden" aria-label="Tìm kiếm" onClick={() => { setSearchOpen(true); requestAnimationFrame(() => searchRef.current?.focus()); }}>
                <Search />
              </Button>
            )}
            <label className={cn("relative w-full min-w-40 max-w-80 max-sm:max-w-none sm:block", searchOpen ? "block" : "hidden")}>
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-3" aria-hidden />
              <input
                ref={searchRef}
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onBlur={() => { if (!search) setSearchOpen(false); }}
                placeholder={inGroup ? "Tìm trong nhóm này…" : "Tìm ở mọi nhóm…"}
                aria-label={inGroup ? "Tìm tin tag trong nhóm này" : "Tìm tin tag ở mọi nhóm"}
                className="h-9 w-full rounded-[var(--radius-input)] border border-rule-2 bg-cotton pl-9 pr-9 text-sm text-ink transition-[border-color] duration-(--dur-micro) placeholder:text-ink-3 hover:border-ink-3 focus-visible:-outline-offset-1 [&::-webkit-search-cancel-button]:hidden"
              />
              {!search && <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2" aria-hidden><Kbd>/</Kbd></span>}
              {search && (
                <button type="button" aria-label="Xóa tìm kiếm" onClick={() => setSearch("")}
                  className="absolute right-1.5 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-sm text-ink-3 hover:bg-paper-3 hover:text-ink">
                  <X className="size-3.5" aria-hidden />
                </button>
              )}
            </label>
            <DateRangePicker value={days} onChange={setDays} />
          </div>}
        </header>
        {/* The page sits in one card, like the YouTrack ledger. A reply opens as a detail page over the list, which stays
            mounted (hidden) so its scroll and "next tag" order survive. */}
        {banner && (
          <div role="status" className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b bg-warn-wash px-3 py-1.5 text-xs text-warn sm:px-6">
            <WifiOff className="size-4 shrink-0" aria-hidden />
            <span className="min-w-0 flex-1">
              {status.state !== "connected" ? STATE_LABEL[status.state] : STREAM_LABEL[stream]}. Danh sách có thể chưa mới.
            </span>
            {status.state === "setup_required" || status.state === "login_required"
              ? <Link href="/settings/#telegram" className="font-semibold underline underline-offset-4">Mở Cài đặt Telegram</Link>
              : <Button size="xs" variant="outline" onClick={() => void qc.invalidateQueries()}><RotateCw /> Thử lại</Button>}
          </div>
        )}
        <div className="min-h-0 min-w-0 p-2 sm:p-4 lg:p-5">
          <div className="grid h-full min-h-0 grid-cols-[minmax(0,1fr)] overflow-hidden rounded-[var(--radius-card)] bg-cotton shadow-stock">
            <div className={cn("grid min-h-0 grid-cols-[minmax(0,1fr)]", replyTo && "hidden")}>
            <AnimatePresence mode="wait">
            {chatId ? (
              <motion.div key={`${chatId}:${digest}`} className="grid min-h-0 grid-cols-[minmax(0,1fr)]" {...PAGE_MOTION}>
                {chatId === BRIEFING ? (
                  <BriefingPage onBack={() => go(ALL)} onOpenDigest={(id, name) => { go(id); setNamed(name); setDigest(true); }} />
                ) : chatId === TASKS ? (
                  // keyed by focus: "Mở phiên" while already on AI Agent selects the new session
                  <TasksPage key={focus ?? ""} focus={focus} headSlot={headSlot} onOpenGroup={go} onUseText={useText} />
                ) : chatId === ALL || chatId === PINNED ? (
                  <PendingInbox pinned={chatId === PINNED} range={range} search={search} onClearSearch={() => setSearch("")} replyTo={replyTo && msgKey(replyTo)} onReply={setReplyTo}
                    onBack={() => setMenuOpen(true)} onUseText={useText} itemsRef={listItems} jump={jump} />
                ) : digest ? (
                  <DigestPage chatId={chatId} title={title} onBack={() => (chatsData.some((c) => c.chat_id === chatId) ? setDigest(false) : go(BRIEFING))} />
                ) : (
                <MessageList
                  onDigest={status.ai_configured ? () => { setReplyTo(null); setFocus(null); setDigest(true); } : undefined}
                  onUseText={useText}
                  chatId={chatId}
                  title={title}
                  search={search}
                  focus={focus}
                  range={range}
                  onBack={() => go(ALL)}
                  replyTo={replyTo && msgKey(replyTo)}
                  onReply={setReplyTo}
                  itemsRef={listItems}
                />
                )}
              </motion.div>
            ) : (
              <motion.div key="empty" className="grid place-items-center p-6" {...PAGE_MOTION}>
                <div className="grid max-w-xs justify-items-center gap-3 text-center">
                  <MessageSquare className="size-6 text-ink-3" aria-hidden />
                  <p className="text-sm text-ink-2">Chọn một nhóm để xem tin bạn được tag</p>
                  <Button size="sm" variant="outline" onClick={() => go(ALL)}>Việc cần xử lý</Button>
                </div>
              </motion.div>
            )}
            </AnimatePresence>
            </div>
            {replyTo && (
              <div key={`${replyTo.chat_id}:${replyTo.message_id}`} className="grid min-h-0 grid-cols-[minmax(0,1fr)] animate-in fade-in-0 slide-in-from-bottom-2 duration-(--dur-short)">
                <Composer chatId={replyTo.chat_id} youtrackConfigured={status.youtrack_configured ?? false} replyTo={replyTo}
              onClearReply={() => setReplyTo(null)} onSent={() => { flashMessage("Đã gửi trả lời"); advance(); }} onDone={() => advance()} onStep={advance}
              onTaskCreated={(id) => toast({ text: "Đã giao AI Agent", action: { label: "Mở phiên", run: () => openTask(id) },
                // Undo = stop the agent and delete the task (same as Xóa on the AI Agent page).
                undo: () => api<void>(`/tasks/${id}`, { method: "DELETE" }).finally(() => qc.invalidateQueries({ queryKey: ["tasks"] })) })} draft={draft}
              aiConfigured={status.ai_configured} groupTitle={chatsData.find((c) => c.chat_id === replyTo.chat_id)?.title} />
              </div>
            )}
          </div>
        </div>
      </div>
      <DeepThinking />
      <ShortcutsDialog open={shortcuts} onOpenChange={setShortcuts} />
      <Toaster />
    </div>
  );
}
